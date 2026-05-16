package tasks

import (
	"bytes"
	"strings"
	"sync"
	"testing"
)

// copyAndStream walks the line boundary: every newline in input must produce
// (a) one buffer line ending with '\n' and (b) one sender call without the
// '\n'. Regressions here silently break the LiveOutput viewer.
func TestCopyAndStreamLineByLine(t *testing.T) {
	in := strings.NewReader("alpha\nbeta\ngamma\n")
	var buf bytes.Buffer
	var got []string
	sender := ChunkSender(func(stream, text string) {
		if stream != "stdout" {
			t.Errorf("unexpected stream: %q", stream)
		}
		got = append(got, text)
	})

	copyAndStream(in, &buf, "stdout", sender)

	if buf.String() != "alpha\nbeta\ngamma\n" {
		t.Errorf("buffer wrong: %q", buf.String())
	}
	wantSent := []string{"alpha", "beta", "gamma"}
	if !equalStrSlice(got, wantSent) {
		t.Errorf("sent lines: want %v got %v", wantSent, got)
	}
}

// A reader without trailing newline must still flush its last line, otherwise
// quick "ping → exit" output gets eaten.
func TestCopyAndStreamFinalLineNoNewline(t *testing.T) {
	in := strings.NewReader("only-line")
	var buf bytes.Buffer
	var got []string
	sender := ChunkSender(func(_, text string) { got = append(got, text) })

	copyAndStream(in, &buf, "stdout", sender)

	if buf.String() != "only-line\n" {
		t.Errorf("buffer should add trailing newline, got %q", buf.String())
	}
	if len(got) != 1 || got[0] != "only-line" {
		t.Errorf("sender: want [only-line], got %v", got)
	}
}

// Without a sender we still accumulate the whole stream. Confirms the buffer
// path is independent of streaming.
func TestCopyAndStreamNoSender(t *testing.T) {
	in := strings.NewReader("a\nb\n")
	var buf bytes.Buffer
	copyAndStream(in, &buf, "stdout", nil)
	if buf.String() != "a\nb\n" {
		t.Errorf("buffer should still collect output, got %q", buf.String())
	}
}

// Long lines used to truncate at 64KB because the bufio.Scanner default
// buffer wasn't grown. Confirm we accept up to ~1 MB.
func TestCopyAndStreamLargeLine(t *testing.T) {
	const size = 256 * 1024
	line := strings.Repeat("x", size)
	in := strings.NewReader(line + "\n")
	var buf bytes.Buffer
	var got []string
	sender := ChunkSender(func(_, text string) { got = append(got, text) })

	copyAndStream(in, &buf, "stdout", sender)

	if buf.Len() != size+1 {
		t.Errorf("buffer length: want %d got %d", size+1, buf.Len())
	}
	if len(got) != 1 || len(got[0]) != size {
		t.Errorf("sender: expected 1 line of %d chars, got %d lines (first %d chars)",
			size, len(got), func() int {
				if len(got) == 0 {
					return -1
				}
				return len(got[0])
			}())
	}
}

// Streaming from two goroutines (stdout + stderr) is the real-world case.
// Guard against any shared-state regression — each call to sender goes
// through the user's closure and must not interleave its line contents.
func TestCopyAndStreamConcurrentStdoutStderr(t *testing.T) {
	stdoutR := strings.NewReader("o1\no2\no3\n")
	stderrR := strings.NewReader("e1\ne2\n")
	var soBuf, seBuf bytes.Buffer

	var mu sync.Mutex
	gotStdout := 0
	gotStderr := 0
	sender := ChunkSender(func(stream, text string) {
		mu.Lock()
		defer mu.Unlock()
		// Whatever line is delivered must be intact — no commas, no embedded
		// newlines — otherwise the bufio.Scanner contract was violated.
		if strings.ContainsAny(text, "\n,") {
			t.Errorf("bad chunk text %q on %s", text, stream)
		}
		switch stream {
		case "stdout":
			gotStdout++
		case "stderr":
			gotStderr++
		default:
			t.Errorf("unknown stream %q", stream)
		}
	})

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		copyAndStream(stdoutR, &soBuf, "stdout", sender)
	}()
	go func() {
		defer wg.Done()
		copyAndStream(stderrR, &seBuf, "stderr", sender)
	}()
	wg.Wait()

	if gotStdout != 3 || gotStderr != 2 {
		t.Errorf("counts wrong: stdout=%d stderr=%d", gotStdout, gotStderr)
	}
	if soBuf.String() != "o1\no2\no3\n" {
		t.Errorf("stdout buf wrong: %q", soBuf.String())
	}
	if seBuf.String() != "e1\ne2\n" {
		t.Errorf("stderr buf wrong: %q", seBuf.String())
	}
}

func equalStrSlice(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
