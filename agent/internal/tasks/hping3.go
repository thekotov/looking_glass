package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/looking-glass/agent/internal/validator"
)

type Hping3Options struct {
	Mode       string `json:"mode"` // tcp_syn|tcp_ack|tcp_fin|udp|icmp
	Port       int    `json:"port"`
	Count      int    `json:"count"`
	IntervalMs int    `json:"interval_ms"`
	TimeoutSec int    `json:"timeout_sec"`
}

type Hping3Result struct {
	Target     string `json:"target"`
	ResolvedIP string `json:"resolved_ip"`
	Mode       string `json:"mode"`
	Port       int    `json:"port"`
	Count      int    `json:"count"`
	RawOutput  string `json:"raw_output"`
}

type Hping3Runner struct{}

func (Hping3Runner) Name() string { return "hping3" }

// modeFlag maps the typed mode → the single hping3 flag we allow.
// Anything not in this map is rejected — never trust raw user strings.
var modeFlag = map[string]string{
	"tcp_syn": "-S",
	"tcp_ack": "-A",
	"tcp_fin": "-F",
	"udp":     "--udp",
	"icmp":    "--icmp",
}

func (Hping3Runner) Run(ctx context.Context, task Task) (*Result, error) {
	var opts Hping3Options
	if err := json.Unmarshal(task.Options, &opts); err != nil {
		return nil, fmt.Errorf("parse options: %w", err)
	}
	if opts.Mode == "" {
		opts.Mode = "tcp_syn"
	}
	flag, ok := modeFlag[opts.Mode]
	if !ok {
		return failedResult("unsupported hping3 mode: "+opts.Mode, 0), nil
	}
	if opts.Count <= 0 {
		opts.Count = 5
	}
	if opts.IntervalMs <= 0 {
		opts.IntervalMs = 200
	}
	// Hard floor on rate — agent-side guardrail against abuse, independent of server.
	if opts.IntervalMs < 10 {
		opts.IntervalMs = 10
	}
	if opts.Count > 100 {
		opts.Count = 100
	}
	if opts.TimeoutSec <= 0 {
		opts.TimeoutSec = 10
	}

	addrs, err := validator.ResolveAndCheck(task.Target)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}
	ip, err := pickIP(addrs, false)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}

	// Build argv: only validated/typed values reach the slice.
	args := []string{
		flag,
		"-c", strconv.Itoa(opts.Count),
		"-i", "u" + strconv.Itoa(opts.IntervalMs*1000), // hping3 uses microseconds with `u` prefix
	}
	if opts.Mode != "icmp" {
		if opts.Port <= 0 {
			opts.Port = 80
		}
		args = append(args, "-p", strconv.Itoa(opts.Port))
	}
	args = append(args, ip.String())

	stdout, stderr, _, duration, err := runCmd(ctx, "hping3", args...)
	if err != nil {
		return failedResult("hping3 spawn: "+err.Error(), duration), nil
	}

	combined := stdout
	if stderr != "" {
		combined += "\n--stderr--\n" + stderr
	}
	return resultFromJSON(Hping3Result{
		Target:     task.Target,
		ResolvedIP: ip.String(),
		Mode:       opts.Mode,
		Port:       opts.Port,
		Count:      opts.Count,
		RawOutput:  combined,
	}, combined, duration)
}
