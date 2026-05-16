package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strconv"
	"time"
	"unicode"

	"github.com/looking-glass/agent/internal/validator"
)

type TCPConnectOptions struct {
	Port             int  `json:"port"`
	TimeoutSec       int  `json:"timeout_sec"`
	IPv6             bool `json:"ipv6"`
	BannerGrab       bool `json:"banner_grab"`
	BannerBytes      int  `json:"banner_bytes"`
	BannerTimeoutMs  int  `json:"banner_timeout_ms"`
}

type TCPConnectResult struct {
	Target          string  `json:"target"`
	ResolvedIP      string  `json:"resolved_ip"`
	Port            int     `json:"port"`
	Open            bool    `json:"open"`
	RTTMs           float64 `json:"rtt_ms"`
	Banner          string  `json:"banner,omitempty"`
	BannerBytes     int     `json:"banner_bytes,omitempty"`
	BannerTruncated bool    `json:"banner_truncated,omitempty"`
	Error           string  `json:"error,omitempty"`
}

type TCPConnectRunner struct{}

func (TCPConnectRunner) Name() string { return "tcp_connect" }

func (TCPConnectRunner) Run(ctx context.Context, task Task) (*Result, error) {
	var opts TCPConnectOptions
	if err := json.Unmarshal(task.Options, &opts); err != nil {
		return nil, fmt.Errorf("parse options: %w", err)
	}

	addrs, err := validator.ResolveAndCheck(task.Target)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}
	ip, err := pickIP(addrs, opts.IPv6)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}

	dialer := net.Dialer{Timeout: time.Duration(opts.TimeoutSec) * time.Second}
	address := net.JoinHostPort(ip.String(), strconv.Itoa(opts.Port))

	start := time.Now()
	conn, dialErr := dialer.DialContext(ctx, "tcp", address)
	rtt := float64(time.Since(start)) / float64(time.Millisecond)

	result := TCPConnectResult{
		Target:     task.Target,
		ResolvedIP: ip.String(),
		Port:       opts.Port,
		Open:       dialErr == nil,
		RTTMs:      round(rtt, 3),
	}
	if dialErr != nil {
		result.Error = dialErr.Error()
	} else if opts.BannerGrab && conn != nil {
		banner, truncated := readBanner(conn, opts.BannerBytes, opts.BannerTimeoutMs)
		result.Banner = banner
		result.BannerBytes = len(banner)
		result.BannerTruncated = truncated
	}
	if conn != nil {
		_ = conn.Close()
	}

	stdout := fmt.Sprintf("connect %s:%d: %s (rtt=%.3f ms)\n",
		ip.String(), opts.Port, statusWord(dialErr == nil), result.RTTMs)
	if result.Banner != "" {
		stdout += fmt.Sprintf("banner (%d bytes%s):\n%s\n",
			result.BannerBytes,
			truncatedMarker(result.BannerTruncated),
			result.Banner)
	}
	return resultFromJSON(result, stdout, int(time.Since(start)/time.Millisecond))
}

// readBanner reads up to maxBytes from conn within timeoutMs, returns the
// printable-safe banner text and whether we hit the byte cap.
func readBanner(conn net.Conn, maxBytes, timeoutMs int) (string, bool) {
	if maxBytes <= 0 {
		maxBytes = 256
	}
	if maxBytes > 4096 {
		maxBytes = 4096
	}
	if timeoutMs <= 0 {
		timeoutMs = 2000
	}
	_ = conn.SetReadDeadline(time.Now().Add(time.Duration(timeoutMs) * time.Millisecond))
	buf := make([]byte, maxBytes+1) // +1 to detect truncation
	n, _ := io.ReadFull(conn, buf)
	if n == 0 {
		return "", false
	}
	truncated := n > maxBytes
	if truncated {
		n = maxBytes
	}
	return sanitizeBanner(buf[:n]), truncated
}

// sanitizeBanner replaces non-printable bytes with a dot so the result is
// safe to display and CSV-export.
func sanitizeBanner(b []byte) string {
	out := make([]byte, len(b))
	for i, c := range b {
		if c == '\n' || c == '\r' || c == '\t' || unicode.IsPrint(rune(c)) {
			out[i] = c
		} else {
			out[i] = '.'
		}
	}
	return string(out)
}

func truncatedMarker(t bool) string {
	if t {
		return ", truncated"
	}
	return ""
}

func statusWord(ok bool) string {
	if ok {
		return "OPEN"
	}
	return "CLOSED"
}
