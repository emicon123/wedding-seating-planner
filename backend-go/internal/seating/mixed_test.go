package seating

import (
	"reflect"
	"testing"
)

// Tests of the mixed plan (task 013, design 003-backend-design §9.7: M1-M10).

func mixedPlan() Plan { return Plan{Capacity: 12, Mixed: true} }

// asUniform is a mixed plan with the flag cleared, to compare it with plan 12.
func asUniform(p Plan) Plan {
	p.Mixed = false
	return p
}

// instance builds a graph from cluster sizes (consecutive ids) and "a-b:level" style links
// between cluster indexes.
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

// m5Graph: removing isolation needs a table more, at a slightly lower score
// (k0 = 3: 12 isolated guests, score 24; k0 + 1 = 4: 7 isolated, score 23).
func m5Graph() Graph {
	g, _ := instance([]int{5, 7, 6, 1, 6, 6, 3, 2},
		clusterLink{6, 2, Acceptable}, clusterLink{2, 4, Acceptable}, clusterLink{7, 4, Acceptable}, clusterLink{4, 1, Acceptable})
	return g
}

// m6Graph: the isolation (X[10] -1- M[4] and two pairs that cannot all be satisfied) is the same at
// k0 = 4 and k0 + 1 = 5, but the score at 5 tables is higher (iso 25 both; score 3 vs 35).
func m6Graph() Graph {
	g, _ := instance([]int{10, 4, 6, 3, 4, 5, 7, 1, 6},
		clusterLink{0, 1, Preferred}, clusterLink{5, 8, Preferred}, clusterLink{4, 6, Acceptable})
	return g
}

// structuralB36: X[10] -1- M[4] can never share a table (14 > 12); N = 36 so that k0 = 3 and 4
// tables of 8+ are possible.
func structuralB36() (Graph, []GuestID) {
	return instance([]int{4, 10, 4, 4, 4, 4, 4, 2}, clusterLink{0, 1, Preferred})
}

func tableCounts(p Plan) int { return len(p.Tables) }

func TestMixedM1ExampleCAddsATable(t *testing.T) {
	g := exampleC()
	p := Propose(g, mixedPlan())
	ev := assertHardRules(t, g, p)
	if tableCounts(p) != 3 || !reflect.DeepEqual(fills(ev), []int{8, 8, 8}) {
		t.Fatalf("fills %v, want three tables of 8", fills(ev))
	}
	if ev.Summary.Isolated != 0 {
		t.Errorf("isolated = %d, want 0", ev.Summary.Isolated)
	}
	p12 := Propose(g, emptyPlan(12))
	if e12 := Evaluate(g, p12); tableCounts(p12) != 2 || e12.Summary.Isolated != 8 {
		t.Errorf("plan 12: %d tables, %d isolated; want 2 and 8", tableCounts(p12), e12.Summary.Isolated)
	}
}

func TestMixedM2ExampleAEqualsPlan12(t *testing.T) {
	g, _ := exampleA()
	pm := Propose(g, mixedPlan())
	if !pm.Mixed || pm.Capacity != 12 {
		t.Fatalf("result carries Capacity %d, Mixed %v", pm.Capacity, pm.Mixed)
	}
	if tableCounts(pm) != 2 {
		t.Fatalf("%d tables, want 2", tableCounts(pm))
	}
	if p12 := Propose(g, emptyPlan(12)); !reflect.DeepEqual(asUniform(pm), p12) {
		t.Errorf("mixed plan differs from plan 12 although k0 has no isolated guests:\nmixed %+v\n12    %+v", pm, p12)
	}
}

func TestMixedM3ExtraTableDoesNotLowerIsolation(t *testing.T) {
	g, _ := structuralB36()
	p := Propose(g, mixedPlan())
	ev := assertHardRules(t, g, p)
	if tableCounts(p) != 3 {
		t.Fatalf("%d tables (fills %v), want k0 = 3", tableCounts(p), fills(ev))
	}
	it := newItems(g, 12)
	l1, _ := feasibleAt(it, 4, nil)
	if l1 == nil {
		t.Fatal("precondition: four tables must be feasible, so that the extra table was really weighed")
	}
	if iso1 := l1.objective().iso; iso1 < ev.Summary.Isolated {
		t.Errorf("precondition: 4 tables isolate %d < %d, so the mixed plan should have taken them", iso1, ev.Summary.Isolated)
	}
}

func TestMixedM4FloorForbidsTheExtraTable(t *testing.T) {
	// X[10] -1- M[4], strangers [4], [4]: N = 22 < 24 = 3 * Floor, isolation is structural anyway.
	g, _ := instance([]int{4, 10, 4, 4}, clusterLink{0, 1, Preferred})
	p := Propose(g, mixedPlan())
	ev := assertHardRules(t, g, p)
	if tableCounts(p) != 2 || ev.Summary.Isolated != 14 {
		t.Errorf("%d tables, %d isolated; want 2 and 14", tableCounts(p), ev.Summary.Isolated)
	}
	// example C with one stranger less (N = 23 < 24): fewer than 3 tables of 8 are possible
	g2, _ := instance([]int{3, 5, 6, 2, 5, 2}, clusterLink{0, 1, Preferred})
	if p2 := Propose(g2, mixedPlan()); tableCounts(p2) != 2 {
		t.Errorf("N = 23: %d tables, want 2", tableCounts(p2))
	}
}

func TestMixedM5IsolationBeatsScore(t *testing.T) {
	g := m5Graph()
	pm := Propose(g, mixedPlan())
	p12 := Propose(g, emptyPlan(12))
	em, e12 := Evaluate(g, pm), Evaluate(g, p12)
	if tableCounts(pm) != tableCounts(p12)+1 {
		t.Fatalf("mixed %d tables, plan 12 %d; want one more", tableCounts(pm), tableCounts(p12))
	}
	if em.Summary.Isolated >= e12.Summary.Isolated {
		t.Errorf("isolated %d (mixed) vs %d (12): the extra table must lower it", em.Summary.Isolated, e12.Summary.Isolated)
	}
	if em.Summary.Score >= e12.Summary.Score {
		t.Errorf("score %v (mixed) vs %v (12): this case is meant to have the LOWER score", em.Summary.Score, e12.Summary.Score)
	}
	assertHardRules(t, g, pm)
}

func TestMixedM6ScoreNeverBuysATable(t *testing.T) {
	g := m6Graph()
	pm := Propose(g, mixedPlan())
	p12 := Propose(g, emptyPlan(12))
	if !reflect.DeepEqual(asUniform(pm), p12) {
		t.Fatalf("mixed plan must equal plan 12 (k0), got %d vs %d tables", tableCounts(pm), tableCounts(p12))
	}
	it := newItems(g, 12)
	l0, _ := solve(g, it, nil)
	l1, _ := feasibleAt(it, l0.k+1, nil)
	if l1 == nil {
		t.Fatal("precondition: k0 + 1 must be feasible")
	}
	o0, o1 := l0.objective(), l1.objective()
	if o0.iso == 0 || o1.iso != o0.iso || o1.score <= o0.score {
		t.Fatalf("precondition: want equal isolation > 0 and a higher score at k0+1, got %+v vs %+v", o0, o1)
	}
}

func TestMixedM7Pins(t *testing.T) {
	t.Run("a pin to table k0+1 is kept when the extra table helps", func(t *testing.T) {
		g := exampleC() // clusters of 3,5,6,2,5,3; k0 = 2, k0 + 1 = 3 removes the isolation
		six := rng(9, 14)
		cur := Plan{Capacity: 12, Mixed: true, Tables: []Table{{Number: 1}, {Number: 2}, pinnedTbl(3, six, six...)}}
		p := Propose(g, cur)
		ev := assertHardRules(t, g, p)
		if tableCounts(p) != 3 || ev.Summary.Isolated != 0 {
			t.Fatalf("%d tables, %d isolated; want 3 and 0", tableCounts(p), ev.Summary.Isolated)
		}
		if tableOfGuest(p, 9) != 3 {
			t.Errorf("the pinned cluster is at table %d, want 3", tableOfGuest(p, 9))
		}
		for _, tb := range p.Tables {
			for _, s := range tb.Seats {
				if s.Pinned != (tb.Number == 3 && s.Guest >= 9 && s.Guest <= 14) {
					t.Errorf("guest %d at table %d: pinned = %v", s.Guest, tb.Number, s.Pinned)
				}
			}
		}
	})
	t.Run("a pin to table k0+1 is released when the extra table does not help", func(t *testing.T) {
		g, f := structuralB36()
		last := f[len(f)-1] // the 2-guest cluster
		ids := rng(last, last+1)
		cur := Plan{Capacity: 12, Mixed: true, Tables: []Table{{Number: 1}, {Number: 2}, {Number: 3}, pinnedTbl(4, ids, ids...)}}
		p := Propose(g, cur)
		assertHardRules(t, g, p)
		if tableCounts(p) != 3 {
			t.Fatalf("%d tables, want k0 = 3 (the pin to table 4 is released)", tableCounts(p))
		}
		for _, tb := range p.Tables {
			for _, s := range tb.Seats {
				if s.Pinned {
					t.Errorf("guest %d is still pinned at table %d", s.Guest, tb.Number)
				}
			}
		}
	})
	t.Run("a pin within k0 is kept like in plan 12", func(t *testing.T) {
		g, f := structuralB36()
		ids := rng(f[2], f[2]+3)
		cur := Plan{Capacity: 12, Mixed: true, Tables: []Table{{Number: 1}, pinnedTbl(2, ids, ids...), {Number: 3}}}
		p := Propose(g, cur)
		assertHardRules(t, g, p)
		if tableOfGuest(p, f[2]) != 2 {
			t.Errorf("pinned cluster at table %d, want 2", tableOfGuest(p, f[2]))
		}
	})
}

func TestMixedM8InfeasibleIsPlan12sBestEffort(t *testing.T) {
	for _, n := range []GuestID{14, 15} { // 14 guests: k = 2 would need 16
		g := BuildGraph(enabledRange(1, n), nil)
		pm := Propose(g, mixedPlan())
		if !pm.Mixed || pm.Capacity != 12 {
			t.Fatalf("Capacity %d Mixed %v", pm.Capacity, pm.Mixed)
		}
		p12 := Propose(g, emptyPlan(12))
		if !reflect.DeepEqual(asUniform(pm), p12) {
			t.Errorf("N = %d: best-effort mixed plan differs from plan 12", n)
		}
		if ev := Evaluate(g, pm); !ev.Summary.NeedsRecalculation || !slicesContains(codes(ev.Violations), ViolUnderFloor) {
			t.Errorf("N = %d: want an under_floor violation, got %v", n, codes(ev.Violations))
		}
	}
}

func TestMixedM9Deterministic(t *testing.T) {
	gA, _ := exampleA()
	gB, _ := structuralB36()
	for name, g := range map[string]Graph{"A": gA, "B36": gB, "C": exampleC(), "M5": m5Graph(), "M6": m6Graph()} {
		first := Propose(g, mixedPlan())
		if again := Propose(g, mixedPlan()); !reflect.DeepEqual(first, again) {
			t.Errorf("%s: two calls differ", name)
		}
	}
}

func TestMixedM10Invariants(t *testing.T) {
	gA, _ := exampleA()
	gB, _ := structuralB36()
	for name, g := range map[string]Graph{"A": gA, "B36": gB, "C": exampleC(), "M5": m5Graph(), "M6": m6Graph(), "fixture": annealFixture()} {
		p := Propose(g, mixedPlan())
		if !p.Mixed || p.Capacity != 12 {
			t.Errorf("%s: Capacity %d Mixed %v", name, p.Capacity, p.Mixed)
		}
		ev := assertHardRules(t, g, p)
		for _, f := range fills(ev) {
			if f < Floor || f > 12 {
				t.Errorf("%s: fills %v outside [%d, 12]", name, fills(ev), Floor)
			}
		}
		// never more than one table above the uniform plan, never fewer
		d := tableCounts(p) - tableCounts(Propose(g, emptyPlan(12)))
		if d != 0 && d != 1 {
			t.Errorf("%s: %d tables more than plan 12", name, d)
		}
		if d == 1 && ev.Summary.Isolated >= Evaluate(g, Propose(g, emptyPlan(12))).Summary.Isolated {
			t.Errorf("%s: an extra table without fewer isolated guests", name)
		}
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
	t.Run("Evaluate ignores it", func(t *testing.T) {
		g, _ := exampleA()
		p := Propose(g, emptyPlan(12))
		pm := p
		pm.Mixed = true
		if !reflect.DeepEqual(Evaluate(g, p), Evaluate(g, pm)) {
			t.Error("Evaluate depends on Mixed")
		}
	})
}
