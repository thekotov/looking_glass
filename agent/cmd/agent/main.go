package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/looking-glass/agent/internal/client"
	"github.com/looking-glass/agent/internal/config"
	"github.com/looking-glass/agent/internal/metrics"
	"github.com/looking-glass/agent/internal/state"
	"github.com/looking-glass/agent/internal/tasks"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Build the task registry — the agent only advertises types it actually runs.
	registry := tasks.NewRegistry()
	registry.Register(tasks.PingRunner{})
	registry.Register(tasks.TracerouteRunner{})
	registry.Register(tasks.MTRRunner{})
	registry.Register(tasks.MTRTCPRunner{})
	registry.Register(tasks.TCPConnectRunner{})
	registry.Register(tasks.TCPScanRunner{})
	registry.Register(tasks.Hping3Runner{})
	registry.Register(tasks.DNSRunner{})
	registry.Register(tasks.HTTPCheckRunner{})
	registry.Register(tasks.TLSCheckRunner{})
	registry.Register(tasks.SYNScanRunner{})
	cfg.Capabilities = registry.Capabilities()

	// Gate caps concurrent runs per task type — see concurrency.go for rationale.
	gate := tasks.NewGate(tasks.ConcurrencyCaps)

	slog.Info("looking-glass agent starting",
		"hostname", cfg.Hostname,
		"server_url", cfg.ServerURL,
		"version", config.Version,
		"state_path", cfg.StatePath,
		"capabilities", cfg.Capabilities,
	)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := run(ctx, cfg, registry, gate); err != nil {
		slog.Error("agent exited with error", "error", err)
		os.Exit(1)
	}
	slog.Info("agent shutdown clean")
}

func run(ctx context.Context, cfg *config.Config, reg *tasks.Registry, gate *tasks.Gate) error {
	store := state.NewStore(cfg.StatePath)
	c := client.New(cfg)

	st, err := store.Load()
	if err != nil {
		slog.Warn("failed to load state, will re-register", "error", err)
		st = nil
	}

	if st == nil {
		st, err = register(ctx, cfg, c, store)
		if err != nil {
			return err
		}
	} else {
		slog.Info("loaded existing agent state", "agent_id", st.AgentID)
		c.SetToken(st.Token)
	}

	// Heartbeat, poll, and metrics-server loops run concurrently.
	errCh := make(chan error, 3)
	go func() { errCh <- heartbeatLoop(ctx, cfg, c, store) }()
	go func() { errCh <- pollLoop(ctx, cfg, c, reg, gate) }()
	go func() { errCh <- metrics.Serve(ctx, cfg.MetricsAddr) }()

	// Wait for any loop to return; ctx cancellation propagates to both.
	err = <-errCh
	cancel := context.AfterFunc(ctx, func() {})
	defer cancel()
	return err
}

func register(
	ctx context.Context, cfg *config.Config, c *client.Client, store *state.Store,
) (*state.State, error) {
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		slog.Info("registering with server", "server_url", cfg.ServerURL)
		resp, err := c.Register(ctx, client.RegisterRequest{
			Hostname:     cfg.Hostname,
			Version:      config.Version,
			Capabilities: cfg.Capabilities,
		})
		if err == nil {
			st := &state.State{AgentID: resp.AgentID, Token: resp.Token}
			if err := store.Save(st); err != nil {
				return nil, err
			}
			c.SetToken(st.Token)
			slog.Info("registered, awaiting approval",
				"agent_id", st.AgentID, "poll_interval", resp.PollInterval)
			return st, nil
		}
		slog.Warn("register failed, will retry", "error", err, "backoff", backoff)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > 60*time.Second {
			backoff = 60 * time.Second
		}
	}
}

func heartbeatLoop(
	ctx context.Context, cfg *config.Config, c *client.Client, store *state.Store,
) error {
	ticker := time.NewTicker(cfg.HeartbeatInterval)
	defer ticker.Stop()

	if err := beat(ctx, cfg, c, store); err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := beat(ctx, cfg, c, store); err != nil {
				return err
			}
		}
	}
}

func beat(
	ctx context.Context, cfg *config.Config, c *client.Client, store *state.Store,
) error {
	resp, err := c.Heartbeat(ctx, client.HeartbeatRequest{
		Version:      config.Version,
		Capabilities: cfg.Capabilities,
	})
	if errors.Is(err, client.ErrUnauthorized) {
		metrics.HeartbeatsTotal.WithLabelValues("unauthorized").Inc()
		slog.Warn("token rejected, clearing state and re-registering")
		_ = store.Clear()
		newSt, regErr := register(ctx, cfg, c, store)
		if regErr != nil {
			return regErr
		}
		slog.Info("re-registered after 401", "agent_id", newSt.AgentID)
		return nil
	}
	if err != nil {
		metrics.HeartbeatsTotal.WithLabelValues("error").Inc()
		slog.Warn("heartbeat failed", "error", err)
		return nil
	}
	metrics.HeartbeatsTotal.WithLabelValues("ok").Inc()
	slog.Info("heartbeat ok",
		"status", resp.Status,
		"poll_interval", resp.PollInterval,
	)
	return nil
}

func pollLoop(
	ctx context.Context, cfg *config.Config, c *client.Client, reg *tasks.Registry, gate *tasks.Gate,
) error {
	// Use cfg.PollInterval as the empty-queue idle wait. After completing a
	// task we immediately poll again — drain the queue without backoff.
	ticker := time.NewTicker(cfg.PollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}

		task, err := c.PollTask(ctx)
		if errors.Is(err, client.ErrUnauthorized) {
			// Heartbeat loop owns re-registration; just wait it out.
			continue
		}
		if err != nil {
			slog.Warn("poll failed", "error", err)
			continue
		}
		if task == nil {
			continue
		}

		slog.Info("got task", "task_id", task.ID, "type", task.Type, "target", task.Target)
		executeTask(ctx, c, reg, gate, task)
	}
}

func executeTask(
	ctx context.Context, c *client.Client, reg *tasks.Registry, gate *tasks.Gate, task *tasks.Task,
) {
	runner, ok := reg.Get(task.Type)
	if !ok {
		errMsg := "unsupported task type"
		exit := 1
		_ = c.SubmitResult(ctx, task.ID, &tasks.Result{
			Stderr:   errMsg,
			ExitCode: &exit,
			Status:   tasks.StatusFailed,
			Error:    &errMsg,
		})
		slog.Warn("unsupported task type, reporting failure", "type", task.Type)
		return
	}

	// Per-task chunk sender — closure carries seq counter + task ID.
	taskID := task.ID
	seq := 0
	sender := tasks.ChunkSender(func(stream, text string) {
		seq++
		if err := c.SubmitChunk(ctx, taskID, client.ChunkPayload{
			Seq:    seq,
			Stream: stream,
			Text:   text,
		}); err != nil {
			// Don't fail the task on chunk delivery hiccup — just log.
			slog.Debug("chunk submit failed", "task_id", taskID, "error", err)
		}
	})
	ctx = tasks.WithChunkSender(ctx, sender)

	// Block here if another task of this type is still running on the agent.
	release, gateErr := gate.Acquire(ctx, task.Type)
	if gateErr != nil {
		errMsg := "agent shutting down before slot freed"
		exit := 1
		_ = c.SubmitResult(ctx, task.ID, &tasks.Result{
			Stderr:   errMsg,
			ExitCode: &exit,
			Status:   tasks.StatusFailed,
			Error:    &errMsg,
		})
		return
	}
	defer release()

	startedAt := time.Now()
	result, err := runner.Run(ctx, *task)
	if err != nil {
		errMsg := err.Error()
		exit := 1
		metrics.TaskRunsTotal.WithLabelValues(task.Type, tasks.StatusFailed).Inc()
		_ = c.SubmitResult(ctx, task.ID, &tasks.Result{
			Stderr:   errMsg,
			ExitCode: &exit,
			Status:   tasks.StatusFailed,
			Error:    &errMsg,
		})
		slog.Warn("task runner errored", "task_id", task.ID, "error", err)
		return
	}

	metrics.TaskRunsTotal.WithLabelValues(task.Type, result.Status).Inc()
	metrics.TaskDurationSeconds.WithLabelValues(task.Type).Observe(time.Since(startedAt).Seconds())

	if err := c.SubmitResult(ctx, task.ID, result); err != nil {
		slog.Warn("failed to submit result", "task_id", task.ID, "error", err)
		return
	}
	slog.Info("task done",
		"task_id", task.ID, "status", result.Status, "duration_ms", result.DurationMs,
	)
}
