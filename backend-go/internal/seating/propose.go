package seating

import "sort"

// maxPasses caps the local search. A fixed pass count (never a clock) keeps
// Propose deterministic; ~100 guests converge in a handful of passes.
const maxPasses = 100

// items are the clusters a proposal actually seats: seated size in
// 1..capacity (oversized and fully disabled clusters are left out). Item index
// order is cluster-key order.
type items struct {
	capacity int
	keys     []GuestID   // cluster key per item
	members  [][]GuestID // enabled members per item
	size     []int
	gain     [][]int // gain[a][b] = score of a and b sharing a table = 2*size_a*size_b*Weight(affinity)
	idx      map[GuestID]int
	total    int // seats needed by all items
}

func newItems(g Graph, capacity int) items {
	it := items{capacity: capacity, idx: map[GuestID]int{}}
	for _, c := range g.clusters {
		if c.SeatedSize() == 0 || c.SeatedSize() > capacity {
			continue
		}
		it.idx[c.Key] = len(it.keys)
		it.keys = append(it.keys, c.Key)
		it.members = append(it.members, c.Enabled)
		it.size = append(it.size, c.SeatedSize())
		it.total += c.SeatedSize()
	}
	m := len(it.keys)
	it.gain = make([][]int, m)
	for i := range it.gain {
		it.gain[i] = make([]int, m)
	}
	for pk, lvl := range g.affinity {
		a, okA := it.idx[pk.lo]
		b, okB := it.idx[pk.hi]
		if !okA || !okB {
			continue
		}
		v := int(2 * Weight(lvl) * float64(it.size[a]*it.size[b])) // always an integer: weights are 1 or 1/2
		it.gain[a][b], it.gain[b][a] = v, v
	}
	return it
}

// minTables is the smallest table count that can hold the seats at all: ⌈seats/capacity⌉.
func minTables(seats, capacity int) int {
	if seats <= 0 || capacity <= 0 {
		return 0
	}
	return (seats + capacity - 1) / capacity
}

// layout is a mutable assignment of items to k tables with incrementally
// maintained fills and "affinity of item a to table t" sums.
type layout struct {
	it     items
	k      int
	assign []int // table index per item, -1 = not placed
	fill   []int
	affTo  [][]int // affTo[a][t] = Σ gain[a][b] over items b at table t
	pinned []bool
}

func newLayout(it items, k int) *layout {
	m := len(it.keys)
	l := &layout{it: it, k: k, assign: make([]int, m), fill: make([]int, k), affTo: make([][]int, m), pinned: make([]bool, m)}
	for a := range l.assign {
		l.assign[a] = -1
		l.affTo[a] = make([]int, k)
	}
	return l
}

func (l *layout) place(a, t int) {
	l.assign[a] = t
	l.fill[t] += l.it.size[a]
	for c := range l.assign {
		l.affTo[c][t] += l.it.gain[c][a]
	}
}

func (l *layout) unplace(a int) {
	t := l.assign[a]
	l.assign[a] = -1
	l.fill[t] -= l.it.size[a]
	for c := range l.assign {
		l.affTo[c][t] -= l.it.gain[c][a]
	}
}

func (l *layout) move(a, t int) {
	l.unplace(a)
	l.place(a, t)
}

func (l *layout) complete() bool {
	for _, t := range l.assign {
		if t < 0 {
			return false
		}
	}
	return true
}

// score is the scenario score (Σ over tables of Σ guest satisfaction), as an
// integer: every unit is a multiple of 0.5 * 2.
func (l *layout) score() int {
	twice := 0
	for a, t := range l.assign {
		if t >= 0 {
			twice += l.affTo[a][t]
		}
	}
	return twice / 2 // each pair is counted from both of its ends
}

func (l *layout) toPlan() Plan {
	p := Plan{Capacity: l.it.capacity, Tables: make([]Table, l.k)}
	for t := range p.Tables {
		p.Tables[t].Number = t + 1
	}
	for a, t := range l.assign {
		if t < 0 {
			continue
		}
		for _, id := range l.it.members[a] {
			p.Tables[t].Seats = append(p.Tables[t].Seats, Seat{Guest: id, Pinned: l.pinned[a]})
		}
	}
	for t := range p.Tables {
		seats := p.Tables[t].Seats
		sort.Slice(seats, func(i, j int) bool { return seats[i].Guest < seats[j].Guest })
	}
	return p
}

// pack places pinned items at their (existing, fitting) tables first, then the
// rest largest-first (ties: smaller index). With affinity each goes to the
// table with the highest affinity gain that keeps fill ≤ capacity; ties and
// the pure mode pick the emptiest table, then the lowest number. Items that fit
// nowhere stay unplaced. A pin to a table number > k, or one that does not
// fit, is released.
func pack(it items, k int, pins map[int]int, affinity bool) *layout {
	l := newLayout(it, k)
	var pinnedItems []int
	for a := range pins {
		pinnedItems = append(pinnedItems, a)
	}
	sort.Ints(pinnedItems)
	for _, a := range pinnedItems {
		if t := pins[a]; t >= 0 && t < k && l.fill[t]+it.size[a] <= it.capacity {
			l.place(a, t)
			l.pinned[a] = true
		}
	}
	var order []int
	for a := range l.assign {
		if l.assign[a] < 0 {
			order = append(order, a)
		}
	}
	sort.SliceStable(order, func(i, j int) bool { return it.size[order[i]] > it.size[order[j]] })
	for _, a := range order {
		best := -1
		for t := 0; t < k; t++ {
			if l.fill[t]+it.size[a] > it.capacity {
				continue
			}
			if best < 0 {
				best = t
				continue
			}
			gt, gb := 0, 0
			if affinity {
				gt, gb = l.affTo[a][t], l.affTo[a][best]
			}
			if gt > gb || (gt == gb && l.fill[t] < l.fill[best]) {
				best = t
			}
		}
		if best >= 0 {
			l.place(a, best)
		}
	}
	return l
}

// repairFloor lifts every table below Floor to Floor by moving an unpinned
// cluster in, or swapping a larger one in for a smaller one, never pushing a
// donor below Floor or any table above capacity; it picks the candidate with
// the least score loss (ties: lowest indices). Each step strictly reduces the
// total deficit, so it terminates. Returns false when some table cannot be
// lifted. Floor is waived for a single table.
func repairFloor(l *layout) bool {
	if l.k <= 1 {
		return true
	}
	for {
		var low []int
		for t := 0; t < l.k; t++ {
			if l.fill[t] < Floor {
				low = append(low, t)
			}
		}
		if len(low) == 0 {
			return true
		}
		sort.SliceStable(low, func(i, j int) bool { return l.fill[low[i]] < l.fill[low[j]] })
		progressed := false
		for _, t := range low {
			if l.liftByMove(t) || l.liftBySwap(t) {
				progressed = true
				break
			}
		}
		if !progressed {
			return false
		}
	}
}

func (l *layout) liftByMove(t int) bool {
	bestA, bestDelta := -1, 0
	for a := range l.assign {
		x := l.assign[a]
		if x < 0 || x == t || l.pinned[a] {
			continue
		}
		s := l.it.size[a]
		if l.fill[t]+s > l.it.capacity || l.fill[x]-s < Floor {
			continue
		}
		if d := l.affTo[a][t] - l.affTo[a][x]; bestA < 0 || d > bestDelta {
			bestA, bestDelta = a, d
		}
	}
	if bestA < 0 {
		return false
	}
	l.move(bestA, t)
	return true
}

func (l *layout) liftBySwap(t int) bool {
	bestA, bestB, bestDelta := -1, -1, 0
	for a := range l.assign {
		x := l.assign[a]
		if x < 0 || x == t || l.pinned[a] {
			continue
		}
		for b := range l.assign {
			if l.assign[b] != t || l.pinned[b] {
				continue
			}
			sa, sb := l.it.size[a], l.it.size[b]
			if sa <= sb || l.fill[t]+sa-sb > l.it.capacity || l.fill[x]-sa+sb < Floor {
				continue
			}
			if d := l.swapDelta(a, b); bestA < 0 || d > bestDelta {
				bestA, bestB, bestDelta = a, b, d
			}
		}
	}
	if bestA < 0 {
		return false
	}
	ta, tb := l.assign[bestA], l.assign[bestB]
	l.move(bestA, tb)
	l.move(bestB, ta)
	return true
}

// swapDelta is the score change of exchanging the tables of a and b (different tables).
func (l *layout) swapDelta(a, b int) int {
	ta, tb := l.assign[a], l.assign[b]
	g := l.it.gain[a][b]
	return (l.affTo[a][tb] - g) - l.affTo[a][ta] + (l.affTo[b][ta] - g) - l.affTo[b][tb]
}

// improve is a first-improvement local search: single-cluster moves, then
// pairwise swaps, each accepted only if it strictly raises the score and keeps
// capacity and floor; pinned clusters never move. At most `passes` passes.
func improve(l *layout, passes int) {
	m := len(l.assign)
	floor := Floor
	if l.k <= 1 {
		floor = 0
	}
	for pass := 0; pass < passes; pass++ {
		changed := false
		for a := 0; a < m; a++ {
			if l.pinned[a] || l.assign[a] < 0 {
				continue
			}
			s := l.it.size[a]
			for t := 0; t < l.k; t++ {
				x := l.assign[a]
				if t == x || l.fill[t]+s > l.it.capacity || l.fill[x]-s < floor {
					continue
				}
				if l.affTo[a][t]-l.affTo[a][x] > 0 {
					l.move(a, t)
					changed = true
				}
			}
		}
		for a := 0; a < m; a++ {
			if l.pinned[a] || l.assign[a] < 0 {
				continue
			}
			for b := a + 1; b < m; b++ {
				ta, tb := l.assign[a], l.assign[b]
				if l.pinned[b] || tb < 0 || ta == tb {
					continue
				}
				sa, sb := l.it.size[a], l.it.size[b]
				newA, newB := l.fill[ta]-sa+sb, l.fill[tb]-sb+sa
				if newA > l.it.capacity || newB > l.it.capacity || newA < floor || newB < floor {
					continue
				}
				if l.swapDelta(a, b) > 0 {
					l.move(a, tb)
					l.move(b, ta)
					changed = true
				}
			}
		}
		if !changed {
			return
		}
	}
}

// pinTargets maps each placeable cluster that has a pinned seat in the current
// plan (any member, enabled or not) to the 0-based table of its smallest
// pinned guest.
func pinTargets(g Graph, current Plan, it items) map[int]int {
	type pin struct {
		guest GuestID
		table int
	}
	best := map[int]pin{}
	for _, t := range current.Tables {
		for _, s := range t.Seats {
			if !s.Pinned {
				continue
			}
			key, ok := g.keyOf[s.Guest]
			if !ok {
				continue
			}
			a, placeable := it.idx[key]
			if !placeable {
				continue
			}
			if p, seen := best[a]; !seen || s.Guest < p.guest {
				best[a] = pin{guest: s.Guest, table: t.Number - 1}
			}
		}
	}
	out := make(map[int]int, len(best))
	for a, p := range best {
		out[a] = p.table
	}
	return out
}

// Propose computes a seating for current.Capacity: the fewest tables k that
// admit a packing with every fill in [Floor, capacity] (floor waived for one
// table), clusters intact, pinned clusters kept at their table (a pin to a
// table number above k is released), then the best satisfaction a bounded
// local search finds. Only enabled guests are seated; oversized clusters stay
// unseated. When no k works it returns the plan with the fewest violations
// (Evaluate lists them) instead of failing. Only the pins of current are used.
// Deterministic: same input, same plan. Writes nothing.
func Propose(g Graph, current Plan) Plan {
	capacity := current.Capacity
	it := newItems(g, capacity)
	if it.total == 0 || capacity <= 0 {
		return Plan{Capacity: capacity}
	}
	pins := pinTargets(g, current, it)

	var best Plan
	bestViolations := -1
	for k := minTables(it.total, capacity); ; k++ {
		var tries []*layout
		for _, affinity := range [2]bool{true, false} {
			l := pack(it, k, pins, affinity)
			if l.complete() && repairFloor(l) {
				improve(l, maxPasses)
				return l.toPlan()
			}
			tries = append(tries, l)
		}
		if l := packExact(it, k, pins); l != nil { // tight fits the greedy passes miss
			improve(l, maxPasses)
			return l.toPlan()
		}
		for _, l := range tries {
			p := l.toPlan()
			if v := len(Evaluate(g, p).Violations); bestViolations < 0 || v < bestViolations {
				best, bestViolations = p, v
			}
		}
		if (k+1)*Floor > it.total {
			return best
		}
	}
}
