package seating

import "sort"

// Test fixture helpers (plain functions, no builder types — see design audit).

func on(ids ...GuestID) []Guest {
	gs := make([]Guest, len(ids))
	for i, id := range ids {
		gs[i] = Guest{ID: id, Enabled: true}
	}
	return gs
}

func off(ids ...GuestID) []Guest {
	gs := make([]Guest, len(ids))
	for i, id := range ids {
		gs[i] = Guest{ID: id, Enabled: false}
	}
	return gs
}

func cat(parts ...[]Guest) []Guest {
	var out []Guest
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

// rng returns the consecutive ids lo..hi.
func rng(lo, hi GuestID) []GuestID {
	var out []GuestID
	for i := lo; i <= hi; i++ {
		out = append(out, i)
	}
	return out
}

func enabledRange(lo, hi GuestID) []Guest { return on(rng(lo, hi)...) }

func lk(a, b GuestID, l LinkLevel) Link { return Link{A: a, B: b, Level: l} }

// star links hub to every other id at level l.
func star(hub GuestID, l LinkLevel, others ...GuestID) []Link {
	out := make([]Link, len(others))
	for i, o := range others {
		out[i] = lk(hub, o, l)
	}
	return out
}

// chain links ids[0]-ids[1]-ids[2]... at level Must (a cluster of len(ids)).
func chain(ids ...GuestID) []Link {
	var out []Link
	for i := 1; i < len(ids); i++ {
		out = append(out, lk(ids[i-1], ids[i], Must))
	}
	return out
}

// clique links every pair of ids at level l.
func clique(l LinkLevel, ids ...GuestID) []Link {
	var out []Link
	for i := range ids {
		for j := i + 1; j < len(ids); j++ {
			out = append(out, lk(ids[i], ids[j], l))
		}
	}
	return out
}

func links(parts ...[]Link) []Link {
	var out []Link
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

func sorted(ids []GuestID) []GuestID {
	out := append([]GuestID(nil), ids...)
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// table builds a plan table from guest ids.
func tbl(number int, ids ...GuestID) Table {
	seats := make([]Seat, len(ids))
	for i, id := range ids {
		seats[i] = Seat{Guest: id}
	}
	return Table{Number: number, Seats: seats}
}

func pinnedTbl(number int, pinned []GuestID, ids ...GuestID) Table {
	t := tbl(number, ids...)
	for i := range t.Seats {
		for _, p := range pinned {
			if t.Seats[i].Guest == p {
				t.Seats[i].Pinned = true
			}
		}
	}
	return t
}
