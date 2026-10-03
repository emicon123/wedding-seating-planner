package seating

import (
	"fmt"
	"math/rand"
	"reflect"
	"testing"
)

// annealFixture is a synthetic stand-in for a real guest list (no real data):
// 106 guests in 25 clusters (sizes 2x7, 3x8, 4x4, 6, 8x3, 10, 12, shuffled by a
// fixed seed) with 55 random group-1/2 affinities between clusters.
func annealFixture() Graph {
	sizes := []int{2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 6, 8, 8, 8, 10, 12}
	r := rand.New(rand.NewSource(1))
	r.Shuffle(len(sizes), func(i, j int) { sizes[i], sizes[j] = sizes[j], sizes[i] })
	var guests []Guest
	var ls []Link
	var firsts []GuestID
	next := GuestID(1)
	for _, s := range sizes {
		firsts = append(firsts, next)
		for i := 0; i < s; i++ {
			guests = append(guests, Guest{ID: next, Enabled: true})
			if i > 0 {
				ls = append(ls, lk(next-GuestID(i), next, Must))
			}
			next++
		}
	}
	for i := 0; i < 55; i++ {
		a, b := firsts[r.Intn(len(firsts))], firsts[r.Intn(len(firsts))]
		ls = append(ls, lk(a, b, LinkLevel(1+r.Intn(2))))
	}
	return BuildGraph(guests, ls)
}

// tightFixture is a synthetic stand-in for a real ~107-guest list at capacity 12
// (no real data): 46 clusters (4x1, 28x2, 9x3, 5x4 guests, shuffled by the seed),
// 100 random group-1/2 affinities between clusters. At capacity 12 it needs 9
// tables with one free seat, so almost only equal-size swaps are possible and the
// walk needs a long search (task 012).
func tightFixture(seed int64) Graph {
	sizes := []int{}
	for _, c := range [][2]int{{1, 4}, {2, 28}, {3, 9}, {4, 5}} {
		for i := 0; i < c[1]; i++ {
			sizes = append(sizes, c[0])
		}
	}
	r := rand.New(rand.NewSource(seed))
	r.Shuffle(len(sizes), func(i, j int) { sizes[i], sizes[j] = sizes[j], sizes[i] })
	var guests []Guest
	var ls []Link
	var firsts []GuestID
	next := GuestID(1)
	for _, s := range sizes {
		firsts = append(firsts, next)
		for i := 0; i < s; i++ {
			guests = append(guests, Guest{ID: next, Enabled: true})
			if i > 0 {
				ls = append(ls, lk(next-GuestID(i), next, Must))
			}
			next++
		}
	}
	for i := 0; i < 100; i++ {
		a, b := firsts[r.Intn(len(firsts))], firsts[r.Intn(len(firsts))]
		ls = append(ls, lk(a, b, LinkLevel(1+r.Intn(2))))
	}
	return BuildGraph(guests, ls)
}

// tightBestObjective12 is the best objective on tightFixture(4) at capacity 12: three
// independent runs of 128 restarts x 3M steps each reached it (so did Propose);
// the former pipeline (4 restarts x <=400k steps, end temperature 0.8) returned 392.
var tightBestObjective12 = objective{iso: 0, score: 408}

// The annealing budget (annealRestarts x annealSteps) must reach the long-run
// objective on an instance shaped like a real list; a smaller budget does not (task 012).
func TestAnnealBudgetReachesLongRunObjective(t *testing.T) {
	g := tightFixture(4)
	p := Propose(g, emptyPlan(12))
	ev := assertHardRules(t, g, p)
	if len(p.Tables) != 9 {
		t.Errorf("%d tables, want 9", len(p.Tables))
	}
	if got := evalObjective(ev); got != tightBestObjective12 {
		t.Errorf("Propose objective %+v, want the long-run optimum %+v", got, tightBestObjective12)
	}
}

// Capacity 12 on annealFixture, computed offline (task 011 objective: isolated
// seats first, then the displayed score with the isolation penalty included):
//   - fixtureOldObjective12: pack + repairFloor + improve only;
//   - fixtureBestObjective12: the best objective of 12 independent anneal runs of 3M
//     steps each from the packed layout (all 12 agreed), taken as the optimum.
//
// Before task 011 these were the plain scores 253 and 306. 253 -> {23 isolated, 208}:
// the same pipeline now optimises isolation first and the score shown includes -1
// per isolated guest. 306 -> {12, 278}: the old best layout seated 23+ guests
// without any acquaintance; the new one isolates 12 and scores 278 (displayed).
// Thresholds, not bit-for-bit plans: the accept rule uses math.Exp.
var (
	fixtureOldObjective12  = objective{iso: 23, score: 208}
	fixtureBestObjective12 = objective{iso: 12, score: 278}
)

// oldLocalSearchObjective is the pre-task-008 pipeline: pack + repairFloor + improve.
func oldLocalSearchObjective(g Graph, capacity int) (o objective, ok bool) {
	it := newItems(g, capacity)
	l := pack(it, minTables(it.total, capacity), nil, true)
	if !l.complete() || !repairFloor(l) {
		return objective{}, false
	}
	improve(l, maxPasses)
	return l.objective(), true
}

func evalObjective(ev Evaluation) objective {
	return objective{iso: ev.Summary.Isolated, score: int(ev.Summary.Score)}
}

func TestPRNG(t *testing.T) {
	a, b, c := &prng{s: 1}, &prng{s: 1}, &prng{s: 2}
	same, differs := true, false
	for i := 0; i < 100; i++ {
		x, y, z := a.next(), b.next(), c.next()
		same = same && x == y
		differs = differs || x != z
	}
	if !same || !differs {
		t.Errorf("same seed must repeat (%v) and different seeds must differ (%v)", same, differs)
	}
	r := &prng{s: annealSeed}
	counts := make([]int, 5)
	for i := 0; i < 5000; i++ {
		counts[r.intn(5)]++
		if f := r.float(); f < 0 || f >= 1 {
			t.Fatalf("float() = %v outside [0,1)", f)
		}
	}
	for v, n := range counts {
		if n < 800 || n > 1200 {
			t.Errorf("intn(5) gave %d %d times out of 5000", v, n)
		}
	}
}

func TestAnnealFixtureCapacity12(t *testing.T) {
	g := annealFixture()
	if got := len(g.Clusters()); got != 25 {
		t.Fatalf("fixture has %d clusters, want 25", got)
	}
	old, ok := oldLocalSearchObjective(g, 12)
	if !ok || old != fixtureOldObjective12 {
		t.Fatalf("old local-search objective = %+v (ok %v), fixture constant says %+v", old, ok, fixtureOldObjective12)
	}
	p := Propose(g, emptyPlan(12))
	ev := assertHardRules(t, g, p)
	if len(p.Tables) != 9 {
		t.Errorf("%d tables, want 9", len(p.Tables))
	}
	got := evalObjective(ev)
	if old.better(got) {
		t.Errorf("annealed objective %+v is worse than the old local-search %+v", got, old)
	}
	if got != fixtureBestObjective12 {
		t.Errorf("annealed objective %+v, want the best known %+v", got, fixtureBestObjective12)
	}
}

func TestAnnealFixtureAllCapacities(t *testing.T) {
	g := annealFixture()
	for _, capacity := range []int{9, 10, 11, 12} {
		t.Run(fmt.Sprint(capacity), func(t *testing.T) {
			p := Propose(g, emptyPlan(capacity))
			ev := Evaluate(g, p)
			assertWellFormed(t, g, p)
			if old, ok := oldLocalSearchObjective(g, capacity); ok && old.better(evalObjective(ev)) {
				t.Errorf("objective %+v worse than old local search %+v", evalObjective(ev), old)
			}
			if again := Propose(g, emptyPlan(capacity)); !reflect.DeepEqual(again, p) {
				t.Error("two calls differ")
			}
		})
	}
}

// feasibleLayout packs and repairs; false when that greedy route fails.
func feasibleLayout(g Graph, capacity int, pins map[int]int) (*layout, bool) {
	it := newItems(g, capacity)
	l := pack(it, minTables(it.total, capacity), pins, true)
	return l, l.complete() && repairFloor(l)
}

// checkLayout asserts the hard rules on a layout: complete, fills in [floor, capacity],
// pinned items at their table.
func checkLayout(t *testing.T, l *layout, pins map[int]int) {
	t.Helper()
	if !l.complete() {
		t.Fatal("layout lost an item")
	}
	fill := make([]int, l.k)
	for a, tb := range l.assign {
		fill[tb] += l.it.size[a]
	}
	for tb, f := range fill {
		if f != l.fill[tb] {
			t.Fatalf("table %d: tracked fill %d != real %d", tb, l.fill[tb], f)
		}
		if f > l.it.capacity || f < l.floor() {
			t.Fatalf("table %d fill %d outside [%d,%d]", tb, f, l.floor(), l.it.capacity)
		}
	}
	for a, tb := range pins {
		if l.pinned[a] && l.assign[a] != tb {
			t.Fatalf("pinned item %d moved from table %d to %d", a, tb, l.assign[a])
		}
	}
	// incremental affTo agrees with a recount
	for a := range l.assign {
		for tb := 0; tb < l.k; tb++ {
			sum := 0
			for b := range l.assign {
				if l.assign[b] == tb {
					sum += l.it.gain[a][b]
				}
			}
			if sum != l.affTo[a][tb] {
				t.Fatalf("affTo[%d][%d] = %d, recount %d", a, tb, l.affTo[a][tb], sum)
			}
		}
	}
}

func TestOptimiseProperties(t *testing.T) {
	improved := 0
	for seed := int64(1); seed <= 10; seed++ {
		guests, ls := randomInstance(rand.New(rand.NewSource(seed)))
		g := BuildGraph(guests, ls)
		for _, capacity := range []int{9, 10, 11, 12} {
			l, ok := feasibleLayout(g, capacity, nil)
			if !ok || l.k == 1 {
				continue
			}
			// pin the first two items where they sit
			pins := map[int]int{}
			for a := 0; a < 2 && a < len(l.assign); a++ {
				pins[a] = l.assign[a]
				l.pinned[a] = true
			}
			before := l.objective()
			start := l.clone()
			optimise(l)
			checkLayout(t, l, pins)
			if l.k != start.k {
				t.Fatalf("k changed")
			}
			if after := l.objective(); before.better(after) {
				t.Errorf("seed %d cap %d: objective got worse %+v -> %+v", seed, capacity, before, after)
			} else if after.better(before) {
				improved++
			}
			again := start.clone()
			optimise(again)
			if !reflect.DeepEqual(again.assign, l.assign) {
				t.Errorf("seed %d cap %d: two optimise runs differ", seed, capacity)
			}
		}
	}
	if improved == 0 {
		t.Error("optimise never improved the objective; the test would not notice a no-op")
	}
}

func TestProposeKeepsPinsAfterAnneal(t *testing.T) {
	g := annealFixture()
	base := Propose(g, emptyPlan(12))
	// pin the guests of table 1 and table 2 where they are, then propose again
	cur := clonePlan(base)
	for i := 0; i < 2; i++ {
		for j := range cur.Tables[i].Seats {
			cur.Tables[i].Seats[j].Pinned = true
		}
	}
	p := Propose(g, cur)
	assertHardRules(t, g, p)
	for i := 0; i < 2; i++ {
		for _, s := range cur.Tables[i].Seats {
			if got := tableOfGuest(p, s.Guest); got != i+1 {
				t.Fatalf("pinned guest %d moved from table %d to %d", s.Guest, i+1, got)
			}
		}
	}
}

func TestAnnealFindsSwapOptimum(t *testing.T) {
	// Two cliques of 8 mixed over two tables of capacity 8: every move breaks capacity,
	// only swaps work; anneal alone (no improve) must unmix them. 100k steps: the walk
	// ends at annealTempLow = 3 (task 012; it was 0.8 and 20k steps were enough), so a lone
	// pass needs a longer walk to visit the optimum; in Propose improve() settles it.
	g := BuildGraph(enabledRange(1, 16), links(clique(Preferred, 1, 2, 3, 4, 5, 6, 7, 8), clique(Preferred, 9, 10, 11, 12, 13, 14, 15, 16)))
	it := newItems(g, 8)
	for _, seed := range []uint64{7, 8, 9, 10} {
		l := newLayout(it, 2)
		for id := GuestID(1); id <= 16; id++ {
			l.place(it.idx[id], int((id-1)%2))
		}
		anneal(l, 100_000, &prng{s: seed})
		if want := (objective{iso: 0, score: 2 * 2 * 28}); l.objective() != want {
			t.Errorf("seed %d: objective %+v, want %+v", seed, l.objective(), want)
		}
		checkLayout(t, l, nil)
	}
}

func TestOptimiseSkips(t *testing.T) {
	g := BuildGraph(enabledRange(1, 20), clique(Preferred, 1, 2, 3, 4))
	it := newItems(g, 20)
	t.Run("single table", func(t *testing.T) {
		l := newLayout(it, 1)
		for a := range it.keys {
			l.place(a, 0)
		}
		before := append([]int(nil), l.assign...)
		optimise(l)
		if !reflect.DeepEqual(before, l.assign) {
			t.Error("layout changed")
		}
	})
	t.Run("fewer than two movable items", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 16), nil)
		it := newItems(g, 8)
		l := newLayout(it, 2)
		for a := range it.keys {
			l.place(a, a%2)
			l.pinned[a] = a != 0
		}
		before := append([]int(nil), l.assign...)
		anneal(l, 1000, &prng{s: 1})
		optimise(l)
		if !reflect.DeepEqual(before, l.assign) {
			t.Error("layout changed")
		}
	})
}

// ---- benchmarks ------------------------------------------------------------

func BenchmarkProposeFixture(b *testing.B) {
	g := annealFixture()
	for _, capacity := range []int{9, 10, 11, 12} {
		b.Run(fmt.Sprintf("cap%d", capacity), func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				Propose(g, emptyPlan(capacity))
			}
		})
	}
	b.Run("generate4", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			for _, capacity := range []int{9, 10, 11, 12} {
				Propose(g, emptyPlan(capacity))
			}
		}
	})
}
