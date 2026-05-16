package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/looking-glass/agent/internal/validator"
)

type SYNScanOptions struct {
	Ports       []int `json:"ports"`
	TimeoutSec  int   `json:"timeout_sec"`
	IPv6        bool  `json:"ipv6"`
}

type SYNScanEntry struct {
	Port  int    `json:"port"`
	State string `json:"state"` // open | closed | filtered
}

type SYNScanResult struct {
	Target     string         `json:"target"`
	ResolvedIP string         `json:"resolved_ip"`
	Total      int            `json:"total"`
	Open       int            `json:"open"`
	Entries    []SYNScanEntry `json:"entries"`
}

type SYNScanRunner struct{}

func (SYNScanRunner) Name() string { return "syn_scan" }

func (SYNScanRunner) Run(ctx context.Context, task Task) (*Result, error) {
	var opts SYNScanOptions
	if err := json.Unmarshal(task.Options, &opts); err != nil {
		return nil, fmt.Errorf("parse options: %w", err)
	}
	if opts.TimeoutSec <= 0 {
		opts.TimeoutSec = 5
	}
	if opts.IPv6 {
		return failedResult("syn_scan currently supports IPv4 only", 0), nil
	}

	addrs, err := validator.ResolveAndCheck(task.Target)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}
	ip, err := pickIP(addrs, false)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}
	ip4 := ip.To4()
	if ip4 == nil {
		return failedResult("syn_scan: target is not IPv4", 0), nil
	}

	start := time.Now()
	entries, err := synScanIPv4(ctx, ip4, opts.Ports, time.Duration(opts.TimeoutSec)*time.Second)
	duration := int(time.Since(start) / time.Millisecond)
	if err != nil {
		return failedResult("syn_scan: "+err.Error(), duration), nil
	}

	openCount := 0
	for _, e := range entries {
		if e.State == "open" {
			openCount++
		}
	}
	result := SYNScanResult{
		Target:     task.Target,
		ResolvedIP: ip4.String(),
		Total:      len(entries),
		Open:       openCount,
		Entries:    entries,
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "SYN scan %s (%s): %d/%d open\n",
		task.Target, ip4.String(), openCount, len(entries))
	for _, e := range entries {
		if e.State == "open" {
			fmt.Fprintf(&sb, "  %d/tcp open\n", e.Port)
		}
	}
	return resultFromJSON(result, sb.String(), duration)
}
