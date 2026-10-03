package seating

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

// TestTuneAnnealBudget measures the objective Propose's pipeline reaches per
// capacity as a function of the annealing budget on a real-shaped instance.
// Skipped unless STOLIKI_TUNE_INPUT names a JSON file (same format as
// STOLIKI_DIAG_INPUT: guest ids, enabled flags, links; never committed).
// STOLIKI_TUNE_GRID="restarts:iters,restarts:iters,..." selects the budgets,
// STOLIKI_TUNE_SEEDS the number of seed offsets (default 5).
func TestTuneAnnealBudget(t *testing.T) {
	path := os.Getenv("STOLIKI_TUNE_INPUT")
	if path == "" {
		t.Skip("set STOLIKI_TUNE_INPUT to a JSON file of guest ids, enabled flags and links")
	}
	g := loadIDsGraph(t, path)
	seeds := 5
	if v, err := strconv.Atoi(os.Getenv("STOLIKI_TUNE_SEEDS")); err == nil {
		seeds = v
	}
	grid := os.Getenv("STOLIKI_TUNE_GRID")
	if grid == "" {
		grid = "4:400000,8:400000,16:400000,8:1000000,16:1000000,32:1000000,8:2000000,16:2000000"
	}
	for _, spec := range strings.Split(grid, ",") {
		var restarts, iters int
		fmt.Sscanf(spec, "%d:%d", &restarts, &iters)
		for _, capacity := range tuneCaps() {
			it := newItems(g, capacity, false)
			var found []objective
			var elapsed time.Duration
			kk := 0
			for s := 0; s < seeds; s++ {
				l := startLayout(it)
				kk = l.k
				if s == 0 {
					t.Logf("movable=%d", len(l.movable()))
				}
				start := time.Now()
				optimiseWith(l, restarts, iters, s*1000)
				elapsed += time.Since(start)
				found = append(found, l.objective())
			}
			t.Logf("restarts=%d iters=%d cap=%d k=%d avg=%v objectives=%v", restarts, iters, capacity, kk, elapsed/time.Duration(seeds), found)
		}
	}
}

func tuneCaps() []int {
	if v, err := strconv.Atoi(os.Getenv("STOLIKI_TUNE_CAP")); err == nil {
		return []int{v}
	}
	return []int{9, 10, 11, 12}
}

// startLayout is the layout Propose hands to optimise at its smallest feasible k (no pins).
func startLayout(it items) *layout {
	for k := minTables(it.total, it.capacity); ; k++ {
		for _, aff := range [2]bool{true, false} {
			c := pack(it, k, nil, aff)
			if c.complete() && repairFloor(c) {
				return c
			}
		}
		if l := packExact(it, k, nil); l != nil {
			return l
		}
	}
}

// loadIDsGraph reads {"guests":[{"id","enabled"}],"links":[{"a","b","level"}]} (the
// STOLIKI_DIAG_INPUT format; ids and flags only) into a Graph.
func loadIDsGraph(tb testing.TB, path string) Graph {
	raw, err := os.ReadFile(path)
	if err != nil {
		tb.Fatal(err)
	}
	var in struct {
		Guests []struct {
			ID      GuestID `json:"id"`
			Enabled bool    `json:"enabled"`
			Child   bool    `json:"child"` // optional (task 014); default false
		} `json:"guests"`
		Links []struct {
			A     GuestID   `json:"a"`
			B     GuestID   `json:"b"`
			Level LinkLevel `json:"level"`
		} `json:"links"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		tb.Fatal(err)
	}
	var guests []Guest
	for _, x := range in.Guests {
		guests = append(guests, Guest{ID: x.ID, Enabled: x.Enabled, Child: x.Child})
	}
	var ls []Link
	for _, x := range in.Links {
		ls = append(ls, Link{A: x.A, B: x.B, Level: x.Level})
	}
	return BuildGraph(guests, ls)
}

// TestTuneStrangerWeight reports the objective Propose reaches on generated (instance, capacity)
// cases, for the current annealStrangerWeight (change the constant and re-run; task 015).
// Skipped unless STOLIKI_TUNE_STR is set. Totals: lower isolated, then lower stranger pairs, is
// better; `partition` cases have a stranger-free optimum (S-P2).
func TestTuneStrangerWeight(t *testing.T) {
	if os.Getenv("STOLIKI_TUNE_STR") == "" {
		t.Skip("set STOLIKI_TUNE_STR=1")
	}
	var tot objective
	partitionMiss, partitionTotal := 0, 0
	start := time.Now()
	for seed := int64(1); seed <= 30; seed++ {
		r := rand.New(rand.NewSource(seed))
		guests, ls := partitionInstance(r, 2+r.Intn(3))
		g := BuildGraph(guests, ls)
		o := triple(Evaluate(g, Propose(g, emptyPlan(12))))
		partitionTotal++
		if o.str != 0 || o.iso != 0 {
			partitionMiss++
		}
		tot.iso += o.iso
		tot.str += o.str
		tot.score += o.score
	}
	for seed := int64(1); seed <= 6; seed++ {
		r := rand.New(rand.NewSource(100 + seed))
		guests, ls := childInstance(r)
		g := BuildGraph(guests, ls)
		for _, capacity := range []int{10, 12} {
			o := triple(Evaluate(g, Propose(g, emptyPlan(capacity))))
			tot.iso += o.iso
			tot.str += o.str
			tot.score += o.score
		}
	}
	for _, g := range []Graph{annealFixture(), tightFixture(4), tightFixture(5)} {
		for _, capacity := range []int{9, 10, 11, 12} {
			o := triple(Evaluate(g, Propose(g, emptyPlan(capacity))))
			t.Logf("fixture cap %d: %+v", capacity, o)
			tot.iso += o.iso
			tot.str += o.str
			tot.score += o.score
		}
	}
	t.Logf("annealStrangerWeight=%v: isolated %d, stranger pairs %d, score %d; partition cases missing 0: %d/%d; %v",
		annealStrangerWeight, tot.iso, tot.str, tot.score, partitionMiss, partitionTotal, time.Since(start).Round(time.Second))
}

// TestTuneLongRun prints the objective of a long search (restarts x steps from the packed start)
// for the fixtures whose best known triple the tests pin. Skipped unless STOLIKI_TUNE_LONG is set.
func TestTuneLongRun(t *testing.T) {
	if os.Getenv("STOLIKI_TUNE_LONG") == "" {
		t.Skip("set STOLIKI_TUNE_LONG=1")
	}
	for name, g := range map[string]Graph{"annealFixture": annealFixture(), "tight4": tightFixture(4)} {
		it := newItems(g, 12, false)
		for rep := 0; rep < 3; rep++ {
			l := startLayout(it)
			optimiseWith(l, 96, 3_000_000, 1000*rep)
			t.Logf("%s cap 12 long run %d: %+v", name, rep, l.objective())
		}
	}
}
