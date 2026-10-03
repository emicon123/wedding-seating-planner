package store

import (
	"context"
	"database/sql"

	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/scenarios"
	"github.com/wojtekrpi/stoliki/backend-go/internal/seating"
	"github.com/wojtekrpi/stoliki/backend-go/internal/store/sqlcgen"
)

// Scenarios is the Scenario aggregate store (scenario row + its tables and assignments). It
// implements scenarios.Store. Every method is exactly one transaction and every mutation bumps
// the scenario version.
type Scenarios struct{ db *sql.DB }

func NewScenarios(db *sql.DB) *Scenarios { return &Scenarios{db: db} }

// List returns the five plans ordered 9, 10, 11, 12, mixed.
func (s *Scenarios) List(ctx context.Context) ([]scenarios.PlanState, error) {
	var out []scenarios.PlanState
	err := withTx(ctx, s.db, func(q *sqlcgen.Queries) (err error) {
		out, err = loadStates(ctx, q)
		return err
	})
	return out, err
}

// Get returns one plan, or apperr.ErrNotFound for a key that is not one of the five plans.
func (s *Scenarios) Get(ctx context.Context, key scenarios.Key) (scenarios.PlanState, error) {
	return s.tx(ctx, key, func(q *sqlcgen.Queries, sc sqlcgen.Scenario) error { return nil })
}

// ReplacePlans swaps the whole content (tables, seats, pins) of every given plan in ONE
// transaction. Per plan it is a compare-and-set on the scenario version: when the stored
// version is not ExpectedVersion the transaction is rolled back (nothing of any plan is
// written) and the error is apperr.StaleVersion (matches apperr.ErrVersionConflict). A
// plan that does not exist gives apperr.ErrNotFound. Each replaced plan's version is bumped
// by 1. Plan tables are stored under their own numbers; the caller guarantees 1..k and no guest
// twice. Returns the stored states of the given plans in List order.
func (s *Scenarios) ReplacePlans(ctx context.Context, ps []scenarios.PlanReplace) ([]scenarios.PlanState, error) {
	var out []scenarios.PlanState
	err := withTx(ctx, s.db, func(q *sqlcgen.Queries) error {
		replaced := make(map[scenarios.Key]bool, len(ps))
		for _, p := range ps {
			sc, err := q.GetScenario(ctx, scenarioKey(p.Key))
			if err != nil {
				return err // sql.ErrNoRows -> ErrNotFound
			}
			n, err := q.BumpScenarioVersionIf(ctx, sqlcgen.BumpScenarioVersionIfParams{ID: sc.ID, Version: p.ExpectedVersion})
			if err != nil {
				return err
			}
			if n == 0 {
				return apperr.StaleVersion{Plan: p.Key.String(), Current: sc.Version}
			}
			if err := q.DeleteScenarioTables(ctx, sc.ID); err != nil {
				return err
			}
			for _, t := range p.Plan.Tables {
				tableID, err := q.InsertDiningTable(ctx, sqlcgen.InsertDiningTableParams{ScenarioID: sc.ID, Number: int64(t.Number)})
				if err != nil {
					return err
				}
				for _, seat := range t.Seats {
					if err := q.UpsertAssignment(ctx, sqlcgen.UpsertAssignmentParams{
						ScenarioID: sc.ID, GuestID: seat.Guest, TableID: tableID, Pinned: boolInt(seat.Pinned),
					}); err != nil {
						return err
					}
				}
			}
			replaced[p.Key] = true
		}
		states, err := loadStates(ctx, q)
		if err != nil {
			return err
		}
		for _, st := range states {
			if replaced[st.Key()] {
				out = append(out, st)
			}
		}
		return nil
	})
	return out, err
}

// SeatCluster puts every listed guest at the table (moving the seated, seating the unseated)
// with the given pin flag. A table that does not exist in this plan, or an unknown guest, gives
// apperr.ErrNotFound and nothing is changed.
func (s *Scenarios) SeatCluster(ctx context.Context, key scenarios.Key, guestIDs []int64, tableNumber int, pinned bool) (scenarios.PlanState, error) {
	return s.tx(ctx, key, func(q *sqlcgen.Queries, sc sqlcgen.Scenario) error {
		tableID, err := q.GetDiningTableID(ctx, sqlcgen.GetDiningTableIDParams{ScenarioID: sc.ID, Number: int64(tableNumber)})
		if err != nil {
			return err // sql.ErrNoRows -> ErrNotFound
		}
		for _, id := range guestIDs {
			if err := q.UpsertAssignment(ctx, sqlcgen.UpsertAssignmentParams{
				ScenarioID: sc.ID, GuestID: id, TableID: tableID, Pinned: boolInt(pinned),
			}); err != nil {
				return err // FOREIGN KEY on guest_id -> ErrNotFound
			}
		}
		return bump(ctx, q, sc)
	})
}

// UnseatCluster removes the listed guests' assignments (and pins); guests without one are
// ignored, so repeating it succeeds.
func (s *Scenarios) UnseatCluster(ctx context.Context, key scenarios.Key, guestIDs []int64) (scenarios.PlanState, error) {
	return s.tx(ctx, key, func(q *sqlcgen.Queries, sc sqlcgen.Scenario) error {
		if len(guestIDs) > 0 {
			if err := q.DeleteAssignments(ctx, sqlcgen.DeleteAssignmentsParams{ScenarioID: sc.ID, GuestIds: guestIDs}); err != nil {
				return err
			}
		}
		return bump(ctx, q, sc)
	})
}

// AddTable appends an empty table numbered max+1.
func (s *Scenarios) AddTable(ctx context.Context, key scenarios.Key) (scenarios.PlanState, error) {
	return s.tx(ctx, key, func(q *sqlcgen.Queries, sc sqlcgen.Scenario) error {
		max, err := q.MaxTableNumber(ctx, sc.ID)
		if err != nil {
			return err
		}
		if _, err := q.InsertDiningTable(ctx, sqlcgen.InsertDiningTableParams{ScenarioID: sc.ID, Number: max + 1}); err != nil {
			return err
		}
		return bump(ctx, q, sc)
	})
}

// RemoveTable deletes table `number` (its guests become unseated, pins included) and renumbers
// the later tables down by one so numbers stay 1..k. A missing table gives apperr.ErrNotFound.
func (s *Scenarios) RemoveTable(ctx context.Context, key scenarios.Key, number int) (scenarios.PlanState, error) {
	return s.tx(ctx, key, func(q *sqlcgen.Queries, sc sqlcgen.Scenario) error {
		n, err := q.DeleteDiningTable(ctx, sqlcgen.DeleteDiningTableParams{ScenarioID: sc.ID, Number: int64(number)})
		if err != nil {
			return err
		}
		if n == 0 {
			return apperr.ErrNotFound
		}
		// SQLite checks UNIQUE (scenario_id, number) row by row, so "number = number - 1" would
		// collide; park the later tables above 1000 first, then bring them back one lower.
		if err := q.ShiftTableNumbersUp(ctx, sqlcgen.ShiftTableNumbersUpParams{ScenarioID: sc.ID, Number: int64(number)}); err != nil {
			return err
		}
		if err := q.ShiftTableNumbersDown(ctx, sc.ID); err != nil {
			return err
		}
		return bump(ctx, q, sc)
	})
}

// ClearPlan deletes the plan: every table of the scenario goes, and its assignments (pins
// included, disabled guests' too) go with them by ON DELETE CASCADE. The scenario row stays and
// its version is bumped. There is no version check, so repeating it succeeds (and bumps again);
// an unknown key gives apperr.ErrNotFound.
func (s *Scenarios) ClearPlan(ctx context.Context, key scenarios.Key) (scenarios.PlanState, error) {
	return s.tx(ctx, key, func(q *sqlcgen.Queries, sc sqlcgen.Scenario) error {
		if err := q.DeleteScenarioTables(ctx, sc.ID); err != nil {
			return err
		}
		return bump(ctx, q, sc)
	})
}

// tx runs fn on the scenario of that key in one transaction and returns the plan as stored
// after fn (apperr.ErrNotFound when the plan does not exist).
func (s *Scenarios) tx(ctx context.Context, key scenarios.Key, fn func(q *sqlcgen.Queries, sc sqlcgen.Scenario) error) (scenarios.PlanState, error) {
	var out scenarios.PlanState
	err := withTx(ctx, s.db, func(q *sqlcgen.Queries) error {
		sc, err := q.GetScenario(ctx, scenarioKey(key))
		if err != nil {
			return err // sql.ErrNoRows -> ErrNotFound
		}
		if err := fn(q, sc); err != nil {
			return err
		}
		states, err := loadStates(ctx, q)
		if err != nil {
			return err
		}
		for _, st := range states {
			if st.Key() == key {
				out = st
			}
		}
		return nil
	})
	return out, err
}

func bump(ctx context.Context, q *sqlcgen.Queries, sc sqlcgen.Scenario) error {
	_, err := q.BumpScenarioVersion(ctx, sc.ID)
	return err
}

// scenarioKey is the (capacity, mixed) lookup of a plan; the only query that finds a scenario by
// identity (every other one uses scenario_id).
func scenarioKey(k scenarios.Key) sqlcgen.GetScenarioParams {
	return sqlcgen.GetScenarioParams{Capacity: int64(k.Capacity), Mixed: boolInt(k.Mixed)}
}

// loadStates reads all five plans: scenarios, then tables and seats grouped by scenario.
// Tables are ordered by number, seats by guest id; an empty table has no seats.
func loadStates(ctx context.Context, q *sqlcgen.Queries) ([]scenarios.PlanState, error) {
	scs, err := q.ListScenarios(ctx)
	if err != nil {
		return nil, err
	}
	tables, err := q.ListDiningTables(ctx)
	if err != nil {
		return nil, err
	}
	seats, err := q.ListAssignmentSeats(ctx)
	if err != nil {
		return nil, err
	}

	type tableKey struct {
		scenario int64
		number   int64
	}
	byScenario := make(map[int64]*scenarios.PlanState, len(scs))
	out := make([]scenarios.PlanState, len(scs))
	for i, sc := range scs {
		out[i] = scenarios.PlanState{Version: sc.Version, Plan: seating.Plan{Capacity: int(sc.Capacity), Mixed: sc.Mixed != 0}}
		byScenario[sc.ID] = &out[i]
	}
	index := make(map[tableKey]int, len(tables)) // table -> position in its plan's Tables
	for _, t := range tables {
		st := byScenario[t.ScenarioID]
		index[tableKey{t.ScenarioID, t.Number}] = len(st.Plan.Tables)
		st.Plan.Tables = append(st.Plan.Tables, seating.Table{Number: int(t.Number)})
	}
	for _, a := range seats {
		st := byScenario[a.ScenarioID]
		ti := index[tableKey{a.ScenarioID, a.TableNumber}]
		st.Plan.Tables[ti].Seats = append(st.Plan.Tables[ti].Seats, seating.Seat{Guest: a.GuestID, Pinned: a.Pinned != 0})
	}
	return out, nil
}

// Compile-time proof that the stores satisfy the interfaces their consumers declare.
var _ scenarios.Store = (*Scenarios)(nil)
