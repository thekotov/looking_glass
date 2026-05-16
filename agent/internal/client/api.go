package client

import "context"

type RegisterRequest struct {
	Hostname     string   `json:"hostname"`
	Version      string   `json:"version"`
	Capabilities []string `json:"capabilities"`
}

type RegisterResponse struct {
	AgentID      string `json:"agent_id"`
	Token        string `json:"token"`
	PollInterval int    `json:"poll_interval"`
}

type HeartbeatRequest struct {
	Version      string   `json:"version,omitempty"`
	Capabilities []string `json:"capabilities,omitempty"`
}

type HeartbeatResponse struct {
	Status       string `json:"status"`
	PollInterval int    `json:"poll_interval"`
}

func (c *Client) Register(ctx context.Context, req RegisterRequest) (*RegisterResponse, error) {
	var out RegisterResponse
	if err := c.post(ctx, "/api/agents/register", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) Heartbeat(ctx context.Context, req HeartbeatRequest) (*HeartbeatResponse, error) {
	var out HeartbeatResponse
	if err := c.post(ctx, "/api/agents/heartbeat", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
