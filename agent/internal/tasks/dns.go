package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"time"
)

type DNSOptions struct {
	RecordType string `json:"record_type"`
	Resolver   string `json:"resolver"`
	TimeoutSec int    `json:"timeout_sec"`
}

type DNSResult struct {
	Target     string   `json:"target"`
	RecordType string   `json:"record_type"`
	Resolver   string   `json:"resolver"`
	Answers    []string `json:"answers"`
	Error      string   `json:"error,omitempty"`
}

type DNSRunner struct{}

func (DNSRunner) Name() string { return "dns" }

func (DNSRunner) Run(ctx context.Context, task Task) (*Result, error) {
	var opts DNSOptions
	if err := json.Unmarshal(task.Options, &opts); err != nil {
		return nil, fmt.Errorf("parse options: %w", err)
	}
	if opts.TimeoutSec <= 0 {
		opts.TimeoutSec = 5
	}

	// Target validation here is lighter — DNS queries to public resolvers for
	// public names are the normal case. We still refuse a target that's a
	// literal RFC1918 IP being PTR'd (handled by the agent's general validator
	// at server side too). For now: only the resolver address is checked.
	if opts.Resolver != "" {
		if ip := net.ParseIP(opts.Resolver); ip != nil {
			// Allow public resolvers (8.8.8.8 etc); reject obviously local ones
			// to keep us symmetric with target restrictions.
			if isPrivateOrLocal(ip) {
				return failedResult("custom resolver must be a public address", 0), nil
			}
		}
	}

	r := buildResolver(opts.Resolver, opts.TimeoutSec)
	rtCtx, cancel := context.WithTimeout(ctx, time.Duration(opts.TimeoutSec)*time.Second)
	defer cancel()

	start := time.Now()
	answers, lookupErr := lookupRecord(rtCtx, r, task.Target, opts.RecordType)
	duration := int(time.Since(start) / time.Millisecond)

	result := DNSResult{
		Target:     task.Target,
		RecordType: opts.RecordType,
		Resolver:   opts.Resolver,
		Answers:    answers,
	}
	if lookupErr != nil {
		result.Error = lookupErr.Error()
		// Don't treat NXDOMAIN as a runner failure — return completed with the error in result.
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "DNS %s %s\n", opts.RecordType, task.Target)
	if lookupErr != nil {
		fmt.Fprintf(&sb, "error: %s\n", lookupErr)
	}
	for _, a := range answers {
		fmt.Fprintf(&sb, "  %s\n", a)
	}
	return resultFromJSON(result, sb.String(), duration)
}

func buildResolver(custom string, timeoutSec int) *net.Resolver {
	if custom == "" {
		return net.DefaultResolver
	}
	addr := custom
	if !strings.Contains(addr, ":") {
		addr = net.JoinHostPort(addr, "53")
	}
	return &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			d := net.Dialer{Timeout: time.Duration(timeoutSec) * time.Second}
			return d.DialContext(ctx, "udp", addr)
		},
	}
}

func lookupRecord(ctx context.Context, r *net.Resolver, target, rtype string) ([]string, error) {
	switch strings.ToUpper(rtype) {
	case "A", "AAAA":
		network := "ip4"
		if strings.ToUpper(rtype) == "AAAA" {
			network = "ip6"
		}
		ips, err := r.LookupIP(ctx, network, target)
		out := make([]string, 0, len(ips))
		for _, ip := range ips {
			out = append(out, ip.String())
		}
		return out, err
	case "MX":
		recs, err := r.LookupMX(ctx, target)
		out := make([]string, 0, len(recs))
		for _, m := range recs {
			out = append(out, fmt.Sprintf("%d %s", m.Pref, m.Host))
		}
		return out, err
	case "TXT":
		return r.LookupTXT(ctx, target)
	case "NS":
		recs, err := r.LookupNS(ctx, target)
		out := make([]string, 0, len(recs))
		for _, n := range recs {
			out = append(out, n.Host)
		}
		return out, err
	case "CNAME":
		v, err := r.LookupCNAME(ctx, target)
		if err != nil {
			return nil, err
		}
		return []string{v}, nil
	case "PTR":
		names, err := r.LookupAddr(ctx, target)
		return names, err
	case "SOA":
		return nil, fmt.Errorf("SOA lookups not supported by net.Resolver — use dig")
	}
	return nil, fmt.Errorf("unsupported record type %q", rtype)
}

// isPrivateOrLocal mirrors a slim subset of validator.CheckIP for DNS resolver checks.
func isPrivateOrLocal(ip net.IP) bool {
	if ip4 := ip.To4(); ip4 != nil {
		return ip4.IsPrivate() || ip4.IsLoopback() || ip4.IsLinkLocalUnicast() || ip4.IsMulticast()
	}
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsMulticast()
}
