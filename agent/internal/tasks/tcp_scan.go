package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/looking-glass/agent/internal/validator"
)

type TCPScanOptions struct {
	Ports       []int `json:"ports"`
	TimeoutSec  int   `json:"timeout_sec"`
	Concurrency int   `json:"concurrency"`
	IPv6        bool  `json:"ipv6"`
}

type ScanEntry struct {
	Port  int     `json:"port"`
	Open  bool    `json:"open"`
	RTTMs float64 `json:"rtt_ms"`
	Error string  `json:"error,omitempty"`
}

type TCPScanResult struct {
	Target     string      `json:"target"`
	ResolvedIP string      `json:"resolved_ip"`
	Total      int         `json:"total"`
	Open       int         `json:"open"`
	Entries    []ScanEntry `json:"entries"`
}

type TCPScanRunner struct{}

func (TCPScanRunner) Name() string { return "tcp_scan" }

func (TCPScanRunner) Run(ctx context.Context, task Task) (*Result, error) {
	var opts TCPScanOptions
	if err := json.Unmarshal(task.Options, &opts); err != nil {
		return nil, fmt.Errorf("parse options: %w", err)
	}
	if opts.Concurrency <= 0 {
		opts.Concurrency = 32
	}
	if opts.TimeoutSec <= 0 {
		opts.TimeoutSec = 3
	}

	addrs, err := validator.ResolveAndCheck(task.Target)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}
	ip, err := pickIP(addrs, opts.IPv6)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}

	start := time.Now()

	entries := make([]ScanEntry, len(opts.Ports))
	sem := make(chan struct{}, opts.Concurrency)
	var wg sync.WaitGroup

	for i, port := range opts.Ports {
		i, port := i, port
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			entries[i] = scanOne(ctx, ip.String(), port, opts.TimeoutSec)
		}()
	}
	wg.Wait()

	sort.SliceStable(entries, func(i, j int) bool { return entries[i].Port < entries[j].Port })

	openCount := 0
	for _, e := range entries {
		if e.Open {
			openCount++
		}
	}

	result := TCPScanResult{
		Target:     task.Target,
		ResolvedIP: ip.String(),
		Total:      len(entries),
		Open:       openCount,
		Entries:    entries,
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "TCP scan %s (%s): %d/%d open\n", task.Target, ip.String(), openCount, len(entries))
	for _, e := range entries {
		if e.Open {
			fmt.Fprintf(&sb, "  %d/tcp open (rtt=%.3fms)\n", e.Port, e.RTTMs)
		}
	}
	return resultFromJSON(result, sb.String(), int(time.Since(start)/time.Millisecond))
}

func scanOne(ctx context.Context, ip string, port, timeoutSec int) ScanEntry {
	dialer := net.Dialer{Timeout: time.Duration(timeoutSec) * time.Second}
	start := time.Now()
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(ip, strconv.Itoa(port)))
	rtt := float64(time.Since(start)) / float64(time.Millisecond)
	entry := ScanEntry{Port: port, Open: err == nil, RTTMs: round(rtt, 3)}
	if err != nil {
		// Don't leak the full Dial error chain — it's noisy and the same per port.
		// Just keep the short reason.
		entry.Error = trimDialErr(err)
	}
	if conn != nil {
		_ = conn.Close()
	}
	return entry
}

func trimDialErr(err error) string {
	s := err.Error()
	// "dial tcp X.X.X.X:Y: connect: refused" → "connect: refused"
	if idx := strings.LastIndex(s, ": "); idx >= 0 && idx < len(s)-2 {
		return s[idx+2:]
	}
	return s
}
