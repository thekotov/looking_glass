// Package validator validates targets before the agent dispatches a task.
//
// This mirrors server/app/validators/targets.py. If they drift, you've
// likely introduced a security gap — when adding a new blocked range,
// update both sides.
package validator

import (
	"fmt"
	"net"
	"strings"
)

var blockedV4 = mustParseNets([]string{
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.0.2.0/24",
	"192.168.0.0/16",
	"198.18.0.0/15",
	"198.51.100.0/24",
	"203.0.113.0/24",
	"224.0.0.0/4",
	"240.0.0.0/4",
	"255.255.255.255/32",
})

var blockedV6 = mustParseNets([]string{
	"::/128",
	"::1/128",
	"fe80::/10",
	"fc00::/7",
	"ff00::/8",
	"2001:db8::/32",
})

func mustParseNets(cidrs []string) []*net.IPNet {
	nets := make([]*net.IPNet, 0, len(cidrs))
	for _, c := range cidrs {
		_, n, err := net.ParseCIDR(c)
		if err != nil {
			panic(fmt.Sprintf("invalid CIDR %q: %v", c, err))
		}
		nets = append(nets, n)
	}
	return nets
}

// CheckIP returns an error if the given IP falls inside any blocked range.
func CheckIP(ip net.IP) error {
	if ip4 := ip.To4(); ip4 != nil {
		for _, n := range blockedV4 {
			if n.Contains(ip4) {
				return fmt.Errorf("target %s is in blocked network %s", ip4, n)
			}
		}
		return nil
	}
	for _, n := range blockedV6 {
		if n.Contains(ip) {
			return fmt.Errorf("target %s is in blocked network %s", ip, n)
		}
	}
	return nil
}

// ResolveAndCheck resolves a target (IP literal or hostname) and verifies
// EVERY resolved address passes CheckIP. Returns the list of resolved IPs.
func ResolveAndCheck(target string) ([]net.IP, error) {
	t := strings.TrimSpace(strings.ToLower(target))
	if t == "" {
		return nil, fmt.Errorf("empty target")
	}
	if ip := net.ParseIP(t); ip != nil {
		if err := CheckIP(ip); err != nil {
			return nil, err
		}
		return []net.IP{ip}, nil
	}
	addrs, err := net.LookupHost(t)
	if err != nil {
		return nil, fmt.Errorf("DNS lookup failed for %s: %w", t, err)
	}
	if len(addrs) == 0 {
		return nil, fmt.Errorf("hostname %s resolves to no addresses", t)
	}
	out := make([]net.IP, 0, len(addrs))
	for _, a := range addrs {
		ip := net.ParseIP(a)
		if ip == nil {
			continue
		}
		if err := CheckIP(ip); err != nil {
			return nil, err
		}
		out = append(out, ip)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("hostname %s resolved to no valid IPs", t)
	}
	return out, nil
}
