package tasks

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/looking-glass/agent/internal/validator"
)

type MTROptions struct {
	Cycles  int  `json:"cycles"`
	MaxHops int  `json:"max_hops"`
	IPv6    bool `json:"ipv6"`
}

type MTRRunner struct{}

func (MTRRunner) Name() string { return "mtr" }

func (MTRRunner) Run(ctx context.Context, task Task) (*Result, error) {
	var opts MTROptions
	if err := json.Unmarshal(task.Options, &opts); err != nil {
		return nil, fmt.Errorf("parse options: %w", err)
	}
	if opts.Cycles <= 0 {
		opts.Cycles = 10
	}
	if opts.MaxHops <= 0 {
		opts.MaxHops = 30
	}
	// Defense-in-depth: clamp to the same caps the server enforces. Keeps a
	// compromised or buggy server from asking the agent to run an mtr that
	// never terminates (cycles=10000) or scans absurd hop counts.
	if opts.Cycles > 100 {
		opts.Cycles = 100
	}
	if opts.MaxHops > 64 {
		opts.MaxHops = 64
	}

	addrs, err := validator.ResolveAndCheck(task.Target)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}
	ip, err := pickIP(addrs, opts.IPv6)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}

	return runMTR(ctx, task.Target, ip.String(), opts.Cycles, opts.MaxHops, opts.IPv6, 0, false)
}

// runMTR is shared between mtr and mtr_tcp.
//
// We use `mtr --raw` instead of `--json` because --json buffers everything
// until completion — no live data. --raw emits one event per line as probes
// happen, which lets us stream a hop table to the UI.
//
// Per-event protocol (with a ChunkSender in ctx):
//   stream="stdout" — the raw mtr line, for the textual LiveOutput viewer
//   stream="event"  — JSON like {"type":"mtr_probe","hop":1,"rtt_ms":4.2}
//                     consumed by the LiveTaskChart hop-table renderer
//
// The final parsed_json mirrors the shape of `mtr --json` so MTRResultView
// keeps working unchanged for completed tasks.
func runMTR(
	ctx context.Context, target, ip string, cycles, maxHops int, ipv6 bool,
	port int, useTCP bool,
) (*Result, error) {
	args := []string{
		"--raw",
		"--report-cycles", strconv.Itoa(cycles),
		"-m", strconv.Itoa(maxHops),
	}
	if useTCP {
		args = append(args, "--tcp", "--port", strconv.Itoa(port))
	}
	if ipv6 {
		args = append(args, "-6")
	} else {
		args = append(args, "-4")
	}
	args = append(args, ip)

	// stdbuf forces line-buffered stdout so events arrive in real time.
	stdbufArgs := append([]string{"-oL", "mtr"}, args...)
	cmd := exec.CommandContext(ctx, "stdbuf", stdbufArgs...)

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return failedResult("mtr stdout pipe: "+err.Error(), 0), nil
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return failedResult("mtr stderr pipe: "+err.Error(), 0), nil
	}

	start := time.Now()
	if err := cmd.Start(); err != nil {
		return failedResult("mtr spawn: "+err.Error(), 0), nil
	}

	state := newMTRState(cycles)
	sender := SenderFromCtx(ctx)

	// Drain stderr in the background so the pipe buffer doesn't fill and
	// block the child. String() below blocks until io.Copy returns, which
	// avoids a data race between the draining goroutine and the read.
	stderrDrain := drainPipeAsync(stderrPipe)

	scanner := bufio.NewScanner(stdoutPipe)
	scanner.Buffer(make([]byte, 0, 64*1024), 1*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if sender != nil {
			sender("stdout", line)
		}
		if ev, ok := parseMTRRawLine(line); ok {
			state.apply(ev)
			if sender != nil {
				if payload, err := json.Marshal(ev); err == nil {
					sender("event", string(payload))
				}
			}
		}
	}
	scanErr := scanner.Err()

	_ = cmd.Wait()
	duration := int(time.Since(start) / time.Millisecond)

	parsed := state.buildReport(target, ip)
	combined := stderrDrain.String()
	if scanErr != nil {
		// Treat as partial: stdout truncation produces a parsed report with
		// whatever we managed to collect. Surface the reason in stderr.
		if combined != "" {
			combined += "\n"
		}
		combined += "stdout scan error: " + scanErr.Error()
	}
	return resultFromJSON(parsed, combined, duration)
}

// --- MTR --raw event parsing & state ---------------------------------

type mtrEvent struct {
	Type   string  `json:"type"`           // mtr_hop | mtr_probe | mtr_dns
	Hop    int     `json:"hop"`            // 0-based as emitted by mtr
	IP     string  `json:"ip,omitempty"`   // for mtr_hop
	Host   string  `json:"host,omitempty"` // for mtr_dns
	RTTMs  float64 `json:"rtt_ms,omitempty"`
}

// parseMTRRawLine parses one line of `mtr --raw` output.
// Examples:
//   "h 0 192.168.1.1"
//   "p 0 12345"     (rtt in microseconds)
//   "d 0 router.example.com"
func parseMTRRawLine(line string) (mtrEvent, bool) {
	parts := strings.Fields(line)
	if len(parts) < 3 {
		return mtrEvent{}, false
	}
	hop, err := strconv.Atoi(parts[1])
	if err != nil {
		return mtrEvent{}, false
	}
	switch parts[0] {
	case "h":
		return mtrEvent{Type: "mtr_hop", Hop: hop, IP: parts[2]}, true
	case "p":
		us, err := strconv.Atoi(parts[2])
		if err != nil {
			return mtrEvent{}, false
		}
		return mtrEvent{Type: "mtr_probe", Hop: hop, RTTMs: float64(us) / 1000.0}, true
	case "d":
		return mtrEvent{Type: "mtr_dns", Hop: hop, Host: strings.Join(parts[2:], " ")}, true
	}
	return mtrEvent{}, false
}

type mtrHopState struct {
	ip   string
	dns  string
	rtts []float64
}

type mtrState struct {
	cycles int
	hops   map[int]*mtrHopState
}

func newMTRState(cycles int) *mtrState {
	return &mtrState{cycles: cycles, hops: map[int]*mtrHopState{}}
}

func (s *mtrState) apply(e mtrEvent) {
	h, ok := s.hops[e.Hop]
	if !ok {
		h = &mtrHopState{}
		s.hops[e.Hop] = h
	}
	switch e.Type {
	case "mtr_hop":
		h.ip = e.IP
	case "mtr_dns":
		h.dns = e.Host
	case "mtr_probe":
		h.rtts = append(h.rtts, e.RTTMs)
	}
}

// buildReport produces a payload shaped like `mtr --json` so the existing
// MTRResultView can render it unchanged. The "hubs" array is the meaningful
// part; "mtr" / "report" wrapping is preserved for compatibility.
func (s *mtrState) buildReport(target, ip string) map[string]any {
	if len(s.hops) == 0 {
		return map[string]any{
			"target":      target,
			"resolved_ip": ip,
			"report": map[string]any{
				"mtr":  map[string]any{"src": "", "dst": target, "tests": s.cycles},
				"hubs": []any{},
			},
		}
	}
	indices := make([]int, 0, len(s.hops))
	for k := range s.hops {
		indices = append(indices, k)
	}
	sort.Ints(indices)

	hubs := make([]map[string]any, 0, len(indices))
	for _, idx := range indices {
		h := s.hops[idx]
		host := h.ip
		if h.dns != "" {
			host = h.dns
		}
		if host == "" {
			host = "???"
		}
		best, worst, avg, stdev := stats(h.rtts)
		recv := len(h.rtts)
		lossPct := 0.0
		if s.cycles > 0 {
			lossPct = float64(s.cycles-recv) * 100.0 / float64(s.cycles)
			if lossPct < 0 {
				lossPct = 0
			}
		}
		var last float64
		if recv > 0 {
			last = round3(h.rtts[len(h.rtts)-1])
		}
		hubs = append(hubs, map[string]any{
			"count": idx + 1,
			"host":  host,
			"Loss%": round3(lossPct),
			"Snt":   s.cycles,
			"Last":  last,
			"Avg":   round3(avg),
			"Best":  round3(best),
			"Wrst":  round3(worst),
			"StDev": round3(stdev),
		})
	}
	return map[string]any{
		"target":      target,
		"resolved_ip": ip,
		"report": map[string]any{
			"mtr":  map[string]any{"src": "", "dst": target, "tests": s.cycles},
			"hubs": hubs,
		},
	}
}

func stats(rtts []float64) (best, worst, avg, stdev float64) {
	if len(rtts) == 0 {
		return
	}
	best = math.MaxFloat64
	worst = 0
	var sum float64
	for _, v := range rtts {
		if v < best {
			best = v
		}
		if v > worst {
			worst = v
		}
		sum += v
	}
	avg = sum / float64(len(rtts))
	var ss float64
	for _, v := range rtts {
		d := v - avg
		ss += d * d
	}
	if len(rtts) > 1 {
		stdev = math.Sqrt(ss / float64(len(rtts)-1))
	}
	return
}

func round3(v float64) float64 {
	return math.Round(v*1000) / 1000
}

// pipeDrain reads everything from a pipe into a buffer in a background
// goroutine. Calling String() blocks until io.Copy returns — must be called
// after cmd.Wait() so the pipe is closed and the drain has completed.
//
// The previous implementation assigned to a plain string field from the
// goroutine and let the caller read it after cmd.Wait(); cmd.Wait() does not
// synchronize with the draining goroutine, so the read raced with the write
// and stderr was almost always empty in the final result.
type pipeDrain struct {
	buf  bytes.Buffer
	done chan struct{}
}

func (d *pipeDrain) String() string {
	<-d.done
	return d.buf.String()
}

func drainPipeAsync(r io.Reader) *pipeDrain {
	d := &pipeDrain{done: make(chan struct{})}
	go func() {
		defer close(d.done)
		_, _ = io.Copy(&d.buf, r)
	}()
	return d
}
