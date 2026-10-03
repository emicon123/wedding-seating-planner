// Package scenarios holds the plan domain: the five seating scenarios (9, 10, 11, 12 seats per
// table, and the mixed plan), the Service that evaluates, proposes, replaces and edits them, and
// the Store and GuestSource interfaces the Service needs (declared here, implemented by package
// store).
package scenarios

import (
	"strconv"

	"github.com/wojtekrpi/stoliki/backend-go/internal/seating"
)

// PlanState is one stored plan as loaded from the database: its optimistic-lock version and
// the seating (capacity, mixed flag, tables ordered 1..k with their seats). It reuses the core's Plan.
type PlanState struct {
	Version int64
	Plan    seating.Plan
}

// Key returns the identity of the stored plan.
func (p PlanState) Key() Key { return Key{Capacity: p.Plan.Capacity, Mixed: p.Plan.Mixed} }

// Key identifies one of the five plans (task 013). API form: "9", "10", "11", "12", "mixed".
// The mixed plan is {12, true}: its tables hold at most 12 guests.
type Key struct {
	Capacity int
	Mixed    bool
}

// Keys are the five plans in the order they are listed, proposed and stored.
var Keys = [5]Key{{9, false}, {10, false}, {11, false}, {12, false}, {12, true}}

// ParseKey reads the API form of a key; anything but "9".."12" and "mixed" is not a key.
func ParseKey(s string) (Key, bool) {
	if s == "mixed" {
		return Key{Capacity: 12, Mixed: true}, true
	}
	if n, err := strconv.Atoi(s); err == nil && strconv.Itoa(n) == s {
		for _, k := range Keys {
			if !k.Mixed && k.Capacity == n {
				return k, true
			}
		}
	}
	return Key{}, false
}

// String is the API form of the key, the inverse of ParseKey.
func (k Key) String() string {
	if k.Mixed {
		return "mixed"
	}
	return strconv.Itoa(k.Capacity)
}
