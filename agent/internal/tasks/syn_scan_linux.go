//go:build linux

package tasks

import (
	"context"
	"encoding/binary"
	"fmt"
	"math/rand/v2"
	"net"
	"sync"
	"syscall"
	"time"
)

// synScanIPv4 sends one SYN per port and listens for SYN/ACK or RST replies.
// Linux only — uses SOCK_RAW + IP_HDRINCL.
//
// Note: the host kernel will also see incoming SYN/ACKs and may emit RSTs back
// to the target (because we never followed up the SYN with ACK). This is
// "noisy on the wire" but doesn't affect detection — we already learned the
// port state from the SYN/ACK. To suppress that noise in prod, add an iptables
// rule on the agent host:
//   iptables -A OUTPUT -p tcp --tcp-flags RST RST -d <target> -j DROP
func synScanIPv4(
	ctx context.Context, dstIP net.IP, ports []int, timeout time.Duration,
) ([]SYNScanEntry, error) {
	srcIP, err := pickSourceIP(dstIP)
	if err != nil {
		return nil, fmt.Errorf("source IP: %w", err)
	}
	srcPort := uint16(40000 + rand.IntN(20000)) // ephemeral range

	sendFd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_RAW, syscall.IPPROTO_TCP)
	if err != nil {
		return nil, fmt.Errorf("open send socket: %w (need CAP_NET_RAW)", err)
	}
	defer syscall.Close(sendFd)
	if err := syscall.SetsockoptInt(sendFd, syscall.IPPROTO_IP, syscall.IP_HDRINCL, 1); err != nil {
		return nil, fmt.Errorf("set IP_HDRINCL: %w", err)
	}

	recvFd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_RAW, syscall.IPPROTO_TCP)
	if err != nil {
		return nil, fmt.Errorf("open recv socket: %w", err)
	}
	defer syscall.Close(recvFd)

	dst4 := [4]byte{dstIP[0], dstIP[1], dstIP[2], dstIP[3]}
	sa := &syscall.SockaddrInet4{Port: 0, Addr: dst4}

	// Send phase: one SYN per port. The kernel handles serialization.
	for _, port := range ports {
		pkt := buildSYNPacket(srcIP, dstIP, srcPort, uint16(port))
		if err := syscall.Sendto(sendFd, pkt, 0, sa); err != nil {
			// One bad port doesn't kill the scan — note it as filtered.
			continue
		}
	}

	// Receive phase: drain the raw socket until timeout or all ports answered.
	// A goroutine pushes parsed replies into a channel; we collect with deadline.
	type reply struct {
		port  int
		state string
	}
	replies := make(chan reply, len(ports))
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		buf := make([]byte, 65535)
		for {
			select {
			case <-stop:
				return
			default:
			}
			// Set a short SO_RCVTIMEO so the loop wakes up to check stop.
			tv := syscall.Timeval{Sec: 0, Usec: 200_000}
			_ = syscall.SetsockoptTimeval(recvFd, syscall.SOL_SOCKET, syscall.SO_RCVTIMEO, &tv)
			n, from, err := syscall.Recvfrom(recvFd, buf, 0)
			if err != nil {
				continue // timeout or interrupted
			}
			fromInet, ok := from.(*syscall.SockaddrInet4)
			if !ok {
				continue
			}
			if fromInet.Addr != dst4 {
				continue // packet not from our target
			}
			port, state := parseTCPReply(buf[:n], srcPort)
			if port == 0 {
				continue
			}
			select {
			case replies <- reply{port: port, state: state}:
			default:
			}
		}
	}()

	collected := map[int]string{}
	deadline := time.Now().Add(timeout)
loop:
	for time.Now().Before(deadline) && len(collected) < len(ports) {
		select {
		case r := <-replies:
			if _, seen := collected[r.port]; !seen {
				collected[r.port] = r.state
			}
		case <-ctx.Done():
			break loop
		case <-time.After(100 * time.Millisecond):
		}
	}
	close(stop)
	wg.Wait()

	// Ports we never heard back from are "filtered" (no SYN/ACK, no RST).
	entries := make([]SYNScanEntry, 0, len(ports))
	for _, p := range ports {
		state, ok := collected[p]
		if !ok {
			state = "filtered"
		}
		entries = append(entries, SYNScanEntry{Port: p, State: state})
	}
	return entries, nil
}

// pickSourceIP figures out which local IP the kernel would use to reach dst,
// without actually opening a connection (UDP "connect" is connectionless).
func pickSourceIP(dst net.IP) (net.IP, error) {
	conn, err := net.Dial("udp", net.JoinHostPort(dst.String(), "80"))
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	local := conn.LocalAddr().(*net.UDPAddr).IP
	if v4 := local.To4(); v4 != nil {
		return v4, nil
	}
	return local, nil
}

// buildSYNPacket constructs an IPv4 header + TCP header with the SYN flag.
// 40 bytes total (20 IP + 20 TCP, no options).
func buildSYNPacket(srcIP, dstIP net.IP, srcPort, dstPort uint16) []byte {
	srcIP = srcIP.To4()
	dstIP = dstIP.To4()
	pkt := make([]byte, 40)

	// --- IPv4 header (20 bytes) ---
	pkt[0] = (4 << 4) | 5             // version=4, IHL=5
	pkt[1] = 0                        // DSCP/ECN
	binary.BigEndian.PutUint16(pkt[2:4], 40)        // total length
	binary.BigEndian.PutUint16(pkt[4:6], uint16(rand.IntN(65535))) // ident
	binary.BigEndian.PutUint16(pkt[6:8], 0)         // flags+frag offset
	pkt[8] = 64                       // TTL
	pkt[9] = syscall.IPPROTO_TCP      // protocol
	// checksum at [10:12] computed below
	copy(pkt[12:16], srcIP)
	copy(pkt[16:20], dstIP)
	binary.BigEndian.PutUint16(pkt[10:12], ipChecksum(pkt[0:20]))

	// --- TCP header (20 bytes) ---
	binary.BigEndian.PutUint16(pkt[20:22], srcPort)
	binary.BigEndian.PutUint16(pkt[22:24], dstPort)
	binary.BigEndian.PutUint32(pkt[24:28], rand.Uint32()) // seq
	binary.BigEndian.PutUint32(pkt[28:32], 0)             // ack
	pkt[32] = 5 << 4                     // data offset = 5 words, reserved=0
	pkt[33] = 0x02                       // flags: SYN
	binary.BigEndian.PutUint16(pkt[34:36], 65535)         // window
	// checksum at [36:38] computed via pseudo-header
	binary.BigEndian.PutUint16(pkt[38:40], 0)             // urgent ptr
	binary.BigEndian.PutUint16(pkt[36:38], tcpChecksum(srcIP, dstIP, pkt[20:40]))
	return pkt
}

// parseTCPReply inspects an incoming raw IPv4+TCP packet and reports the
// reply state for the matched destination port (relative to our scan).
// Returns (port, state) or (0, "") if the packet doesn't match.
func parseTCPReply(pkt []byte, wantDstPort uint16) (int, string) {
	if len(pkt) < 40 {
		return 0, ""
	}
	ihl := int(pkt[0]&0x0f) * 4
	if ihl > len(pkt) {
		return 0, ""
	}
	tcp := pkt[ihl:]
	if len(tcp) < 20 {
		return 0, ""
	}
	srcPort := binary.BigEndian.Uint16(tcp[0:2])
	dstPort := binary.BigEndian.Uint16(tcp[2:4])
	if dstPort != wantDstPort {
		return 0, ""
	}
	flags := tcp[13]
	// SYN|ACK = 0x12 → open; RST (with or without ACK) → closed
	if flags&0x12 == 0x12 {
		return int(srcPort), "open"
	}
	if flags&0x04 == 0x04 {
		return int(srcPort), "closed"
	}
	return 0, ""
}

func ipChecksum(b []byte) uint16 {
	var sum uint32
	for i := 0; i+1 < len(b); i += 2 {
		sum += uint32(binary.BigEndian.Uint16(b[i : i+2]))
	}
	if len(b)%2 == 1 {
		sum += uint32(b[len(b)-1]) << 8
	}
	for sum > 0xffff {
		sum = (sum & 0xffff) + (sum >> 16)
	}
	return ^uint16(sum)
}

func tcpChecksum(srcIP, dstIP net.IP, tcp []byte) uint16 {
	// Pseudo-header: src(4) + dst(4) + zero(1) + proto(1) + tcplen(2)
	pseudo := make([]byte, 12+len(tcp))
	copy(pseudo[0:4], srcIP.To4())
	copy(pseudo[4:8], dstIP.To4())
	pseudo[8] = 0
	pseudo[9] = syscall.IPPROTO_TCP
	binary.BigEndian.PutUint16(pseudo[10:12], uint16(len(tcp)))
	copy(pseudo[12:], tcp)
	return ipChecksum(pseudo)
}
