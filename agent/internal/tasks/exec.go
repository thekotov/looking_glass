package tasks

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"os/exec"
	"sync"
	"time"
)

// runCmd executes a command with a strict argv slice (no shell). The argv is
// constructed by the runner from typed/validated params — never user input.
//
// If a ChunkSender is present in the context, stdout/stderr are streamed
// line-by-line as the process produces them (a copy is still accumulated
// for the final result). Otherwise we just collect output and return at the end.
//
// Returns stdout, stderr, exitCode, durationMs, err.
// err is only non-nil for spawn failure; non-zero exit codes are reported
// via the int return.
func runCmd(ctx context.Context, name string, args ...string) (string, string, int, int, error) {
	sender := SenderFromCtx(ctx)
	// When streaming, force line-buffered stdio so the child flushes per line
	// instead of when the pipe buffer fills (which can take seconds for fast
	// tools like hping3 and produces a useless "all-at-once at the end" UX).
	// stdbuf ships with coreutils, always present on Debian.
	cmd := exec.CommandContext(ctx, name, args...)
	if sender != nil {
		stdbufArgs := append([]string{"-oL", "-eL", name}, args...)
		cmd = exec.CommandContext(ctx, "stdbuf", stdbufArgs...)
	}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return "", "", 0, 0, err
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return "", "", 0, 0, err
	}

	start := time.Now()
	if err := cmd.Start(); err != nil {
		return "", "", 0, 0, err
	}

	var stdoutBuf, stderrBuf bytes.Buffer
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		copyAndStream(stdoutPipe, &stdoutBuf, "stdout", sender)
	}()
	go func() {
		defer wg.Done()
		copyAndStream(stderrPipe, &stderrBuf, "stderr", sender)
	}()

	waitErr := cmd.Wait()
	wg.Wait()
	duration := int(time.Since(start) / time.Millisecond)

	exitCode := 0
	if waitErr != nil {
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			exitCode = exitErr.ExitCode()
			waitErr = nil
		}
	}
	return stdoutBuf.String(), stderrBuf.String(), exitCode, duration, waitErr
}

// copyAndStream reads r line-by-line, writes each line into buf, and (if
// sender is non-nil) forwards the line to the server as a streaming chunk.
//
// We use bufio.Scanner with the default scanLines, which strips the newline.
// We re-add "\n" when writing into the buffer so the final stdout matches what
// the process actually wrote.
func copyAndStream(r io.Reader, buf *bytes.Buffer, stream string, sender ChunkSender) {
	scanner := bufio.NewScanner(r)
	// Allow long lines (e.g. mtr --json output is one giant blob).
	scanner.Buffer(make([]byte, 0, 64*1024), 1*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		buf.WriteString(line)
		buf.WriteByte('\n')
		if sender != nil {
			sender(stream, line)
		}
	}
}
