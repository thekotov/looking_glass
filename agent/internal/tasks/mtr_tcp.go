package tasks

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/looking-glass/agent/internal/validator"
)

type MTRTCPOptions struct {
	Cycles  int  `json:"cycles"`
	MaxHops int  `json:"max_hops"`
	Port    int  `json:"port"`
	IPv6    bool `json:"ipv6"`
}

type MTRTCPRunner struct{}

func (MTRTCPRunner) Name() string { return "mtr_tcp" }

func (MTRTCPRunner) Run(ctx context.Context, task Task) (*Result, error) {
	var opts MTRTCPOptions
	if err := json.Unmarshal(task.Options, &opts); err != nil {
		return nil, fmt.Errorf("parse options: %w", err)
	}
	if opts.Cycles <= 0 {
		opts.Cycles = 10
	}
	if opts.MaxHops <= 0 {
		opts.MaxHops = 30
	}
	if opts.Port <= 0 {
		opts.Port = 443
	}
	// Defense-in-depth: clamp to the same caps the server enforces.
	if opts.Cycles > 100 {
		opts.Cycles = 100
	}
	if opts.MaxHops > 64 {
		opts.MaxHops = 64
	}
	if opts.Port > 65535 {
		opts.Port = 65535
	}

	addrs, err := validator.ResolveAndCheck(task.Target)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}
	ip, err := pickIP(addrs, opts.IPv6)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}

	return runMTR(ctx, task.Target, ip.String(), opts.Cycles, opts.MaxHops, opts.IPv6, opts.Port, true)
}
