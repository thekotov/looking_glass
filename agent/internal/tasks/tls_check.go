package tasks

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/looking-glass/agent/internal/validator"
)

type TLSCheckOptions struct {
	Port       int    `json:"port"`
	SNI        string `json:"sni"`
	TimeoutSec int    `json:"timeout_sec"`
}

type CertInfo struct {
	Subject     string   `json:"subject"`
	Issuer      string   `json:"issuer"`
	NotBefore   string   `json:"not_before"`
	NotAfter    string   `json:"not_after"`
	DaysLeft    int      `json:"days_left"`
	DNSNames    []string `json:"dns_names"`
	SerialHex   string   `json:"serial_hex"`
	IsCA        bool     `json:"is_ca"`
	KeyAlgo     string   `json:"key_algorithm"`
	SigAlgo     string   `json:"signature_algorithm"`
}

type TLSCheckResult struct {
	Target      string     `json:"target"`
	Port        int        `json:"port"`
	SNI         string     `json:"sni"`
	Version     string     `json:"version"`
	CipherSuite string     `json:"cipher_suite"`
	HandshakeMs float64    `json:"handshake_ms"`
	Chain       []CertInfo `json:"chain"`
	Error       string     `json:"error,omitempty"`
}

type TLSCheckRunner struct{}

func (TLSCheckRunner) Name() string { return "tls_check" }

func (TLSCheckRunner) Run(ctx context.Context, task Task) (*Result, error) {
	var opts TLSCheckOptions
	if err := json.Unmarshal(task.Options, &opts); err != nil {
		return nil, fmt.Errorf("parse options: %w", err)
	}
	if opts.TimeoutSec <= 0 {
		opts.TimeoutSec = 10
	}

	addrs, err := validator.ResolveAndCheck(task.Target)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}
	ip, err := pickIP(addrs, false)
	if err != nil {
		return failedResult(err.Error(), 0), nil
	}

	sni := opts.SNI
	if sni == "" {
		sni = task.Target
	}

	dialer := &net.Dialer{Timeout: time.Duration(opts.TimeoutSec) * time.Second}
	address := net.JoinHostPort(ip.String(), strconv.Itoa(opts.Port))

	start := time.Now()
	tlsCfg := &tls.Config{
		ServerName:         sni,
		InsecureSkipVerify: true, //nolint:gosec // we report cert details, validity is separate
	}
	conn, err := tls.DialWithDialer(dialer, "tcp", address, tlsCfg)
	if err != nil {
		return failedResult(err.Error(), int(time.Since(start)/time.Millisecond)), nil
	}
	defer conn.Close()
	handshakeMs := round(float64(time.Since(start))/float64(time.Millisecond), 3)

	state := conn.ConnectionState()
	chain := make([]CertInfo, 0, len(state.PeerCertificates))
	now := time.Now()
	for _, c := range state.PeerCertificates {
		chain = append(chain, CertInfo{
			Subject:   c.Subject.String(),
			Issuer:    c.Issuer.String(),
			NotBefore: c.NotBefore.UTC().Format(time.RFC3339),
			NotAfter:  c.NotAfter.UTC().Format(time.RFC3339),
			DaysLeft:  int(c.NotAfter.Sub(now).Hours() / 24),
			DNSNames:  c.DNSNames,
			SerialHex: c.SerialNumber.Text(16),
			IsCA:      c.IsCA,
			KeyAlgo:   c.PublicKeyAlgorithm.String(),
			SigAlgo:   c.SignatureAlgorithm.String(),
		})
	}

	result := TLSCheckResult{
		Target:      task.Target,
		Port:        opts.Port,
		SNI:         sni,
		Version:     tlsVersionName(state.Version),
		CipherSuite: tls.CipherSuiteName(state.CipherSuite),
		HandshakeMs: handshakeMs,
		Chain:       chain,
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "TLS %s:%d (sni=%s) %s %s\n",
		task.Target, opts.Port, sni, result.Version, result.CipherSuite)
	for i, c := range chain {
		fmt.Fprintf(&sb, "[%d] %s\n    issuer: %s\n    expires: %s (%d days)\n",
			i, c.Subject, c.Issuer, c.NotAfter, c.DaysLeft)
	}
	return resultFromJSON(result, sb.String(), int(time.Since(start)/time.Millisecond))
}
