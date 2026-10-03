package seating

import (
	"math/rand"
	"reflect"
	"testing"
)

// Tests of task 015 rule 6 "avoid strangers" (design 003-backend-design §11.6,
// 03-seating-model § Stranger pairs, examples I and J).

// exampleI: A[5] -1- B[5]; clique {A, C[2], D[2]} and clique {B, E[2], F[2]} at level 2; G[2]
// unlinked. Ids: A 1-5, B 6-10, C 11-12, D 13-14, E 15-16, F 17-18, G 19-20.
func exampleI() Graph {
	g, _ := instance([]int{5, 5, 2, 2, 2, 2, 2},
		clusterLink{0, 1, Preferred},
		clusterLink{0, 2, Acceptable}, clusterLink{0, 3, Acceptable}, clusterLink{2, 3, Acceptable},
		clusterLink{1, 4, Acceptable}, clusterLink{1, 5, Acceptable}, clusterLink{4, 5, Acceptable})
	return g
}

var (
	exampleIA, exampleIB, exampleIC = rng(1, 5), rng(6, 10), rng(11, 12)
	exampleID, exampleIE, exampleIF = rng(13, 14), rng(15, 16), rng(17, 18)
	exampleIG                       = rng(19, 20)
)

func ids(parts ...[]GuestID) []GuestID {
	var out []GuestID
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

// triple is (isolated adults, stranger pairs, score) as Evaluate reports it.
func triple(ev Evaluation) objective {
	return objective{iso: ev.Summary.Isolated, str: ev.Summary.StrangerPairs, score: int(ev.Summary.Score)}
}

// ---- Evaluate (S-E1..S-E7) -------------------------------------------------

func TestEvaluateStrangerPairs(t *testing.T) {
	gI := exampleI()
	t.Run("S-E1 example I layout a", func(t *testing.T) {
		p := Plan{Capacity: 12, Tables: []Table{
			tbl(1, ids(exampleIA, exampleIB, exampleIG)...),
			tbl(2, ids(exampleIC, exampleID, exampleIE, exampleIF)...)}}
		if got, want := triple(Evaluate(gI, p)), (objective{iso: 0, str: 36, score: 58}); got != want {
			t.Errorf("(iso, strangers, score) = %+v, want %+v", got, want)
		}
	})
	t.Run("S-E2 example I layout b", func(t *testing.T) {
		p := Plan{Capacity: 12, Tables: []Table{
			tbl(1, ids(exampleIA, exampleIC, exampleID, exampleIG)...),
			tbl(2, ids(exampleIB, exampleIE, exampleIF)...)}}
		if got, want := triple(Evaluate(gI, p)), (objective{iso: 0, str: 18, score: 48}); got != want {
			t.Errorf("(iso, strangers, score) = %+v, want %+v", got, want)
		}
	})
	t.Run("S-E3 children form no pair", func(t *testing.T) {
		// family {1..5}: adults 1, 2, children 3, 4, 5; stranger cluster {6, 7, 8}: three adults
		guests := kids(enabledRange(1, 8), 3, 4, 5)
		g := BuildGraph(guests, links(chain(1, 2, 3, 4, 5), chain(6, 7, 8)))
		ev := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, rng(1, 8)...)}})
		if ev.Summary.StrangerPairs != 6 {
			t.Errorf("pairs = %d, want 2 adults x 3 adults = 6", ev.Summary.StrangerPairs)
		}
		for _, id := range rng(3, 5) {
			if gs := guestScore(t, ev, id); gs != zeroScore(id, 1) {
				t.Errorf("child %d: %+v, want all zeros (StrangersAtTable included)", id, gs)
			}
		}
		if gs := guestScore(t, ev, 1); gs.StrangersAtTable != 3 {
			t.Errorf("adult 1 strangers = %d, want 3", gs.StrangersAtTable)
		}
	})
	t.Run("S-E4 level 2 is an acquaintance", func(t *testing.T) {
		g, _ := instance([]int{2, 3}, clusterLink{0, 1, Acceptable})
		if ev := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, rng(1, 5)...)}}); ev.Summary.StrangerPairs != 0 {
			t.Errorf("pairs = %d, want 0", ev.Summary.StrangerPairs)
		}
	})
	t.Run("S-E5 a cluster is never its own stranger", func(t *testing.T) {
		g, _ := instance([]int{3, 2})
		whole := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 3), tbl(2, 4, 5)}})
		if whole.Summary.StrangerPairs != 0 {
			t.Errorf("whole cluster alone: pairs = %d, want 0", whole.Summary.StrangerPairs)
		}
		// split by hand: {1, 2} + stranger 4 at table 1, {3} + stranger 5 at table 2 (cluster_split)
		split := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 4), tbl(2, 3, 5)}})
		if split.Summary.StrangerPairs != 3 || !slicesContains(codes(split.Violations), ViolClusterSplit) {
			t.Errorf("split: pairs = %d, codes %v; want 3 (2 + 1) and cluster_split", split.Summary.StrangerPairs, codes(split.Violations))
		}
	})
	t.Run("S-E6 unseated adults form no pairs", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 6), nil)
		ev := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2)}})
		if ev.Summary.StrangerPairs != 1 || ev.Summary.Unseated != 4 {
			t.Errorf("pairs = %d, unseated = %d; want 1 and 4", ev.Summary.StrangerPairs, ev.Summary.Unseated)
		}
	})
	t.Run("S-E7 pairs = half the sum of strangersAtTable, on random plans", func(t *testing.T) {
		for seed := int64(1); seed <= 40; seed++ {
			r := rand.New(rand.NewSource(seed))
			guests, ls := childInstance(r)
			g := BuildGraph(guests, ls)
			p := Propose(g, emptyPlan(12))
			// scramble: shuffle the guests over the same number of tables, hard rules ignored
			scr := Plan{Capacity: 12, Tables: make([]Table, max(2, len(p.Tables)))}
			for i := range scr.Tables {
				scr.Tables[i].Number = i + 1
			}
			for _, gu := range guests {
				ti := r.Intn(len(scr.Tables))
				scr.Tables[ti].Seats = append(scr.Tables[ti].Seats, Seat{Guest: gu.ID})
			}
			for _, plan := range []Plan{p, scr} {
				ev := Evaluate(g, plan)
				sum := 0
				for _, gs := range ev.GuestScores {
					sum += gs.StrangersAtTable
				}
				if sum%2 != 0 || ev.Summary.StrangerPairs != sum/2 {
					t.Fatalf("seed %d: pairs %d, sum of strangersAtTable %d", seed, ev.Summary.StrangerPairs, sum)
				}
			}
		}
	})
}

// ---- deltas (S-D1..S-D7) ---------------------------------------------------

func TestStrangerDeltasHandBuilt(t *testing.T) {
	// layout places single-guest clusters by id; every check recomputes the objective.
	build := func(guests []Guest, ls []Link, k int, tables ...[]GuestID) *layout {
		g := BuildGraph(guests, ls)
		m := map[GuestID]int{}
		for ti, ids := range tables {
			for _, id := range ids {
				m[g.keyOf[id]] = ti
			}
		}
		return isoLayout(g, 12, k, m)
	}
	t.Run("S-D1 from strangers to acquaintances", func(t *testing.T) {
		l := build(enabledRange(1, 6), []Link{lk(4, 5, Preferred), lk(4, 6, Preferred)}, 2, rng(1, 4), rng(5, 6))
		if d := checkMoveDelta(t, l, l.it.idx[4], 1); d.str != -3 {
			t.Errorf("delta %+v, want str -3 (leaves 3 strangers, meets none)", d)
		}
	})
	t.Run("S-D2 to a table without adults", func(t *testing.T) {
		l := build(enabledRange(1, 4), nil, 3, rng(1, 3), []GuestID{4})
		if d := checkMoveDelta(t, l, l.it.idx[1], 2); d.str != -2 {
			t.Errorf("delta %+v, want str -2 (only the left side counts)", d)
		}
	})
	t.Run("S-D3 swap of two acquainted items", func(t *testing.T) {
		l := build(enabledRange(1, 6), []Link{lk(3, 4, Preferred)}, 2, rng(1, 3), rng(4, 6))
		if d := checkSwapDelta(t, l, l.it.idx[3], l.it.idx[4]); d.str != 0 {
			t.Errorf("delta %+v, want str 0 (3 + 3 stranger pairs before and after)", d)
		}
	})
	t.Run("S-D4 swap of strangers", func(t *testing.T) {
		l := build(enabledRange(1, 5), []Link{lk(1, 2, Preferred), lk(4, 5, Preferred)}, 2, rng(1, 3), rng(4, 5))
		if d := checkSwapDelta(t, l, l.it.idx[3], l.it.idx[4]); d.str != 1 {
			t.Errorf("delta %+v, want str +1 (2 pairs -> 3)", d)
		}
	})
	t.Run("S-D5 a third item knows only b", func(t *testing.T) {
		l := build(enabledRange(1, 5), []Link{lk(2, 4, Preferred)}, 2, rng(1, 3), rng(4, 5))
		if d := checkSwapDelta(t, l, l.it.idx[1], l.it.idx[4]); d.str != -1 {
			t.Errorf("delta %+v, want str -1 (4 pairs -> 3)", d)
		}
		checkSwapDelta(t, l, l.it.idx[3], l.it.idx[5])
	})
	t.Run("S-D6 children-only item", func(t *testing.T) {
		guests := kids(enabledRange(1, 5), 4, 5)
		l := build(guests, chain(4, 5), 2, rng(1, 3), rng(4, 5))
		cl := l.it.idx[4]
		if d := checkMoveDelta(t, l, cl, 0); d != (delta{}) {
			t.Errorf("children-only move delta %+v, want zero", d)
		}
		if d := checkSwapDelta(t, l, l.it.idx[1], cl); d.str != -2 {
			t.Errorf("swap with an adult: %+v, want str -2 (only the adult's own term: 3 pairs -> 1)", d)
		}
	})
	t.Run("S-D7 the only known cluster is children-only", func(t *testing.T) {
		// 1 -1- K{4, 5} (children): no adult knows the adult 1, so all adults it meets are strangers
		guests := kids(enabledRange(1, 7), 4, 5)
		l := build(guests, append(chain(4, 5), lk(1, 4, Preferred)), 2, []GuestID{1, 2, 4, 5}, []GuestID{3, 6, 7})
		a := l.it.idx[1]
		if len(l.it.nbr[a]) != 0 || l.it.hasPartner[a] {
			t.Fatalf("precondition: item 1 has no neighbours and no partner, got nbr %v partner %v", l.it.nbr[a], l.it.hasPartner[a])
		}
		if d := checkMoveDelta(t, l, a, 1); d.str != 2 {
			t.Errorf("delta %+v, want str +2 (meets 3 strangers instead of 1)", d)
		}
	})
}

// ---- Propose (S-P1..S-P6) --------------------------------------------------

func TestProposeExampleI(t *testing.T) {
	g := exampleI()
	p := Propose(g, emptyPlan(12))
	ev := assertHardRules(t, g, p)
	if got, want := triple(ev), (objective{iso: 0, str: 18, score: 48}); got != want {
		t.Errorf("(iso, strangers, score) = %+v, want %+v (before task 015: 36 strangers, score 58)", got, want)
	}
	if len(p.Tables) != 2 {
		t.Errorf("%d tables, want 2", len(p.Tables))
	}
}

// partitionInstance builds an instance that splits into stranger-free tables: `groups` groups of
// 10-11 seats (so that k = ⌈N/12⌉ = groups, with a little slack), each a clique of 1-4 clusters (level 1 or 2), ids
// shuffled, plus random extra cross links (more acquaintances only).
func partitionInstance(r *rand.Rand, groups int) ([]Guest, []Link) {
	var sizes []int
	var groupOf []int
	for gi := 0; gi < groups; gi++ {
		seats := 10 + r.Intn(2)
		for seats > 0 {
			s := min(seats, 1+r.Intn(5))
			sizes = append(sizes, s)
			groupOf = append(groupOf, gi)
			seats -= s
		}
	}
	perm := r.Perm(len(sizes))
	shuffled := make([]int, len(sizes))
	shGroup := make([]int, len(sizes))
	for i, p := range perm {
		shuffled[i], shGroup[i] = sizes[p], groupOf[p]
	}
	guests, ls, f := clustersOfSizes(shuffled...)
	for i := range f {
		for j := i + 1; j < len(f); j++ {
			if shGroup[i] == shGroup[j] || r.Intn(12) == 0 {
				ls = append(ls, lk(f[i], f[j], LinkLevel(1+r.Intn(2))))
			}
		}
	}
	return guests, ls
}

func TestProposeZeroStrangersWhenThePartitionExists(t *testing.T) { // S-P2
	for seed := int64(1); seed <= 30; seed++ {
		r := rand.New(rand.NewSource(seed))
		guests, ls := partitionInstance(r, 2+r.Intn(3))
		g := BuildGraph(guests, ls)
		p := Propose(g, emptyPlan(12))
		ev := assertHardRules(t, g, p)
		if ev.Summary.StrangerPairs != 0 || ev.Summary.Isolated != 0 {
			t.Errorf("seed %d: %d guests, fills %v: %d stranger pairs, %d isolated; want 0 and 0",
				seed, len(guests), fills(ev), ev.Summary.StrangerPairs, ev.Summary.Isolated)
		}
	}
}

func TestProposeNoLinksEvensTheTables(t *testing.T) { // S-P3, example J
	g := BuildGraph(enabledRange(1, 20), nil)
	p := Propose(g, emptyPlan(12))
	ev := assertHardRules(t, g, p)
	if !reflect.DeepEqual(sortedDesc(fills(ev)), []int{10, 10}) || ev.Summary.StrangerPairs != 90 {
		t.Errorf("fills %v, %d stranger pairs; want 10 + 10 and 90 (12 + 8 would give 94)", fills(ev), ev.Summary.StrangerPairs)
	}
}

// bruteInstance is a random instance of 4-8 clusters (minSize-maxSize guests, ~20% children, so
// adults >= 0), random links, minN <= N <= maxN.
func bruteInstance(r *rand.Rand, minN, maxN, minSize, maxSize int) ([]Guest, []Link) {
	for {
		m := 4 + r.Intn(5)
		sizes := make([]int, m)
		n := 0
		for i := range sizes {
			sizes[i] = minSize + r.Intn(maxSize-minSize+1)
			n += sizes[i]
		}
		if n < minN || n > maxN {
			continue
		}
		guests, ls, f := clustersOfSizes(sizes...)
		for i := range guests {
			guests[i].Child = r.Intn(5) == 0
		}
		for i := 0; i < m; i++ {
			for j := i + 1; j < m; j++ {
				if r.Intn(3) == 0 {
					ls = append(ls, lk(f[i], f[j], LinkLevel(1+r.Intn(2))))
				}
			}
		}
		return guests, ls
	}
}

// bruteBest enumerates every assignment of the items to k tables with fills in [floor, 12]
// (floor waived for k = 1) and returns the best objective by the order, and whether any exists.
func bruteBest(it items, k int) (best objective, ok bool) {
	m := len(it.keys)
	l := newLayout(it, k)
	var rec func(a int)
	rec = func(a int) {
		if a == m {
			for t := 0; t < k; t++ {
				if l.fill[t] > it.capacity || (k > 1 && l.fill[t] < it.floor) {
					return
				}
			}
			if o := l.objective(); !ok || it.order.better(o, best) {
				best, ok = o, true
			}
			return
		}
		for t := 0; t < k; t++ {
			if l.fill[t]+it.size[a] > it.capacity {
				continue
			}
			l.place(a, t)
			rec(a + 1)
			l.unplace(a)
		}
	}
	rec(0)
	return best, ok
}

// S-P4: Propose reaches the lexicographic minimum of (isolated, stranger pairs, score), found by
// enumeration, on small random instances.
func TestProposeMatchesBruteForceTriple(t *testing.T) {
	checked, scoreMisses := 0, 0
	for seed := int64(1); seed <= 25; seed++ {
		r := rand.New(rand.NewSource(seed))
		guests, ls := bruteInstance(r, 14, 36, 1, 5)
		g := BuildGraph(guests, ls)
		it := newItems(g, 12, false)
		var sizes []int
		for _, s := range it.size {
			sizes = append(sizes, s)
		}
		k := minFeasibleTables(sizes, 12)
		if k <= 0 || k > 3 {
			continue
		}
		want, ok := bruteBest(it, k)
		if !ok {
			continue
		}
		p := Propose(g, emptyPlan(12))
		ev := assertHardRules(t, g, p)
		got := triple(ev)
		checked++
		if len(p.Tables) != k || got.iso != want.iso || got.str != want.str {
			t.Errorf("seed %d (k %d): Propose %+v with %d tables, brute-force minimum %+v", seed, k, got, len(p.Tables), want)
		} else if got.score != want.score {
			scoreMisses++
			t.Errorf("seed %d: iso and strangers match but score %d, brute-force best %d", seed, got.score, want.score)
		}
	}
	if checked < 12 {
		t.Errorf("only %d instances were checked", checked)
	}
	t.Logf("%d instances checked, %d score misses", checked, scoreMisses)
}

// S-P5: never worse than the greedy start (pack + repair) in the triple order, on generated
// inputs with children, and no single feasible move or swap improves the result.
func TestProposeNeverWorseThanPackRepair(t *testing.T) {
	compared := 0
	for seed := int64(1); seed <= 20; seed++ {
		r := rand.New(rand.NewSource(seed))
		guests, ls := childInstance(r)
		g := BuildGraph(guests, ls)
		for _, capacity := range []int{9, 10, 11, 12} {
			start, ok := feasibleLayout(g, capacity, nil)
			if !ok {
				continue
			}
			p := Propose(g, emptyPlan(capacity))
			if len(p.Tables) != start.k {
				continue
			}
			compared++
			if got := triple(Evaluate(g, p)); start.objective().better(got) {
				t.Errorf("seed %d capacity %d: result %+v worse than the greedy start %+v", seed, capacity, got, start.objective())
			}
		}
	}
	if compared == 0 {
		t.Error("nothing compared")
	}
}

// S-P6: determinism on the tight fixture, a children fixture and example I.
func TestProposeDeterministicWithStrangers(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	guests, ls := childInstance(r)
	for name, g := range map[string]Graph{"I": exampleI(), "children": BuildGraph(guests, ls), "fixture": annealFixture()} {
		for _, plan := range []Plan{emptyPlan(10), emptyPlan(12), mixedPlan()} {
			if a, b := Propose(g, plan), Propose(g, plan); !reflect.DeepEqual(a, b) {
				t.Errorf("%s %+v: two calls differ", name, plan)
			}
		}
	}
}

// the anneal runs without any link now (the stranger term varies, example J)
func TestHasWeight(t *testing.T) {
	g := BuildGraph(kids(enabledRange(1, 4), 1, 2), nil)
	l := newLayout(newItems(g, 12, false), 2)
	if l.hasWeight([]int{0, 1}) || !l.hasWeight([]int{0, 2}) {
		t.Errorf("hasWeight: children-only items %v, with an adult %v", l.hasWeight([]int{0, 1}), l.hasWeight([]int{0, 2}))
	}
}
