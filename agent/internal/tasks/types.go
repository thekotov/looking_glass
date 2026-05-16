package tasks

import (
	"context"
	"encoding/json"
)

// Task is what the agent receives from the server's poll endpoint.
type Task struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Target  string          `json:"target"`
	Options json.RawMessage `json:"options"`
}

// Status mirrors the server's TaskStatus enum (terminal values only — the
// agent reports completed/failed/timeout, never queued/claimed).
const (
	StatusCompleted = "completed"
	StatusFailed    = "failed"
	StatusTimeout   = "timeout"
)

// Result is what the agent reports back.
type Result struct {
	Stdout     string          `json:"stdout"`
	Stderr     string          `json:"stderr"`
	ExitCode   *int            `json:"exit_code,omitempty"`
	DurationMs int             `json:"duration_ms"`
	ParsedJSON json.RawMessage `json:"parsed_json,omitempty"`
	Status     string          `json:"status"`
	Error      *string         `json:"error,omitempty"`
}

// Runner executes one task type. Implementations live next to this file
// (ping.go, mtr.go, ...) and register themselves in Registry.
type Runner interface {
	// Name is the task type string, matching server's TaskType enum.
	Name() string
	// Run executes the task and returns a Result. ctx cancellation should
	// be honored — used for shutdown and timeouts.
	Run(ctx context.Context, task Task) (*Result, error)
}

// Registry maps task type → Runner. Populate via Register at init time.
type Registry struct {
	runners map[string]Runner
}

func NewRegistry() *Registry {
	return &Registry{runners: map[string]Runner{}}
}

func (r *Registry) Register(runner Runner) {
	r.runners[runner.Name()] = runner
}

func (r *Registry) Get(name string) (Runner, bool) {
	rr, ok := r.runners[name]
	return rr, ok
}

func (r *Registry) Capabilities() []string {
	out := make([]string, 0, len(r.runners))
	for name := range r.runners {
		out = append(out, name)
	}
	return out
}
