package seating

import (
	"math/rand"
	"reflect"
	"testing"
)

// ---- deltas vs recomputed objective ---------------------------------------

func objDiff(after, before objective) delta {
	return delta{iso: after.iso - before.iso, str: after.str - before.str, score: after.score - before.score}
}

// checkMoveDelta asserts moveDelta(a, tb) == objective(after) - objective(before)
// and leaves the layout where it was.
func checkMoveDelta(t *testing.T, l *layout, a, tb int) delta {
	t.Helper()
	ta := l.assign[a]
	before := l.objective()
	got := l.moveDelta(a, tb)
	l.move(a, tb)
	want := objDiff(l.objective(), before)
	l.move(a, ta)
	if got != want {
		t.Fatalf("moveDelta(%d: %d->%d) = %+v, recomputed %+v", a, ta, tb, got, want)
	}
	return got
}

func checkSwapDelta(t *testing.T, l *layout, a, b int) delta {
	t.Helper()
	ta, tb := l.assign[a], l.assign[b]
	before := l.objective()
	got := l.swapDelta(a, b)
	l.move(a, tb)
	l.move(b, ta)
	want := objDiff(l.objective(), before)
	l.move(a, ta)
	l.move(b, tb)
	if got != want {
		t.Fatalf("swapDelta(%d@%d, %d@%d) = %+v, recomputed %+v", a, ta, b, tb, got, want)
	}
	return got
}

// isoLayout builds a layout from a graph and a table index per cluster key.
func isoLayout(g Graph, capacity, k int, tableOfKey map[GuestID]int) *layout {
	it := newItems(g, capacity, false)
	l := newLayout(it, k)
	for key, tb := range tableOfKey {
		l.place(it.idx[key], tb)
	}
	return l
}

func TestIsolationDeltasHandBuilt(t *testing.T) {
	// ids are single-guest clusters unless chained. Partner links are group 1.
	t.Run("D1 isolated item moves to its partner's table", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 5), links(chain(1, 2, 3), []Link{lk(1, 4, Preferred)}))
		l := isoLayout(g, 12, 2, map[GuestID]int{1: 0, 4: 1, 5: 0})
		it := l.it
		a := it.idx[1]
		if o := l.objective(); o.iso != 3+1 {
			t.Fatalf("setup: objective %+v, want 4 isolated seats (cluster of 3 and the single partner)", o)
		}
		d := checkMoveDelta(t, l, a, 1)
		if d.iso != -4 || d.score != 4+2*3 { // 4 isolated fewer, pair gain 2*3*1=6
			t.Errorf("delta = %+v", d)
		}
	})
	t.Run("D2 partner leaves, the only partner of c at the table", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 4), []Link{lk(1, 2, Preferred)})
		l := isoLayout(g, 12, 2, map[GuestID]int{1: 0, 2: 0, 3: 1})
		d := checkMoveDelta(t, l, l.it.idx[1], 1)
		if d.iso != 2 { // 1 and 2 isolated afterwards (1 moves away, 2 left alone)
			t.Errorf("delta = %+v, want 2 new isolated seats", d)
		}
	})
	t.Run("D3 partner arrives at an isolated c", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 5), links(chain(1, 2, 3), []Link{lk(1, 4, Preferred)}))
		l := isoLayout(g, 12, 2, map[GuestID]int{1: 0, 4: 1, 5: 1})
		d := checkMoveDelta(t, l, l.it.idx[4], 0)
		if d.iso != -4 {
			t.Errorf("delta = %+v, want -4 (cluster of 3 and the single both stop being isolated)", d)
		}
	})
	t.Run("D4 c has two partners at ta, one leaves", func(t *testing.T) {
		// 1 partners with 2 and 3; all three at table 0; 3 leaves: 1 keeps 2.
		g := BuildGraph(enabledRange(1, 4), []Link{lk(1, 2, Preferred), lk(1, 3, Acceptable)})
		l := isoLayout(g, 12, 2, map[GuestID]int{1: 0, 2: 0, 3: 0, 4: 1})
		d := checkMoveDelta(t, l, l.it.idx[3], 1)
		if d.iso != 1 { // 3 itself becomes isolated at table 1 (4 is a stranger); 1 stays fine
			t.Errorf("delta = %+v, want only item 3 newly isolated", d)
		}
	})
	t.Run("D5 swap: c at ta is a partner of b only, d at tb a partner of b only", func(t *testing.T) {
		// 1 (table 0) and 3 (table 1) are strangers to each other; b = 2 is partner of c = 3? no:
		// partners: 2-4 (c=4 at table 0), 2-5 (d=5 at table 1). a = 1 is a stranger with no partners.
		g := BuildGraph(enabledRange(1, 5), []Link{lk(2, 4, Preferred), lk(2, 5, Preferred)})
		l := isoLayout(g, 12, 2, map[GuestID]int{1: 0, 4: 0, 2: 1, 5: 1, 3: 1})
		checkSwapDelta(t, l, l.it.idx[1], l.it.idx[2])
	})
	t.Run("D6 swap of mutual partners at different tables", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 4), []Link{lk(1, 2, Preferred)})
		l := isoLayout(g, 12, 2, map[GuestID]int{1: 0, 3: 0, 2: 1, 4: 1})
		d := checkSwapDelta(t, l, l.it.idx[1], l.it.idx[2])
		if d.iso != 0 || d.score != 0 {
			t.Errorf("delta = %+v, want none (both stay apart)", d)
		}
	})
	t.Run("D7 c is a partner of both swapped items", func(t *testing.T) {
		// c = 3 at table 0 with a = 1; b = 2 at table 1. c partners with both 1 and 2.
		g := BuildGraph(enabledRange(1, 4), []Link{lk(3, 1, Preferred), lk(3, 2, Preferred)})
		l := isoLayout(g, 12, 2, map[GuestID]int{1: 0, 3: 0, 2: 1, 4: 1})
		checkSwapDelta(t, l, l.it.idx[1], l.it.idx[2])
		checkSwapDelta(t, l, l.it.idx[2], l.it.idx[1])
	})
	t.Run("D8 item without partners and without neighbours", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 4), []Link{lk(1, 2, Preferred)})
		l := isoLayout(g, 12, 2, map[GuestID]int{1: 0, 2: 0, 3: 0, 4: 1})
		// iso and score do not change; since task 015 the stranger pairs do (3 meets 1 and 2 at
		// table 0, only 4 at table 1: 2 -> 1)
		if d := checkMoveDelta(t, l, l.it.idx[3], 1); d != (delta{str: -1}) {
			t.Errorf("delta = %+v, want only str -1", d)
		}
	})
	t.Run("D9 item whose only partner is oversized is isolated everywhere", func(t *testing.T) {
		// cluster {2..14} has 13 guests > capacity 12 and is not an item.
		g := BuildGraph(enabledRange(1, 16), links(chain(2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14), []Link{lk(1, 2, Preferred)}))
		l := isoLayout(g, 12, 2, map[GuestID]int{1: 0, 15: 0, 16: 1})
		if !l.it.hasPartner[l.it.idx[1]] {
			t.Fatal("setup: guest 1 should have a partner")
		}
		if o := l.objective(); o.iso != 1 {
			t.Fatalf("objective %+v, want 1 isolated seat", o)
		}
		if d := checkMoveDelta(t, l, l.it.idx[1], 1); d != (delta{}) {
			t.Errorf("delta = %+v, want zero", d)
		}
	})
}

// TestObjectiveDeltasMatchRecompute is the oracle for the delta rules: on random
// instances and arbitrary (hard rules ignored) layouts, every move and swap delta
// equals the recomputed objective difference, and the objective agrees with Evaluate.
func TestObjectiveDeltasMatchRecompute(t *testing.T) {
	isolatedSeen := 0
	for seed := int64(1); seed <= 45; seed++ {
		r := rand.New(rand.NewSource(seed))
		guests, ls := randomInstance(r)
		g := BuildGraph(guests, ls)
		capacity := []int{9, 10, 11, 12}[seed%4]
		it := newItems(g, capacity, false)
		k := minTables(it.total, capacity)
		if k < 2 {
			k = 2
		}
		l := pack(it, k, nil, seed%2 == 0)
		if !l.complete() {
			// place leftovers anywhere: deltas must hold for any layout
			for a := range l.assign {
				if l.assign[a] < 0 {
					l.place(a, r.Intn(k))
				}
			}
		}
		for step := 0; step < 2500; step++ {
			a := r.Intn(len(l.assign))
			if r.Intn(2) == 0 {
				tb := r.Intn(k)
				if tb == l.assign[a] {
					continue
				}
				checkMoveDelta(t, l, a, tb)
				l.move(a, tb)
			} else {
				b := r.Intn(len(l.assign))
				ta, tb := l.assign[a], l.assign[b]
				if ta == tb {
					continue
				}
				checkSwapDelta(t, l, a, b)
				l.move(a, tb)
				l.move(b, ta)
			}
			if step%500 == 0 {
				o := l.objective()
				isolatedSeen += o.iso
				ev := Evaluate(g, l.toPlan())
				if ev.Summary.Score != float64(o.score) || ev.Summary.Isolated != o.iso || ev.Summary.StrangerPairs != o.str {
					t.Fatalf("seed %d: Evaluate score/isolated/strangers %v/%d/%d, objective %+v", seed, ev.Summary.Score, ev.Summary.Isolated, ev.Summary.StrangerPairs, o)
				}
			}
		}
	}
	if isolatedSeen == 0 {
		t.Error("no isolated seats were ever seen; the property test would not notice wrong isolation deltas")
	}
}

// ---- Evaluate --------------------------------------------------------------

func TestEvaluateIsolation(t *testing.T) {
	type want struct {
		sat      float64
		isolated bool
	}
	check := func(t *testing.T, ev Evaluation, w map[GuestID]want) {
		t.Helper()
		for id, x := range w {
			gs := guestScore(t, ev, id)
			if gs.Satisfaction != x.sat || gs.Isolated != x.isolated {
				t.Errorf("guest %d: satisfaction %v isolated %v, want %v / %v", id, gs.Satisfaction, gs.Isolated, x.sat, x.isolated)
			}
			if (gs.Satisfaction < 0) != gs.Isolated {
				t.Errorf("guest %d: satisfaction < 0 (%v) must hold iff isolated (%v)", id, gs.Satisfaction, gs.Isolated)
			}
		}
	}
	// cluster {1,2} -1- {3}; 4, 5 strangers.
	base := func(extra ...Guest) Graph {
		return BuildGraph(cat(enabledRange(1, 5), extra), links(chain(1, 2), []Link{lk(1, 3, Preferred)}))
	}

	t.Run("E1 partner elsewhere: whole cluster isolated", func(t *testing.T) {
		ev := Evaluate(base(), Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 4, 5), tbl(2, 3)}})
		// 3 is isolated too: its partner cluster {1,2} sits elsewhere.
		check(t, ev, map[GuestID]want{1: {-1, true}, 2: {-1, true}, 3: {-1, true}, 4: {0, false}, 5: {0, false}})
		if ev.Tables[0].Score != -2 || ev.Tables[1].Score != -1 || ev.Summary.Score != -3 {
			t.Errorf("scores %v %v total %v, want -2 -1 -3", ev.Tables[0].Score, ev.Tables[1].Score, ev.Summary.Score)
		}
		if ev.Summary.Isolated != 3 {
			t.Errorf("Summary.Isolated = %d, want 3", ev.Summary.Isolated)
		}
	})
	t.Run("E2 partner at the table", func(t *testing.T) {
		ev := Evaluate(base(), Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 3, 4, 5)}})
		check(t, ev, map[GuestID]want{1: {1, false}, 2: {1, false}, 3: {2, false}})
		if ev.Summary.Isolated != 0 {
			t.Errorf("Summary.Isolated = %d", ev.Summary.Isolated)
		}
	})
	t.Run("E3 only a group-2 partner at the table", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 4), []Link{lk(1, 2, Acceptable)})
		ev := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 3)}})
		check(t, ev, map[GuestID]want{1: {0.5, false}, 2: {0.5, false}, 3: {0, false}})
	})
	t.Run("E4 guest with no partners at all", func(t *testing.T) {
		ev := Evaluate(base(), Plan{Capacity: 12, Tables: []Table{tbl(1, 4, 5)}})
		check(t, ev, map[GuestID]want{4: {0, false}, 5: {0, false}})
	})
	t.Run("E5 only partner cluster fully disabled", func(t *testing.T) {
		g := BuildGraph(cat(on(1, 2, 4), off(3)), links(chain(1, 2), []Link{lk(1, 3, Preferred)}))
		ev := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 4)}})
		check(t, ev, map[GuestID]want{1: {0, false}, 2: {0, false}, 4: {0, false}})
	})
	t.Run("E6 partner enabled but unseated is still isolated", func(t *testing.T) {
		ev := Evaluate(base(), Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 4, 5)}})
		check(t, ev, map[GuestID]want{1: {-1, true}, 2: {-1, true}, 3: {0, false}})
		if ev.Summary.Isolated != 2 {
			t.Errorf("Summary.Isolated = %d, want 2 (the unseated guest is not counted)", ev.Summary.Isolated)
		}
	})
	t.Run("E7 unseated guest is never isolated and adds no violation", func(t *testing.T) {
		ev := Evaluate(base(), Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 3, 4)}})
		check(t, ev, map[GuestID]want{5: {0, false}})
		want := []ViolationCode{ViolUnseated}
		if got := codes(ev.Violations); !reflect.DeepEqual(got, want) {
			t.Errorf("violations %v, want %v", got, want)
		}
	})
	t.Run("E8 partner cluster split: one member at the table suffices", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 6), links(chain(3, 4), []Link{lk(1, 3, Preferred)}))
		ev := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 3, 5), tbl(2, 4, 6)}})
		check(t, ev, map[GuestID]want{1: {1, false}, 3: {1, false}})
	})
	t.Run("E9 isolation is not a violation", func(t *testing.T) {
		// the same plan on a graph without the partner link has the same violations
		plan := Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 4, 5), tbl(2, 3)}}
		iso := Evaluate(base(), plan)
		plain := Evaluate(BuildGraph(enabledRange(1, 5), chain(1, 2)), plan)
		if iso.Summary.Isolated != 3 || plain.Summary.Isolated != 0 {
			t.Fatalf("setup: isolated %d / %d", iso.Summary.Isolated, plain.Summary.Isolated)
		}
		if !reflect.DeepEqual(iso.Violations, plain.Violations) || iso.Summary.NeedsRecalculation != plain.Summary.NeedsRecalculation {
			t.Errorf("violations differ: %+v vs %+v", iso.Violations, plain.Violations)
		}
	})
}

// ---- Propose fixtures (design 03-seating-model § Isolation, examples A, B, C) ----

// clustersOfSizes returns guests 1..N and the group-0 links of consecutive
// clusters of the given sizes; the first id of cluster i is returned in firsts.
func clustersOfSizes(sizes ...int) (guests []Guest, ls []Link, firsts []GuestID) {
	next := GuestID(1)
	for _, s := range sizes {
		firsts = append(firsts, next)
		ids := rng(next, next+GuestID(s)-1)
		guests = append(guests, on(ids...)...)
		ls = append(ls, chain(ids...)...)
		next += GuestID(s)
	}
	return guests, ls, firsts
}

// exampleA: M[4] -1- P[2] -1- Q[6] -1- R[2]; strangers S1[4], S2[4], S3[2]; 24 guests.
func exampleA() (Graph, []GuestID) {
	guests, ls, f := clustersOfSizes(4, 2, 6, 2, 4, 4, 2)
	ls = append(ls, lk(f[0], f[1], Preferred), lk(f[1], f[2], Preferred), lk(f[2], f[3], Preferred))
	return BuildGraph(guests, ls), f
}

func TestProposeMichalCaseAvoidsIsolation(t *testing.T) {
	g, f := exampleA()
	p := Propose(g, emptyPlan(12))
	ev := assertHardRules(t, g, p)
	if len(p.Tables) != 2 || !reflect.DeepEqual(sortedDesc(fills(ev)), []int{12, 12}) {
		t.Fatalf("fills %v, want two tables of 12", fills(ev))
	}
	if ev.Summary.Isolated != 0 || ev.Summary.Score != 40 {
		t.Errorf("isolated %d score %v, want 0 isolated and score 40 (the old objective returned 48 with M isolated)", ev.Summary.Isolated, ev.Summary.Score)
	}
	if !seatedAtSameTable(p, f[0], f[1]) {
		t.Error("M must sit with its only partner P")
	}
	for _, gs := range ev.GuestScores {
		if gs.Isolated || gs.Satisfaction < 0 {
			t.Errorf("guest %d is isolated: %+v", gs.Guest, gs)
		}
	}
}

func TestProposeUnavoidableIsolation(t *testing.T) {
	// B: M[4] -1- X[10]: 14 > 12, never together; strangers [2], [4], [4].
	guests, ls, f := clustersOfSizes(4, 10, 2, 4, 4)
	ls = append(ls, lk(f[0], f[1], Preferred))
	g := BuildGraph(guests, ls)
	p := Propose(g, emptyPlan(12))
	ev := assertHardRules(t, g, p)
	if len(p.Tables) != 2 {
		t.Fatalf("%d tables, want 2", len(p.Tables))
	}
	if ev.Summary.Isolated != 14 || ev.Summary.NeedsRecalculation {
		t.Errorf("isolated %d, needsRecalculation %v; want 14 and false", ev.Summary.Isolated, ev.Summary.NeedsRecalculation)
	}
	for _, id := range append(rng(1, 4), rng(5, 14)...) {
		if gs := guestScore(t, ev, id); !gs.Isolated || gs.Satisfaction != -IsolationPenalty {
			t.Errorf("guest %d: %+v, want isolated", id, gs)
		}
	}
}

// exampleC: M[3] -1- P[5]; strangers [6], [2], [5], [3]; 24 guests.
func exampleC() Graph {
	guests, ls, f := clustersOfSizes(3, 5, 6, 2, 5, 3)
	ls = append(ls, lk(f[0], f[1], Preferred))
	return BuildGraph(guests, ls)
}

func TestProposeFewestTablesBeatsIsolation(t *testing.T) {
	g := exampleC()
	p := Propose(g, emptyPlan(12))
	ev := assertHardRules(t, g, p)
	if len(p.Tables) != 2 || ev.Summary.Isolated != 8 {
		t.Errorf("%d tables, %d isolated; want 2 tables and 8 isolated (M and P cannot share 4 free seats)", len(p.Tables), ev.Summary.Isolated)
	}
	// the diagnostic primitive: three tables of exactly 8 remove the isolation
	it := newItems(g, 12, false)
	l, _ := feasibleAt(it, 3, nil)
	if l == nil {
		t.Fatal("k+1 = 3 must be feasible")
	}
	ev3 := assertHardRules(t, g, l.toPlan())
	if len(ev3.Tables) != 3 || ev3.Summary.Isolated != 0 {
		t.Errorf("k=3: %d tables, %d isolated; want 3 and 0", len(ev3.Tables), ev3.Summary.Isolated)
	}
	// feasibleAt at the minimal k agrees with Propose
	l2, _ := feasibleAt(it, 2, nil)
	if l2 == nil || !reflect.DeepEqual(l2.toPlan(), p) {
		t.Error("feasibleAt(k) differs from Propose at the same k")
	}
}

func TestProposePinsBeatIsolation(t *testing.T) {
	g, f := exampleA()
	cur := Plan{Capacity: 12, Tables: []Table{
		pinnedTbl(1, rng(f[0], f[0]+3), rng(f[0], f[0]+3)...), // M pinned to table 1
		pinnedTbl(2, rng(f[1], f[1]+1), rng(f[1], f[1]+1)...), // P pinned to table 2
	}}
	p := Propose(g, cur)
	ev := assertHardRules(t, g, p)
	if tableOfGuest(p, f[0]) != 1 || tableOfGuest(p, f[1]) != 2 {
		t.Fatalf("pins moved: M at %d, P at %d", tableOfGuest(p, f[0]), tableOfGuest(p, f[1]))
	}
	for _, id := range rng(f[0], f[0]+3) {
		if !guestScore(t, ev, id).Isolated {
			t.Errorf("M's guest %d should be isolated: its only partner is pinned elsewhere", id)
		}
	}
}

func TestProposeIsolationDeterministic(t *testing.T) {
	gA, _ := exampleA()
	for name, g := range map[string]Graph{"A": gA, "C": exampleC(), "fixture": annealFixture()} {
		for _, capacity := range []int{9, 10, 11, 12} {
			first := Propose(g, emptyPlan(capacity))
			if again := Propose(g, emptyPlan(capacity)); !reflect.DeepEqual(first, again) {
				t.Errorf("%s capacity %d: two calls differ", name, capacity)
			}
		}
	}
}

// TestProposeIsLocallyOptimalForIsolation: the result of Propose has no single
// feasible move or swap that improves (isolated, score) - in particular none
// that lowers the isolated count (improve scans every move and swap).
func TestProposeIsLocallyOptimalForIsolation(t *testing.T) {
	checked := 0
	for seed := int64(1); seed <= 12; seed++ {
		guests, ls := randomInstance(rand.New(rand.NewSource(seed)))
		g := BuildGraph(guests, ls)
		for _, capacity := range []int{9, 10, 11, 12} {
			it := newItems(g, capacity, false)
			var l *layout
			for k := minTables(it.total, capacity); l == nil && k*Floor <= it.total; k++ {
				l, _ = feasibleAt(it, k, nil)
			}
			if l == nil || l.k < 2 {
				continue
			}
			checked++
			m := len(l.assign)
			for a := 0; a < m; a++ {
				for tb := 0; tb < l.k; tb++ {
					ta := l.assign[a]
					if tb == ta || l.fill[tb]+it.size[a] > capacity || l.fill[ta]-it.size[a] < Floor {
						continue
					}
					if d := l.moveDelta(a, tb); d.improves() {
						t.Fatalf("seed %d cap %d: move %d->%d improves by %+v", seed, capacity, a, tb, d)
					}
				}
				for b := a + 1; b < m; b++ {
					ta, tb := l.assign[a], l.assign[b]
					if ta == tb {
						continue
					}
					na, nb := l.fill[ta]-it.size[a]+it.size[b], l.fill[tb]-it.size[b]+it.size[a]
					if na > capacity || nb > capacity || na < Floor || nb < Floor {
						continue
					}
					if d := l.swapDelta(a, b); d.improves() {
						t.Fatalf("seed %d cap %d: swap %d,%d improves by %+v", seed, capacity, a, b, d)
					}
				}
			}
		}
	}
	if checked < 20 {
		t.Errorf("only %d layouts checked", checked)
	}
}
