package seating

import (
	"math/rand"
	"reflect"
	"testing"
)

func clusterByKey(t *testing.T, g Graph, key GuestID) Cluster {
	t.Helper()
	for _, c := range g.Clusters() {
		if c.Key == key {
			return c
		}
	}
	t.Fatalf("no cluster with key %d in %+v", key, g.Clusters())
	return Cluster{}
}

func TestWeight(t *testing.T) {
	tests := []struct {
		level LinkLevel
		want  float64
	}{
		{Must, 0}, {Preferred, 1.0}, {Acceptable, 0.5}, {LinkLevel(7), 0},
	}
	for _, tc := range tests {
		if got := Weight(tc.level); got != tc.want {
			t.Errorf("Weight(%d) = %v, want %v", tc.level, got, tc.want)
		}
	}
}

func TestBuildGraphClusters(t *testing.T) {
	rafal := star(1, Must, 2, 3, 4, 5) // Rafał(1) lists wife, mother-in-law, ...
	tests := []struct {
		name         string
		guests       []Guest
		links        []Link
		wantClusters [][2][]GuestID // per cluster: {members, enabled}
		wantKeys     []GuestID
		wantSeated   []int
	}{
		{
			name:         "Rafał group-0 cluster of five",
			guests:       enabledRange(1, 5),
			links:        rafal,
			wantKeys:     []GuestID{1},
			wantClusters: [][2][]GuestID{{rng(1, 5), rng(1, 5)}},
			wantSeated:   []int{5},
		},
		{
			name:         "disabling the hub keeps one cluster of 4 enabled (user-confirmed)",
			guests:       cat(off(1), enabledRange(2, 5)),
			links:        rafal,
			wantKeys:     []GuestID{1},
			wantClusters: [][2][]GuestID{{rng(1, 5), rng(2, 5)}},
			wantSeated:   []int{4},
		},
		{
			name:         "guests without group-0 links are clusters of one",
			guests:       enabledRange(1, 3),
			wantKeys:     []GuestID{1, 2, 3},
			wantClusters: [][2][]GuestID{{{1}, {1}}, {{2}, {2}}, {{3}, {3}}},
			wantSeated:   []int{1, 1, 1},
		},
		{
			name:         "key is the smallest member id, chains connect transitively",
			guests:       enabledRange(1, 6),
			links:        chain(6, 4, 2),
			wantKeys:     []GuestID{1, 2, 3, 5},
			wantClusters: [][2][]GuestID{{{1}, {1}}, {{2, 4, 6}, {2, 4, 6}}, {{3}, {3}}, {{5}, {5}}},
			wantSeated:   []int{1, 3, 1, 1},
		},
		{
			name:         "all members disabled gives seated size 0",
			guests:       off(1, 2, 3),
			links:        chain(1, 2, 3),
			wantKeys:     []GuestID{1},
			wantClusters: [][2][]GuestID{{rng(1, 3), nil}},
			wantSeated:   []int{0},
		},
		{
			name:         "links to unknown guests, self links and duplicate guests are ignored",
			guests:       cat(on(1, 2), on(2)),
			links:        []Link{lk(1, 99, Must), lk(2, 2, Must), lk(1, 2, Preferred)},
			wantKeys:     []GuestID{1, 2},
			wantClusters: [][2][]GuestID{{{1}, {1}}, {{2}, {2}}},
			wantSeated:   []int{1, 1},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			g := BuildGraph(tc.guests, tc.links)
			cs := g.Clusters()
			if len(cs) != len(tc.wantKeys) {
				t.Fatalf("got %d clusters (%+v), want %d", len(cs), cs, len(tc.wantKeys))
			}
			for i, c := range cs {
				if c.Key != tc.wantKeys[i] {
					t.Errorf("cluster %d key = %d, want %d", i, c.Key, tc.wantKeys[i])
				}
				if !reflect.DeepEqual(c.Members, tc.wantClusters[i][0]) {
					t.Errorf("cluster %d members = %v, want %v", i, c.Members, tc.wantClusters[i][0])
				}
				if !reflect.DeepEqual(c.Enabled, tc.wantClusters[i][1]) {
					t.Errorf("cluster %d enabled = %v, want %v", i, c.Enabled, tc.wantClusters[i][1])
				}
				if c.SeatedSize() != tc.wantSeated[i] {
					t.Errorf("cluster %d seated = %d, want %d", i, c.SeatedSize(), tc.wantSeated[i])
				}
			}
		})
	}
}

func TestClusterOfAndIsEnabled(t *testing.T) {
	g := BuildGraph(cat(on(1, 2), off(3)), chain(1, 3))
	c, ok := g.ClusterOf(3)
	if !ok || c.Key != 1 {
		t.Fatalf("ClusterOf(3) = %+v, %v; want key 1", c, ok)
	}
	if _, ok := g.ClusterOf(42); ok {
		t.Error("ClusterOf(unknown) should report false")
	}
	for id, want := range map[GuestID]bool{1: true, 2: true, 3: false, 42: false} {
		if got := g.IsEnabled(id); got != want {
			t.Errorf("IsEnabled(%d) = %v, want %v", id, got, want)
		}
	}
}

func TestBuildGraphAffinity(t *testing.T) {
	maciek := links(
		[]Link{lk(1, 2, Must)},       // Maciek–Karolina
		[]Link{lk(1, 3, Preferred)},  // Maciek–Michał
		[]Link{lk(3, 4, Must)},       // Michał–Ola
		[]Link{lk(2, 5, Acceptable)}, // Karolina–stranger family
	)
	tests := []struct {
		name         string
		guests       []Guest
		links        []Link
		a, b         GuestID
		wantLevel    LinkLevel
		wantRelated  bool
		wantWarnings []DataWarning
	}{
		{name: "cluster-level propagation: Maciek's pair prefers Michał's pair", guests: enabledRange(1, 5), links: maciek, a: 2, b: 4, wantLevel: Preferred, wantRelated: true},
		{name: "symmetric", guests: enabledRange(1, 5), links: maciek, a: 4, b: 2, wantLevel: Preferred, wantRelated: true},
		{name: "by cluster key", guests: enabledRange(1, 5), links: maciek, a: 1, b: 3, wantLevel: Preferred, wantRelated: true},
		{name: "group 2 propagates too", guests: enabledRange(1, 5), links: maciek, a: 1, b: 5, wantLevel: Acceptable, wantRelated: true},
		{name: "not transitive", guests: enabledRange(1, 5), links: maciek, a: 3, b: 5},
		{name: "same cluster is not an affinity", guests: enabledRange(1, 5), links: maciek, a: 1, b: 2},
		{name: "unknown guest", guests: enabledRange(1, 5), links: maciek, a: 1, b: 99},
		{
			name:   "disabled member's link still counts (A-13)",
			guests: cat(on(1, 2), off(3), on(4)),
			links:  []Link{lk(2, 3, Preferred), lk(3, 4, Must)},
			a:      2, b: 4, wantLevel: Preferred, wantRelated: true, // 2 ↔ {3,4} via disabled 3
		},
		{
			name:   "disabled member's link counts across clusters",
			guests: cat(on(1), off(2), on(3)),
			links:  []Link{lk(1, 2, Must), lk(2, 3, Preferred)},
			a:      1, b: 3, wantLevel: Preferred, wantRelated: true,
		},
		{
			name:   "links 1 and 2 between the same two clusters give Preferred + warning",
			guests: enabledRange(1, 4),
			links:  []Link{lk(1, 2, Must), lk(3, 4, Must), lk(1, 3, Preferred), lk(2, 4, Acceptable)},
			a:      1, b: 3, wantLevel: Preferred, wantRelated: true,
			wantWarnings: []DataWarning{{Code: WarnConflictingLinkLevels, Guests: []GuestID{1, 2, 3, 4}}},
		},
		{
			name:   "level-1 link inside one cluster creates no affinity and no warning",
			guests: enabledRange(1, 2),
			links:  []Link{lk(1, 2, Must), lk(1, 2, Preferred)},
			a:      1, b: 2,
			wantRelated: false,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			g := BuildGraph(tc.guests, tc.links)
			level, ok := g.Affinity(tc.a, tc.b)
			if ok != tc.wantRelated || (ok && level != tc.wantLevel) {
				t.Errorf("Affinity(%d,%d) = (%v,%v), want (%v,%v)", tc.a, tc.b, level, ok, tc.wantLevel, tc.wantRelated)
			}
			if !reflect.DeepEqual(g.Warnings(), tc.wantWarnings) {
				t.Errorf("warnings = %+v, want %+v", g.Warnings(), tc.wantWarnings)
			}
		})
	}
}

func TestBuildGraphWarnings(t *testing.T) {
	tests := []struct {
		name   string
		guests []Guest
		links  []Link
		want   []DataWarning
	}{
		{name: "9 is fine", guests: enabledRange(1, 9), links: chain(rng(1, 9)...)},
		{
			name: "10 exceeds 9", guests: enabledRange(1, 10), links: chain(rng(1, 10)...),
			want: []DataWarning{{Code: WarnClusterExceeds9, Guests: rng(1, 10)}},
		},
		{name: "12 exceeds 9 only", guests: enabledRange(1, 12), links: chain(rng(1, 12)...),
			want: []DataWarning{{Code: WarnClusterExceeds9, Guests: rng(1, 12)}}},
		{
			name: "13 exceeds 9 and 12", guests: enabledRange(1, 13), links: chain(rng(1, 13)...),
			want: []DataWarning{
				{Code: WarnClusterExceeds9, Guests: rng(1, 13)},
				{Code: WarnClusterExceeds12, Guests: rng(1, 13)},
			},
		},
		{
			name:   "only enabled members count; warning lists enabled guests",
			guests: cat(off(1), enabledRange(2, 10)), links: chain(rng(1, 10)...),
		},
		{
			name:   "two oversized clusters are reported in key order",
			guests: enabledRange(1, 21), links: links(chain(rng(1, 10)...), chain(rng(11, 21)...)),
			want: []DataWarning{
				{Code: WarnClusterExceeds9, Guests: rng(1, 10)},
				{Code: WarnClusterExceeds9, Guests: rng(11, 21)},
			},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := BuildGraph(tc.guests, tc.links).Warnings()
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("warnings = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestBuildGraphDeterministicInAnyOrder(t *testing.T) {
	guests := cat(enabledRange(1, 25), off(26, 27, 28))
	ls := links(
		chain(1, 2, 3), chain(4, 5), chain(26, 6, 7), chain(10, 11, 12, 13),
		[]Link{lk(1, 4, Preferred), lk(5, 26, Acceptable), lk(3, 10, Preferred), lk(2, 11, Acceptable), lk(12, 20, Preferred)},
		[]Link{lk(1, 4, Preferred), lk(4, 1, Preferred)}, // duplicates in both directions
	)
	want := BuildGraph(guests, ls)
	r := rand.New(rand.NewSource(7))
	for i := 0; i < 50; i++ {
		gs := append([]Guest(nil), guests...)
		l2 := append([]Link(nil), ls...)
		r.Shuffle(len(gs), func(a, b int) { gs[a], gs[b] = gs[b], gs[a] })
		r.Shuffle(len(l2), func(a, b int) { l2[a], l2[b] = l2[b], l2[a] })
		for j := range l2 {
			if r.Intn(2) == 0 {
				l2[j].A, l2[j].B = l2[j].B, l2[j].A
			}
		}
		if got := BuildGraph(gs, l2); !reflect.DeepEqual(got, want) {
			t.Fatalf("shuffle %d produced a different graph", i)
		}
	}
}
