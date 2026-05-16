package tasks

import (
	"context"
	"sync"
	"testing"
	"time"
)

// A task type with no cap should always return a no-op release immediately —
// the Gate must never block traffic for unconfigured types.
func TestGateUncappedTypeNoBlock(t *testing.T) {
	g := NewGate(map[string]int{"capped": 1})
	rel, err := g.Acquire(context.Background(), "uncapped")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	rel() // should not panic
}

// Second acquire on a cap=1 type must block until release. Use a short
// timeout to catch any "forgot to enqueue" regression.
func TestGateBlocksWhenSaturated(t *testing.T) {
	g := NewGate(map[string]int{"hping3": 1})

	rel1, err := g.Acquire(context.Background(), "hping3")
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := g.Acquire(ctx, "hping3"); err == nil {
		t.Fatal("expected timeout while gate saturated")
	}

	// After release, a fresh acquire must succeed promptly.
	rel1()
	rel2, err := g.Acquire(context.Background(), "hping3")
	if err != nil {
		t.Fatalf("post-release acquire: %v", err)
	}
	rel2()
}

// Concurrency cap must hold under load — multiple goroutines piling onto the
// same type must never exceed N in flight at once.
func TestGateRespectsCapUnderLoad(t *testing.T) {
	const cap = 2
	g := NewGate(map[string]int{"mtr": cap})

	var (
		mu       sync.Mutex
		inFlight int
		maxSeen  int
	)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rel, err := g.Acquire(context.Background(), "mtr")
			if err != nil {
				t.Errorf("acquire: %v", err)
				return
			}
			mu.Lock()
			inFlight++
			if inFlight > maxSeen {
				maxSeen = inFlight
			}
			mu.Unlock()

			time.Sleep(5 * time.Millisecond)

			mu.Lock()
			inFlight--
			mu.Unlock()
			rel()
		}()
	}
	wg.Wait()
	if maxSeen > cap {
		t.Errorf("max concurrency observed=%d exceeds cap=%d", maxSeen, cap)
	}
}

// Cancelling the caller's context while waiting for a slot must release the
// waiter — otherwise an agent shutdown leaks a goroutine.
func TestGateRespectsContextCancel(t *testing.T) {
	g := NewGate(map[string]int{"syn_scan": 1})
	rel, err := g.Acquire(context.Background(), "syn_scan")
	if err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	defer rel()

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := g.Acquire(ctx, "syn_scan")
		done <- err
	}()
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected cancellation error, got nil")
		}
	case <-time.After(time.Second):
		t.Fatal("Acquire did not return after context cancel")
	}
}
