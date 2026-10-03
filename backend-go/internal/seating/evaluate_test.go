package seating

import (
	"reflect"
	"testing"
)

func guestScore(t *testing.T, ev Evaluation, id GuestID) GuestScore {
	t.Helper()
	for _, gs := range ev.GuestScores {
		if gs.Guest == id {
			return gs
		}
	}
	t.Fatalf("no guest score for %d", id)
	return GuestScore{}
}

func codes(vs []Violation) []ViolationCode {
	var out []ViolationCode
	for _, v := range vs {
		out = append(out, v.Code)
	}
	return out
}

func TestEvaluateSatisfaction(t *testing.T) {
	// {1,5} is a cluster. 2 is Preferred with it, 3 Acceptable, 4 a stranger.
	// 6 is a disabled guest linked Preferred to 1 and seated at the same table.
	guests := cat(enabledRange(1, 5), off(6))
	ls := links(chain(1, 5), []Link{lk(1, 2, Preferred), lk(1, 3, Acceptable), lk(1, 6, Preferred)})
	g := BuildGraph(guests, ls)
	plan := Plan{Capacity: 10, Tables: []Table{tbl(1, 1, 2, 3, 4, 5, 6)}}

	ev := Evaluate(g, plan)

	want := map[GuestID]GuestScore{
		// own cluster mate (5) is not counted; 2 -> 1.0, 3 -> 0.5, 4 -> 0.
		1: {Guest: 1, Table: 1, Satisfaction: 1.5, PreferredTotal: 1, PreferredAtTable: 1, FallbackAtTable: 1, StrangersAtTable: 1},
		5: {Guest: 5, Table: 1, Satisfaction: 1.5, PreferredTotal: 1, PreferredAtTable: 1, FallbackAtTable: 1, StrangersAtTable: 1},
		// 2 sits with the whole cluster {1,5} (2 people, 1.0 each).
		2: {Guest: 2, Table: 1, Satisfaction: 2.0, PreferredTotal: 2, PreferredAtTable: 2, FallbackAtTable: 0, StrangersAtTable: 2},
		3: {Guest: 3, Table: 1, Satisfaction: 1.0, PreferredTotal: 0, PreferredAtTable: 0, FallbackAtTable: 2, StrangersAtTable: 2},
		4: {Guest: 4, Table: 1, Satisfaction: 0, PreferredTotal: 0, PreferredAtTable: 0, FallbackAtTable: 0, StrangersAtTable: 4},
	}
	if len(ev.GuestScores) != len(want) {
		t.Fatalf("got %d guest scores, want %d (enabled guests only): %+v", len(ev.GuestScores), len(want), ev.GuestScores)
	}
	for id, w := range want {
		if got := guestScore(t, ev, id); got != w {
			t.Errorf("guest %d score = %+v, want %+v", id, got, w)
		}
	}
	// GuestScores are ordered by guest id.
	for i := 1; i < len(ev.GuestScores); i++ {
		if ev.GuestScores[i-1].Guest >= ev.GuestScores[i].Guest {
			t.Errorf("guest scores not ordered by id: %+v", ev.GuestScores)
		}
	}
	if len(ev.Tables) != 1 || ev.Tables[0].Score != 6.0 || ev.Summary.Score != 6.0 {
		t.Errorf("table/scenario score = %+v / %v, want 6.0", ev.Tables, ev.Summary.Score)
	}
	if ev.Tables[0].Fill != 5 {
		t.Errorf("fill = %d, want 5 (disabled seat ignored)", ev.Tables[0].Fill)
	}
}

func TestEvaluateScoreLevelsOrdering(t *testing.T) {
	// group 1 (1.0) > group 2 (0.5) > only strangers (0 contribution, but the guest has
	// partners and none at the table: isolated, -IsolationPenalty since task 011), for single guests.
	g := BuildGraph(enabledRange(1, 5), []Link{lk(1, 2, Preferred), lk(1, 3, Acceptable)})
	score := func(mate GuestID) float64 {
		return guestScore(t, Evaluate(g, Plan{Capacity: 10, Tables: []Table{tbl(1, 1, mate)}}), 1).Satisfaction
	}
	if p, a, s := score(2), score(3), score(4); !(p > a && a > s) || p != 1.0 || a != 0.5 || s != -IsolationPenalty {
		t.Errorf("preferred/acceptable/stranger-only = %v/%v/%v, want 1.0/0.5/%v", p, a, s, -IsolationPenalty)
	}
	// a stranger next to a partner adds nothing: the contribution of a stranger is still 0.
	ev := Evaluate(g, Plan{Capacity: 10, Tables: []Table{tbl(1, 1, 2, 4)}})
	if got := guestScore(t, ev, 1).Satisfaction; got != 1.0 {
		t.Errorf("guest 1 with a partner and a stranger = %v, want 1.0", got)
	}
}

func TestEvaluatePlacementsAndTableScores(t *testing.T) {
	// Rafał's cluster {1..5} (disabled hub 1), pinned at table 1; singles 6,7 at table 2.
	guests := cat(off(1), enabledRange(2, 7))
	g := BuildGraph(guests, star(1, Must, 2, 3, 4, 5))
	plan := Plan{Capacity: 10, Tables: []Table{
		pinnedTbl(1, []GuestID{3}, 1, 2, 3, 4, 5), // includes the disabled hub's seat
		tbl(2, 6, 7),
	}}
	ev := Evaluate(g, plan)
	want := []Placement{{ClusterKey: 1, Guests: []GuestID{2, 3, 4, 5}, Pinned: true}}
	if !reflect.DeepEqual(ev.Tables[0].Clusters, want) {
		t.Errorf("table 1 clusters = %+v, want %+v", ev.Tables[0].Clusters, want)
	}
	want2 := []Placement{{ClusterKey: 6, Guests: []GuestID{6}}, {ClusterKey: 7, Guests: []GuestID{7}}}
	if !reflect.DeepEqual(ev.Tables[1].Clusters, want2) {
		t.Errorf("table 2 clusters = %+v, want %+v", ev.Tables[1].Clusters, want2)
	}
	if ev.Summary.Seated != 6 || ev.Summary.Unseated != 0 || ev.Summary.TableCount != 2 {
		t.Errorf("summary = %+v", ev.Summary)
	}
}

func TestEvaluateViolations(t *testing.T) {
	tests := []struct {
		name       string
		guests     []Guest
		links      []Link
		plan       Plan
		wantCodes  []ViolationCode
		wantTable  []int
		wantGuests [][]GuestID
	}{
		{
			name:   "clean plan",
			guests: enabledRange(1, 16),
			plan:   Plan{Capacity: 10, Tables: []Table{tbl(1, rng(1, 8)...), tbl(2, rng(9, 16)...)}},
		},
		{
			name:       "re-enabled child at a full table gives 11/10",
			guests:     enabledRange(1, 19), // 1..10 are the family, 11 the re-enabled child (same cluster)
			links:      chain(1, 11),
			plan:       Plan{Capacity: 10, Tables: []Table{tbl(1, rng(1, 11)...), tbl(2, rng(12, 19)...)}},
			wantCodes:  []ViolationCode{ViolOverCapacity},
			wantTable:  []int{1},
			wantGuests: [][]GuestID{rng(1, 11)},
		},
		{
			name:       "under floor with k > 1",
			guests:     enabledRange(1, 15),
			plan:       Plan{Capacity: 10, Tables: []Table{tbl(1, rng(1, 8)...), tbl(2, rng(9, 15)...)}},
			wantCodes:  []ViolationCode{ViolUnderFloor},
			wantTable:  []int{2},
			wantGuests: [][]GuestID{rng(9, 15)},
		},
		{
			name:   "7 guests with k = 1 is no violation (floor waived)",
			guests: enabledRange(1, 7),
			plan:   Plan{Capacity: 10, Tables: []Table{tbl(1, rng(1, 7)...)}},
		},
		{
			name:       "an empty extra table is under the floor",
			guests:     enabledRange(1, 8),
			plan:       Plan{Capacity: 10, Tables: []Table{tbl(1, rng(1, 8)...), tbl(2)}},
			wantCodes:  []ViolationCode{ViolUnderFloor},
			wantTable:  []int{2},
			wantGuests: [][]GuestID{nil},
		},
		{
			name:       "cluster split over two tables",
			guests:     enabledRange(1, 16),
			links:      chain(1, 9),
			plan:       Plan{Capacity: 10, Tables: []Table{tbl(1, rng(1, 8)...), tbl(2, rng(9, 16)...)}},
			wantCodes:  []ViolationCode{ViolClusterSplit},
			wantTable:  []int{0},
			wantGuests: [][]GuestID{{1, 9}},
		},
		{
			name:       "unseated guests",
			guests:     enabledRange(1, 8),
			plan:       Plan{Capacity: 10, Tables: []Table{tbl(1, rng(1, 6)...)}},
			wantCodes:  []ViolationCode{ViolUnseated},
			wantTable:  []int{0},
			wantGuests: [][]GuestID{{7, 8}},
		},
		{
			name:       "no tables at all: everybody unseated",
			guests:     enabledRange(1, 3),
			plan:       Plan{Capacity: 9},
			wantCodes:  []ViolationCode{ViolUnseated},
			wantTable:  []int{0},
			wantGuests: [][]GuestID{{1, 2, 3}},
		},
		{
			name:       "oversized cluster (10 > 9) left unseated",
			guests:     enabledRange(1, 16),
			links:      chain(rng(1, 10)...),
			plan:       Plan{Capacity: 9, Tables: []Table{tbl(1, rng(11, 16)...)}},
			wantCodes:  []ViolationCode{ViolOversizedCluster, ViolUnseated},
			wantTable:  []int{0, 0},
			wantGuests: [][]GuestID{rng(1, 10), rng(1, 10)},
		},
		{
			name:   "disabled guests' seats are ignored everywhere",
			guests: cat(enabledRange(1, 8), off(9, 10, 11, 12, 13, 14)),
			plan:   Plan{Capacity: 9, Tables: []Table{tbl(1, rng(1, 14)...), tbl(2, 9, 10)}},
			// table 1 has 8 enabled (14 seats), table 2 has 0 enabled seats -> under floor; no over_capacity.
			wantCodes:  []ViolationCode{ViolUnderFloor},
			wantTable:  []int{2},
			wantGuests: [][]GuestID{nil},
		},
		{
			name:       "a guest listed at two tables counts once (first seat wins)",
			guests:     enabledRange(1, 16),
			plan:       Plan{Capacity: 10, Tables: []Table{tbl(1, rng(1, 8)...), tbl(2, append(rng(9, 16), 1)...)}},
			wantCodes:  nil,
			wantTable:  nil,
			wantGuests: nil,
		},
		{
			name:       "violations are ordered: tables, then clusters, then unseated",
			guests:     enabledRange(1, 22),
			links:      chain(1, 20),
			plan:       Plan{Capacity: 10, Tables: []Table{tbl(1, rng(1, 11)...), tbl(2, rng(12, 19)...), tbl(3, 20, 21)}},
			wantCodes:  []ViolationCode{ViolOverCapacity, ViolUnderFloor, ViolClusterSplit, ViolUnseated},
			wantTable:  []int{1, 3, 0, 0},
			wantGuests: [][]GuestID{rng(1, 11), {20, 21}, {1, 20}, {22}},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ev := Evaluate(BuildGraph(tc.guests, tc.links), tc.plan)
			if got := codes(ev.Violations); !reflect.DeepEqual(got, tc.wantCodes) {
				t.Fatalf("violation codes = %v, want %v (%+v)", got, tc.wantCodes, ev.Violations)
			}
			for i, v := range ev.Violations {
				if v.Table != tc.wantTable[i] {
					t.Errorf("violation %d (%s) table = %d, want %d", i, v.Code, v.Table, tc.wantTable[i])
				}
				if !reflect.DeepEqual(v.Guests, tc.wantGuests[i]) {
					t.Errorf("violation %d (%s) guests = %v, want %v", i, v.Code, v.Guests, tc.wantGuests[i])
				}
			}
			if ev.Summary.ViolationCount != len(ev.Violations) {
				t.Errorf("ViolationCount = %d, want %d", ev.Summary.ViolationCount, len(ev.Violations))
			}
			if ev.Summary.NeedsRecalculation != (len(ev.Violations) > 0) {
				t.Errorf("NeedsRecalculation = %v with %d violations", ev.Summary.NeedsRecalculation, len(ev.Violations))
			}
		})
	}
}

func TestEvaluateUnseatedPlacements(t *testing.T) {
	// Zosia (3) is a re-enabled child of cluster {1,3} that has no assignment; 2 is a single.
	g := BuildGraph(cat(enabledRange(1, 3), off(4)), chain(1, 3))
	ev := Evaluate(g, Plan{Capacity: 10, Tables: []Table{tbl(1, 1)}})
	want := []Placement{{ClusterKey: 1, Guests: []GuestID{3}}, {ClusterKey: 2, Guests: []GuestID{2}}}
	if !reflect.DeepEqual(ev.Unseated, want) {
		t.Errorf("unseated = %+v, want %+v", ev.Unseated, want)
	}
	if ev.Summary.Seated != 1 || ev.Summary.Unseated != 2 {
		t.Errorf("summary = %+v", ev.Summary)
	}
	gs := guestScore(t, ev, 3)
	if gs.Table != 0 || gs.Satisfaction != 0 {
		t.Errorf("unseated guest score = %+v, want table 0 / satisfaction 0", gs)
	}
	if !ev.Summary.NeedsRecalculation {
		t.Error("an unseated guest must flag NeedsRecalculation")
	}
}

func TestEvaluateIsPure(t *testing.T) {
	g := BuildGraph(enabledRange(1, 16), []Link{lk(1, 2, Preferred)})
	p := Plan{Capacity: 10, Tables: []Table{tbl(1, rng(1, 8)...), tbl(2, rng(9, 16)...)}}
	a, b := Evaluate(g, p), Evaluate(g, p)
	if !reflect.DeepEqual(a, b) {
		t.Error("Evaluate is not deterministic")
	}
}
