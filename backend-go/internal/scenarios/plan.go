// Package scenarios holds the plan domain: the four seating scenarios (9, 10, 11, 12 seats per
// table), the Service that evaluates, proposes, replaces and edits them, and the Store and
// GuestSource interfaces the Service needs (declared here, implemented by package store).
package scenarios

import "github.com/wojtekrpi/stoliki/backend-go/internal/seating"

// PlanState is one stored plan as loaded from the database: its optimistic-lock version and
// the seating (capacity, tables ordered 1..k with their seats). It reuses the core's Plan.
type PlanState struct {
	Version int64
	Plan    seating.Plan
}
