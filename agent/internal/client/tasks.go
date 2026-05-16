package client

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/looking-glass/agent/internal/tasks"
)

// PollTask returns the next task or (nil, nil) if the queue is empty.
func (c *Client) PollTask(ctx context.Context) (*tasks.Task, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.serverURL+"/api/tasks/poll", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.httpc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrUnauthorized
	}
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("server returned %d: %s", resp.StatusCode, string(body))
	}

	// FastAPI returns the JSON literal `null` when the queue is empty.
	var raw json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var t tasks.Task
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil, fmt.Errorf("unmarshal task: %w", err)
	}
	return &t, nil
}

// SubmitResult posts the final result of a task.
func (c *Client) SubmitResult(ctx context.Context, taskID string, result *tasks.Result) error {
	return c.post(ctx, "/api/tasks/"+taskID+"/result", result, nil)
}

// ChunkPayload mirrors the server-side TaskChunkSubmit schema.
type ChunkPayload struct {
	Seq    int    `json:"seq"`
	Stream string `json:"stream"`
	Text   string `json:"text"`
}

// SubmitChunk posts one incremental output line for a running task.
func (c *Client) SubmitChunk(ctx context.Context, taskID string, chunk ChunkPayload) error {
	return c.post(ctx, "/api/tasks/"+taskID+"/chunk", chunk, nil)
}
