package seating

import "sort"

// ExpandDisabled returns a copy of p in which every cluster that has at least
// one seated enabled member also seats its disabled members at that table
// (the table of its smallest seated enabled member), carrying the cluster's pin
// flag (any seat of the cluster pinned). Existing seats of those disabled
// members elsewhere are moved. Clusters without a seated enabled member and
// guests unknown to the graph are left untouched. Used when the plans are replaced (PUT /scenarios).
func ExpandDisabled(g Graph, p Plan) Plan {
	tableIdx := map[GuestID]int{} // enabled guest -> table index (first seat)
	pinned := map[GuestID]bool{}  // cluster key -> any seat pinned
	for ti, t := range p.Tables {
		for _, s := range t.Seats {
			key, ok := g.keyOf[s.Guest]
			if !ok {
				continue
			}
			if s.Pinned {
				pinned[key] = true
			}
			if g.enabled[s.Guest] {
				if _, seen := tableIdx[s.Guest]; !seen {
					tableIdx[s.Guest] = ti
				}
			}
		}
	}
	// target table index per cluster that has a seated enabled member.
	target := map[GuestID]int{}
	for _, c := range g.clusters {
		for _, id := range c.Enabled { // ascending: smallest seated member wins
			if ti, ok := tableIdx[id]; ok {
				target[c.Key] = ti
				break
			}
		}
	}

	out := Plan{Capacity: p.Capacity, Tables: make([]Table, len(p.Tables))}
	for ti, t := range p.Tables {
		out.Tables[ti] = Table{Number: t.Number}
		for _, s := range t.Seats {
			if key, ok := g.keyOf[s.Guest]; ok && !g.enabled[s.Guest] {
				if _, has := target[key]; has {
					continue // re-added at the cluster's table below
				}
			}
			out.Tables[ti].Seats = append(out.Tables[ti].Seats, s)
		}
	}
	for _, c := range g.clusters {
		ti, ok := target[c.Key]
		if !ok {
			continue
		}
		for _, id := range c.Members {
			if !g.enabled[id] {
				out.Tables[ti].Seats = append(out.Tables[ti].Seats, Seat{Guest: id, Pinned: pinned[c.Key]})
			}
		}
	}
	for ti := range out.Tables {
		seats := out.Tables[ti].Seats
		sort.SliceStable(seats, func(i, j int) bool { return seats[i].Guest < seats[j].Guest })
	}
	return out
}
