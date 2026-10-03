package seating

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

// diagnoseLines reports, per capacity 9..12 and without pins, the isolated guests
// of the proposed plan (k tables) and the same for k + 1 tables when that is
// feasible and (k+1)*Floor <= N. Ids and counts only, never names. Not a product
// feature: the user decides whether an extra table is worth it (task 011).
func diagnoseLines(g Graph) []string {
	var out []string
	describe := func(capacity, k int, p Plan) string {
		ev := Evaluate(g, p)
		var keys []GuestID
		size := map[GuestID]int{}
		for _, gs := range ev.GuestScores {
			if !gs.Isolated {
				continue
			}
			c, _ := g.ClusterOf(gs.Guest)
			if size[c.Key] == 0 {
				keys = append(keys, c.Key)
			}
			size[c.Key]++
		}
		sortIDs(keys)
		var parts []string
		for _, key := range keys {
			parts = append(parts, fmt.Sprintf("key %d size %d", key, size[key]))
		}
		clusters := ""
		if len(parts) > 0 {
			clusters = " (clusters: " + strings.Join(parts, "; ") + ")"
		}
		return fmt.Sprintf("cap=%d k=%d isolated=%d%s score=%v", capacity, k, ev.Summary.Isolated, clusters, ev.Summary.Score)
	}
	for _, capacity := range []int{9, 10, 11, 12} {
		p := Propose(g, Plan{Capacity: capacity})
		k := len(p.Tables)
		out = append(out, describe(capacity, k, p))
		it := newItems(g, capacity)
		if k == 0 || (k+1)*Floor > it.total {
			continue
		}
		if l, _ := feasibleAt(it, k+1, nil); l != nil {
			out = append(out, describe(capacity, k+1, l.toPlan()))
		} else {
			out = append(out, fmt.Sprintf("cap=%d k=%d infeasible", capacity, k+1))
		}
	}
	return out
}

func sortIDs(ids []GuestID) {
	for i := 1; i < len(ids); i++ {
		for j := i; j > 0 && ids[j-1] > ids[j]; j-- {
			ids[j-1], ids[j] = ids[j], ids[j-1]
		}
	}
}

// TestDiagnoseIsolation is the Phase C report. Skipped unless STOLIKI_DIAG_INPUT
// names a JSON file {"guests":[{"id":1,"enabled":true}],"links":[{"a":1,"b":2,"level":1}]}
// (ids and flags only, no names). It never touches the database.
func TestDiagnoseIsolation(t *testing.T) {
	path := os.Getenv("STOLIKI_DIAG_INPUT")
	if path == "" {
		t.Skip("set STOLIKI_DIAG_INPUT to a JSON file of guest ids, enabled flags and links")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var in struct {
		Guests []struct {
			ID      GuestID `json:"id"`
			Enabled bool    `json:"enabled"`
		} `json:"guests"`
		Links []struct {
			A     GuestID   `json:"a"`
			B     GuestID   `json:"b"`
			Level LinkLevel `json:"level"`
		} `json:"links"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		t.Fatal(err)
	}
	var guests []Guest
	for _, x := range in.Guests {
		guests = append(guests, Guest{ID: x.ID, Enabled: x.Enabled})
	}
	var ls []Link
	for _, x := range in.Links {
		ls = append(ls, Link{A: x.A, B: x.B, Level: x.Level})
	}
	for _, line := range diagnoseLines(BuildGraph(guests, ls)) {
		t.Log(line)
	}
}

// The report logic itself is checked on the synthetic example C of the design:
// two tables isolate M and P (8 guests), three tables of 8 remove it.
func TestDiagnoseLinesExampleC(t *testing.T) {
	lines := diagnoseLines(exampleC())
	var got []string
	for _, l := range lines {
		if strings.HasPrefix(l, "cap=12 ") {
			got = append(got, l)
		}
	}
	if len(got) != 2 {
		t.Fatalf("cap 12 lines: %v", got)
	}
	if !strings.HasPrefix(got[0], "cap=12 k=2 isolated=8 (clusters: key 1 size 3; key 4 size 5)") {
		t.Errorf("k line: %s", got[0])
	}
	if !strings.HasPrefix(got[1], "cap=12 k=3 isolated=0 score=") {
		t.Errorf("k+1 line: %s", got[1])
	}
}
