package tasks

import (
	"encoding/json"
	"fmt"
)

// resultFromJSON builds a Result from a parsed payload and a stdout string,
// marking the run as completed with exit_code 0.
func resultFromJSON(parsed any, stdout string, durationMs int) (*Result, error) {
	buf, err := json.Marshal(parsed)
	if err != nil {
		return nil, fmt.Errorf("marshal parsed json: %w", err)
	}
	exit := 0
	return &Result{
		Stdout:     stdout,
		ExitCode:   &exit,
		DurationMs: durationMs,
		ParsedJSON: buf,
		Status:     StatusCompleted,
	}, nil
}

// failedResult constructs a result with status=failed and the given message
// in stderr/error.
func failedResult(msg string, durationMs int) *Result {
	exit := 1
	m := msg
	return &Result{
		Stderr:     msg,
		ExitCode:   &exit,
		DurationMs: durationMs,
		Status:     StatusFailed,
		Error:      &m,
	}
}
