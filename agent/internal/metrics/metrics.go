// Package metrics exposes Prometheus metrics for the agent.
//
// Exposed on a dedicated HTTP server (default :9100) so it stays isolated
// from the agent's outbound traffic to the looking-glass server. The runtime
// flips counters via Inc/Observe; Serve runs the listener.
package metrics

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	TaskRunsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "lg_agent_task_runs_total",
			Help: "Tasks executed by this agent, by type and final status.",
		},
		[]string{"type", "status"},
	)
	TaskDurationSeconds = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "lg_agent_task_duration_seconds",
			Help:    "Task wall-clock duration in seconds, by type.",
			Buckets: prometheus.ExponentialBuckets(0.05, 2, 12),
		},
		[]string{"type"},
	)
	HeartbeatsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "lg_agent_heartbeats_total",
			Help: "Heartbeats sent to the server, by outcome.",
		},
		[]string{"outcome"},
	)
	AgentUp = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "lg_agent_up",
			Help: "1 when the agent process is running.",
		},
	)
)

// Registry returned to the HTTP handler. Built fresh so we control what's exposed.
func newRegistry() *prometheus.Registry {
	r := prometheus.NewRegistry()
	r.MustRegister(collectors.NewGoCollector())
	r.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	r.MustRegister(TaskRunsTotal, TaskDurationSeconds, HeartbeatsTotal, AgentUp)
	AgentUp.Set(1)
	return r
}

// Serve starts the /metrics HTTP listener. Returns when ctx is cancelled.
func Serve(ctx context.Context, addr string) error {
	reg := newRegistry()
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	errCh := make(chan error, 1)
	go func() {
		slog.Info("metrics listening", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
		close(errCh)
	}()
	select {
	case <-ctx.Done():
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutCtx)
		return nil
	case err := <-errCh:
		return err
	}
}
