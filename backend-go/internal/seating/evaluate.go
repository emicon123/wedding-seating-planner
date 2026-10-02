package seating

import "sort"

// ViolationCode identifies a broken hard rule in a plan.
type ViolationCode string

const (
	ViolClusterSplit     ViolationCode = "cluster_split"
	ViolOverCapacity     ViolationCode = "over_capacity"
	ViolUnderFloor       ViolationCode = "under_floor"
	ViolUnseated         ViolationCode = "unseated_guests"
	ViolOversizedCluster ViolationCode = "oversized_cluster"
)

// Violation is a broken hard rule. Table 0 means "not about one table".
// Guests: over_capacity / under_floor list the enabled guests at the table;
// cluster_split the seated enabled members; oversized_cluster the cluster's
// enabled members; unseated_guests all unseated enabled guests. Always sorted.
type Violation struct {
	Code   ViolationCode
	Table  int
	Guests []GuestID
}

// Placement is one cluster (enabled members only) at a table, or in the unseated tray.
type Placement struct {
	ClusterKey GuestID
	Guests     []GuestID
	Pinned     bool
}

// Summary is the headline of an Evaluation.
type Summary struct {
	TableCount, Seated, Unseated, ViolationCount int
	Score                                        float64
	NeedsRecalculation                           bool
}

// TableEval is the evaluation of one table.
type TableEval struct {
	Number, Fill int
	Score        float64
	Clusters     []Placement
}

// GuestScore is the satisfaction of one enabled guest. Table 0 means unseated.
type GuestScore struct {
	Guest            GuestID
	Table            int
	Satisfaction     float64
	PreferredTotal   int // enabled guests in clusters with a group-1 affinity to the guest's cluster
	PreferredAtTable int
	FallbackAtTable  int
	StrangersAtTable int
}

// Evaluation is everything derived from a Plan.
type Evaluation struct {
	Summary     Summary
	Tables      []TableEval
	Unseated    []Placement
	GuestScores []GuestScore
	Violations  []Violation
}

// Evaluate derives fill, satisfaction and violations of a plan. Seats of
// disabled guests (and of guests unknown to the graph) are ignored; a guest
// listed twice counts once, at the first seat. NeedsRecalculation is
// len(Violations) > 0. It is pure and deterministic.
func Evaluate(g Graph, p Plan) Evaluation {
	// tableOf: enabled guest -> table index. Pinned: per table, cluster keys with a pinned seat.
	tableOf := map[GuestID]int{}
	seen := map[GuestID]bool{}
	atTable := make([]map[GuestID][]GuestID, len(p.Tables)) // table idx -> cluster key -> enabled guests
	pinned := make([]map[GuestID]bool, len(p.Tables))
	for ti, t := range p.Tables {
		atTable[ti] = map[GuestID][]GuestID{}
		pinned[ti] = map[GuestID]bool{}
		for _, s := range t.Seats {
			key, known := g.keyOf[s.Guest]
			if !known || seen[s.Guest] {
				continue
			}
			seen[s.Guest] = true
			if s.Pinned {
				pinned[ti][key] = true
			}
			if g.enabled[s.Guest] {
				tableOf[s.Guest] = ti
				atTable[ti][key] = append(atTable[ti][key], s.Guest)
			}
		}
	}

	preferredTotal := g.preferredTotals()
	ev := Evaluation{Tables: make([]TableEval, len(p.Tables))}
	var scores []GuestScore

	for ti, t := range p.Tables {
		keys := sortedClusterKeys(atTable[ti])
		te := TableEval{Number: t.Number}
		for _, k := range keys {
			guests := sortedIDs(atTable[ti][k])
			te.Fill += len(guests)
			te.Clusters = append(te.Clusters, Placement{ClusterKey: k, Guests: guests, Pinned: pinned[ti][k]})
		}
		for _, k := range keys {
			var sat float64
			var prefAt, fallAt, strangers int
			for _, o := range keys {
				if o == k {
					continue
				}
				n := len(atTable[ti][o])
				switch lvl, ok := g.Affinity(k, o); {
				case ok && lvl == Preferred:
					prefAt += n
					sat += Weight(Preferred) * float64(n)
				case ok && lvl == Acceptable:
					fallAt += n
					sat += Weight(Acceptable) * float64(n)
				default:
					strangers += n
				}
			}
			for _, gid := range sortedIDs(atTable[ti][k]) {
				scores = append(scores, GuestScore{
					Guest: gid, Table: t.Number, Satisfaction: sat,
					PreferredTotal: preferredTotal[k], PreferredAtTable: prefAt,
					FallbackAtTable: fallAt, StrangersAtTable: strangers,
				})
				te.Score += sat
			}
		}
		ev.Tables[ti] = te
		ev.Summary.Score += te.Score
		ev.Summary.Seated += te.Fill
	}

	// Unseated enabled guests, per cluster in key order.
	var unseatedAll []GuestID
	for _, c := range g.clusters {
		var loose []GuestID
		for _, id := range c.Enabled {
			if _, ok := tableOf[id]; !ok {
				loose = append(loose, id)
			}
		}
		if len(loose) == 0 {
			continue
		}
		ev.Unseated = append(ev.Unseated, Placement{ClusterKey: c.Key, Guests: loose})
		unseatedAll = append(unseatedAll, loose...)
		for _, id := range loose {
			scores = append(scores, GuestScore{Guest: id, PreferredTotal: preferredTotal[c.Key]})
		}
	}
	sort.Slice(scores, func(i, j int) bool { return scores[i].Guest < scores[j].Guest })
	ev.GuestScores = scores
	ev.Summary.Unseated = len(unseatedAll)
	ev.Summary.TableCount = len(p.Tables)

	ev.Violations = g.violations(p, ev.Tables, tableOf, unseatedAll)
	ev.Summary.ViolationCount = len(ev.Violations)
	ev.Summary.NeedsRecalculation = len(ev.Violations) > 0
	return ev
}

func (g Graph) violations(p Plan, tables []TableEval, tableOf map[GuestID]int, unseated []GuestID) []Violation {
	var vs []Violation
	k := len(p.Tables)
	for ti, te := range tables {
		var guests []GuestID
		for _, pl := range te.Clusters {
			guests = append(guests, pl.Guests...)
		}
		switch {
		case te.Fill > p.Capacity:
			vs = append(vs, Violation{Code: ViolOverCapacity, Table: te.Number, Guests: sortedIDs(guests)})
		case k > 1 && te.Fill < Floor:
			vs = append(vs, Violation{Code: ViolUnderFloor, Table: p.Tables[ti].Number, Guests: sortedIDs(guests)})
		}
	}
	for _, c := range g.clusters {
		if c.SeatedSize() > p.Capacity {
			vs = append(vs, Violation{Code: ViolOversizedCluster, Guests: sortedIDs(c.Enabled)})
		}
		tablesUsed := map[int]bool{}
		var seated []GuestID
		for _, id := range c.Enabled {
			if ti, ok := tableOf[id]; ok {
				tablesUsed[ti] = true
				seated = append(seated, id)
			}
		}
		if len(tablesUsed) > 1 {
			vs = append(vs, Violation{Code: ViolClusterSplit, Guests: sortedIDs(seated)})
		}
	}
	if len(unseated) > 0 {
		vs = append(vs, Violation{Code: ViolUnseated, Guests: sortedIDs(unseated)})
	}
	return vs
}

// preferredTotals: cluster key -> number of enabled guests in clusters that have
// a group-1 affinity to it.
func (g Graph) preferredTotals() map[GuestID]int {
	out := map[GuestID]int{}
	for pk, lvl := range g.affinity {
		if lvl != Preferred {
			continue
		}
		out[pk.lo] += g.clusters[g.index[pk.hi]].SeatedSize()
		out[pk.hi] += g.clusters[g.index[pk.lo]].SeatedSize()
	}
	return out
}

func sortedClusterKeys(m map[GuestID][]GuestID) []GuestID {
	out := make([]GuestID, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// sortedIDs returns a sorted copy, or nil for an empty input.
func sortedIDs(ids []GuestID) []GuestID {
	if len(ids) == 0 {
		return nil
	}
	out := append([]GuestID(nil), ids...)
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}
