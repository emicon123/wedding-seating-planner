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
	floor    int         // minimum fill per table when k > 1 (FloorOf: 8, or 9 in the mixed plan)
	order    order       // how layouts are compared: lexicographic triple, or the bilans (mixed plan)
	keys     []GuestID   // cluster key per item
	members  [][]GuestID // enabled members per item
	size     []int       // seats: fill, capacity, floor, pack order
	adults   []int       // enabled adults: the weight in gain and isolation (task 014)
	gain     [][]int     // gain[a][b] = score of a and b sharing a table = 2*adults_a*adults_b*Weight(affinity)
	idx      map[GuestID]int
	total    int // seats needed by all items
	// hasPartner[a]: item a has an enabled adult and a group-1/2 partner cluster with an
	// enabled adult. Counts partners that are not items too (oversized ones).
	hasPartner []bool
	// nbr[a]: indices b with gain[a][b] > 0, ascending (adjacency list for the deltas).
	nbr [][]int
	// know[a][b] = adults[b] when gain[a][b] > 0, else 0: the adults of b that a's adults know.
	know [][]int
}

// order is how the optimiser ranks layouts (task 015, design 003-backend-design §12.2).
type order uint8

const (
	// lexOrder: (isolated adults, stranger pairs) lower first, then a higher score: the four uniform plans.
	lexOrder order = iota
	// netOrder: a higher bilans = score - 2*StrangerPenalty*stranger pairs: the mixed plan.
	netOrder
)

func newItems(g Graph, capacity int, mixed bool) items {
	it := items{capacity: capacity, floor: FloorOf(Plan{Mixed: mixed}), idx: map[GuestID]int{}}
	if mixed {
		it.order = netOrder
	}
	for _, c := range g.clusters {
		if c.SeatedSize() == 0 || c.SeatedSize() > capacity {
			continue
		}
		it.idx[c.Key] = len(it.keys)
		it.keys = append(it.keys, c.Key)
		it.members = append(it.members, c.Enabled)
		it.size = append(it.size, c.SeatedSize())
		it.adults = append(it.adults, c.AdultSize())
		it.total += c.SeatedSize()
	}
	m := len(it.keys)
	partners := g.hasPartners()
	it.hasPartner = make([]bool, m)
	for a, key := range it.keys {
		it.hasPartner[a] = partners[key] && it.adults[a] > 0
	}
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
		v := int(2 * Weight(lvl) * float64(it.adults[a]*it.adults[b])) // always an integer: weights are 1 or 1/2
		it.gain[a][b], it.gain[b][a] = v, v
	}
	it.nbr = make([][]int, m)
	it.know = make([][]int, m)
	for a := range it.gain {
		it.know[a] = make([]int, m)
		for b, v := range it.gain[a] {
			if v > 0 {
				it.nbr[a] = append(it.nbr[a], b)
				it.know[a][b] = it.adults[b]
			}
		}
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
// maintained fills, adult counts and "affinity of item a to table t" sums.
type layout struct {
	it       items
	k        int
	assign   []int // table index per item, -1 = not placed
	fill     []int
	adultsAt []int   // enabled adults seated per table
	affTo    [][]int // affTo[a][t] = Σ gain[a][b] over items b at table t
	knowTo   [][]int // knowTo[a][t] = Σ know[a][b] over items b at table t (adults a's adults know there)
	pinned   []bool
}

func newLayout(it items, k int) *layout {
	m := len(it.keys)
	l := &layout{it: it, k: k, assign: make([]int, m), fill: make([]int, k), adultsAt: make([]int, k),
		affTo: make([][]int, m), knowTo: make([][]int, m), pinned: make([]bool, m)}
	for a := range l.assign {
		l.assign[a] = -1
		l.affTo[a] = make([]int, k)
		l.knowTo[a] = make([]int, k)
	}
	return l
}

func (l *layout) place(a, t int) {
	l.assign[a] = t
	l.fill[t] += l.it.size[a]
	l.adultsAt[t] += l.it.adults[a]
	for _, c := range l.it.nbr[a] { // gain and know are symmetric in their support: only a's neighbours change
		l.affTo[c][t] += l.it.gain[c][a]
		l.knowTo[c][t] += l.it.know[c][a]
	}
}

func (l *layout) unplace(a int) {
	t := l.assign[a]
	l.assign[a] = -1
	l.fill[t] -= l.it.size[a]
	l.adultsAt[t] -= l.it.adults[a]
	for _, c := range l.it.nbr[a] {
		l.affTo[c][t] -= l.it.gain[c][a]
		l.knowTo[c][t] -= l.it.know[c][a]
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

// objective is what the optimiser compares: the triple (isolated adults, stranger pairs,
// score), ranked by the items' order. An explicit triple, never a weighted sum (no big-M).
type objective struct {
	iso   int // isolated enabled adults: lower is better
	str   int // stranger pairs (task 015): lower is better
	score int // displayed scenario score, isolation penalty included (= Evaluate Summary.Score)
}

// net is the bilans of the mixed plan: score - 2*StrangerPenalty*stranger pairs.
func (o objective) net() int { return o.score - 2*StrangerPenalty*o.str }

// better is the lexicographic order of the uniform plans: fewer isolated adults, then fewer
// stranger pairs, then a higher score.
func (o objective) better(p objective) bool {
	return o.iso < p.iso || (o.iso == p.iso && (o.str < p.str || (o.str == p.str && o.score > p.score)))
}

// delta is the change of an objective caused by one step.
type delta struct{ iso, str, score int }

// net is the bilans change of the step.
func (d delta) net() int { return d.score - 2*StrangerPenalty*d.str }

// improves: the step makes the lexicographic objective strictly better.
func (d delta) improves() bool {
	return d.iso < 0 || (d.iso == 0 && (d.str < 0 || (d.str == 0 && d.score > 0)))
}

// notWorse: the step does not make the lexicographic objective worse (ties included).
func (d delta) notWorse() bool {
	return d.iso < 0 || (d.iso == 0 && (d.str < 0 || (d.str == 0 && d.score >= 0)))
}

// better orders two candidate steps the same way objectives are ordered.
func (d delta) better(e delta) bool {
	return d.iso < e.iso || (d.iso == e.iso && (d.str < e.str || (d.str == e.str && d.score > e.score)))
}

// The comparison sites call these instead of the lexicographic methods above, so the
// mixed plan's scalar bilans is read in exactly one place per site (design §12.2).

// better: o is a better layout than p.
func (r order) better(o, p objective) bool {
	if r == netOrder {
		return o.net() > p.net()
	}
	return o.better(p)
}

// improves: the step strictly improves the layout.
func (r order) improves(d delta) bool {
	if r == netOrder {
		return d.net() > 0
	}
	return d.improves()
}

// notWorse: the step does not worsen the layout.
func (r order) notWorse(d delta) bool {
	if r == netOrder {
		return d.net() >= 0
	}
	return d.notWorse()
}

// stepBetter: step d is a better candidate than e (repairFloor's choice).
func (r order) stepBetter(d, e delta) bool {
	if r == netOrder {
		return d.net() > e.net()
	}
	return d.better(e)
}

// energy is the exponent numerator of the annealing acceptance of a worse step d:
// the lexicographic walk uses the weighted knobs, the bilans walk its true objective.
func (r order) energy(d delta) float64 {
	if r == netOrder {
		return float64(d.net())
	}
	return float64(d.score) - annealIsoWeight*float64(d.iso) - annealStrangerWeight*float64(d.str)
}

// objective computes the triple from scratch, O(items). Since every gain is a
// positive integer and gain[a][a] = 0, affTo[a][t] == 0 means "no partner item
// at a's table", which is exactly Evaluate's prefAt+fallAt == 0. Stranger pairs: every placed
// adult of a counts the adults at its table that are neither its cluster nor known; each pair is
// seen from both ends.
func (l *layout) objective() objective {
	twice, iso, strTwice := 0, 0, 0
	for a, t := range l.assign {
		if t < 0 {
			continue
		}
		twice += l.affTo[a][t]
		if l.it.hasPartner[a] && l.affTo[a][t] == 0 {
			iso += l.it.adults[a]
		}
		strTwice += l.it.adults[a] * l.strangersOf(a, t)
	}
	// each pair is counted from both of its ends
	return objective{iso: iso, str: strTwice / 2, score: twice/2 - IsolationPenalty*iso}
}

// strangersOf is the number of stranger adults item a meets at table t when placed there
// (a itself excluded wherever it currently is).
func (l *layout) strangersOf(a, t int) int {
	n := l.adultsAt[t] - l.knowTo[a][t]
	if l.assign[a] == t {
		n -= l.it.adults[a]
	}
	return n
}

// score is the displayed scenario score (Σ over tables of Σ guest satisfaction,
// isolation penalty included) as an integer: every unit is a multiple of 0.5 * 2.
func (l *layout) score() int { return l.objective().score }

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// moveDelta is the objective change of moving the placed item a to table tb
// (tb != assign[a]), exact, in O(|nbr[a]|). See design 003-backend-design §8.3:
// only a and its neighbours at ta or tb can change their isolation status.
func (l *layout) moveDelta(a, tb int) delta {
	ta := l.assign[a]
	pair := l.affTo[a][tb] - l.affTo[a][ta]
	dI := 0
	if l.it.hasPartner[a] {
		dI += l.it.adults[a] * (b2i(l.affTo[a][tb] == 0) - b2i(l.affTo[a][ta] == 0))
	}
	for _, c := range l.it.nbr[a] {
		switch l.assign[c] {
		case ta: // a leaves: c is isolated if a was its only partner there
			dI += l.it.adults[c] * b2i(l.affTo[c][ta] == l.it.gain[c][a])
		case tb: // a arrives: c stops being isolated
			dI -= l.it.adults[c] * b2i(l.affTo[c][tb] == 0)
		}
	}
	// only pairs containing a change: its strangers at tb (it is not there yet) minus those at ta
	dS := l.it.adults[a] * (l.strangersOf(a, tb) - l.strangersOf(a, ta))
	return delta{iso: dI, str: dS, score: pair - IsolationPenalty*dI}
}

// swapDelta is the objective change of exchanging the tables of a and b (both
// placed, different tables), exact, in O(|nbr[a]| + |nbr[b]|).
func (l *layout) swapDelta(a, b int) delta {
	ta, tb := l.assign[a], l.assign[b]
	g := l.it.gain[a][b]
	pair := (l.affTo[a][tb] - g) - l.affTo[a][ta] + (l.affTo[b][ta] - g) - l.affTo[b][tb]
	dI := 0
	if l.it.hasPartner[a] {
		dI += l.it.adults[a] * (b2i(l.affTo[a][tb]-g == 0) - b2i(l.affTo[a][ta] == 0))
	}
	if l.it.hasPartner[b] {
		dI += l.it.adults[b] * (b2i(l.affTo[b][ta]-g == 0) - b2i(l.affTo[b][tb] == 0))
	}
	// others: a third item c at ta or tb whose sum changes; each counted once
	other := func(c int) {
		var before, after int
		switch l.assign[c] {
		case ta:
			before = l.affTo[c][ta]
			after = before - l.it.gain[c][a] + l.it.gain[c][b]
		case tb:
			before = l.affTo[c][tb]
			after = before - l.it.gain[c][b] + l.it.gain[c][a]
		default:
			return
		}
		dI += l.it.adults[c] * (b2i(after == 0) - b2i(before == 0))
	}
	for _, c := range l.it.nbr[a] {
		if c != b {
			other(c)
		}
	}
	for _, c := range l.it.nbr[b] {
		if c != a && l.it.gain[c][a] == 0 {
			other(c)
		}
	}
	// stranger pairs: every changed pair contains a or b, never both (different tables before and
	// after), so nothing is double counted. kab = a and b know each other: b leaves tb, a leaves ta.
	x, y := l.it.adults[a], l.it.adults[b]
	kA, kB := l.it.know[a][b], l.it.know[b][a] // y and x when known, else 0
	strABefore := l.adultsAt[ta] - x - l.knowTo[a][ta]
	strAAfter := (l.adultsAt[tb] - y) - (l.knowTo[a][tb] - kA)
	strBBefore := l.adultsAt[tb] - y - l.knowTo[b][tb]
	strBAfter := (l.adultsAt[ta] - x) - (l.knowTo[b][ta] - kB)
	dS := x*(strAAfter-strABefore) + y*(strBAfter-strBBefore)
	return delta{iso: dI, str: dS, score: pair - IsolationPenalty*dI}
}

func (l *layout) toPlan() Plan {
	p := Plan{Capacity: l.it.capacity, Mixed: l.it.order == netOrder, Tables: make([]Table, l.k)}
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
	var queue []int
	for a := range l.assign {
		if l.assign[a] < 0 {
			queue = append(queue, a)
		}
	}
	sort.SliceStable(queue, func(i, j int) bool { return it.size[queue[i]] > it.size[queue[j]] })
	for _, a := range queue {
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

// repairFloor lifts every table below the floor (items.floor) to it by moving an unpinned
// cluster in, or swapping a larger one in for a smaller one, never pushing a
// donor below the floor or any table above capacity; it picks the candidate with
// the best step in the items' order (uniform: fewest new isolated adults, then stranger pairs, then
// the least score loss; mixed: the best bilans change; ties: lowest indices). Each step strictly reduces the
// total deficit, so it terminates. Returns false when some table cannot be
// lifted. The floor is waived for a single table.
func repairFloor(l *layout) bool {
	if l.k <= 1 {
		return true
	}
	for {
		var low []int
		for t := 0; t < l.k; t++ {
			if l.fill[t] < l.it.floor {
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
	bestA, bestDelta := -1, delta{}
	for a := range l.assign {
		x := l.assign[a]
		if x < 0 || x == t || l.pinned[a] {
			continue
		}
		s := l.it.size[a]
		if l.fill[t]+s > l.it.capacity || l.fill[x]-s < l.it.floor {
			continue
		}
		if d := l.moveDelta(a, t); bestA < 0 || l.it.order.stepBetter(d, bestDelta) {
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
	bestA, bestB, bestDelta := -1, -1, delta{}
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
			if sa <= sb || l.fill[t]+sa-sb > l.it.capacity || l.fill[x]-sa+sb < l.it.floor {
				continue
			}
			if d := l.swapDelta(a, b); bestA < 0 || l.it.order.stepBetter(d, bestDelta) {
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

// improve is a first-improvement local search: single-cluster moves, then
// pairwise swaps, each accepted only if it strictly improves the objective in the items' order
// (uniform: isolated adults, stranger pairs, score; mixed: the bilans) and keeps
// capacity and floor; pinned clusters never move. At most `passes` passes.
func improve(l *layout, passes int) {
	m := len(l.assign)
	floor := l.floor()
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
				if l.it.order.improves(l.moveDelta(a, t)) {
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
				if l.it.order.improves(l.swapDelta(a, b)) {
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

// feasibleAt tries one table count k: pack with and without affinity (+
// repairFloor), then packExact. It returns the optimised feasible layout, or
// nil plus the greedy tries (for the best-effort fallback of Propose).
func feasibleAt(it items, k int, pins map[int]int) (best *layout, tries []*layout) {
	for _, affinity := range [2]bool{true, false} {
		l := pack(it, k, pins, affinity)
		if l.complete() && repairFloor(l) {
			optimise(l)
			return l, nil
		}
		tries = append(tries, l)
	}
	if l := packExact(it, k, pins); l != nil { // tight fits the greedy passes miss
		optimise(l)
		return l, nil
	}
	return nil, tries
}

// fewestViolations folds the greedy tries of one k into the best-effort plan: the one whose
// Evaluate lists the fewest violations (the first on ties). bestV < 0 means "none yet".
func fewestViolations(g Graph, tries []*layout, best Plan, bestV int) (Plan, int) {
	for _, t := range tries {
		p := t.toPlan()
		if v := len(Evaluate(g, p).Violations); bestV < 0 || v < bestV {
			best, bestV = p, v
		}
	}
	return best, bestV
}

// solve finds the optimised feasible layout at the smallest feasible table count k (from
// ⌈seats/capacity⌉ upwards): every fill in [it.floor, capacity] (floor waived for one table), clusters
// intact, pinned clusters kept at their table (a pin to a table number above k is released). When
// no k works it returns nil and the plan with the fewest violations (Evaluate lists them), the
// best-effort fallback. it.total must be > 0.
func solve(g Graph, it items, pins map[int]int) (l *layout, bestEffort Plan) {
	bestViolations := -1
	for k := minTables(it.total, it.capacity); ; k++ {
		l, tries := feasibleAt(it, k, pins)
		if l != nil {
			return l, Plan{}
		}
		bestEffort, bestViolations = fewestViolations(g, tries, bestEffort, bestViolations)
		if (k+1)*it.floor > it.total {
			return nil, bestEffort
		}
	}
}

// Propose computes a seating for current.Capacity: the fewest tables k that
// admit a packing with every fill in [8, capacity] (floor waived for one
// table), clusters intact, pinned clusters kept at their table (a pin to a
// table number above k is released), then, among those layouts, the fewest
// isolated adults, then the fewest stranger pairs, then the best satisfaction that a
// bounded simulated-annealing run plus a local search finds. Only
// enabled guests are seated; oversized clusters stay unseated. When no k works it returns the
// plan with the fewest violations (Evaluate lists them) instead of failing. Only
// the pins of current are used. Deterministic: same input, same plan. Writes
// nothing. The mixed plan (current.Mixed, Capacity 12) instead has floor 9, a free
// table count and the bilans as its objective, see proposeMixed. The result keeps Capacity and Mixed.
func Propose(g Graph, current Plan) Plan {
	capacity := current.Capacity
	it := newItems(g, capacity, current.Mixed)
	var out Plan
	switch {
	case it.total == 0 || capacity <= 0:
		out = Plan{Capacity: capacity}
	case current.Mixed:
		out = proposeMixed(g, it, pinTargets(g, current, it))
	default:
		l, best := solve(g, it, pinTargets(g, current, it))
		if l != nil {
			out = l.toPlan()
		} else {
			out = best
		}
	}
	out.Mixed = current.Mixed
	return out
}

// mixedRange is the table counts the mixed plan tries: [⌈N/12⌉, ⌊N/9⌋] (one table for N ≤ 12),
// the lower bound raised to the highest pinned table when that still fits under ⌊N/9⌋ (otherwise
// the pins above k are released by pack). hi < lo when no k has 9-12 guests per table (N = 13-17, 25-26).
func mixedRange(it items, pins map[int]int) (lo, hi int) {
	lo, hi = minTables(it.total, it.capacity), it.total/it.floor
	if it.total <= it.capacity {
		return 1, 1
	}
	top := 0
	for _, t := range pins {
		top = max(top, t+1)
	}
	if top > lo && top <= hi {
		lo = top
	}
	return lo, hi
}

// proposeMixed is the mixed plan (tasks 013, 015): capacity 12, floor 9, any table count k in
// mixedRange, each k solved in full (pack, repair, anneal, improve) and compared by the bilans;
// the highest wins and ties keep the smaller k (strict > while k ascends). With no feasible k it
// returns the best-effort plan: the fewest violations among the greedy tries (floor 9).
func proposeMixed(g Graph, it items, pins map[int]int) Plan {
	lo, hi := mixedRange(it, pins)
	var best *layout
	var bestEffort Plan
	bestViolations := -1
	for k := lo; k <= max(hi, lo); k++ {
		l, tries := feasibleAt(it, k, pins)
		if l == nil {
			bestEffort, bestViolations = fewestViolations(g, tries, bestEffort, bestViolations)
			continue
		}
		if best == nil || l.objective().net() > best.objective().net() {
			best = l
		}
	}
	if best != nil {
		return best.toPlan()
	}
	return bestEffort
}
