package validator

import (
	"net"
	"strings"
	"testing"
)

// Each row is an IP literal and whether CheckIP should reject it.
// Anything reject=false is a public address we expect to allow.
var checkIPCases = []struct {
	name   string
	ip     string
	reject bool
}{
	// --- IPv4 blocked ---
	{"loopback v4", "127.0.0.1", true},
	{"rfc1918 10/8", "10.5.5.5", true},
	{"rfc1918 172.16/12 mid", "172.20.1.1", true},
	{"rfc1918 192.168/16", "192.168.1.1", true},
	{"link-local 169.254", "169.254.10.20", true},
	{"AWS metadata", "169.254.169.254", true},
	{"CGNAT 100.64/10", "100.64.0.1", true},
	{"multicast 224/4", "224.0.0.1", true},
	{"reserved 240/4", "250.0.0.1", true},
	{"broadcast", "255.255.255.255", true},
	{"TEST-NET-1", "192.0.2.5", true},
	{"TEST-NET-2", "198.51.100.5", true},
	{"TEST-NET-3", "203.0.113.5", true},
	{"benchmarking 198.18/15", "198.18.0.1", true},
	{"this-network 0/8", "0.0.0.1", true},

	// --- IPv4 allowed ---
	{"cloudflare 1.1.1.1", "1.1.1.1", false},
	{"google 8.8.8.8", "8.8.8.8", false},
	{"public near rfc1918 boundary", "11.0.0.1", false},
	{"172.15 outside rfc1918", "172.15.0.1", false},
	{"172.32 outside rfc1918", "172.32.0.1", false},
	{"100.63 outside CGNAT", "100.63.255.255", false},

	// --- IPv6 blocked ---
	{"v6 loopback", "::1", true},
	{"v6 unspecified", "::", true},
	{"v6 link-local fe80", "fe80::1", true},
	{"v6 ULA fc00", "fc00::1", true},
	{"v6 ULA fd00", "fd00::1", true},
	{"v6 multicast", "ff02::1", true},
	{"v6 documentation 2001:db8", "2001:db8::1", true},

	// --- IPv6 allowed ---
	{"v6 cloudflare", "2606:4700:4700::1111", false},
	{"v6 google", "2001:4860:4860::8888", false},
}

func TestCheckIP(t *testing.T) {
	for _, tc := range checkIPCases {
		t.Run(tc.name, func(t *testing.T) {
			ip := net.ParseIP(tc.ip)
			if ip == nil {
				t.Fatalf("test bug: %q is not a parseable IP", tc.ip)
			}
			err := CheckIP(ip)
			if tc.reject && err == nil {
				t.Errorf("CheckIP(%s): expected reject, got allow", tc.ip)
			}
			if !tc.reject && err != nil {
				t.Errorf("CheckIP(%s): expected allow, got reject: %v", tc.ip, err)
			}
		})
	}
}

// Hostname resolution paths in ResolveAndCheck.
func TestResolveAndCheckEmpty(t *testing.T) {
	if _, err := ResolveAndCheck(""); err == nil {
		t.Error("empty target should fail")
	}
	if _, err := ResolveAndCheck("   "); err == nil {
		t.Error("whitespace-only target should fail")
	}
}

// Catches the "we accidentally accepted a metadata IP" class of bug.
func TestResolveAndCheckRejectsMetadataIP(t *testing.T) {
	_, err := ResolveAndCheck("169.254.169.254")
	if err == nil {
		t.Fatal("expected cloud metadata IP to be rejected")
	}
	if !strings.Contains(err.Error(), "blocked") {
		t.Errorf("error should mention 'blocked', got: %v", err)
	}
}

// IP literals — we don't actually hit DNS for these. Cheap path coverage.
func TestResolveAndCheckIPLiteral(t *testing.T) {
	ips, err := ResolveAndCheck("1.1.1.1")
	if err != nil {
		t.Fatalf("1.1.1.1 should resolve: %v", err)
	}
	if len(ips) != 1 || !ips[0].Equal(net.ParseIP("1.1.1.1")) {
		t.Errorf("unexpected resolution: %v", ips)
	}
}

// Lowercases and trims before parsing — confirm the upper-case IPv6 works.
func TestResolveAndCheckCaseInsensitive(t *testing.T) {
	if _, err := ResolveAndCheck("  2606:4700:4700::1111  "); err != nil {
		t.Errorf("trimmed/lowercased IPv6 should pass: %v", err)
	}
	if _, err := ResolveAndCheck("FE80::1"); err == nil {
		t.Errorf("uppercase fe80 should still be rejected as link-local")
	}
}
