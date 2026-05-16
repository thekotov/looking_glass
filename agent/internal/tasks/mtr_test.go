package tasks

import (
	"math"
	"reflect"
	"testing"
)

// parseMTRRawLine is the hot path for live streaming. Bugs here silently drop
// probes from the UI, so cover every branch.
func TestParseMTRRawLine(t *testing.T) {
	cases := []struct {
		name string
		line string
		want mtrEvent
		ok   bool
	}{
		{
			name: "hop with IPv4",
			line: "h 0 192.168.1.1",
			want: mtrEvent{Type: "mtr_hop", Hop: 0, IP: "192.168.1.1"},
			ok:   true,
		},
		{
			name: "probe in microseconds becomes ms",
			line: "p 3 12345",
			// 12345us → 12.345ms.
			want: mtrEvent{Type: "mtr_probe", Hop: 3, RTTMs: 12.345},
			ok:   true,
		},
		{
			name: "dns multi-word hostname is joined",
			line: "d 1 router.example.com",
			want: mtrEvent{Type: "mtr_dns", Hop: 1, Host: "router.example.com"},
			ok:   true,
		},
		{
			name: "dns with whitespace-separated label keeps everything",
			line: "d 2 some weird host",
			want: mtrEvent{Type: "mtr_dns", Hop: 2, Host: "some weird host"},
			ok:   true,
		},
		{
			name: "too few fields",
			line: "h 0",
			ok:   false,
		},
		{
			name: "non-integer hop",
			line: "h x 1.2.3.4",
			ok:   false,
		},
		{
			name: "non-integer rtt rejected",
			line: "p 0 not-a-number",
			ok:   false,
		},
		{
			name: "unknown event type",
			line: "x 0 hello",
			ok:   false,
		},
		{
			name: "empty",
			line: "",
			ok:   false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseMTRRawLine(tc.line)
			if ok != tc.ok {
				t.Fatalf("ok mismatch: want=%v got=%v event=%+v", tc.ok, ok, got)
			}
			if !ok {
				return
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("event mismatch:\n  want %+v\n   got %+v", tc.want, got)
			}
		})
	}
}

func TestStatsEmpty(t *testing.T) {
	best, worst, avg, stdev := stats(nil)
	if best != 0 || worst != 0 || avg != 0 || stdev != 0 {
		t.Errorf("expected zeros, got best=%v worst=%v avg=%v stdev=%v", best, worst, avg, stdev)
	}
}

func TestStatsSinglePoint(t *testing.T) {
	best, worst, avg, stdev := stats([]float64{5.0})
	if best != 5 || worst != 5 || avg != 5 {
		t.Errorf("single point should report itself, got best=%v worst=%v avg=%v", best, worst, avg)
	}
	if stdev != 0 {
		t.Errorf("stdev of single sample is 0, got %v", stdev)
	}
}

func TestStatsKnownValues(t *testing.T) {
	// Mean=4, sample stdev=sqrt(((1-4)^2+(3-4)^2+(5-4)^2+(7-4)^2)/3)=sqrt(20/3)≈2.582
	best, worst, avg, stdev := stats([]float64{1, 3, 5, 7})
	if best != 1 || worst != 7 {
		t.Errorf("best/worst wrong: best=%v worst=%v", best, worst)
	}
	if math.Abs(avg-4) > 1e-9 {
		t.Errorf("avg should be 4, got %v", avg)
	}
	want := math.Sqrt(20.0 / 3.0)
	if math.Abs(stdev-want) > 1e-9 {
		t.Errorf("stdev: want %v got %v", want, stdev)
	}
}

// applyAndBuildReport exercises the full event-stream → report pipeline that
// MTRResultView consumes. If this changes shape, the frontend breaks.
func TestBuildReportShape(t *testing.T) {
	st := newMTRState(3)
	st.apply(mtrEvent{Type: "mtr_hop", Hop: 0, IP: "10.0.0.1"})
	st.apply(mtrEvent{Type: "mtr_dns", Hop: 0, Host: "gw.example"})
	st.apply(mtrEvent{Type: "mtr_probe", Hop: 0, RTTMs: 1.0})
	st.apply(mtrEvent{Type: "mtr_probe", Hop: 0, RTTMs: 3.0})
	// Second hop, only one probe, no DNS — host should fall back to IP.
	st.apply(mtrEvent{Type: "mtr_hop", Hop: 1, IP: "1.2.3.4"})
	st.apply(mtrEvent{Type: "mtr_probe", Hop: 1, RTTMs: 5.0})
	// Third hop, no events at all — host should render as "???".
	st.apply(mtrEvent{Type: "mtr_hop", Hop: 2, IP: ""})

	report := st.buildReport("example.com", "1.1.1.1")
	if report["target"] != "example.com" || report["resolved_ip"] != "1.1.1.1" {
		t.Fatalf("top-level fields wrong: %+v", report)
	}
	inner, ok := report["report"].(map[string]any)
	if !ok {
		t.Fatalf("report['report'] missing or wrong type: %T", report["report"])
	}
	hubs, ok := inner["hubs"].([]map[string]any)
	if !ok {
		t.Fatalf("hubs wrong type: %T", inner["hubs"])
	}
	if len(hubs) != 3 {
		t.Fatalf("expected 3 hubs, got %d", len(hubs))
	}

	// Hop 0: DNS name wins over IP.
	if hubs[0]["host"] != "gw.example" {
		t.Errorf("hop 0 host: want 'gw.example', got %v", hubs[0]["host"])
	}
	// Loss% = (3 cycles - 2 received) * 100 / 3 = 33.333...
	if got := hubs[0]["Loss%"].(float64); math.Abs(got-33.333) > 0.001 {
		t.Errorf("hop 0 loss%%: want ~33.333, got %v", got)
	}
	if hubs[0]["Snt"].(int) != 3 {
		t.Errorf("hop 0 Snt: want 3, got %v", hubs[0]["Snt"])
	}
	// Last sample was 3.0 ms.
	if got := hubs[0]["Last"].(float64); got != 3.0 {
		t.Errorf("hop 0 Last: want 3.0, got %v", got)
	}

	// Hop 1: no DNS → host = IP.
	if hubs[1]["host"] != "1.2.3.4" {
		t.Errorf("hop 1 host: want '1.2.3.4', got %v", hubs[1]["host"])
	}

	// Hop 2: no IP, no DNS → "???".
	if hubs[2]["host"] != "???" {
		t.Errorf("hop 2 host: want '???', got %v", hubs[2]["host"])
	}
	// 0 probes received → Loss% should be 100.
	if got := hubs[2]["Loss%"].(float64); got != 100.0 {
		t.Errorf("hop 2 loss%%: want 100, got %v", got)
	}
}

// Empty state should produce an empty hubs array, not a crash. Important
// because mtr can exit immediately if the target is unreachable.
func TestBuildReportNoHops(t *testing.T) {
	st := newMTRState(5)
	report := st.buildReport("nowhere.invalid", "0.0.0.0")
	inner := report["report"].(map[string]any)
	hubs := inner["hubs"].([]any)
	if len(hubs) != 0 {
		t.Errorf("expected zero hubs, got %d", len(hubs))
	}
}
