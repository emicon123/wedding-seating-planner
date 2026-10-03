package seating

import (
	"math"
	"sync"
)

// Simulated-annealing stage of Propose (task 008, objective task 011). It only
// improves the objective (fewest isolated seats, then highest score) of a layout that is already feasible: same k, same pins, every fill inside
// [floor, capacity], clusters atomic. Everything is deterministic: a tiny PRNG
// with constant seeds and a fixed iteration budget (no clock, no math/rand).

const (
	annealSeed           uint64  = 0x5EA7_1A9C_2026_1003 // restart i: see restartPRNG
	annealIters                  = 1_500_000             // steps per restart, upper bound
	annealItersPerItemSq         = 700                   // steps per (movable items)^2, the swap neighbourhood, until the bound is reached
	annealRestarts               = 32                    // independent walks, run in parallel (task 012)
	annealTempHigh       float64 = 6                     // start temperature, in score units
	annealTempLow        float64 = 3                     // end temperature (task 012: was 0.8, a warmer end finds the deep basins of full tables more often)
	// annealIsoWeight: extra score points one added isolated seat counts for in the
	// acceptance probability of a worse step (on top of the IsolationPenalty already
	// inside the score delta). A tuning knob for the walk only: it never decides which
	// layout is returned (that is the lexicographic objective). The design suggested 8;
	// measured on 164 generated (instance, capacity) cases (total isolated seats left,
	// lower is better): w=0: 800, 1: 801, 2: 809, 4: 822, 8: 837, so a high weight
	// freezes the walk inside isolation barriers. 1 keeps the knob alive and costs
	// nothing against 0.
	annealIsoWeight float64 = 1
	// annealStrangerWeight: the same kind of walk-only knob for one added stranger pair
	// (task 015); the mixed plan walks the same objective (task 016). Measured
	// with TestTuneStrangerWeight on 30 stranger-free-partition instances, 12 random child
	// instances and annealFixture / tightFixture(4) / tightFixture(5) at capacities 9-12 (total
	// stranger pairs left, isolated adults equal throughout: 78): w=0: 2056, 1: 2023, 2: 2017,
	// 4: 2017, 8: 2029 (every w finds the 0-stranger partitions). 2 is the lowest of the flat
	// optimum (and the design's value: one stranger pair weighs like one group-1 pair of singles).
	annealStrangerWeight float64 = 2
	splitmixStep         uint64  = 0x9E3779B97F4A7C15
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

// restartPRNG is the generator of restart i. Seeds that differ by a multiple of
// splitmixStep give the same stream shifted by a few draws, so the restart seeds
// are scrambled through one splitmix draw each to make the walks independent.
func restartPRNG(i int) *prng {
	seed := &prng{s: annealSeed + uint64(i)}
	return &prng{s: seed.next()}
}

// clone is an independent copy of the layout (the items table is shared, it is read-only).
func (l *layout) clone() *layout {
	c := &layout{
		it:       l.it,
		k:        l.k,
		assign:   append([]int(nil), l.assign...),
		fill:     append([]int(nil), l.fill...),
		adultsAt: append([]int(nil), l.adultsAt...),
		affTo:    make([][]int, len(l.affTo)),
		knowTo:   make([][]int, len(l.knowTo)),
		pinned:   append([]bool(nil), l.pinned...),
	}
	for a := range l.affTo {
		c.affTo[a] = append([]int(nil), l.affTo[a]...)
		c.knowTo[a] = append([]int(nil), l.knowTo[a]...)
	}
	return c
}

// floor is the minimum fill per table the hard rules ask for at this k.
func (l *layout) floor() int {
	if l.k <= 1 {
		return 0
	}
	return l.it.floor
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
// layout it started from in (isolated seats, score) order. A step moves one item
// to another table or swaps two items on different tables; only steps that keep
// capacity and the floor are tried. Steps that are not worse in that order are
// always accepted, a worse step by probability exp(Δ/T), Δ = score change minus
// annealIsoWeight per added isolated seat, with T cooling geometrically from
// annealTempHigh to annealTempLow over `iters` steps.
func anneal(l *layout, iters int, r *prng) {
	mv := l.movable()
	if len(mv) < 2 || l.k <= 1 || iters <= 0 {
		return
	}
	floor, capacity := l.floor(), l.it.capacity
	cur := l.objective()
	best, bestAssign := cur, append([]int(nil), l.assign...)
	temp := annealTempHigh
	cool := math.Pow(annealTempLow/annealTempHigh, 1/float64(iters))
	for i := 0; i < iters; i++ {
		temp *= cool
		a := mv[r.intn(len(mv))]
		ta, sa := l.assign[a], l.it.size[a]
		var d delta
		var b, tb int
		if r.next()&1 == 0 { // move a to another table
			tb = r.intn(l.k - 1)
			if tb >= ta {
				tb++
			}
			if l.fill[tb]+sa > capacity || l.fill[ta]-sa < floor {
				continue
			}
			b = -1
			d = l.moveDelta(a, tb)
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
			d = l.swapDelta(a, b)
		}
		if !d.notWorse() && r.float() >= math.Exp(d.energy()/temp) {
			continue
		}
		if b < 0 {
			l.move(a, tb)
		} else {
			l.move(a, tb)
			l.move(b, ta)
		}
		cur.iso += d.iso
		cur.str += d.str
		cur.score += d.score
		if cur.better(best) {
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

// optimise improves a feasible layout in place: several annealing restarts
// from copies of the start layout (each with its own constant seed, the best
// objective wins, the earliest on ties), then the strict-improvement local
// search. Postcondition: objective(l) is not worse than at entry in (isolated
// seats, score) order; k, pins and the hard rules are untouched. Skipped for a
// single table or fewer than two movable items.
func optimise(l *layout) {
	optimiseWith(l, annealRestarts, annealSteps(len(l.movable())), 0)
}

// hasWeight reports whether any of the items has an adult: without one the objective is
// constant at every arrangement and there is nothing to search. Affinity is not needed: with no
// links at all the stranger term still varies with the table sizes (task 015, example J).
func (l *layout) hasWeight(items []int) bool {
	for _, a := range items {
		if l.it.adults[a] > 0 {
			return true
		}
	}
	return false
}

// annealSteps is the steps per restart for m movable items: m^2 (the number of
// swaps) times annealItersPerItemSq, at most annealIters. 46 items (a real
// ~107-guest list) get ~1.48M, 20 items 280k, 10 items 70k.
func annealSteps(m int) int { return min(annealIters, annealItersPerItemSq*m*m) }

// optimiseWith is optimise with an explicit budget: `restarts` annealing runs of
// `iters` steps each; restart i uses restartPRNG(seedBase+i).
// The restarts run in parallel goroutines, each on its own clone with its own PRNG
// (the items table is read-only), and the winner is picked afterwards in index
// order, so the result does not depend on scheduling.
func optimiseWith(l *layout, restarts, iters, seedBase int) {
	if movable := l.movable(); l.k > 1 && len(movable) >= 2 && l.hasWeight(movable) {
		results := make([]*layout, restarts)
		var wg sync.WaitGroup
		for i := range results {
			wg.Add(1)
			go func() {
				defer wg.Done()
				c := l.clone()
				anneal(c, iters, restartPRNG(seedBase+i))
				results[i] = c
			}()
		}
		wg.Wait()
		bestObj := l.objective()
		var winner *layout
		for _, c := range results {
			if o := c.objective(); o.better(bestObj) {
				bestObj, winner = o, c
			}
		}
		if winner != nil {
			l.restore(winner.assign)
		}
	}
	improve(l, maxPasses)
}
