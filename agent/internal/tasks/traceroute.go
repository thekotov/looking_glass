package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/looking-glass/agent/internal/validator"
)

type TracerouteOptions struct {
	MaxHops       int  `json:"max_hops"`
	TimeoutSec    int  `json:"timeout_sec"`
	QueriesPerHop int  `json:"queries_per_hop"`
	IPv6          bool `json:"ipv6"`
}

type TraceHop struct {
	Hop  int       `json:"hop"`
	IPs  []string  `json:"ips"`
	RTTs []float64 `json:"rtts_ms"`
}

type TracerouteResult struct {
	Target     string     `json:"target"`
	ResolvedIP string     `json:"resolved_ip"`
	Hops       []TraceHop `json:"hops"`
}

type TracerouteRunner struct{}

func (TracerouteRunner) Name() string { return "traceroute" }

var traceLineRe = regexp.MustCompile(
	`^\s*(\d+)\s+(.+)$`,
)

func (TracerouteRunner) Run(ctx context.Context, task Task) (*Result, error) {
	var opts TracerouteOptions
	if err := json.Unmarshal(task.Options, &opts); err != nil {
		return nil, fmt.Errorf("parse options: %w", err)
	}
	if opts.MaxHops <= 0 {
		opts.MaxHops = 30
	}
	if opts.TimeoutSec <= 0 {
		opts.TimeoutSec = 3
	}
	if opts.QueriesPerHop <= 0 {
		opts.QueriesPerHop = 1
	}
	// Defense-in-depth: clamp to the same caps the server enforces.
	if opts.MaxHops > 64 {
		opts.MaxHops = 64
	}
	if opts.TimeoutSec > 10 {
		opts.TimeoutSec = 10
	}
	if opts.QueriesPerHop > 3 {
		opts.QueriesPerHop = 3
	}

	addrs, err := validator.ResolveAndCheck(task.Target)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}
	ip, err := pickIP(addrs, opts.IPv6)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}

	// argv built only from validated ints + the resolved IP literal.
	args := []string{
		"-n",
		"-m", strconv.Itoa(opts.MaxHops),
		"-q", strconv.Itoa(opts.QueriesPerHop),
		"-w", strconv.Itoa(opts.TimeoutSec),
	}
	if opts.IPv6 {
		args = append(args, "-6")
	}
	args = append(args, ip.String())

	stdout, stderr, _, duration, err := runCmd(ctx, "traceroute", args...)
	if err != nil {
		return failedResult("traceroute spawn: "+err.Error(), duration), nil
	}

	result := TracerouteResult{
		Target:     task.Target,
		ResolvedIP: ip.String(),
		Hops:       parseTraceroute(stdout),
	}
	combined := stdout
	if stderr != "" {
		combined += "\n--stderr--\n" + stderr
	}
	return resultFromJSON(result, combined, duration)
}

// parseTraceroute parses standard `traceroute -n` output. Each hop line:
//
//	" 1  10.0.0.1  1.234 ms  1.111 ms  2.222 ms"
//	" 5  * * *"
func parseTraceroute(output string) []TraceHop {
	hops := make([]TraceHop, 0, 16)
	scanner := strings.Split(output, "\n")
	for _, line := range scanner {
		m := traceLineRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		hopNum, err := strconv.Atoi(m[1])
		if err != nil {
			continue
		}
		// Initialize empty slices so JSON renders them as `[]` instead of `null`
		// — keeps the frontend's `.length` access safe without optional chaining.
		hop := TraceHop{Hop: hopNum, IPs: []string{}, RTTs: []float64{}}
		// Walk tokens left-to-right. A token may be:
		//  - "*" (no reply)
		//  - an IP literal (followed by RTTs)
		//  - a float followed by "ms"
		tokens := strings.Fields(m[2])
		for i := 0; i < len(tokens); i++ {
			tok := tokens[i]
			if tok == "*" {
				continue
			}
			if strings.Contains(tok, ".") || strings.Contains(tok, ":") {
				// Heuristic: if it has a dot/colon and is not a number, treat as IP.
				if _, err := strconv.ParseFloat(tok, 64); err != nil {
					if !containsStr(hop.IPs, tok) {
						hop.IPs = append(hop.IPs, tok)
					}
					continue
				}
			}
			// RTT path: "<number> ms"
			if rtt, err := strconv.ParseFloat(tok, 64); err == nil {
				if i+1 < len(tokens) && tokens[i+1] == "ms" {
					hop.RTTs = append(hop.RTTs, round(rtt, 3))
					i++
				}
			}
		}
		hops = append(hops, hop)
	}
	return hops
}

func containsStr(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
