//go:build !linux

package tasks

import (
	"context"
	"errors"
	"net"
	"time"
)

// Non-Linux stub. The real implementation needs SOCK_RAW + IP_HDRINCL which
// behave differently on Windows/macOS. Local Windows builds use this stub so
// `go build` passes; the actual agent container builds on Linux.
func synScanIPv4(
	_ context.Context, _ net.IP, _ []int, _ time.Duration,
) ([]SYNScanEntry, error) {
	return nil, errors.New("syn_scan is Linux-only (requires SOCK_RAW + IP_HDRINCL)")
}
