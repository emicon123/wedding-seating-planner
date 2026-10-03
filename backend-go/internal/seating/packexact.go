package seating

import "sort"

// exactBudget bounds the search by node count (never by time), so the
// fallback is deterministic and cannot stall.
const exactBudget = 100000

type exactKey struct {
	table  int
	counts [maxItemSize + 1]int
}

// maxItemSize is the largest cluster size the exact search handles (the
// largest capacity). Items above it can never be placeable anyway.
const maxItemSize = 12

type exactSearch struct {
	capacity, floor int
	k               int
	start           []int // initial fill per table (honoured pins)
	budget          int
	failed          map[exactKey]bool
	picked          [][]int // picked[t] = sizes added to table t
}

// packExact is the fallback when the greedy packings miss a tight fit: a
// bounded depth-first search over cluster *sizes* (not clusters) that finds an
// assignment of the unpinned items to k tables with every fill in
// [it.floor, capacity] (floor waived when k = 1), honouring pins like pack.
// It ignores affinity (improve optimises afterwards). Returns nil when no
// packing exists or the node budget is exhausted.
func packExact(it items, k int, pins map[int]int) *layout {
	if it.capacity > maxItemSize {
		return nil
	}
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
	var counts [maxItemSize + 1]int
	bySize := make([][]int, maxItemSize+1)
	for a := range l.assign {
		if l.assign[a] < 0 {
			counts[it.size[a]]++
			bySize[it.size[a]] = append(bySize[it.size[a]], a)
		}
	}
	s := &exactSearch{capacity: it.capacity, k: k, start: append([]int(nil), l.fill...), budget: exactBudget,
		failed: map[exactKey]bool{}, picked: make([][]int, k)}
	if k > 1 {
		s.floor = it.floor
	}
	if !s.table(0, counts) {
		return nil
	}
	for t := 0; t < k; t++ {
		for _, size := range s.picked[t] {
			a := bySize[size][0]
			bySize[size] = bySize[size][1:]
			l.place(a, t)
		}
	}
	return l
}

func (s *exactSearch) table(t int, counts [maxItemSize + 1]int) bool {
	remaining := 0
	for size := 1; size <= maxItemSize; size++ {
		remaining += size * counts[size]
	}
	if t == s.k {
		return remaining == 0
	}
	lo, hi := 0, 0
	for u := t; u < s.k; u++ {
		lo += max(0, s.floor-s.start[u])
		hi += s.capacity - s.start[u]
	}
	if remaining < lo || remaining > hi {
		return false
	}
	key := exactKey{t, counts}
	if s.failed[key] {
		return false
	}
	if s.budget--; s.budget < 0 {
		return false
	}
	// If all remaining tables look alike, the largest remaining item must go
	// on this one (symmetry breaking).
	forceLargest := true
	for u := t + 1; u < s.k; u++ {
		if s.start[u] != s.start[t] {
			forceLargest = false
		}
	}
	maxSize := maxItemSize
	if forceLargest {
		for size := maxItemSize; size >= 1; size-- {
			if counts[size] > 0 {
				maxSize = size
				break
			}
		}
	}
	s.picked[t] = s.picked[t][:0]
	if s.fill(t, s.start[t], counts, maxSize, forceLargest) {
		return true
	}
	if s.budget >= 0 {
		s.failed[key] = true
	}
	return false
}

// fill adds items (sizes non-increasing) to table t; mustTake forces at least
// one item of exactly maxSize first (symmetry breaking).
func (s *exactSearch) fill(t, fill int, counts [maxItemSize + 1]int, maxSize int, mustTake bool) bool {
	if !mustTake && fill >= s.floor {
		if s.table(t+1, counts) {
			return true
		}
		if s.budget < 0 {
			return false
		}
	}
	lowest := 1
	if mustTake {
		lowest = maxSize
	}
	for size := maxSize; size >= lowest; size-- {
		if counts[size] == 0 || fill+size > s.capacity {
			continue
		}
		counts[size]--
		s.picked[t] = append(s.picked[t], size)
		if s.fill(t, fill+size, counts, size, false) {
			return true
		}
		s.picked[t] = s.picked[t][:len(s.picked[t])-1]
		counts[size]++
		if s.budget < 0 {
			return false
		}
	}
	return false
}
