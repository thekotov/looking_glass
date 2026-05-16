package tasks

import (
	"context"
	"sync"
)

// ConcurrencyCaps defines how many tasks of a given type may run in parallel
// on a single agent. Tasks not in this map have no limit.
//
// Reasoning per type:
//   - syn_scan / tcp_scan: noisy, fan out internally; cap at 1 to prevent
//     overlap between groups of scans on the same agent
//   - hping3: packet generator, dangerous if multiple instances run together
//   - mtr / mtr_tcp / traceroute: each can hold the wire for tens of seconds;
//     cap at 2 so a stuck task doesn't lock everything out
var ConcurrencyCaps = map[string]int{
	"syn_scan":   1,
	"tcp_scan":   1,
	"hping3":     1,
	"mtr":        2,
	"mtr_tcp":    2,
	"traceroute": 2,
}

type Gate struct {
	mu   sync.Mutex
	sems map[string]chan struct{}
}

func NewGate(caps map[string]int) *Gate {
	g := &Gate{sems: make(map[string]chan struct{}, len(caps))}
	for k, n := range caps {
		if n > 0 {
			g.sems[k] = make(chan struct{}, n)
		}
	}
	return g
}

// Acquire blocks until a slot is free for taskType, then returns a release fn.
// If taskType has no cap, returns a no-op release.
func (g *Gate) Acquire(ctx context.Context, taskType string) (func(), error) {
	g.mu.Lock()
	sem, ok := g.sems[taskType]
	g.mu.Unlock()
	if !ok {
		return func() {}, nil
	}
	select {
	case sem <- struct{}{}:
		return func() { <-sem }, nil
	case <-ctx.Done():
		return func() {}, ctx.Err()
	}
}
