// Package seating is the pure functional core of Stoliki: clusters, scoring,
// evaluation and auto-seating. It performs no I/O and has no clock and no
// package-level mutable state; the only randomness is a constant-seed PRNG
// inside Propose (anneal.go), so every result is still a deterministic
// function of its arguments (all tie-breaks are by ascending guest/cluster key
// and table number).
//
// Rules: docs/architecture/03-seating-model.md. Signatures:
// docs/architecture/diagrams/003-backend-design.md §2.1.
package seating

import "sort"

// GuestID identifies a guest (the database id).
type GuestID = int64

// LinkLevel is the strength of a link between two guests.
type LinkLevel int

const (
	// Must is group 0: the guests sit together (hard); it defines clusters.
	Must LinkLevel = 0
	// Preferred is group 1: should sit together (weight 1.0).
	Preferred LinkLevel = 1
	// Acceptable is group 2: may sit together only if unavoidable (weight 0.5).
	Acceptable LinkLevel = 2
)

// Floor is the minimum number of enabled guests at a table when the plan has
// more than one table (the four uniform plans).
const Floor = 8

// MixedFloor is the same minimum in the mixed plan (task 015).
const MixedFloor = 9

// StrangerPenalty (lambda) is the satisfaction each adult of a stranger pair loses in the
// mixed plan's bilans, bilans = score - 2*StrangerPenalty*stranger pairs (task 015). Integer.
const StrangerPenalty = 1

// FloorOf is the minimum fill per table of a plan with more than one table. One function,
// used by Evaluate and by the optimiser (items.floor).
func FloorOf(p Plan) int {
	if p.Mixed {
		return MixedFloor
	}
	return Floor
}

// IsolationPenalty is the satisfaction taken from each isolated guest: a seated
// guest whose cluster has partners (group-1/2 affinity) but none at the table
// (task 011). Untyped: used as an int by the optimiser and as a float by Evaluate.
const IsolationPenalty = 1

// Weight is the satisfaction a table-mate of the given affinity level adds.
func Weight(l LinkLevel) float64 {
	switch l {
	case Preferred:
		return 1.0
	case Acceptable:
		return 0.5
	default:
		return 0
	}
}

// Guest is the part of a guest the core needs.
type Guest struct {
	ID      GuestID
	Enabled bool
	// Child: takes a seat (fill, capacity, floor, integrity) but is not scored: it
	// neither receives nor gives satisfaction and is never isolated (task 014).
	Child bool
}

// Link is an undirected relation between two guests.
type Link struct {
	A, B  GuestID
	Level LinkLevel
}

// Cluster is a connected component of the group-0 graph over ALL guests.
type Cluster struct {
	Key     GuestID   // smallest member id
	Members []GuestID // all members, sorted
	Enabled []GuestID // enabled members, sorted
	Adults  []GuestID // enabled members that are not children, sorted (task 014)
}

// SeatedSize is the number of seats the cluster takes (enabled members).
func (c Cluster) SeatedSize() int { return len(c.Enabled) }

// AdultSize is the cluster's weight wherever satisfaction or isolation is counted:
// its enabled adults. Seats (SeatedSize) are what fill, capacity and floor count.
func (c Cluster) AdultSize() int { return len(c.Adults) }

// WarningCode identifies a kind of data warning.
type WarningCode string

const (
	WarnClusterExceeds9       WarningCode = "cluster_exceeds_9"
	WarnClusterExceeds12      WarningCode = "cluster_exceeds_12"
	WarnConflictingLinkLevels WarningCode = "conflicting_link_levels"
)

// DataWarning is a problem in the guest data (not in a plan).
type DataWarning struct {
	Code   WarningCode
	Guests []GuestID
}

type pairKey struct{ lo, hi GuestID } // cluster keys, lo < hi

// Graph is the derived, immutable cluster structure. Build it with BuildGraph.
type Graph struct {
	clusters []Cluster
	keyOf    map[GuestID]GuestID // guest id -> cluster key
	index    map[GuestID]int     // cluster key -> position in clusters
	enabled  map[GuestID]bool
	child    map[GuestID]bool
	affinity map[pairKey]LinkLevel
	warnings []DataWarning
}

// BuildGraph derives clusters (union-find over level-0 links of ALL guests,
// disabled included), cluster affinities (links of all members) and data
// warnings. Links naming unknown guests, self links and unknown levels are
// ignored; duplicate guest ids keep the first occurrence. The result does not
// depend on the order of the inputs.
func BuildGraph(guests []Guest, links []Link) Graph {
	enabled := make(map[GuestID]bool, len(guests))
	child := make(map[GuestID]bool, len(guests))
	ids := make([]GuestID, 0, len(guests))
	for _, gu := range guests {
		if _, dup := enabled[gu.ID]; dup {
			continue
		}
		enabled[gu.ID] = gu.Enabled
		child[gu.ID] = gu.Child
		ids = append(ids, gu.ID)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })

	// Union-find; the root is always the smallest id of the component.
	parent := make(map[GuestID]GuestID, len(ids))
	for _, id := range ids {
		parent[id] = id
	}
	find := func(x GuestID) GuestID {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	for _, l := range links {
		if l.Level != Must || l.A == l.B {
			continue
		}
		_, okA := parent[l.A]
		_, okB := parent[l.B]
		if !okA || !okB {
			continue
		}
		ra, rb := find(l.A), find(l.B)
		if ra < rb {
			parent[rb] = ra
		} else if rb < ra {
			parent[ra] = rb
		}
	}

	g := Graph{
		keyOf:    make(map[GuestID]GuestID, len(ids)),
		index:    map[GuestID]int{},
		enabled:  enabled,
		child:    child,
		affinity: map[pairKey]LinkLevel{},
	}
	for _, id := range ids { // ids ascending, so members come out sorted
		key := find(id)
		g.keyOf[id] = key
		i, ok := g.index[key]
		if !ok {
			i = len(g.clusters)
			g.index[key] = i
			g.clusters = append(g.clusters, Cluster{Key: key})
		}
		c := &g.clusters[i]
		c.Members = append(c.Members, id)
		if enabled[id] {
			c.Enabled = append(c.Enabled, id)
			if !child[id] {
				c.Adults = append(c.Adults, id)
			}
		}
	}
	// Clusters were created in order of their smallest member = key, so they
	// are already ordered by Key.

	g.buildAffinity(links)
	g.buildWarnings()
	return g
}

type pairLinks struct {
	has1, has2 bool
	guests     map[GuestID]bool
}

func (g *Graph) buildAffinity(links []Link) {
	pairs := map[pairKey]*pairLinks{}
	for _, l := range links {
		if l.Level != Preferred && l.Level != Acceptable {
			continue
		}
		ka, okA := g.keyOf[l.A]
		kb, okB := g.keyOf[l.B]
		if !okA || !okB || ka == kb {
			continue
		}
		pk := pairKey{lo: min(ka, kb), hi: max(ka, kb)}
		pl := pairs[pk]
		if pl == nil {
			pl = &pairLinks{guests: map[GuestID]bool{}}
			pairs[pk] = pl
		}
		if l.Level == Preferred {
			pl.has1 = true
		} else {
			pl.has2 = true
		}
		pl.guests[l.A], pl.guests[l.B] = true, true
	}

	keys := make([]pairKey, 0, len(pairs))
	for pk := range pairs {
		keys = append(keys, pk)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].lo != keys[j].lo {
			return keys[i].lo < keys[j].lo
		}
		return keys[i].hi < keys[j].hi
	})
	for _, pk := range keys {
		pl := pairs[pk]
		if pl.has1 {
			g.affinity[pk] = Preferred // level 1 wins; no other combining logic
		} else {
			g.affinity[pk] = Acceptable
		}
		if pl.has1 && pl.has2 {
			g.warnings = append(g.warnings, DataWarning{Code: WarnConflictingLinkLevels, Guests: sortedKeys(pl.guests)})
		}
	}
}

// buildWarnings must run after buildAffinity: oversize warnings come first.
func (g *Graph) buildWarnings() {
	var oversize []DataWarning
	for _, c := range g.clusters {
		if c.SeatedSize() > 9 {
			oversize = append(oversize, DataWarning{Code: WarnClusterExceeds9, Guests: append([]GuestID(nil), c.Enabled...)})
		}
		if c.SeatedSize() > 12 {
			oversize = append(oversize, DataWarning{Code: WarnClusterExceeds12, Guests: append([]GuestID(nil), c.Enabled...)})
		}
	}
	g.warnings = append(oversize, g.warnings...)
}

func sortedKeys(m map[GuestID]bool) []GuestID {
	out := make([]GuestID, 0, len(m))
	for id := range m {
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// Clusters returns all clusters ordered by Key (including those with no enabled member).
func (g Graph) Clusters() []Cluster { return g.clusters }

// ClusterOf returns the cluster a guest belongs to; false for an unknown guest.
func (g Graph) ClusterOf(id GuestID) (Cluster, bool) {
	key, ok := g.keyOf[id]
	if !ok {
		return Cluster{}, false
	}
	return g.clusters[g.index[key]], true
}

// Affinity is the group-1/2 level between the clusters of a and b (any member
// id or cluster key works). false means strangers: no affinity, the same
// cluster, or an unknown guest.
func (g Graph) Affinity(a, b GuestID) (LinkLevel, bool) {
	ka, okA := g.keyOf[a]
	kb, okB := g.keyOf[b]
	if !okA || !okB || ka == kb {
		return 0, false
	}
	l, ok := g.affinity[pairKey{lo: min(ka, kb), hi: max(ka, kb)}]
	return l, ok
}

// IsEnabled reports whether the guest exists and is enabled.
func (g Graph) IsEnabled(id GuestID) bool { return g.enabled[id] }

// Warnings lists data warnings: cluster_exceeds_9 / _12 in cluster order, then
// conflicting_link_levels in cluster-pair order.
func (g Graph) Warnings() []DataWarning { return g.warnings }
