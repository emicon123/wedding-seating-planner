package seating

import (
	"math/rand"
	"reflect"
	"testing"
)

// Tests of the mixed plan (task 013, rewritten in task 015: floor 9, free table count, bilans;
// design 003-backend-design §12.6, X1-X13; 03-seating-model examples L-O). The task-013 tests
// M1-M8 (the k0 / k0+1 isolation-only rule) are replaced by X1-X9; M9/M10 live on as X7/X12.

func mixedPlan() Plan { return Plan{Capacity: 12, Mixed: true} }

// instance builds a graph from cluster sizes (consecutive ids) and links between cluster indexes.
type clusterLink struct {
	a, b  int
	level LinkLevel
}

func instance(sizes []int, cl ...clusterLink) (Graph, []GuestID) {
	guests, ls, f := clustersOfSizes(sizes...)
	for _, c := range cl {
		ls = append(ls, lk(f[c.a], f[c.b], c.level))
	}
	return BuildGraph(guests, ls), f
}

func tableCounts(p Plan) int { return len(p.Tables) }

// bilansOf is the mixed plan's objective of an evaluation: score - 2*λ*stranger pairs.
func bilansOf(ev Evaluation) int {
	return int(ev.Summary.Score) - 2*StrangerPenalty*ev.Summary.StrangerPairs
}

// cliqueGroups: clusters of `size` seats, `groups[i]` of them in group i, all pairs inside a
// group linked at level 1, no link between groups.
func cliqueGroups(size int, groups ...int) Graph {
	var sizes []int
	var gi []int
	for i, n := range groups {
		for j := 0; j < n; j++ {
			sizes = append(sizes, size)
			gi = append(gi, i)
		}
	}
	var cl []clusterLink
	for a := range sizes {
		for b := a + 1; b < len(sizes); b++ {
			if gi[a] == gi[b] {
				cl = append(cl, clusterLink{a, b, Preferred})
			}
		}
	}
	g, _ := instance(sizes, cl...)
	return g
}

func TestMixedX1ExampleLExtraTableRemovesStrangers(t *testing.T) {
	g := cliqueGroups(3, 6, 6) // two acquainted groups of 18, N = 36, k in [3, 4]
	p := Propose(g, mixedPlan())
	ev := assertHardRules(t, g, p)
	if tableCounts(p) != 4 || !reflect.DeepEqual(fills(ev), []int{9, 9, 9, 9}) {
		t.Fatalf("fills %v, want four tables of 9", fills(ev))
	}
	if got := triple(ev); got != (objective{iso: 0, str: 0, score: 216}) || bilansOf(ev) != 216 {
		t.Errorf("(iso, strangers, score) = %+v, bilans %d; want (0, 0, 216) and 216", got, bilansOf(ev))
	}
	p12 := Propose(g, emptyPlan(12))
	if e12 := Evaluate(g, p12); tableCounts(p12) != 3 || e12.Summary.StrangerPairs != 36 {
		t.Errorf("plan 12: %d tables, %d stranger pairs; want 3 and 36", tableCounts(p12), e12.Summary.StrangerPairs)
	}
}

func TestMixedX2PenaltyChoosesTheExtraTable(t *testing.T) {
	g := cliqueGroups(3, 6, 6)
	it := newItems(g, 12, true)
	l3, _ := feasibleAt(it, 3, nil)
	l4, _ := feasibleAt(it, 4, nil)
	if l3 == nil || l4 == nil {
		t.Fatal("both table counts must be feasible")
	}
	o3, o4 := l3.objective(), l4.objective()
	if o3.score != 252 || o4.score != 216 {
		t.Fatalf("scores %d (k=3) and %d (k=4), want 252 and 216 (example L)", o3.score, o4.score)
	}
	// at λ = 0 the higher score would win (k = 3); with λ = 1 the strangers it carries decide
	if o3.net() != 252-2*36 || o4.net() != 216 || o3.net() >= o4.net() {
		t.Errorf("bilans %d (k=3) vs %d (k=4), want 180 < 216", o3.net(), o4.net())
	}
}

func TestMixedX3ExampleMUsersShape(t *testing.T) {
	// groups of 9 (3 x 3), 12 (4 x 3) and 10 (2 x 5), no links between groups; N = 31, k = 3 only
	sizes := []int{3, 3, 3, 3, 3, 3, 3, 5, 5}
	var cl []clusterLink
	for _, grp := range [][]int{{0, 1, 2}, {3, 4, 5, 6}, {7, 8}} {
		for i, a := range grp {
			for _, b := range grp[i+1:] {
				cl = append(cl, clusterLink{a, b, Preferred})
			}
		}
	}
	g, _ := instance(sizes, cl...)
	p := Propose(g, mixedPlan())
	ev := assertHardRules(t, g, p)
	if !reflect.DeepEqual(sortedDesc(fills(ev)), []int{12, 10, 9}) || ev.Summary.StrangerPairs != 0 || ev.Summary.Isolated != 0 {
		t.Errorf("fills %v, %d stranger pairs, %d isolated; want 12 + 10 + 9, 0, 0", fills(ev), ev.Summary.StrangerPairs, ev.Summary.Isolated)
	}
}

func TestMixedX4TieKeepsTheSmallerK(t *testing.T) {
	// 36 children-only singletons: bilans 0 at k = 3 and k = 4
	g := BuildGraph(kids(enabledRange(1, 36), rng(1, 36)...), nil)
	p := Propose(g, mixedPlan())
	assertHardRules(t, g, p)
	if tableCounts(p) != 3 {
		t.Errorf("%d tables, want the smaller k = 3", tableCounts(p))
	}
}

func TestMixedX5SingleTable(t *testing.T) {
	g := BuildGraph(enabledRange(1, 8), nil)
	p := Propose(g, mixedPlan())
	ev := assertHardRules(t, g, p)
	if tableCounts(p) != 1 || fills(ev)[0] != 8 {
		t.Errorf("fills %v, want one table of 8 (floor waived)", fills(ev))
	}
}

func TestMixedX6NoFeasibleK(t *testing.T) {
	for _, n := range []GuestID{13, 14, 17, 25, 26} {
		g := BuildGraph(enabledRange(1, n), nil)
		p := Propose(g, mixedPlan())
		if !p.Mixed || p.Capacity != 12 {
			t.Fatalf("N = %d: Capacity %d Mixed %v", n, p.Capacity, p.Mixed)
		}
		assertWellFormed(t, g, p)
		if ev := Evaluate(g, p); !ev.Summary.NeedsRecalculation || !slicesContains(codes(ev.Violations), ViolUnderFloor) {
			t.Errorf("N = %d: want an under_floor violation, got %v (fills %v)", n, codes(ev.Violations), fills(ev))
		}
	}
	// N = 27 is the first feasible head count after the gap
	g := BuildGraph(enabledRange(1, 27), nil)
	assertHardRules(t, g, Propose(g, mixedPlan()))
}

func TestMixedX7EveryTableHasNineToTwelve(t *testing.T) {
	gB, _ := instance([]int{4, 10, 4, 4, 4, 4, 4, 2}, clusterLink{0, 1, Preferred})
	for name, g := range map[string]Graph{"L": cliqueGroups(3, 6, 6), "B36": gB, "C": exampleC(), "I": exampleI(), "fixture": annealFixture()} {
		p := Propose(g, mixedPlan())
		if !p.Mixed || p.Capacity != 12 {
			t.Errorf("%s: Capacity %d Mixed %v", name, p.Capacity, p.Mixed)
		}
		ev := assertHardRules(t, g, p)
		if tableCounts(p) > 1 {
			for _, f := range fills(ev) {
				if f < MixedFloor || f > 12 {
					t.Errorf("%s: fills %v outside [%d, 12]", name, fills(ev), MixedFloor)
				}
			}
		}
	}
}

func TestMixedX8Pins(t *testing.T) {
	g := cliqueGroups(3, 12) // one acquainted group of 36: three tables of 12 are best unpinned
	if p := Propose(g, mixedPlan()); tableCounts(p) != 3 {
		t.Fatalf("precondition: unpinned best is 3 tables, got %d", tableCounts(p))
	}
	pin := rng(1, 3)
	t.Run("a pin to table 4 raises the lower bound of k", func(t *testing.T) {
		cur := Plan{Capacity: 12, Mixed: true, Tables: []Table{{Number: 1}, {Number: 2}, {Number: 3}, pinnedTbl(4, pin, pin...)}}
		p := Propose(g, cur)
		assertHardRules(t, g, p)
		if tableCounts(p) != 4 || tableOfGuest(p, 1) != 4 {
			t.Errorf("%d tables, pinned cluster at table %d; want 4 and 4", tableCounts(p), tableOfGuest(p, 1))
		}
		for _, tb := range p.Tables {
			for _, s := range tb.Seats {
				if s.Pinned != (tb.Number == 4 && s.Guest <= 3) {
					t.Errorf("guest %d at table %d: pinned = %v", s.Guest, tb.Number, s.Pinned)
				}
			}
		}
	})
	t.Run("a pin above floor(N/9) is released", func(t *testing.T) {
		cur := Plan{Capacity: 12, Mixed: true, Tables: []Table{{Number: 1}, {Number: 2}, {Number: 3}, {Number: 4}, pinnedTbl(5, pin, pin...)}}
		p := Propose(g, cur) // N = 36: k in [3, 4]; table 5 cannot exist
		assertHardRules(t, g, p)
		if tableCounts(p) != 3 {
			t.Errorf("%d tables, want 3 (the pin is released)", tableCounts(p))
		}
		for _, tb := range p.Tables {
			for _, s := range tb.Seats {
				if s.Pinned {
					t.Errorf("guest %d is still pinned at table %d", s.Guest, tb.Number)
				}
			}
		}
	})
	t.Run("a pin within the best k is kept", func(t *testing.T) {
		cur := Plan{Capacity: 12, Mixed: true, Tables: []Table{{Number: 1}, pinnedTbl(2, pin, pin...), {Number: 3}}}
		p := Propose(g, cur)
		assertHardRules(t, g, p)
		if tableCounts(p) != 3 || tableOfGuest(p, 1) != 2 {
			t.Errorf("%d tables, pinned cluster at table %d; want 3 and 2", tableCounts(p), tableOfGuest(p, 1))
		}
	})
}

// X9: Propose maximises the bilans over all k and layouts, ties to the smaller k, checked
// against full enumeration on small random instances (with children).
func TestMixedX9MatchesBruteForce(t *testing.T) {
	checked, multiK := 0, 0
	for seed := int64(1); seed <= 40; seed++ {
		r := rand.New(rand.NewSource(seed))
		guests, ls := bruteInstance(r, 36, 48, 3, 7)
		g := BuildGraph(guests, ls)
		it := newItems(g, 12, true)
		lo, hi := minTables(it.total, 12), it.total/MixedFloor
		bestK, bestNet, found := 0, 0, false
		for k := lo; k <= hi; k++ {
			if o, ok := bruteBest(it, k); ok && (!found || o.net() > bestNet) {
				bestK, bestNet, found = k, o.net(), true
			}
		}
		if !found {
			continue
		}
		checked++
		if hi > lo {
			multiK++
		}
		p := Propose(g, mixedPlan())
		ev := assertHardRules(t, g, p)
		if got := bilansOf(ev); got != bestNet || tableCounts(p) != bestK {
			t.Errorf("seed %d (N=%d, k in [%d, %d]): Propose bilans %d with %d tables, brute force %d with %d tables",
				seed, it.total, lo, hi, got, tableCounts(p), bestNet, bestK)
		}
	}
	if checked < 12 || multiK < 6 {
		t.Errorf("%d instances checked, %d with more than one k", checked, multiK)
	}
}

func TestMixedX10EvaluateFloorNine(t *testing.T) {
	g := BuildGraph(enabledRange(1, 20), nil)
	stored := Plan{Capacity: 12, Mixed: true, Tables: []Table{tbl(1, rng(1, 8)...), tbl(2, rng(9, 20)...)}}
	ev := Evaluate(g, stored)
	if !ev.Summary.NeedsRecalculation || !reflect.DeepEqual(codes(ev.Violations), []ViolationCode{ViolUnderFloor}) || ev.Violations[0].Table != 1 {
		t.Errorf("mixed table of 8: violations %+v, want one under_floor at table 1", ev.Violations)
	}
	uniform := stored
	uniform.Mixed = false
	if ev := Evaluate(g, uniform); len(ev.Violations) != 0 {
		t.Errorf("the same fills in plan 12 (floor 8): violations %+v, want none", ev.Violations)
	}
	nine := Plan{Capacity: 12, Mixed: true, Tables: []Table{tbl(1, rng(1, 9)...), tbl(2, rng(10, 20)...)}}
	if ev := Evaluate(g, nine); len(ev.Violations) != 0 {
		t.Errorf("a mixed table of 9: violations %+v, want none", ev.Violations)
	}
}

// X11: the net objective of a mixed layout equals what Evaluate says, and its deltas add up.
func TestMixedX11NetMatchesEvaluate(t *testing.T) {
	for seed := int64(1); seed <= 20; seed++ {
		r := rand.New(rand.NewSource(seed))
		guests, ls := childInstance(r)
		g := BuildGraph(guests, ls)
		it := newItems(g, 12, true)
		k := max(2, minTables(it.total, 12))
		l := pack(it, k, nil, seed%2 == 0)
		for a := range l.assign {
			if l.assign[a] < 0 {
				l.place(a, r.Intn(k))
			}
		}
		for step := 0; step < 600; step++ {
			a, b := r.Intn(len(l.assign)), r.Intn(len(l.assign))
			if ta, tb := l.assign[a], l.assign[b]; ta != tb {
				d := l.swapDelta(a, b)
				before := l.objective().net()
				l.move(a, tb)
				l.move(b, ta)
				if got := l.objective().net() - before; got != d.net() {
					t.Fatalf("seed %d: swap net delta %d, recomputed %d", seed, d.net(), got)
				}
			}
			if step%150 == 0 {
				ev := Evaluate(g, l.toPlan())
				if bilansOf(ev) != l.objective().net() {
					t.Fatalf("seed %d: Evaluate bilans %d, objective net %d", seed, bilansOf(ev), l.objective().net())
				}
			}
		}
	}
}

func TestMixedX12Deterministic(t *testing.T) {
	gB, _ := instance([]int{4, 10, 4, 4, 4, 4, 4, 2}, clusterLink{0, 1, Preferred})
	for name, g := range map[string]Graph{"L": cliqueGroups(3, 6, 6), "B36": gB, "C": exampleC(), "I": exampleI(), "13": BuildGraph(enabledRange(1, 13), nil)} {
		first := Propose(g, mixedPlan())
		if again := Propose(g, mixedPlan()); !reflect.DeepEqual(first, again) {
			t.Errorf("%s: two calls differ", name)
		}
	}
}

func TestMixedX13UniformPlansKeepTheFloorOfEight(t *testing.T) {
	if FloorOf(Plan{Capacity: 12}) != Floor || Floor != 8 || FloorOf(mixedPlan()) != MixedFloor || MixedFloor != 9 {
		t.Errorf("FloorOf: uniform %d, mixed %d", FloorOf(Plan{Capacity: 12}), FloorOf(mixedPlan()))
	}
	for _, c := range []int{9, 10, 11, 12} {
		if it := newItems(BuildGraph(enabledRange(1, 20), nil), c, false); it.floor != 8 || it.order != lexOrder {
			t.Errorf("capacity %d: floor %d order %v", c, it.floor, it.order)
		}
	}
	if it := newItems(BuildGraph(enabledRange(1, 20), nil), 12, true); it.floor != 9 || it.order != netOrder {
		t.Errorf("mixed: floor %d order %v", it.floor, it.order)
	}
}

func TestMixedKeepsTheFlag(t *testing.T) {
	t.Run("no guests", func(t *testing.T) {
		if p := Propose(BuildGraph(nil, nil), mixedPlan()); !p.Mixed || p.Capacity != 12 || len(p.Tables) != 0 {
			t.Errorf("got %+v", p)
		}
	})
	t.Run("ExpandDisabled", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 3), nil)
		if p := ExpandDisabled(g, Plan{Capacity: 12, Mixed: true, Tables: []Table{tbl(1, 1, 2, 3)}}); !p.Mixed {
			t.Error("ExpandDisabled dropped Mixed")
		}
	})
	t.Run("Evaluate scores the mixed plan like plan 12", func(t *testing.T) {
		g, _ := exampleA()
		p := Propose(g, emptyPlan(12))
		pm := p
		pm.Mixed = true
		if !reflect.DeepEqual(Evaluate(g, p), Evaluate(g, pm)) {
			t.Error("Evaluate depends on Mixed beyond the floor")
		}
	})
}
