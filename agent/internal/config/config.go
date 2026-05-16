package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

const Version = "0.1.0"

type Config struct {
	ServerURL         string
	Hostname          string
	HeartbeatInterval time.Duration
	PollInterval      time.Duration
	InsecureTLS       bool
	StatePath         string
	Capabilities      []string
	MetricsAddr       string
}

func Load() (*Config, error) {
	serverURL := os.Getenv("SERVER_URL")
	if serverURL == "" {
		return nil, fmt.Errorf("SERVER_URL is required")
	}

	hostname := os.Getenv("AGENT_HOSTNAME")
	if hostname == "" {
		hn, err := os.Hostname()
		if err != nil {
			return nil, fmt.Errorf("AGENT_HOSTNAME not set and os.Hostname() failed: %w", err)
		}
		hostname = hn
	}

	heartbeat, err := parseDurationEnv("HEARTBEAT_INTERVAL", 15*time.Second)
	if err != nil {
		return nil, err
	}
	poll, err := parseDurationEnv("POLL_INTERVAL", 5*time.Second)
	if err != nil {
		return nil, err
	}
	insecure, err := parseBoolEnv("INSECURE_TLS", false)
	if err != nil {
		return nil, err
	}

	statePath := os.Getenv("STATE_PATH")
	if statePath == "" {
		statePath = "/var/lib/agent/state.json"
	}

	metricsAddr := os.Getenv("METRICS_ADDR")
	if metricsAddr == "" {
		metricsAddr = ":9100"
	}

	// Capabilities are populated at runtime from the task Registry — leave nil here.
	var caps []string

	return &Config{
		ServerURL:         serverURL,
		Hostname:          hostname,
		HeartbeatInterval: heartbeat,
		PollInterval:      poll,
		InsecureTLS:       insecure,
		StatePath:         statePath,
		Capabilities:      caps,
		MetricsAddr:       metricsAddr,
	}, nil
}

func parseDurationEnv(key string, def time.Duration) (time.Duration, error) {
	v := os.Getenv(key)
	if v == "" {
		return def, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("invalid %s=%q: %w", key, v, err)
	}
	return d, nil
}

func parseBoolEnv(key string, def bool) (bool, error) {
	v := os.Getenv(key)
	if v == "" {
		return def, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("invalid %s=%q: %w", key, v, err)
	}
	return b, nil
}
