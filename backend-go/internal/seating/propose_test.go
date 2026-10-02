package seating

import (
	"math/rand"
	"reflect"
	"sort"
	"testing"
)

// ---- helpers ---------------------------------------------------------------

func fills(ev Evaluation) []int {
	out := make([]int, len(ev.Tables))
	for i, t := range ev.Tables {
		out[i] = t.Fill
	}
	return out
}

func sortedDesc(in []int) []int {
	out := append([]int(nil), in...)
	sort.Sort(sort.Reverse(sort.IntSlice(out)))
	return out
}

func tableOfGuest(p Plan, id GuestID) int {
	for _, t := range p.Tables {
		for _, s := range t.Seats {
			if s.Guest == id {
				return t.Number
			}
		}
	}
	return 0
}

func emptyPlan(capacity int) Plan { return Plan{Capacity: capacity} }

func clonePlan(p Plan) Plan {
	out := Plan{Capacity: p.Capacity}
	for _, t := range p.Tables {
		out.Tables = append(out.Tables, Table{Number: t.Number, Seats: append([]Seat(nil), t.Seats...)})
	}
	return out
}

// assertWellFormed: tables numbered 1..k, only enabled guests seated, nobody twice.
func assertWellFormed(t *testing.T, g Graph, p Plan) {
	t.Helper()
	seen := map[GuestID]bool{}
	for i, tb := range p.Tables {
		if tb.Number != i+1 {
			t.Fatalf("table %d has number %d", i+1, tb.Number)
		}
		for _, s := range tb.Seats {
			if !g.IsEnabled(s.Guest) {
				t.Fatalf("seat for disabled/unknown guest %d", s.Guest)
			}
			if seen[s.Guest] {
				t.Fatalf("guest %d seated twice", s.Guest)
			}
			seen[s.Guest] = true
		}
	}
}

// assertHardRules: no violation at all (cluster integrity, capacity, floor, everyone seated).
func assertHardRules(t *testing.T, g Graph, p Plan) Evaluation {
	t.Helper()
	assertWellFormed(t, g, p)
	ev := Evaluate(g, p)
	if len(ev.Violations) != 0 {
		t.Fatalf("violations %+v for fills %v", ev.Violations, fills(ev))
	}
	return ev
}

func seatedAtSameTable(p Plan, a, b GuestID) bool {
	ta, tb := tableOfGuest(p, a), tableOfGuest(p, b)
	return ta != 0 && ta == tb
}

// ---- internals -------------------------------------------------------------

func TestMinTables(t *testing.T) {
	tests := []struct{ seats, capacity, want int }{
		{0, 10, 0}, {1, 10, 1}, {5, 8, 1}, {8, 8, 1}, {9, 8, 2},
		{24, 10, 3}, {92, 8, 12}, {92, 10, 10}, {92, 12, 8}, {100, 12, 9},
	}
	for _, tc := range tests {
		if got := minTables(tc.seats, tc.capacity); got != tc.want {
			t.Errorf("minTables(%d, %d) = %d, want %d", tc.seats, tc.capacity, got, tc.want)
		}
	}
}

func TestPack(t *testing.T) {
	singles := func(n GuestID) items { return newItems(BuildGraph(enabledRange(1, n), nil), 10) }
	tests := []struct {
		name         string
		it           items
		k            int
		affinity     bool
		wantComplete bool
		wantMaxFill  int
	}{
		{"24 singles in 3 tables of 10 are balanced", singles(24), 3, true, true, 8},
		{"24 singles do not fit 2 tables of 10", singles(24), 2, true, false, 10},
		{"pure mode balances too", singles(24), 3, false, true, 8},
		{"a single table takes up to capacity", singles(10), 1, true, true, 10},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			l := pack(tc.it, tc.k, nil, tc.affinity)
			if l.complete() != tc.wantComplete {
				t.Fatalf("complete = %v, want %v (fills %v)", l.complete(), tc.wantComplete, l.fill)
			}
			maxFill := 0
			for _, f := range l.fill {
				if f > tc.it.capacity {
					t.Errorf("fill %d exceeds capacity", f)
				}
				maxFill = max(maxFill, f)
			}
			if maxFill != tc.wantMaxFill {
				t.Errorf("max fill = %d, want %d (fills %v)", maxFill, tc.wantMaxFill, l.fill)
			}
		})
	}
}

func TestPackAffinityPullsPartnersTogether(t *testing.T) {
	g := BuildGraph(enabledRange(1, 12), links(clique(Preferred, 1, 2, 3, 4, 5, 6), clique(Preferred, 7, 8, 9, 10, 11, 12)))
	it := newItems(g, 10)
	l := pack(it, 2, nil, true)
	if !l.complete() {
		t.Fatal("pack incomplete")
	}
	for _, grp := range [][]GuestID{rng(1, 6), rng(7, 12)} {
		for _, id := range grp[1:] {
			if l.assign[it.idx[id]] != l.assign[it.idx[grp[0]]] {
				t.Errorf("guest %d separated from %d", id, grp[0])
			}
		}
	}
}

func TestPackHonoursFittingPinsAndReleasesOthers(t *testing.T) {
	g := BuildGraph(enabledRange(1, 24), nil)
	it := newItems(g, 10)
	pins := map[int]int{it.idx[5]: 2, it.idx[6]: 7} // table index 2 exists (k=3); 7 does not
	l := pack(it, 3, pins, true)
	if l.assign[it.idx[5]] != 2 || !l.pinned[it.idx[5]] {
		t.Errorf("pin for 5 not honoured: assign=%d pinned=%v", l.assign[it.idx[5]], l.pinned[it.idx[5]])
	}
	if l.pinned[it.idx[6]] {
		t.Error("a pin beyond the table count must be released")
	}
	if !l.complete() {
		t.Error("released pin cluster must still be placed")
	}
}

func TestRepairFloor(t *testing.T) {
	t.Run("moves clusters into an under-floor table (10+10+4 -> feasible)", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 24), nil)
		it := newItems(g, 10)
		l := newLayout(it, 3)
		for id := GuestID(1); id <= 24; id++ {
			switch {
			case id <= 10:
				l.place(it.idx[id], 0)
			case id <= 20:
				l.place(it.idx[id], 1)
			default:
				l.place(it.idx[id], 2)
			}
		}
		if !repairFloor(l) {
			t.Fatalf("repair failed, fills %v", l.fill)
		}
		for _, f := range l.fill {
			if f < Floor || f > 10 {
				t.Errorf("fills %v out of [6,10]", l.fill)
			}
		}
		if got := l.fill[0] + l.fill[1] + l.fill[2]; got != 24 {
			t.Errorf("seated %d, want 24", got)
		}
	})
	t.Run("needs a swap: donor 5+5, receiver 4 singles", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 14), links(chain(1, 2, 3, 4, 5), chain(6, 7, 8, 9, 10)))
		it := newItems(g, 10)
		l := newLayout(it, 2)
		l.place(it.idx[1], 0)
		l.place(it.idx[6], 0)
		for id := GuestID(11); id <= 14; id++ {
			l.place(it.idx[id], 1)
		}
		if !repairFloor(l) {
			t.Fatalf("repair failed, fills %v", l.fill)
		}
		if l.fill[0] < Floor || l.fill[1] < Floor {
			t.Errorf("fills %v", l.fill)
		}
	})
	t.Run("unfixable: two tables of 5", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 10), links(chain(1, 2, 3, 4, 5), chain(6, 7, 8, 9, 10)))
		it := newItems(g, 10)
		l := newLayout(it, 2)
		l.place(it.idx[1], 0)
		l.place(it.idx[6], 1)
		if repairFloor(l) {
			t.Errorf("repair claims success with fills %v", l.fill)
		}
	})
	t.Run("pinned clusters are never moved, so this layout stays unfixable", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 14), nil)
		it := newItems(g, 10)
		l := newLayout(it, 2)
		for id := GuestID(1); id <= 10; id++ {
			l.place(it.idx[id], 0)
			l.pinned[it.idx[id]] = true
		}
		for id := GuestID(11); id <= 14; id++ {
			l.place(it.idx[id], 1)
		}
		before := append([]int(nil), l.assign...)
		if repairFloor(l) {
			t.Error("repair claims success although only pinned clusters could donate")
		}
		if !reflect.DeepEqual(before, l.assign) {
			t.Error("a pinned cluster was moved")
		}
	})
}

func TestImprove(t *testing.T) {
	t.Run("never lowers the score and reaches the optimum on a swap case", func(t *testing.T) {
		// two Preferred cliques of 4 mixed across two tables; floors/capacity forbid single moves.
		g := BuildGraph(enabledRange(1, 16), links(clique(Preferred, 1, 2, 3, 4, 5, 6, 7, 8), clique(Preferred, 9, 10, 11, 12, 13, 14, 15, 16)))
		it := newItems(g, 8)
		l := newLayout(it, 2)
		for id := GuestID(1); id <= 16; id++ {
			l.place(it.idx[id], int((id-1)%2)) // worst case: alternate
		}
		before := l.score()
		improve(l, maxPasses)
		if l.score() < before {
			t.Fatalf("score fell from %d to %d", before, l.score())
		}
		if want := 2 * 2 * 28; l.score() != want { // two cliques of 8: C(8,2)=28 pairs * 2 each
			t.Errorf("score = %d, want optimum %d", l.score(), want)
		}
	})
	t.Run("respects capacity, floor and pins", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 14), clique(Preferred, 1, 2, 3, 4, 5, 6, 7, 8))
		it := newItems(g, 8)
		l := newLayout(it, 2)
		for id := GuestID(1); id <= 14; id++ {
			l.place(it.idx[id], int(id%2)) // 7 + 7 split
		}
		l.pinned[it.idx[2]] = true // 2 stays at table 0
		improve(l, maxPasses)
		for _, f := range l.fill {
			if f < Floor || f > 8 {
				t.Errorf("fills %v out of [6,8]", l.fill)
			}
		}
		if l.assign[it.idx[2]] != 0 {
			t.Error("pinned cluster moved")
		}
	})
	t.Run("pass cap limits work", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 16), links(clique(Preferred, 1, 2, 3, 4, 5, 6, 7, 8), clique(Preferred, 9, 10, 11, 12, 13, 14, 15, 16)))
		it := newItems(g, 8)
		l := newLayout(it, 2)
		for id := GuestID(1); id <= 16; id++ {
			l.place(it.idx[id], int((id-1)%2))
		}
		before := l.score()
		improve(l, 0)
		if l.score() != before {
			t.Error("zero passes must change nothing")
		}
	})
}

// ---- worked examples -------------------------------------------------------

func TestProposeExamples(t *testing.T) {
	t.Run("24 singles at capacity 10 give 3 tables, none below 6 (no 10+10+4)", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 24), nil)
		ev := assertHardRules(t, g, Propose(g, emptyPlan(10)))
		if len(ev.Tables) != 3 {
			t.Fatalf("tables = %d, want 3 (fills %v)", len(ev.Tables), fills(ev))
		}
		for _, f := range fills(ev) {
			if f < Floor || f > 10 {
				t.Errorf("fills %v", fills(ev))
			}
		}
	})

	t.Run("92 singles: 12 / 10 / 8 tables at capacity 8 / 10 / 12", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 92), nil)
		for capacity, want := range map[int]int{8: 12, 10: 10, 12: 8} {
			ev := assertHardRules(t, g, Propose(g, emptyPlan(capacity)))
			if len(ev.Tables) != want {
				t.Errorf("capacity %d: %d tables, want %d", capacity, len(ev.Tables), want)
			}
		}
	})

	t.Run("small and empty inputs", func(t *testing.T) {
		tests := []struct {
			name       string
			guests     []Guest
			wantTables int
		}{
			{"no guests", nil, 0},
			{"all disabled", off(1, 2, 3), 0},
			{"5 guests: one table, floor waived", enabledRange(1, 5), 1},
			{"exactly capacity", enabledRange(1, 8), 1},
		}
		for _, tc := range tests {
			g := BuildGraph(tc.guests, nil)
			ev := assertHardRules(t, g, Propose(g, emptyPlan(8)))
			if len(ev.Tables) != tc.wantTables {
				t.Errorf("%s: %d tables, want %d", tc.name, len(ev.Tables), tc.wantTables)
			}
		}
	})

	t.Run("Rafał's cluster of 5 stays together at every capacity", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 40), star(1, Must, 2, 3, 4, 5))
		for _, capacity := range []int{8, 10, 12} {
			p := Propose(g, emptyPlan(capacity))
			assertHardRules(t, g, p)
			for id := GuestID(2); id <= 5; id++ {
				if !seatedAtSameTable(p, 1, id) {
					t.Errorf("capacity %d: guest %d not with Rafał", capacity, id)
				}
			}
		}
	})

	t.Run("a disabled hub does not split his family; disabled guests take no seat", func(t *testing.T) {
		g := BuildGraph(cat(off(1), enabledRange(2, 40)), star(1, Must, 2, 3, 4, 5))
		p := Propose(g, emptyPlan(10))
		assertHardRules(t, g, p)
		if tableOfGuest(p, 1) != 0 {
			t.Error("disabled guest was seated")
		}
		for id := GuestID(3); id <= 5; id++ {
			if !seatedAtSameTable(p, 2, id) {
				t.Errorf("family member %d split from 2", id)
			}
		}
	})

	t.Run("fewest tables beats satisfaction", func(t *testing.T) {
		// Three preferred cliques 7+7+6 would be perfectly happy at 3 tables, but 20 guests fit 2 tables of 10.
		g := BuildGraph(enabledRange(1, 20), links(clique(Preferred, rng(1, 7)...), clique(Preferred, rng(8, 14)...), clique(Preferred, rng(15, 20)...)))
		ev := assertHardRules(t, g, Propose(g, emptyPlan(10)))
		if len(ev.Tables) != 2 {
			t.Errorf("tables = %d, want 2", len(ev.Tables))
		}
	})

	t.Run("10+10+4 rebalances minimally to 10+8+6", func(t *testing.T) {
		// Cliques X=1..10 and Y=11..20 want to stay whole; 21..24 are strangers.
		g := BuildGraph(enabledRange(1, 24), links(clique(Preferred, rng(1, 10)...), clique(Preferred, rng(11, 20)...)))
		ev := assertHardRules(t, g, Propose(g, emptyPlan(10)))
		if got := sortedDesc(fills(ev)); !reflect.DeepEqual(got, []int{10, 8, 6}) {
			t.Errorf("fills = %v, want 10+8+6", got)
		}
		if ev.Summary.Score != 148 { // 90 (whole clique) + 56 + 2
			t.Errorf("score = %v, want 148", ev.Summary.Score)
		}
	})

	t.Run("oversized cluster stays unseated with violations; the rest is planned without it", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 23), chain(rng(1, 9)...)) // 9 > 8, plus 14 singles
		p := Propose(g, emptyPlan(8))
		assertWellFormed(t, g, p)
		ev := Evaluate(g, p)
		if got := codes(ev.Violations); !reflect.DeepEqual(got, []ViolationCode{ViolOversizedCluster, ViolUnseated}) {
			t.Fatalf("violations = %v", got)
		}
		if !reflect.DeepEqual(ev.Violations[1].Guests, rng(1, 9)) {
			t.Errorf("unseated guests = %v", ev.Violations[1].Guests)
		}
		if len(ev.Tables) != 2 || ev.Summary.Seated != 14 { // 14 singles -> 2 tables of 7
			t.Errorf("tables=%d seated=%d, want 2 and 14", len(ev.Tables), ev.Summary.Seated)
		}
		if !ev.Summary.NeedsRecalculation {
			t.Error("NeedsRecalculation must be true with violations")
		}
	})

	t.Run("infeasible floor returns best effort plus violations instead of failing", func(t *testing.T) {
		g := BuildGraph(enabledRange(1, 9), nil) // 9 guests, capacity 8: 2 tables would need >= 12
		p := Propose(g, emptyPlan(8))
		assertWellFormed(t, g, p)
		ev := Evaluate(g, p)
		if ev.Summary.Seated != 9 || len(ev.Tables) != 2 {
			t.Errorf("tables=%d seated=%d", len(ev.Tables), ev.Summary.Seated)
		}
		if !ev.Summary.NeedsRecalculation {
			t.Error("best effort plan must report its violations")
		}
	})
}

// ---- companions: Maciek / Karolina -----------------------------------------

func TestProposeMaciekKarolinaGroupOneList(t *testing.T) {
	// Maciek(1)+Karolina(2) have a group-1 list of 9 people, each with a partner (group 0): 20 guests.
	// By cluster-level propagation the pair prefers all 9 couples; the couples don't know each other.
	var ls []Link
	ls = append(ls, lk(1, 2, Must))
	for i := GuestID(0); i < 9; i++ {
		person, partner := 3+i, 12+i
		ls = append(ls, lk(person, partner, Must), lk(1, person, Preferred))
	}
	g := BuildGraph(enabledRange(1, 20), ls)

	// With the pair's table holding c couples (capacity C = 2 + 2c): score = c * 2*2*2*1 = 8c.
	tests := []struct {
		capacity, wantTables, wantCouples int
	}{
		{8, 3, 3}, {10, 2, 4}, {12, 2, 5},
	}
	for _, tc := range tests {
		p := Propose(g, emptyPlan(tc.capacity))
		ev := assertHardRules(t, g, p)
		if len(ev.Tables) != tc.wantTables {
			t.Errorf("capacity %d: %d tables, want %d", tc.capacity, len(ev.Tables), tc.wantTables)
		}
		if want := float64(8 * tc.wantCouples); ev.Summary.Score != want {
			t.Errorf("capacity %d: score = %v, want %v", tc.capacity, ev.Summary.Score, want)
		}
		if gs := guestScore(t, ev, 1); gs.PreferredAtTable != 2*tc.wantCouples || gs.PreferredTotal != 18 {
			t.Errorf("capacity %d: Maciek %+v, want %d of 18 preferred at table", tc.capacity, gs, 2*tc.wantCouples)
		}
		if !seatedAtSameTable(p, 1, 2) {
			t.Errorf("capacity %d: Maciek and Karolina split", tc.capacity)
		}
		for i := GuestID(0); i < 9; i++ {
			if !seatedAtSameTable(p, 3+i, 12+i) {
				t.Errorf("capacity %d: couple %d split", tc.capacity, i)
			}
		}
	}
}

func TestProposeCompanionOrdering(t *testing.T) {
	// A's cluster (size 4) can sit with only one of the other clusters (size 3 each, capacity 8, 13 guests).
	// 1..4 = A, 5..7 = X, 8..10 = Y, 11..13 = Z
	base := links(chain(1, 2, 3, 4), chain(5, 6, 7), chain(8, 9, 10), chain(11, 12, 13))
	tests := []struct {
		name         string
		extra        []Link
		wantWithA    GuestID // a member of the cluster expected at A's table
		wantNotWithA GuestID
	}{
		{"group 1 beats group 2", []Link{lk(1, 5, Preferred), lk(1, 8, Acceptable)}, 5, 8},
		{"group 2 beats a stranger", []Link{lk(1, 8, Acceptable)}, 8, 5},
		{"group 1 beats a stranger", []Link{lk(1, 11, Preferred)}, 11, 5},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			g := BuildGraph(enabledRange(1, 13), links(base, tc.extra))
			p := Propose(g, emptyPlan(8))
			assertHardRules(t, g, p)
			if !seatedAtSameTable(p, 1, tc.wantWithA) {
				t.Errorf("A should sit with %d: %+v", tc.wantWithA, p.Tables)
			}
			if seatedAtSameTable(p, 1, tc.wantNotWithA) {
				t.Errorf("A should not sit with %d", tc.wantNotWithA)
			}
		})
	}
}

// ---- pins, determinism, expand ---------------------------------------------

func TestProposeKeepsPins(t *testing.T) {
	g := BuildGraph(cat(enabledRange(1, 23), off(24)), chain(5, 6, 24)) // cluster {5,6,24}: 24 is disabled
	tests := []struct {
		name       string
		current    Plan
		wantTable  map[GuestID]int
		wantPinned []GuestID
	}{
		{
			name:       "single guest pinned at table 3",
			current:    Plan{Capacity: 10, Tables: []Table{tbl(1), tbl(2), pinnedTbl(3, []GuestID{9}, 9)}},
			wantTable:  map[GuestID]int{9: 3},
			wantPinned: []GuestID{9},
		},
		{
			name:       "a pin on any member (even disabled) pins the whole cluster",
			current:    Plan{Capacity: 10, Tables: []Table{tbl(1), pinnedTbl(2, []GuestID{24}, 5, 24)}},
			wantTable:  map[GuestID]int{5: 2, 6: 2},
			wantPinned: []GuestID{5, 6},
		},
		{
			name:       "a pin on a table beyond the new table count is released",
			current:    Plan{Capacity: 10, Tables: []Table{tbl(1), tbl(2), tbl(3), tbl(4), pinnedTbl(5, []GuestID{9}, 9)}},
			wantTable:  nil,
			wantPinned: nil,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := Propose(g, tc.current)
			ev := assertHardRules(t, g, p)
			for id, want := range tc.wantTable {
				if got := tableOfGuest(p, id); got != want {
					t.Errorf("guest %d at table %d, want %d", id, got, want)
				}
			}
			var gotPinned []GuestID
			for _, tb := range p.Tables {
				for _, s := range tb.Seats {
					if s.Pinned {
						gotPinned = append(gotPinned, s.Guest)
					}
				}
			}
			if !reflect.DeepEqual(sorted(gotPinned), tc.wantPinned) {
				t.Errorf("pinned seats = %v, want %v", sorted(gotPinned), tc.wantPinned)
			}
			for _, tev := range ev.Tables {
				for _, pl := range tev.Clusters {
					wantPin := false
					for _, w := range tc.wantPinned {
						if w == pl.ClusterKey || (pl.ClusterKey == 5 && w == 6) {
							wantPin = true
						}
					}
					if pl.Pinned != wantPin {
						t.Errorf("placement %+v pinned = %v, want %v", pl, pl.Pinned, wantPin)
					}
				}
			}
		})
	}
}

func TestProposeIgnoresPreviousUnpinnedSeats(t *testing.T) {
	g := BuildGraph(enabledRange(1, 24), nil)
	stale := Plan{Capacity: 10, Tables: []Table{tbl(1, rng(1, 12)...), tbl(2, rng(13, 24)...)}} // overfull, unpinned
	p := Propose(g, stale)
	assertHardRules(t, g, p)
}

func TestProposeDeterministic(t *testing.T) {
	guests, ls := randomInstance(rand.New(rand.NewSource(11)))
	g := BuildGraph(guests, ls)
	want := Propose(g, emptyPlan(10))
	for i := 0; i < 5; i++ {
		if got := Propose(g, emptyPlan(10)); !reflect.DeepEqual(got, want) {
			t.Fatal("same input, different plan")
		}
	}
	// Different input order -> same graph -> same plan.
	r := rand.New(rand.NewSource(5))
	for i := 0; i < 5; i++ {
		gs := append([]Guest(nil), guests...)
		l2 := append([]Link(nil), ls...)
		r.Shuffle(len(gs), func(a, b int) { gs[a], gs[b] = gs[b], gs[a] })
		r.Shuffle(len(l2), func(a, b int) { l2[a], l2[b] = l2[b], l2[a] })
		if got := Propose(BuildGraph(gs, l2), emptyPlan(10)); !reflect.DeepEqual(got, want) {
			t.Fatal("input order changed the plan")
		}
	}
}

func TestExpandDisabled(t *testing.T) {
	// cluster {1,2,3} (3 disabled child), cluster {4,5} fully disabled, single 6.
	g := BuildGraph(cat(on(1, 2), off(3, 4, 5), on(6)), links(chain(1, 2, 3), chain(4, 5)))
	tests := []struct {
		name string
		in   Plan
		want Plan
	}{
		{
			name: "disabled member joins its cluster's table",
			in:   Plan{Capacity: 10, Tables: []Table{tbl(1, 6), tbl(2, 1, 2)}},
			want: Plan{Capacity: 10, Tables: []Table{tbl(1, 6), tbl(2, 1, 2, 3)}},
		},
		{
			name: "pin of the cluster is carried to the added seat",
			in:   Plan{Capacity: 10, Tables: []Table{pinnedTbl(1, []GuestID{1, 2}, 1, 2)}},
			want: Plan{Capacity: 10, Tables: []Table{pinnedTbl(1, []GuestID{1, 2, 3}, 1, 2, 3)}},
		},
		{
			name: "a stray disabled seat at another table is moved to the cluster's table",
			in:   Plan{Capacity: 10, Tables: []Table{tbl(1, 3, 6), tbl(2, 1, 2)}},
			want: Plan{Capacity: 10, Tables: []Table{tbl(1, 6), tbl(2, 1, 2, 3)}},
		},
		{
			name: "idempotent",
			in:   Plan{Capacity: 10, Tables: []Table{tbl(1, 1, 2, 3, 6)}},
			want: Plan{Capacity: 10, Tables: []Table{tbl(1, 1, 2, 3, 6)}},
		},
		{
			name: "a cluster with no enabled member gets no assignment",
			in:   Plan{Capacity: 10, Tables: []Table{tbl(1, 6)}},
			want: Plan{Capacity: 10, Tables: []Table{tbl(1, 6)}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			before := clonePlan(tc.in)
			got := ExpandDisabled(g, tc.in)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %+v, want %+v", got, tc.want)
			}
			if !reflect.DeepEqual(tc.in, before) {
				t.Error("input plan was mutated")
			}
			// Expanding never changes the evaluation (disabled seats are ignored).
			if !reflect.DeepEqual(Evaluate(g, got), Evaluate(g, tc.in)) {
				t.Error("evaluation changed by ExpandDisabled")
			}
		})
	}
}

// ---- generated-input invariants and scale ----------------------------------

// randomInstance: 30..110 guests, clusters of 1..6, random group-1/2 links, ~8% disabled.
func randomInstance(r *rand.Rand) ([]Guest, []Link) {
	n := 30 + r.Intn(81)
	var guests []Guest
	var ls []Link
	next := GuestID(1)
	for int(next) <= n {
		size := 1 + r.Intn(6)
		if int(next)+size-1 > n {
			size = n - int(next) + 1
		}
		first := next
		for i := 0; i < size; i++ {
			guests = append(guests, Guest{ID: next, Enabled: r.Intn(100) >= 8})
			if i > 0 {
				ls = append(ls, lk(first, next, Must))
			}
			next++
		}
	}
	for i := 0; i < n/2; i++ {
		a, b := GuestID(1+r.Intn(n)), GuestID(1+r.Intn(n))
		ls = append(ls, lk(a, b, LinkLevel(1+r.Intn(2))))
	}
	return guests, ls
}

func TestProposeInvariantsOnGeneratedInputs(t *testing.T) {
	verified, skipped, infeasible := 0, 0, 0
	for seed := int64(1); seed <= 60; seed++ {
		r := rand.New(rand.NewSource(seed))
		guests, ls := randomInstance(r)
		g := BuildGraph(guests, ls)
		var sizes []int
		for _, c := range g.Clusters() {
			if c.SeatedSize() > 0 {
				sizes = append(sizes, c.SeatedSize())
			}
		}
		for _, capacity := range []int{8, 10, 12} {
			p := Propose(g, emptyPlan(capacity))
			assertWellFormed(t, g, p)
			ev := Evaluate(g, p)
			wantK := minFeasibleTables(sizes, capacity)
			switch {
			case wantK < 0:
				skipped++
				continue
			case wantK == 0:
				infeasible++ // no k satisfies the floor: only well-formedness is required
				continue
			}
			if len(ev.Violations) != 0 {
				t.Errorf("seed %d cap %d: violations %+v (fills %v), but k=%d is feasible", seed, capacity, ev.Violations, fills(ev), wantK)
				continue
			}
			if len(p.Tables) != wantK {
				t.Errorf("seed %d cap %d: %d tables, minimum feasible is %d", seed, capacity, len(p.Tables), wantK)
			}
			verified++
		}
	}
	t.Logf("verified %d (seed,capacity) cases against the exact oracle; skipped %d (oracle budget), %d infeasible", verified, skipped, infeasible)
	if verified < 100 {
		t.Errorf("only %d cases verified; generator/oracle too weak", verified)
	}
}

func TestProposeScaleHundredGuests(t *testing.T) {
	// ~100 guests: families (clusters) with partner links; all three capacities, deterministic, hard rules hold.
	r := rand.New(rand.NewSource(2026))
	var guests []Guest
	var ls []Link
	next := GuestID(1)
	var firsts []GuestID
	for next <= 100 {
		size := 1 + r.Intn(5)
		first := next
		for i := 0; i < size && next <= 100; i++ {
			guests = append(guests, Guest{ID: next, Enabled: true})
			if i > 0 {
				ls = append(ls, lk(first, next, Must))
			}
			next++
		}
		firsts = append(firsts, first)
	}
	for i := 0; i < 40; i++ {
		a, b := firsts[r.Intn(len(firsts))], firsts[r.Intn(len(firsts))]
		ls = append(ls, lk(a, b, LinkLevel(1+r.Intn(2))))
	}
	g := BuildGraph(guests, ls)
	for _, capacity := range []int{8, 10, 12} {
		p := Propose(g, emptyPlan(capacity))
		ev := assertHardRules(t, g, p)
		if got := Propose(g, emptyPlan(capacity)); !reflect.DeepEqual(got, p) {
			t.Errorf("capacity %d: not deterministic", capacity)
		}
		if want := (100 + capacity - 1) / capacity; len(ev.Tables) < want {
			t.Errorf("capacity %d: %d tables is below the lower bound %d", capacity, len(ev.Tables), want)
		}
	}
}

func TestProposeScoreMatchesEvaluate(t *testing.T) {
	improvedSomewhere := 0
	defer func() {
		if improvedSomewhere == 0 {
			t.Error("improve never raised the score on any generated input; the test would not notice a no-op improve")
		}
	}()
	for seed := int64(1); seed <= 40; seed++ {
		guests, ls := randomInstance(rand.New(rand.NewSource(seed)))
		g := BuildGraph(guests, ls)
		it := newItems(g, 10)
		k := minTables(it.total, 10)
		l := pack(it, k, nil, true)
		if !l.complete() || !repairFloor(l) {
			continue
		}
		before := l.score()
		improve(l, maxPasses)
		if l.score() < before {
			t.Errorf("seed %d: improve lowered the score %d -> %d", seed, before, l.score())
		}
		if l.score() > before {
			improvedSomewhere++
		}
		ev := Evaluate(g, l.toPlan())
		if ev.Summary.Score != float64(l.score()) {
			t.Errorf("seed %d: internal score %d != Evaluate %v", seed, l.score(), ev.Summary.Score)
		}
	}
}

func BenchmarkPropose100(b *testing.B) {
	r := rand.New(rand.NewSource(1))
	var guests []Guest
	var ls []Link
	for next := GuestID(1); next <= 110; {
		size := 1 + r.Intn(5)
		first := next
		for i := 0; i < size && next <= 110; i++ {
			guests = append(guests, Guest{ID: next, Enabled: true})
			if i > 0 {
				ls = append(ls, lk(first, next, Must))
			}
			next++
		}
	}
	for i := 0; i < 55; i++ {
		ls = append(ls, lk(GuestID(1+r.Intn(110)), GuestID(1+r.Intn(110)), LinkLevel(1+r.Intn(2))))
	}
	g := BuildGraph(guests, ls)
	for _, capacity := range []int{8, 10, 12} {
		b.Run(map[int]string{8: "cap8", 10: "cap10", 12: "cap12"}[capacity], func(b *testing.B) {
			for i := 0; i < b.N; i++ {
				Propose(g, emptyPlan(capacity))
			}
		})
	}
}

// ---- exact fallback --------------------------------------------------------

// itemsOfSizes makes one cluster per size (members chained), ids allocated consecutively.
func itemsOfSizes(sizes []int, capacity int) items {
	var guests []Guest
	var ls []Link
	next := GuestID(1)
	for _, s := range sizes {
		first := next
		for i := 0; i < s; i++ {
			guests = append(guests, Guest{ID: next, Enabled: true})
			if i > 0 {
				ls = append(ls, lk(first, next, Must))
			}
			next++
		}
	}
	return newItems(BuildGraph(guests, ls), capacity)
}

func TestPackExact(t *testing.T) {
	t.Run("finds perfect packings that greedy packing misses", func(t *testing.T) {
		for seed := int64(1); seed <= 40; seed++ {
			r := rand.New(rand.NewSource(seed))
			const k, capacity = 6, 12
			var sizes []int
			for tb := 0; tb < k; tb++ { // each table is exactly full
				for left := capacity; left > 0; {
					s := min(left, 1+r.Intn(6))
					sizes = append(sizes, s)
					left -= s
				}
			}
			r.Shuffle(len(sizes), func(a, b int) { sizes[a], sizes[b] = sizes[b], sizes[a] })
			it := itemsOfSizes(sizes, capacity)
			l := packExact(it, k, nil)
			if l == nil || !l.complete() {
				t.Fatalf("seed %d: no perfect packing found for sizes %v", seed, sizes)
			}
			for _, f := range l.fill {
				if f != capacity {
					t.Fatalf("seed %d: fills %v", seed, l.fill)
				}
			}
		}
	})
	t.Run("infeasible cases return nil", func(t *testing.T) {
		tests := []struct {
			name     string
			sizes    []int
			k, c     int
			wantNone bool
		}{
			{"too many seats", []int{5, 5, 5}, 1, 12, true},
			{"four 5s need four tables of 8", []int{5, 5, 5, 5}, 3, 8, true},
			{"floor cannot be met", []int{5, 5}, 2, 10, true},
			{"feasible", []int{5, 1, 5, 1}, 2, 10, false},
		}
		for _, tc := range tests {
			l := packExact(itemsOfSizes(tc.sizes, tc.c), tc.k, nil)
			if (l == nil) != tc.wantNone {
				t.Errorf("%s: nil=%v, want %v", tc.name, l == nil, tc.wantNone)
			}
		}
	})
	t.Run("honours fitting pins and plans the rest around them", func(t *testing.T) {
		it := itemsOfSizes([]int{6, 6, 4, 4}, 10)
		// pin the first 6-cluster to table 1 (0-based): the other 6 must pair with a 4 at table 0, and the 4 joins the pin.
		l := packExact(it, 2, map[int]int{0: 1})
		if l == nil || !l.complete() {
			t.Fatal("no packing")
		}
		if l.assign[0] != 1 || !l.pinned[0] {
			t.Errorf("pin not honoured: %v", l.assign)
		}
		if !reflect.DeepEqual(l.fill, []int{10, 10}) {
			t.Errorf("fills %v", l.fill)
		}
	})
}

func TestProposeToleratesOddInput(t *testing.T) {
	g := BuildGraph(enabledRange(1, 30), clique(Preferred, 1, 2, 3))
	tests := []struct {
		name    string
		current Plan
	}{
		{"zero capacity", Plan{Capacity: 0}},
		{"negative capacity", Plan{Capacity: -3}},
		{"capacity above 12", Plan{Capacity: 20}},
		{"pins on table 0, negative and unknown guests", Plan{Capacity: 10, Tables: []Table{
			{Number: 0, Seats: []Seat{{Guest: 1, Pinned: true}}},
			{Number: -2, Seats: []Seat{{Guest: 2, Pinned: true}, {Guest: 999, Pinned: true}}},
		}}},
		{"every guest pinned to table 1 overfills it: surplus pins are released", Plan{Capacity: 10, Tables: []Table{
			pinnedTbl(1, rng(1, 30), rng(1, 30)...),
		}}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := Propose(g, tc.current) // must not panic
			assertWellFormed(t, g, p)
			if tc.current.Capacity == 10 {
				assertHardRules(t, g, p)
			}
		})
	}
}
