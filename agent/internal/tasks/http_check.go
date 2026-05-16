package tasks

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"strings"
	"time"

	"github.com/looking-glass/agent/internal/validator"
)

type HTTPCheckOptions struct {
	Method          string            `json:"method"`
	FollowRedirects bool              `json:"follow_redirects"`
	Headers         map[string]string `json:"headers"`
	TimeoutSec      int               `json:"timeout_sec"`
}

type HTTPCheckResult struct {
	URL            string            `json:"url"`
	FinalURL       string            `json:"final_url"`
	Method         string            `json:"method"`
	StatusCode     int               `json:"status_code"`
	Status         string            `json:"status"`
	ResponseHeader map[string]string `json:"response_headers"`
	BodyExcerpt    string            `json:"body_excerpt"`
	BodySizeBytes  int               `json:"body_size_bytes"`
	DurationMs     float64           `json:"duration_ms"`
	Timing         *HTTPTiming       `json:"timing,omitempty"`
	TLS            *HTTPTLSInfo      `json:"tls,omitempty"`
	Error          string            `json:"error,omitempty"`
}

// HTTPTiming is a waterfall breakdown of the request in milliseconds.
// Each field is the cumulative time-since-start when that phase finished.
// "Phase duration" can be derived by subtracting from the previous stage.
type HTTPTiming struct {
	DNSMs            float64 `json:"dns_ms"`             // time spent in DNS resolution
	TCPConnectMs     float64 `json:"tcp_connect_ms"`     // TCP handshake duration
	TLSHandshakeMs   float64 `json:"tls_handshake_ms"`   // TLS handshake duration (0 for plain http)
	TTFBMs           float64 `json:"ttfb_ms"`            // time-to-first-byte (cumulative, from start)
	TotalMs          float64 `json:"total_ms"`           // total request duration including body
	ConnectionReused bool    `json:"connection_reused"`  // true if HTTP/2 or keep-alive reused conn
}

type HTTPTLSInfo struct {
	Version     string `json:"version"`
	CipherSuite string `json:"cipher_suite"`
	ServerName  string `json:"server_name"`
}

type HTTPCheckRunner struct{}

func (HTTPCheckRunner) Name() string { return "http_check" }

func (HTTPCheckRunner) Run(ctx context.Context, task Task) (*Result, error) {
	var opts HTTPCheckOptions
	if err := json.Unmarshal(task.Options, &opts); err != nil {
		return nil, fmt.Errorf("parse options: %w", err)
	}
	if opts.Method == "" {
		opts.Method = "GET"
	}
	if opts.TimeoutSec <= 0 {
		opts.TimeoutSec = 10
	}

	// Target must be a URL (http or https). Validate host portion via validator.
	rawURL := task.Target
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		rawURL = "https://" + rawURL
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return failedResult("invalid URL: "+err.Error(), 0), nil
	}
	if u.Hostname() == "" {
		return failedResult("URL has no host", 0), nil
	}
	if _, err := validator.ResolveAndCheck(u.Hostname()); err != nil {
		return failedResult(err.Error(), 0), nil
	}

	transport := &http.Transport{
		ResponseHeaderTimeout: time.Duration(opts.TimeoutSec) * time.Second,
		TLSHandshakeTimeout:   time.Duration(opts.TimeoutSec) * time.Second,
		DialContext: (&net.Dialer{
			Timeout: time.Duration(opts.TimeoutSec) * time.Second,
		}).DialContext,
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   time.Duration(opts.TimeoutSec) * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			if opts.FollowRedirects {
				return nil
			}
			return http.ErrUseLastResponse
		},
	}

	req, err := http.NewRequestWithContext(ctx, opts.Method, rawURL, nil)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}
	for k, v := range opts.Headers {
		req.Header.Set(k, v)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "looking-glass-agent/0.1")
	}

	// Capture per-phase timestamps via httptrace so we can render a waterfall.
	// All fields are measured relative to `start` so subtracting from the
	// previous phase gives that phase's duration.
	start := time.Now()
	var (
		dnsStart       time.Time
		dnsDoneAt      time.Time
		connectStart   time.Time
		connectDoneAt  time.Time
		tlsStart       time.Time
		tlsDoneAt      time.Time
		gotFirstByteAt time.Time
		connReused     bool
	)
	trace := &httptrace.ClientTrace{
		DNSStart: func(_ httptrace.DNSStartInfo) { dnsStart = time.Now() },
		DNSDone:  func(_ httptrace.DNSDoneInfo) { dnsDoneAt = time.Now() },
		ConnectStart: func(_, _ string) {
			connectStart = time.Now()
		},
		ConnectDone: func(_, _ string, _ error) {
			connectDoneAt = time.Now()
		},
		TLSHandshakeStart: func() { tlsStart = time.Now() },
		TLSHandshakeDone: func(_ tls.ConnectionState, _ error) {
			tlsDoneAt = time.Now()
		},
		GotFirstResponseByte: func() { gotFirstByteAt = time.Now() },
		GotConn: func(info httptrace.GotConnInfo) {
			connReused = info.Reused
		},
	}
	req = req.WithContext(httptrace.WithClientTrace(req.Context(), trace))

	resp, err := client.Do(req)
	duration := time.Since(start)
	if err != nil {
		return failedResult(err.Error(), int(duration/time.Millisecond)), nil
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024))
	bodySize := len(body)
	total := time.Since(start)

	result := HTTPCheckResult{
		URL:            rawURL,
		FinalURL:       resp.Request.URL.String(),
		Method:         opts.Method,
		StatusCode:     resp.StatusCode,
		Status:         resp.Status,
		ResponseHeader: flattenHeaders(resp.Header),
		BodyExcerpt:    truncate(string(body), 1024),
		BodySizeBytes:  bodySize,
		DurationMs:     round(float64(duration)/float64(time.Millisecond), 3),
		Timing: &HTTPTiming{
			DNSMs:            phaseDurMs(dnsStart, dnsDoneAt),
			TCPConnectMs:     phaseDurMs(connectStart, connectDoneAt),
			TLSHandshakeMs:   phaseDurMs(tlsStart, tlsDoneAt),
			TTFBMs:           sinceStartMs(start, gotFirstByteAt),
			TotalMs:          round(float64(total)/float64(time.Millisecond), 3),
			ConnectionReused: connReused,
		},
	}
	if resp.TLS != nil {
		result.TLS = &HTTPTLSInfo{
			Version:     tlsVersionName(resp.TLS.Version),
			CipherSuite: tls.CipherSuiteName(resp.TLS.CipherSuite),
			ServerName:  resp.TLS.ServerName,
		}
	}

	stdout := fmt.Sprintf("%s %s\n%d %s\n%d bytes in %.0f ms\n",
		opts.Method, rawURL, resp.StatusCode, resp.Status, bodySize, result.DurationMs)
	return resultFromJSON(result, stdout, int(duration/time.Millisecond))
}

// phaseDurMs returns the duration of a phase in milliseconds. Returns 0 if
// either timestamp is zero — happens for plain HTTP (no TLS) or when the
// connection was reused (no DNS/TCP).
func phaseDurMs(start, end time.Time) float64 {
	if start.IsZero() || end.IsZero() {
		return 0
	}
	return round(float64(end.Sub(start))/float64(time.Millisecond), 3)
}

// sinceStartMs returns time-since-start in milliseconds. Returns 0 if the
// event never fired (e.g. transport error before first byte).
func sinceStartMs(start, at time.Time) float64 {
	if at.IsZero() {
		return 0
	}
	return round(float64(at.Sub(start))/float64(time.Millisecond), 3)
}

func flattenHeaders(h http.Header) map[string]string {
	out := make(map[string]string, len(h))
	for k, v := range h {
		out[k] = strings.Join(v, ", ")
	}
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func tlsVersionName(v uint16) string {
	switch v {
	case tls.VersionTLS13:
		return "TLS1.3"
	case tls.VersionTLS12:
		return "TLS1.2"
	case tls.VersionTLS11:
		return "TLS1.1"
	case tls.VersionTLS10:
		return "TLS1.0"
	}
	return fmt.Sprintf("0x%04x", v)
}
