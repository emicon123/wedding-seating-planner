package seating

import "math"

// Simulated-annealing stage of Propose (task 008). It only raises the score of
// a layout that is already feasible: same k, same pins, every fill inside
// [floor, capacity], clusters atomic. Everything is deterministic: a tiny PRNG
// with constant seeds and a fixed iteration budget (no clock, no math/rand).

const (
	annealSeed         uint64  = 0x5EA7_1A9C_2026_1003 // restart i uses annealSeed + i*splitmixStep
	annealIters                = 400_000               // steps per restart, upper bound
	annealItersPerItem         = 16_000                // steps per movable item until the bound is reached
	annealRestarts             = 4
	annealTempHigh     float64 = 6   // start temperature, in score units
	annealTempLow      float64 = 0.8 // end temperature
	splitmixStep       uint64  = 0x9E3779B97F4A7C15
)

// prng is a self-contained splitmix64 generator.
type prng struct{ s uint64 }

func (r *prng) next() uint64 {
	r.s += splitmixStep
	z := r.s
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
	z = (z ^ (z >> 27)) * 0x94D049BB133111EB
	return z ^ (z >> 31)
}

// intn is uniform in [0, n) up to a negligible modulo bias (n is tiny).
func (r *prng) intn(n int) int { return int(r.next() % uint64(n)) }

// float is uniform in [0, 1).
func (r *prng) float() float64 { return float64(r.next()>>11) / (1 << 53) }

// clone is an independent copy of the layout (the items table is shared, it is read-only).
func (l *layout) clone() *layout {
	c := &layout{
		it:     l.it,
		k:      l.k,
		assign: append([]int(nil), l.assign...),
		fill:   append([]int(nil), l.fill...),
		affTo:  make([][]int, len(l.affTo)),
		pinned: append([]bool(nil), l.pinned...),
	}
	for a := range l.affTo {
		c.affTo[a] = append([]int(nil), l.affTo[a]...)
	}
	return c
}

// floor is the minimum fill per table the hard rules ask for at this k.
func (l *layout) floor() int {
	if l.k <= 1 {
		return 0
	}
	return Floor
}

// movable lists the placed, unpinned items in index order.
func (l *layout) movable() []int {
	var out []int
	for a, t := range l.assign {
		if t >= 0 && !l.pinned[a] {
			out = append(out, a)
		}
	}
	return out
}

// anneal runs one annealing pass over the movable items of l (feasible on
// entry) and leaves l at the best layout it saw, which is never worse than the
// layout it started from. A step moves one item to another table or swaps two
// items on different tables; only steps that keep capacity and the floor are
// tried. Improvements and ties are always accepted, a worse step by
// probability exp(Δ/T) with T cooling geometrically from annealTempHigh to
// annealTempLow over `iters` steps.
func anneal(l *layout, iters int, r *prng) {
	mv := l.movable()
	if len(mv) < 2 || l.k <= 1 || iters <= 0 {
		return
	}
	floor, capacity := l.floor(), l.it.capacity
	cur := l.score()
	best, bestAssign := cur, append([]int(nil), l.assign...)
	temp := annealTempHigh
	cool := math.Pow(annealTempLow/annealTempHigh, 1/float64(iters))
	for i := 0; i < iters; i++ {
		temp *= cool
		a := mv[r.intn(len(mv))]
		ta, sa := l.assign[a], l.it.size[a]
		var delta, b, tb int
		if r.next()&1 == 0 { // move a to another table
			tb = r.intn(l.k - 1)
			if tb >= ta {
				tb++
			}
			if l.fill[tb]+sa > capacity || l.fill[ta]-sa < floor {
				continue
			}
			b = -1
			delta = l.affTo[a][tb] - l.affTo[a][ta]
		} else { // swap a with an item at another table
			b = mv[r.intn(len(mv))]
			tb = l.assign[b]
			if tb == ta {
				continue
			}
			sb := l.it.size[b]
			if l.fill[ta]-sa+sb > capacity || l.fill[tb]-sb+sa > capacity ||
				l.fill[ta]-sa+sb < floor || l.fill[tb]-sb+sa < floor {
				continue
			}
			delta = l.swapDelta(a, b)
		}
		if delta < 0 && r.float() >= math.Exp(float64(delta)/temp) {
			continue
		}
		if b < 0 {
			l.move(a, tb)
		} else {
			l.move(a, tb)
			l.move(b, ta)
		}
		cur += delta
		if cur > best {
			best = cur
			copy(bestAssign, l.assign)
		}
	}
	l.restore(bestAssign)
}

// restore rearranges l to the given complete assignment of its placed items.
func (l *layout) restore(assign []int) {
	for a, t := range assign {
		if l.assign[a] >= 0 && l.assign[a] != t {
			l.unplace(a)
		}
	}
	for a, t := range assign {
		if l.assign[a] < 0 && t >= 0 {
			l.place(a, t)
		}
	}
}

// optimise raises the score of a feasible layout in place: several annealing
// restarts from copies of the start layout (each with its own constant seed,
// the best wins, the earliest on ties), then the strict-improvement local
// search. Postcondition: score(l) ≥ score at entry; k, pins and the hard rules
// are untouched. Skipped for a single table or fewer than two movable items.
func optimise(l *layout) {
	if movable := len(l.movable()); l.k > 1 && movable >= 2 {
		iters := min(annealIters, annealItersPerItem*movable)
		bestScore := l.score()
		var winner *layout
		for i := 0; i < annealRestarts; i++ {
			c := l.clone()
			anneal(c, iters, &prng{s: annealSeed + uint64(i)*splitmixStep})
			if s := c.score(); s > bestScore {
				bestScore, winner = s, c
			}
		}
		if winner != nil {
			l.restore(winner.assign)
		}
	}
	improve(l, maxPasses)
}
