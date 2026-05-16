package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"net"
	"os"
	"strings"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
	"golang.org/x/net/ipv6"

	"github.com/looking-glass/agent/internal/validator"
)

type PingOptions struct {
	Count      int  `json:"count"`
	TimeoutSec int  `json:"timeout_sec"`
	IntervalMs int  `json:"interval_ms"`
	SizeBytes  int  `json:"size_bytes"`
	IPv6       bool `json:"ipv6"`
}

type PingReply struct {
	Seq   int     `json:"seq"`
	RTTMs float64 `json:"rtt_ms"`
	TTL   int     `json:"ttl"`
}

type PingResult struct {
	Target      string      `json:"target"`
	ResolvedIP  string      `json:"resolved_ip"`
	Transmitted int         `json:"transmitted"`
	Received    int         `json:"received"`
	LossPercent float64     `json:"loss_percent"`
	RTTMinMs    float64     `json:"rtt_min_ms"`
	RTTAvgMs    float64     `json:"rtt_avg_ms"`
	RTTMaxMs    float64     `json:"rtt_max_ms"`
	Replies     []PingReply `json:"replies"`
}

type PingRunner struct{}

func (PingRunner) Name() string { return "ping" }

func (PingRunner) Run(ctx context.Context, task Task) (*Result, error) {
	var opts PingOptions
	if len(task.Options) > 0 {
		if err := json.Unmarshal(task.Options, &opts); err != nil {
			return nil, fmt.Errorf("parse options: %w", err)
		}
	}
	if opts.Count == 0 {
		opts.Count = 5
	}
	if opts.TimeoutSec == 0 {
		opts.TimeoutSec = 5
	}
	if opts.IntervalMs == 0 {
		opts.IntervalMs = 1000
	}
	if opts.SizeBytes == 0 {
		opts.SizeBytes = 56
	}

	// Resolve + validate target (agent-side, in addition to server).
	resolved, err := validator.ResolveAndCheck(task.Target)
	if err != nil {
		return failed(task, err.Error())
	}
	ip, err := pickIP(resolved, opts.IPv6)
	if err != nil {
		return failed(task, err.Error())
	}

	start := time.Now()
	result, runErr := runPing(ctx, ip, opts)
	duration := int(time.Since(start) / time.Millisecond)

	if runErr != nil {
		return failed(task, runErr.Error())
	}
	result.Target = task.Target
	result.ResolvedIP = ip.String()

	parsed, _ := json.Marshal(result)
	stdout := renderPingStdout(result)
	exit := 0
	status := StatusCompleted
	if result.Received == 0 {
		exit = 1
		status = StatusFailed
	}
	return &Result{
		Stdout:     stdout,
		ExitCode:   &exit,
		DurationMs: duration,
		ParsedJSON: parsed,
		Status:     status,
	}, nil
}

// pickIP returns the first address matching the requested family.
//
// We do NOT fall back to the other family. Callers (mtr, traceroute, ping)
// pass the family choice as a separate `-4`/`-6` flag to the underlying tool,
// so silently returning an IPv6 literal when the caller asked for IPv4 would
// produce a confusing `mtr -4 2001:db8::1` invocation that fails at the tool
// level instead of at task validation.
func pickIP(addrs []net.IP, preferV6 bool) (net.IP, error) {
	if len(addrs) == 0 {
		return nil, errors.New("no addresses for target")
	}
	for _, a := range addrs {
		isV6 := a.To4() == nil
		if isV6 == preferV6 {
			return a, nil
		}
	}
	family := "IPv4"
	if preferV6 {
		family = "IPv6"
	}
	return nil, fmt.Errorf("target has no %s address", family)
}

func runPing(ctx context.Context, ip net.IP, opts PingOptions) (*PingResult, error) {
	isV6 := ip.To4() == nil

	var (
		network string
		listen  string
		proto   int
		msgType icmp.Type
	)
	if isV6 {
		network, listen, proto, msgType = "ip6:ipv6-icmp", "::", 58, ipv6.ICMPTypeEchoRequest
	} else {
		network, listen, proto, msgType = "ip4:icmp", "0.0.0.0", 1, ipv4.ICMPTypeEcho
	}

	conn, err := icmp.ListenPacket(network, listen)
	if err != nil {
		return nil, fmt.Errorf("open icmp socket: %w (need CAP_NET_RAW)", err)
	}
	defer conn.Close()

	// Read TTL on incoming packets so we can report it.
	if !isV6 {
		_ = conn.IPv4PacketConn().SetControlMessage(ipv4.FlagTTL, true)
	} else {
		_ = conn.IPv6PacketConn().SetControlMessage(ipv6.FlagHopLimit, true)
	}

	id := int(uint16(os.Getpid())) ^ rand.IntN(0xffff)
	payload := makePayload(opts.SizeBytes)

	result := &PingResult{
		Replies:  make([]PingReply, 0, opts.Count),
		RTTMinMs: math.MaxFloat64,
	}

	interval := time.Duration(opts.IntervalMs) * time.Millisecond
	timeout := time.Duration(opts.TimeoutSec) * time.Second
	dst := &net.IPAddr{IP: ip}

	for seq := 0; seq < opts.Count; seq++ {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		msg := icmp.Message{
			Type: msgType, Code: 0,
			Body: &icmp.Echo{
				ID: id, Seq: seq + 1,
				Data: payload,
			},
		}
		buf, err := msg.Marshal(nil)
		if err != nil {
			return result, fmt.Errorf("marshal icmp: %w", err)
		}

		sendStart := time.Now()
		if _, err := conn.WriteTo(buf, dst); err != nil {
			return result, fmt.Errorf("send icmp: %w", err)
		}
		result.Transmitted++

		_ = conn.SetReadDeadline(time.Now().Add(timeout))
		reply, ttl, ok := readReply(conn, isV6, proto, id, seq+1)
		if ok {
			rttMs := float64(time.Since(sendStart)) / float64(time.Millisecond)
			result.Received++
			result.RTTMinMs = math.Min(result.RTTMinMs, rttMs)
			result.RTTMaxMs = math.Max(result.RTTMaxMs, rttMs)
			result.RTTAvgMs += rttMs
			result.Replies = append(result.Replies, PingReply{
				Seq: reply.Seq, RTTMs: round(rttMs, 3), TTL: ttl,
			})
		}

		if seq < opts.Count-1 {
			select {
			case <-ctx.Done():
				return result, ctx.Err()
			case <-time.After(interval):
			}
		}
	}

	if result.Received == 0 {
		result.RTTMinMs = 0
	} else {
		result.RTTAvgMs = round(result.RTTAvgMs/float64(result.Received), 3)
	}
	result.RTTMinMs = round(result.RTTMinMs, 3)
	result.RTTMaxMs = round(result.RTTMaxMs, 3)
	if result.Transmitted > 0 {
		result.LossPercent = round(
			float64(result.Transmitted-result.Received)*100/float64(result.Transmitted),
			2,
		)
	}
	return result, nil
}

func readReply(
	conn *icmp.PacketConn, isV6 bool, proto, wantID, wantSeq int,
) (*icmp.Echo, int, bool) {
	buf := make([]byte, 1500)
	for {
		var (
			n   int
			ttl int
			err error
		)
		if !isV6 {
			var cm *ipv4.ControlMessage
			n, cm, _, err = conn.IPv4PacketConn().ReadFrom(buf)
			if cm != nil {
				ttl = cm.TTL
			}
		} else {
			var cm *ipv6.ControlMessage
			n, cm, _, err = conn.IPv6PacketConn().ReadFrom(buf)
			if cm != nil {
				ttl = cm.HopLimit
			}
		}
		if err != nil {
			return nil, 0, false
		}
		msg, err := icmp.ParseMessage(proto, buf[:n])
		if err != nil {
			continue
		}
		echo, ok := msg.Body.(*icmp.Echo)
		if !ok {
			continue
		}
		// Match our id+seq — otherwise it's a stale or someone-else's reply.
		if echo.ID != wantID || echo.Seq != wantSeq {
			continue
		}
		return echo, ttl, true
	}
}

func makePayload(size int) []byte {
	if size < 8 {
		size = 8
	}
	p := make([]byte, size)
	for i := range p {
		p[i] = byte(i & 0xff)
	}
	return p
}

func round(v float64, digits int) float64 {
	pow := math.Pow(10, float64(digits))
	return math.Round(v*pow) / pow
}

func renderPingStdout(r *PingResult) string {
	var b strings.Builder
	fmt.Fprintf(&b, "PING %s (%s)\n", r.Target, r.ResolvedIP)
	for _, rep := range r.Replies {
		fmt.Fprintf(&b, "icmp_seq=%d ttl=%d time=%.3f ms\n", rep.Seq, rep.TTL, rep.RTTMs)
	}
	fmt.Fprintf(&b, "--- %s ping statistics ---\n", r.Target)
	fmt.Fprintf(&b,
		"%d packets transmitted, %d received, %.1f%% packet loss\n",
		r.Transmitted, r.Received, r.LossPercent,
	)
	if r.Received > 0 {
		fmt.Fprintf(&b,
			"rtt min/avg/max = %.3f/%.3f/%.3f ms\n",
			r.RTTMinMs, r.RTTAvgMs, r.RTTMaxMs,
		)
	}
	return b.String()
}

func failed(_ Task, msg string) (*Result, error) {
	exit := 1
	return &Result{
		Stderr:   msg,
		ExitCode: &exit,
		Status:   StatusFailed,
		Error:    &msg,
	}, nil
}
