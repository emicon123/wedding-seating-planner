package seating

import (
	"math/rand"
	"reflect"
	"testing"
)

// Tests of task 014 (children take seats but are not scored); design
// 003-backend-design §10.5 and 03-seating-model § Children, examples D-H.

// kids returns a copy of gs with the given ids marked as children.
func kids(gs []Guest, ids ...GuestID) []Guest {
	out := append([]Guest(nil), gs...)
	for i := range out {
		for _, id := range ids {
			if out[i].ID == id {
				out[i].Child = true
			}
		}
	}
	return out
}

func zeroScore(id GuestID, table int) GuestScore { return GuestScore{Guest: id, Table: table} }

// ---- graph -----------------------------------------------------------------

func TestClusterAdults(t *testing.T) {
	// cluster {1,2,3,4}: 1 adult, 2 enabled child, 3 disabled child, 4 disabled adult.
	guests := cat(kids(on(1, 2), 2), kids(off(3), 3), off(4))
	g := BuildGraph(guests, chain(1, 2, 3, 4))
	c, _ := g.ClusterOf(1)
	if c.SeatedSize() != 2 || c.AdultSize() != 1 || !reflect.DeepEqual(c.Adults, []GuestID{1}) || !reflect.DeepEqual(c.Enabled, []GuestID{1, 2}) {
		t.Errorf("cluster = %+v, want 2 seats, adults [1]", c)
	}
	// no children anywhere: Adults == Enabled
	g = BuildGraph(on(1, 2, 3), chain(1, 2))
	for _, c := range g.Clusters() {
		if !reflect.DeepEqual(c.Adults, c.Enabled) {
			t.Errorf("without children Adults %v != Enabled %v", c.Adults, c.Enabled)
		}
	}
}

func TestPartnersAndPreferredTotalsCountAdults(t *testing.T) {
	// 1 -1- cluster {2,3} of children only; 4 -1- cluster {5,6} (5 adult, 6 child).
	guests := kids(on(1, 2, 3, 4, 5, 6), 2, 3, 6)
	g := BuildGraph(guests, links(chain(2, 3), chain(5, 6), []Link{lk(1, 2, Preferred), lk(4, 5, Preferred)}))
	partners := g.hasPartners()
	if partners[1] || partners[2] {
		t.Errorf("a children-only partner is no partner and a children-only cluster has none: %v", partners)
	}
	if !partners[4] || !partners[5] {
		t.Errorf("4 and 5 are adult partners of each other: %v", partners)
	}
	pt := g.preferredTotals()
	if pt[4] != 1 || pt[5] != 1 || pt[1] != 0 {
		t.Errorf("preferredTotals = %v, want 4 and 5 -> 1 (adults), 1 -> 0", pt)
	}
}

// ---- Evaluate (C1-C7) ------------------------------------------------------

func TestEvaluateChildrenC1FamilyWithChildren(t *testing.T) {
	// K = {1..5}: adults 1, 2; children 3, 4, 5. F = {6, 7} adults. K -1- F.
	g := BuildGraph(kids(enabledRange(1, 7), 3, 4, 5), links(chain(1, 2, 3, 4, 5), chain(6, 7), []Link{lk(1, 6, Preferred)}))
	ev := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 3, 4, 5, 6, 7)}})
	for _, id := range []GuestID{1, 2} {
		want := GuestScore{Guest: id, Table: 1, Satisfaction: 2, PreferredTotal: 2, PreferredAtTable: 2}
		if got := guestScore(t, ev, id); got != want {
			t.Errorf("adult %d = %+v, want %+v", id, got, want)
		}
	}
	for _, id := range []GuestID{6, 7} {
		want := GuestScore{Guest: id, Table: 1, Satisfaction: 2, PreferredTotal: 2, PreferredAtTable: 2}
		if got := guestScore(t, ev, id); got != want {
			t.Errorf("adult %d = %+v, want %+v", id, got, want)
		}
	}
	for _, id := range []GuestID{3, 4, 5} {
		if got := guestScore(t, ev, id); got != zeroScore(id, 1) {
			t.Errorf("child %d = %+v, want all zeros at table 1", id, got)
		}
	}
	if ev.Tables[0].Score != 8 || ev.Summary.Score != 8 || ev.Tables[0].Fill != 7 || ev.Summary.Isolated != 0 {
		t.Errorf("table %v summary %+v, want score 8, fill 7, 0 isolated", ev.Tables[0], ev.Summary)
	}
}

func TestEvaluateChildrenC2StrangersAreAdultsOnly(t *testing.T) {
	// 1 -1- 2; stranger family {3..6} with one adult (3) and three children.
	g := BuildGraph(kids(enabledRange(1, 6), 4, 5, 6), links(chain(3, 4, 5, 6), []Link{lk(1, 2, Preferred)}))
	ev := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 3, 4, 5, 6)}})
	want := GuestScore{Guest: 1, Table: 1, Satisfaction: 1, PreferredTotal: 1, PreferredAtTable: 1, StrangersAtTable: 1}
	if got := guestScore(t, ev, 1); got != want {
		t.Errorf("guest 1 = %+v, want %+v (the three children are not strangers)", got, want)
	}
	if got := guestScore(t, ev, 3); got.StrangersAtTable != 2 || got.Satisfaction != 0 {
		t.Errorf("guest 3 = %+v, want 2 adult strangers", got)
	}
}

func TestEvaluateChildrenC3PartnerOfOnlyChildren(t *testing.T) {
	// Example E: T = {3 (disabled), 4, 5 children}; E = {1, 2} adults, E -1- Tomek (3).
	guests := cat(on(1, 2), off(3), kids(on(4, 5), 4, 5), enabledRange(6, 12))
	g := BuildGraph(guests, links(chain(1, 2), chain(3, 4, 5), []Link{lk(1, 3, Preferred)}))
	ev := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 6, 7, 8, 9, 10, 11), tbl(2, 4, 5, 12)}})
	for _, id := range []GuestID{1, 2} {
		want := GuestScore{Guest: id, Table: 1, StrangersAtTable: 6}
		if got := guestScore(t, ev, id); got != want {
			t.Errorf("E adult %d = %+v, want %+v (no partners: not isolated, 0, preferredTotal 0)", id, got, want)
		}
	}
	for _, id := range []GuestID{4, 5} {
		if got := guestScore(t, ev, id); got != zeroScore(id, 2) {
			t.Errorf("T child %d = %+v, want all zeros", id, got)
		}
	}
	if ev.Summary.Isolated != 0 || ev.Summary.Score != 0 {
		t.Errorf("summary %+v, want 0 isolated, score 0", ev.Summary)
	}
	// Sitting together adds nothing either.
	ev = Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 4, 5, 6, 7, 8, 9), tbl(2, 10, 11, 12)}})
	if ev.Summary.Score != 0 || guestScore(t, ev, 1).Satisfaction != 0 {
		t.Errorf("E next to its children-only partner: score %v, want 0", ev.Summary.Score)
	}
}

func TestEvaluateChildrenC4ChildrenOnlyCluster(t *testing.T) {
	// {1, 2} children only, 3 -1- 4 together at the table, 5 a stranger.
	g := BuildGraph(kids(enabledRange(1, 5), 1, 2), links(chain(1, 2), []Link{lk(3, 4, Preferred)}))
	plain := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, 3, 4, 5)}})
	ev := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 3, 4, 5)}})
	if ev.Tables[0].Fill != 5 || ev.Summary.Seated != 5 {
		t.Errorf("fill %d seated %d, want 5 (children take seats)", ev.Tables[0].Fill, ev.Summary.Seated)
	}
	for _, id := range []GuestID{1, 2} {
		if got := guestScore(t, ev, id); got != zeroScore(id, 1) {
			t.Errorf("child %d = %+v, want zeros", id, got)
		}
	}
	if ev.Summary.Score != plain.Summary.Score || ev.Summary.Isolated != plain.Summary.Isolated {
		t.Errorf("score/isolated %v/%d with the children-only cluster, %v/%d without", ev.Summary.Score, ev.Summary.Isolated, plain.Summary.Score, plain.Summary.Isolated)
	}
	if got := guestScore(t, ev, 3); got.StrangersAtTable != 1 || got.Satisfaction != 1 {
		t.Errorf("guest 3 = %+v, want the children as nobody (strangers 1 = guest 5)", got)
	}
}

func TestEvaluateChildrenC5IsolatedFamily(t *testing.T) {
	// K = {1..5}: adults 1, 2; P = {6} adult; K -1- P at different tables.
	g := BuildGraph(kids(enabledRange(1, 8), 3, 4, 5), links(chain(1, 2, 3, 4, 5), []Link{lk(1, 6, Preferred)}))
	ev := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, 1, 2, 3, 4, 5, 7), tbl(2, 6, 8)}})
	if ev.Summary.Isolated != 3 { // K's two adults + P
		t.Errorf("isolated %d, want 3 (2 adults of K and P; K's children are not isolated)", ev.Summary.Isolated)
	}
	if ev.Tables[0].Score != -2 || ev.Tables[1].Score != -1 || ev.Summary.Score != -3 {
		t.Errorf("table scores %v / %v, summary %v, want -2 / -1 / -3", ev.Tables[0].Score, ev.Tables[1].Score, ev.Summary.Score)
	}
	for _, id := range []GuestID{1, 2} {
		if gs := guestScore(t, ev, id); !gs.Isolated || gs.Satisfaction != -1 {
			t.Errorf("adult %d = %+v, want isolated, -1", id, gs)
		}
	}
	for _, id := range []GuestID{3, 4, 5} {
		if got := guestScore(t, ev, id); got != zeroScore(id, 1) {
			t.Errorf("child %d = %+v, want zeros, not isolated", id, got)
		}
	}
}

func TestEvaluateChildrenC6FlagsNeverChangeSeats(t *testing.T) {
	for seed := int64(1); seed <= 12; seed++ {
		r := rand.New(rand.NewSource(seed))
		guests, ls := randomInstance(r)
		plain := BuildGraph(guests, ls)
		var flagged []Guest
		for _, gu := range guests {
			gu.Child = r.Intn(3) == 0
			flagged = append(flagged, gu)
		}
		withKids := BuildGraph(flagged, ls)
		for _, capacity := range []int{9, 12} {
			p := Propose(plain, emptyPlan(capacity))
			// unseat a few guests so unseated_guests is exercised too
			if len(p.Tables) > 0 && len(p.Tables[0].Seats) > 2 {
				p.Tables[0].Seats = p.Tables[0].Seats[2:]
			}
			a, b := Evaluate(plain, p), Evaluate(withKids, p)
			if !reflect.DeepEqual(a.Violations, b.Violations) || !reflect.DeepEqual(a.Unseated, b.Unseated) ||
				a.Summary.NeedsRecalculation != b.Summary.NeedsRecalculation || a.Summary.Seated != b.Summary.Seated ||
				a.Summary.Unseated != b.Summary.Unseated || a.Summary.ViolationCount != b.Summary.ViolationCount {
				t.Fatalf("seed %d cap %d: violations/unseated/seated differ with child flags", seed, capacity)
			}
			for i := range a.Tables {
				if a.Tables[i].Fill != b.Tables[i].Fill || !reflect.DeepEqual(a.Tables[i].Clusters, b.Tables[i].Clusters) {
					t.Fatalf("seed %d cap %d table %d: fill/placements differ with child flags", seed, capacity, i+1)
				}
			}
			if len(a.GuestScores) != len(b.GuestScores) {
				t.Fatalf("seed %d: guest score counts differ", seed)
			}
			for i, gs := range b.GuestScores {
				if withKids.child[gs.Guest] && (gs != GuestScore{Guest: gs.Guest, Table: a.GuestScores[i].Table}) {
					t.Fatalf("seed %d: child %d has a non-zero score %+v", seed, gs.Guest, gs)
				}
			}
		}
	}
}

func TestEvaluateChildrenC7UnseatedChild(t *testing.T) {
	g := BuildGraph(kids(enabledRange(1, 4), 2), cat2(chain(1, 2), []Link{lk(1, 3, Preferred)}))
	ev := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, 3, 4)}})
	if got := guestScore(t, ev, 2); got != (GuestScore{Guest: 2}) {
		t.Errorf("unseated child = %+v, want zeros, table 0", got)
	}
	if got := guestScore(t, ev, 1); got != (GuestScore{Guest: 1, PreferredTotal: 1}) {
		t.Errorf("unseated adult = %+v, want PreferredTotal 1 only", got)
	}
	if !ev.Summary.NeedsRecalculation || ev.Summary.Unseated != 2 {
		t.Errorf("summary %+v, want 2 unseated and needsRecalculation", ev.Summary)
	}
}

func cat2(a, b []Link) []Link { return links(a, b) }

func TestEvaluateChildrenFillAndFloorUnchanged(t *testing.T) { // example G
	adults := func(lo, hi GuestID) []GuestID { return rng(lo, hi) }
	cases := []struct {
		name         string
		a, c         int // adults and children at table 1
		wantFill     int
		wantViolCode ViolationCode
	}{
		{"5 adults + 3 children meet the floor", 5, 3, 8, ""},
		{"5 adults + 2 children are under the floor", 5, 2, 7, ViolUnderFloor},
		{"10 adults + 3 children are over capacity", 10, 3, 13, ViolOverCapacity},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// table 1: ids 1..a adults then a+1..a+c children; table 2: eight adults
			all := enabledRange(1, GuestID(tc.a+tc.c+8))
			g := BuildGraph(kids(all, rng(GuestID(tc.a+1), GuestID(tc.a+tc.c))...), nil)
			t1 := append(adults(1, GuestID(tc.a)), rng(GuestID(tc.a+1), GuestID(tc.a+tc.c))...)
			ev := Evaluate(g, Plan{Capacity: 12, Tables: []Table{tbl(1, t1...), tbl(2, rng(GuestID(tc.a+tc.c+1), GuestID(tc.a+tc.c+8))...)}})
			if ev.Tables[0].Fill != tc.wantFill {
				t.Errorf("fill %d, want %d", ev.Tables[0].Fill, tc.wantFill)
			}
			var got ViolationCode
			if len(ev.Violations) > 0 {
				got = ev.Violations[0].Code
			}
			if got != tc.wantViolCode || len(ev.Violations) > 1 {
				t.Errorf("violations %+v, want %q only", ev.Violations, tc.wantViolCode)
			}
		})
	}
}

// ---- delta rules (D10-D13) -------------------------------------------------

func TestChildrenDeltasHandBuilt(t *testing.T) {
	t.Run("D10 moving a children-only item changes nothing", func(t *testing.T) {
		// 1,2 children only; 3 -1- 4; 5 stranger.
		g := BuildGraph(kids(enabledRange(1, 5), 1, 2), links(chain(1, 2), []Link{lk(3, 4, Preferred), lk(1, 3, Preferred)}))
		l := isoLayout(g, 12, 2, map[GuestID]int{1: 0, 3: 0, 4: 1, 5: 1})
		if d := checkMoveDelta(t, l, l.it.idx[1], 1); d != (delta{}) {
			t.Errorf("delta = %+v, want (0, 0)", d)
		}
		if len(l.it.nbr[l.it.idx[1]]) != 0 || l.it.hasPartner[l.it.idx[1]] || l.it.adults[l.it.idx[1]] != 0 {
			t.Errorf("a children-only item must have weight 0, no neighbours, no partner")
		}
	})
	t.Run("D11 isolated family moves to its partner", func(t *testing.T) {
		// K = {1..5}: adults 1, 2; P = {6}; K -1- P; K at table 0 with 7, P at table 1.
		g := BuildGraph(kids(enabledRange(1, 7), 3, 4, 5), links(chain(1, 2, 3, 4, 5), []Link{lk(1, 6, Preferred)}))
		l := isoLayout(g, 12, 2, map[GuestID]int{1: 0, 7: 0, 6: 1})
		d := checkMoveDelta(t, l, l.it.idx[1], 1)
		// K stops being isolated (-2 adults); P was isolated (1), now not (-1); pair 2*2*1 = 4
		if d.iso != -3 || d.score != 4+3 {
			t.Errorf("delta = %+v, want iso -3, score +7", d)
		}
	})
	t.Run("D12 a partner [4/1] leaves c's table", func(t *testing.T) {
		// c = {1,2}; partner {3..6} with 1 adult; both at table 0, then the partner leaves.
		g := BuildGraph(kids(enabledRange(1, 7), 4, 5, 6), links(chain(1, 2), chain(3, 4, 5, 6), []Link{lk(1, 3, Preferred)}))
		l := isoLayout(g, 12, 2, map[GuestID]int{1: 0, 3: 0, 7: 1})
		d := checkMoveDelta(t, l, l.it.idx[3], 1)
		if d.iso != 3 { // c's two adults + the partner's adult
			t.Errorf("delta = %+v, want iso +3 (adults[c] 2 + adults[partner] 1)", d)
		}
	})
	t.Run("D13 swap with a children-only item", func(t *testing.T) {
		// X = {1,2} children only; a = 3 -1- b = 4; table 0: X, 3; table 1: 4, 5.
		g := BuildGraph(kids(enabledRange(1, 5), 1, 2), links(chain(1, 2), []Link{lk(3, 4, Preferred)}))
		l := isoLayout(g, 12, 2, map[GuestID]int{1: 0, 3: 0, 4: 1, 5: 1})
		x, a, b := l.it.idx[1], l.it.idx[3], l.it.idx[4]
		if d := checkSwapDelta(t, l, x, b); d.iso != -2 { // X <-> 4: 4 joins 3, both stop being isolated
			t.Errorf("swap X<->b delta = %+v, want iso -2", d)
		}
		checkSwapDelta(t, l, x, a)
	})
}

// childInstance is randomInstance with ~25% of the guests flagged as children, one
// cluster made children-only and a partner link into it.
func childInstance(r *rand.Rand) ([]Guest, []Link) {
	guests, ls := randomInstance(r)
	for i := range guests {
		guests[i].Child = r.Intn(4) == 0
	}
	g := BuildGraph(guests, ls)
	cl := g.Clusters()
	only := cl[r.Intn(len(cl))]
	for i := range guests {
		for _, m := range only.Members {
			if guests[i].ID == m {
				guests[i].Child = true
			}
		}
	}
	other := cl[r.Intn(len(cl))].Key
	if other != only.Key {
		ls = append(ls, lk(only.Key, other, Preferred))
	}
	return guests, ls
}

func TestObjectiveDeltasMatchRecomputeWithChildren(t *testing.T) {
	isolatedSeen, childOnly := 0, 0
	for seed := int64(1); seed <= 45; seed++ {
		r := rand.New(rand.NewSource(seed))
		guests, ls := childInstance(r)
		g := BuildGraph(guests, ls)
		capacity := []int{9, 10, 11, 12}[seed%4]
		it := newItems(g, capacity)
		for a := range it.adults {
			if it.adults[a] == 0 {
				childOnly++
			}
			if it.adults[a] > it.size[a] || (it.adults[a] == 0 && (len(it.nbr[a]) > 0 || it.hasPartner[a])) {
				t.Fatalf("seed %d item %d: adults %d size %d nbr %v partner %v", seed, a, it.adults[a], it.size[a], it.nbr[a], it.hasPartner[a])
			}
		}
		k := max(2, minTables(it.total, capacity))
		l := pack(it, k, nil, seed%2 == 0)
		for a := range l.assign {
			if l.assign[a] < 0 {
				l.place(a, r.Intn(k))
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
				if ev.Summary.Score != float64(o.score) || ev.Summary.Isolated != o.iso {
					t.Fatalf("seed %d: Evaluate score/isolated %v/%d, objective %+v", seed, ev.Summary.Score, ev.Summary.Isolated, o)
				}
			}
		}
	}
	if isolatedSeen == 0 || childOnly == 0 {
		t.Errorf("isolatedSeen %d, children-only items %d: the property test would not notice wrong weights", isolatedSeen, childOnly)
	}
}

// ---- Propose (examples D, E/F, H) -------------------------------------------

func pinnedPlan(capacity int, tables ...Table) Plan { return Plan{Capacity: capacity, Tables: tables} }

func TestProposeChildrenExampleD(t *testing.T) {
	// F = {1,2}; K = {3..7}: adults 3, 4, children 5, 6, 7; L = {8,9,10}; 10 strangers 11..20.
	// F -1- K, F -1- L. K pinned to table 1, L to table 2: F joins L (K weighs 2, not 5).
	guests := kids(enabledRange(1, 20), 5, 6, 7)
	ls := links(chain(1, 2), chain(3, 4, 5, 6, 7), chain(8, 9, 10), []Link{lk(1, 3, Preferred), lk(1, 8, Preferred)})
	g := BuildGraph(guests, ls)
	cur := pinnedPlan(12, pinnedTbl(1, rng(3, 7), rng(3, 7)...), pinnedTbl(2, rng(8, 10), rng(8, 10)...))
	p := Propose(g, cur)
	ev := assertHardRules(t, g, p)
	if len(p.Tables) != 2 {
		t.Fatalf("%d tables, want 2", len(p.Tables))
	}
	if !seatedAtSameTable(p, 1, 8) || seatedAtSameTable(p, 1, 3) {
		t.Errorf("F must sit with L (tables: F %d, K %d, L %d)", tableOfGuest(p, 1), tableOfGuest(p, 3), tableOfGuest(p, 8))
	}
	if ev.Summary.Isolated != 2 || ev.Summary.Score != 10 {
		t.Errorf("isolated %d score %v, want 2 and 10 (12 - 2)", ev.Summary.Isolated, ev.Summary.Score)
	}
	if again := Propose(g, cur); !reflect.DeepEqual(again, p) {
		t.Error("Propose is not deterministic with children")
	}
}

func TestProposeChildrenExampleEF(t *testing.T) {
	// Tomek (1, disabled) with children 2, 3 (enabled): T. E = {4, 5} -1- Tomek. 16 strangers.
	guests := cat(off(1), kids(on(2, 3), 2, 3), enabledRange(4, 21))
	g := BuildGraph(guests, links(chain(1, 2, 3), chain(4, 5), []Link{lk(4, 1, Preferred)}))
	for _, capacity := range []int{10, 12} {
		p := Propose(g, emptyPlan(capacity))
		ev := assertHardRules(t, g, p)
		if tableOfGuest(p, 2) == 0 || tableOfGuest(p, 2) != tableOfGuest(p, 3) {
			t.Errorf("cap %d: the children-only cluster must be seated together: %v %v", capacity, tableOfGuest(p, 2), tableOfGuest(p, 3))
		}
		for _, f := range fills(ev) {
			if f < Floor || f > capacity {
				t.Errorf("cap %d: fills %v outside [8, %d]", capacity, fills(ev), capacity)
			}
		}
		for _, id := range []GuestID{2, 3} {
			if got := guestScore(t, ev, id); got != zeroScore(id, tableOfGuest(p, id)) {
				t.Errorf("child %d = %+v, want zeros", id, got)
			}
		}
		for _, id := range []GuestID{4, 5} {
			if gs := guestScore(t, ev, id); gs.Isolated || gs.Satisfaction != 0 {
				t.Errorf("E adult %d = %+v, want never isolated, 0", id, gs)
			}
		}
		if ev.Summary.Isolated != 0 || ev.Summary.Score != 0 {
			t.Errorf("cap %d: isolated %d score %v, want 0 / 0", capacity, ev.Summary.Isolated, ev.Summary.Score)
		}
	}
}

// exampleH: example C with M = {1,2,3} having one adult (1) and two children, P[5], strangers [6] [2] [5] [3].
// With dropAdult the adult of M is disabled and M gets a fourth (disabled) member so N stays 24.
func exampleH(dropAdult bool) Graph {
	guests, ls, f := clustersOfSizes(3, 5, 6, 2, 5, 3)
	ls = append(ls, lk(f[0], f[1], Preferred))
	guests = kids(guests, 2, 3)
	if dropAdult {
		guests[0].Enabled = false
		guests = append(guests, Guest{ID: 100, Enabled: true, Child: true}) // keeps 3 children seated: N = 24 - 1 + 1
		ls = append(ls, lk(1, 100, Must))
	}
	return BuildGraph(guests, ls)
}

func TestProposeChildrenExampleHMixed(t *testing.T) {
	t.Run("one adult and two children: isolation counts adults, still three tables", func(t *testing.T) {
		g := exampleH(false)
		uni := Propose(g, emptyPlan(12))
		uev := assertHardRules(t, g, uni)
		if len(uni.Tables) != 2 || uev.Summary.Isolated != 6 { // M's adult 1 + P's 5 adults (was 8)
			t.Errorf("plan 12: %d tables, %d isolated, want 2 and 6", len(uni.Tables), uev.Summary.Isolated)
		}
		p := Propose(g, mixedPlan())
		ev := assertHardRules(t, g, p)
		if len(p.Tables) != 3 || ev.Summary.Isolated != 0 || !seatedAtSameTable(p, 1, 4) {
			t.Errorf("mixed: %d tables, %d isolated, want 3 and 0 with M next to P (fills %v)", len(p.Tables), ev.Summary.Isolated, fills(ev))
		}
	})
	t.Run("M has no adult enabled: nobody is isolated, the mixed plan keeps two tables", func(t *testing.T) {
		g := exampleH(true)
		p := Propose(g, mixedPlan())
		ev := assertHardRules(t, g, p)
		if len(p.Tables) != 2 || ev.Summary.Isolated != 0 {
			t.Errorf("mixed: %d tables, %d isolated, want 2 and 0 (M has no adult, so P has no partner)", len(p.Tables), ev.Summary.Isolated)
		}
		if again := Propose(g, mixedPlan()); !reflect.DeepEqual(again, p) {
			t.Error("not deterministic")
		}
	})
}

func TestProposeChildrenInvariantsOnGeneratedInputs(t *testing.T) {
	verified := 0
	for seed := int64(1); seed <= 12; seed++ {
		r := rand.New(rand.NewSource(seed))
		guests, ls := childInstance(r)
		g := BuildGraph(guests, ls)
		var sizes []int
		for _, c := range g.Clusters() {
			if c.SeatedSize() > 0 {
				sizes = append(sizes, c.SeatedSize())
			}
		}
		for _, capacity := range []int{9, 12} {
			p := Propose(g, emptyPlan(capacity))
			assertWellFormed(t, g, p)
			ev := Evaluate(g, p)
			wantK := minFeasibleTables(sizes, capacity)
			if wantK <= 0 {
				continue
			}
			if len(ev.Violations) != 0 || len(p.Tables) != wantK {
				t.Errorf("seed %d cap %d: %d tables (want %d), violations %+v", seed, capacity, len(p.Tables), wantK, ev.Violations)
			}
			for _, gs := range ev.GuestScores {
				if g.child[gs.Guest] && (gs.Satisfaction != 0 || gs.Isolated || gs.PreferredAtTable != 0 || gs.StrangersAtTable != 0) {
					t.Fatalf("child %d scored: %+v", gs.Guest, gs)
				}
			}
			verified++
		}
	}
	if verified < 10 {
		t.Errorf("only %d cases verified", verified)
	}
}
