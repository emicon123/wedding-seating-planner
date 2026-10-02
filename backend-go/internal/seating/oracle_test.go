package seating

// Test-only exact feasibility oracle: can the cluster sizes be split over k
// tables with every fill in [floor, capacity]? Used to check that Propose
// really uses the minimum feasible number of tables on generated inputs.

type sizeCounts [7]int // index = cluster size 1..6

type oracleKey struct {
	counts sizeCounts
	bins   int
}

type oracle struct {
	capacity, floor int
	budget          int
	failed          map[oracleKey]bool
	exhausted       bool
}

// minFeasibleTables returns the smallest k >= ceil(N/capacity) for which a
// packing exists, 0 when none exists, and -1 when the search budget ran out.
func minFeasibleTables(sizes []int, capacity int) int {
	var counts sizeCounts
	total := 0
	for _, s := range sizes {
		counts[s]++
		total += s
	}
	if total == 0 {
		return 0
	}
	for k := (total + capacity - 1) / capacity; ; k++ {
		floor := Floor
		if k == 1 {
			floor = 0
		}
		if k*floor > total {
			return 0
		}
		o := &oracle{capacity: capacity, floor: floor, budget: 400000, failed: map[oracleKey]bool{}}
		ok := o.feasible(counts, k)
		if o.exhausted {
			return -1
		}
		if ok {
			return k
		}
	}
}

func (o *oracle) feasible(counts sizeCounts, bins int) bool {
	if o.exhausted {
		return false
	}
	remaining := 0
	for s := 1; s <= 6; s++ {
		remaining += s * counts[s]
	}
	if bins == 0 {
		return remaining == 0
	}
	if remaining < bins*o.floor || remaining > bins*o.capacity {
		return false
	}
	key := oracleKey{counts, bins}
	if o.failed[key] {
		return false
	}
	o.budget--
	if o.budget < 0 {
		o.exhausted = true
		return false
	}
	// The next bin contains the largest remaining cluster (breaks symmetry).
	largest := 0
	for s := 6; s >= 1; s-- {
		if counts[s] > 0 {
			largest = s
			break
		}
	}
	counts[largest]--
	ok := o.fill(counts, bins, largest, largest)
	if !ok && !o.exhausted {
		o.failed[key] = true
	}
	return ok
}

// fill adds further clusters (sizes <= maxSize, non-increasing) to the current bin.
func (o *oracle) fill(counts sizeCounts, bins, binFill, maxSize int) bool {
	if binFill >= o.floor {
		if o.feasible(counts, bins-1) {
			return true
		}
		if o.exhausted {
			return false
		}
	}
	for s := maxSize; s >= 1; s-- {
		if counts[s] == 0 || binFill+s > o.capacity {
			continue
		}
		counts[s]--
		if o.fill(counts, bins, binFill+s, s) {
			return true
		}
		counts[s]++
		if o.exhausted {
			return false
		}
	}
	return false
}
