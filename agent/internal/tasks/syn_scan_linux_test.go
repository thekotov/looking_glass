//go:build linux

package tasks

import (
	"encoding/binary"
	"net"
	"testing"
)

// Cross-check ipChecksum against an independent reference implementation.
// The reference walks the input as 16-bit big-endian words, sums with carry
// fold, and complements — the textbook one's-complement variant. Matching
// against another implementation catches both an off-by-one in word stride
// and a missing carry fold.
func referenceChecksum(b []byte) uint16 {
	var sum uint32
	for i := 0; i+1 < len(b); i += 2 {
		sum += uint32(b[i])<<8 | uint32(b[i+1])
		for sum > 0xffff {
			sum = (sum & 0xffff) + (sum >> 16)
		}
	}
	if len(b)%2 == 1 {
		sum += uint32(b[len(b)-1]) << 8
		for sum > 0xffff {
			sum = (sum & 0xffff) + (sum >> 16)
		}
	}
	return ^uint16(sum)
}

func TestIPChecksumMatchesReference(t *testing.T) {
	cases := [][]byte{
		{0x00, 0x01, 0xf2, 0x03, 0xf4, 0xf5},
		{0x45, 0x00, 0x00, 0x28, 0xab, 0xcd, 0x40, 0x00, 0x40, 0x06,
			0x00, 0x00, 0x0a, 0x00, 0x00, 0x01, 0x08, 0x08, 0x08, 0x08},
		{0xff, 0xff, 0xff, 0xff}, // forces a fold
		{0x12, 0x34, 0x56},       // odd length
	}
	for i, c := range cases {
		want := referenceChecksum(c)
		got := ipChecksum(c)
		if want != got {
			t.Errorf("case %d: want 0x%04x got 0x%04x for %x", i, want, got, c)
		}
	}
}

// Verifying-end property: the checksum field zeroed → compute → put it back →
// running ipChecksum over the whole header MUST return 0. This is how the
// kernel validates an incoming packet.
func TestIPChecksumSelfVerifies(t *testing.T) {
	// Synthetic IPv4 header. Total length and identification are arbitrary —
	// we only care that compute-then-verify rounds back to 0.
	hdr := make([]byte, 20)
	hdr[0] = (4 << 4) | 5
	binary.BigEndian.PutUint16(hdr[2:4], 40)
	binary.BigEndian.PutUint16(hdr[4:6], 0xabcd)
	hdr[8] = 64
	hdr[9] = 6
	copy(hdr[12:16], net.IPv4(10, 0, 0, 1).To4())
	copy(hdr[16:20], net.IPv4(8, 8, 8, 8).To4())
	binary.BigEndian.PutUint16(hdr[10:12], ipChecksum(hdr))

	if got := ipChecksum(hdr); got != 0 {
		t.Errorf("verify with checksum in place: want 0, got 0x%04x", got)
	}
}

// Odd-length input exercises the "leftover byte padded with zero" branch.
// Building an OS we trust this not to wander: pad with 0x00 manually and
// confirm both code paths agree.
func TestIPChecksumOddLength(t *testing.T) {
	odd := []byte{0xde, 0xad, 0xbe, 0xef, 0x42}
	even := []byte{0xde, 0xad, 0xbe, 0xef, 0x42, 0x00}
	if a, b := ipChecksum(odd), ipChecksum(even); a != b {
		t.Errorf("odd vs zero-padded even disagree: 0x%04x vs 0x%04x", a, b)
	}
}

// tcpChecksum uses the pseudo-header (src, dst, proto, length). Self-verify:
// once we slot the result into the TCP checksum field, recomputing over the
// pseudo+tcp must return 0.
func TestTCPChecksumSelfVerifies(t *testing.T) {
	src := net.IPv4(10, 0, 0, 1)
	dst := net.IPv4(8, 8, 8, 8)
	// 20-byte TCP header with SYN set, src/dst ports, no options.
	tcp := make([]byte, 20)
	binary.BigEndian.PutUint16(tcp[0:2], 12345) // src port
	binary.BigEndian.PutUint16(tcp[2:4], 80)    // dst port
	binary.BigEndian.PutUint32(tcp[4:8], 1)     // seq
	tcp[12] = 5 << 4                            // data offset
	tcp[13] = 0x02                              // SYN
	binary.BigEndian.PutUint16(tcp[14:16], 65535) // window

	sum := tcpChecksum(src, dst, tcp)
	binary.BigEndian.PutUint16(tcp[16:18], sum)

	// Build the same pseudo + tcp and verify it sums to 0.
	pseudo := make([]byte, 12+len(tcp))
	copy(pseudo[0:4], src.To4())
	copy(pseudo[4:8], dst.To4())
	pseudo[9] = 6 // TCP
	binary.BigEndian.PutUint16(pseudo[10:12], uint16(len(tcp)))
	copy(pseudo[12:], tcp)
	if got := ipChecksum(pseudo); got != 0 {
		t.Errorf("verify pseudo+tcp: want 0, got 0x%04x", got)
	}
}

// buildSYNPacket should produce a 40-byte buffer with a self-consistent IP and
// TCP checksum. We don't trust the generator without a self-verify pass —
// otherwise a typo in pseudo-header construction would silently land a packet
// the kernel discards.
func TestBuildSYNPacketIsSelfConsistent(t *testing.T) {
	src := net.IPv4(192, 0, 2, 10)
	dst := net.IPv4(198, 51, 100, 25)
	pkt := buildSYNPacket(src, dst, 50000, 443)

	if len(pkt) != 40 {
		t.Fatalf("packet length: want 40 got %d", len(pkt))
	}
	// IPv4 header self-verify.
	if got := ipChecksum(pkt[0:20]); got != 0 {
		t.Errorf("IPv4 checksum did not self-verify: 0x%04x", got)
	}
	// TCP self-verify via pseudo-header.
	pseudo := make([]byte, 12+20)
	copy(pseudo[0:4], src.To4())
	copy(pseudo[4:8], dst.To4())
	pseudo[9] = 6
	binary.BigEndian.PutUint16(pseudo[10:12], 20)
	copy(pseudo[12:], pkt[20:40])
	if got := ipChecksum(pseudo); got != 0 {
		t.Errorf("TCP checksum did not self-verify: 0x%04x", got)
	}
	// SYN flag set, ACK not set.
	if pkt[33] != 0x02 {
		t.Errorf("TCP flags: want 0x02 (SYN only), got 0x%02x", pkt[33])
	}
	// Destination port encoded correctly.
	if got := binary.BigEndian.Uint16(pkt[22:24]); got != 443 {
		t.Errorf("dst port: want 443 got %d", got)
	}
}

// parseTCPReply maps flags → port state. Cover SYN/ACK (open), RST (closed),
// other flag combinations (no match), and packets too short or with the wrong
// port to defend against malformed replies on the wire.
func TestParseTCPReply(t *testing.T) {
	build := func(srcPort, dstPort uint16, flags byte) []byte {
		buf := make([]byte, 40)
		buf[0] = (4 << 4) | 5
		binary.BigEndian.PutUint16(buf[2:4], 40)
		binary.BigEndian.PutUint16(buf[20:22], srcPort)
		binary.BigEndian.PutUint16(buf[22:24], dstPort)
		buf[32] = 5 << 4
		buf[33] = flags
		return buf
	}

	cases := []struct {
		name     string
		pkt      []byte
		wantPort int
		wantSt   string
	}{
		{"SYN/ACK → open", build(443, 50000, 0x12), 443, "open"},
		{"RST → closed", build(443, 50000, 0x04), 443, "closed"},
		{"RST/ACK → closed", build(443, 50000, 0x14), 443, "closed"},
		{"ACK only → no match", build(443, 50000, 0x10), 0, ""},
		{"wrong dst port", build(443, 50001, 0x12), 0, ""},
		{"too short", []byte{0x00, 0x00, 0x00}, 0, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			port, state := parseTCPReply(tc.pkt, 50000)
			if port != tc.wantPort || state != tc.wantSt {
				t.Errorf("parseTCPReply: want (%d,%q) got (%d,%q)",
					tc.wantPort, tc.wantSt, port, state)
			}
		})
	}
}
