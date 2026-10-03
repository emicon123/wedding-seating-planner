package scenarios

import (
	"context"
	"fmt"
	"slices"
	"sort"

	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/guests"
	"github.com/wojtekrpi/stoliki/backend-go/internal/seating"
)

// Store is the persistence the Service needs; *store.Scenarios implements it. Declared here
// (consumer side) so that store can import this package without a cycle.
type Store interface {
	List(ctx context.Context) ([]PlanState, error)
	Get(ctx context.Context, capacity int) (PlanState, error)
	// ReplacePlans writes all given plans in ONE transaction; any stale ExpectedVersion rolls
	// everything back (apperr.ErrVersionConflict). Returns the new states ordered by capacity.
	ReplacePlans(ctx context.Context, ps []PlanReplace) ([]PlanState, error)
	SeatCluster(ctx context.Context, capacity int, members []int64, tableNumber int, pinned bool) (PlanState, error)
	UnseatCluster(ctx context.Context, capacity int, members []int64) (PlanState, error)
	AddTable(ctx context.Context, capacity int) (PlanState, error)
	RemoveTable(ctx context.Context, capacity, number int) (PlanState, error)
	ClearPlan(ctx context.Context, capacity int) (PlanState, error)
}

// GuestSource is all the Service needs from the guest list; *store.Guests satisfies it.
type GuestSource interface {
	List(ctx context.Context) ([]guests.Guest, []guests.Link, error)
}

// Evaluated is a stored plan together with everything derived from it.
type Evaluated struct {
	State PlanState
	Eval  seating.Evaluation
}

// Proposal is a transient auto-seating result for one capacity; it is never stored.
type Proposal struct {
	BasedOnVersion int64
	Plan           seating.Plan
	Eval           seating.Evaluation
}

// PlanInput is one plan of a bulk replace as the client sent it (one ScenarioLayout): the
// version it replaces and the tables to store. A seat is Pinned when its guest was listed in
// the layout's pinnedGuestIds.
type PlanInput struct {
	Capacity int
	BasedOn  int64
	Tables   []seating.Table
}

// PlanReplace is what the store writes for one plan: the complete plan, to be stored when the
// stored version still equals ExpectedVersion.
type PlanReplace struct {
	Capacity        int
	ExpectedVersion int64
	Plan            seating.Plan
}

// Capacities are the four plans, in the order they are listed and proposed.
var Capacities = [4]int{9, 10, 11, 12}

// Service evaluates, proposes, replaces and edits the four plans. It holds no state: every
// call reads what it needs, so evaluations are never stale (nothing derived is stored).
type Service struct {
	plans  Store
	guests GuestSource
}

func NewService(p Store, g GuestSource) *Service { return &Service{plans: p, guests: g} }

// List returns the four plans (9, 10, 11, 12) with their evaluations.
func (s *Service) List(ctx context.Context) ([]Evaluated, error) {
	g, err := s.graph(ctx)
	if err != nil {
		return nil, err
	}
	states, err := s.plans.List(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Evaluated, len(states))
	for i, st := range states {
		out[i] = Evaluated{State: st, Eval: seating.Evaluate(g, st.Plan)}
	}
	return out, nil
}

// Calculate runs auto-seating for all four capacities from ONE graph and the current pins.
// It writes nothing.
func (s *Service) Calculate(ctx context.Context) ([]Proposal, error) {
	g, err := s.graph(ctx)
	if err != nil {
		return nil, err
	}
	states, err := s.plans.List(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Proposal, len(states))
	for i, st := range states {
		proposed := seating.Propose(g, st.Plan)
		out[i] = Proposal{BasedOnVersion: st.Version, Plan: proposed, Eval: seating.Evaluate(g, proposed)}
	}
	return out, nil
}

// Replace stores all four plans at once (Generate and its undo): the capacities must be 9, 10,
// 11 and 12, each exactly once. Per plan it validates the layout (table numbers 1..k without gaps
// or repeats, every guest known and at most once), spreads each pin to every seat of the pinned
// cluster (a cluster is pinned when any listed member is), and seats each cluster's disabled
// members with it. The store then writes everything in one transaction under the optimistic lock
// of every plan: a stale BasedOn on any plan is apperr.ErrVersionConflict and nothing is
// changed. Invalid input is apperr.Validation (field "plans") before anything is written.
// Violations do not block saving. Returns the four evaluated plans ordered 9..12.
func (s *Service) Replace(ctx context.Context, in []PlanInput) ([]Evaluated, error) {
	if err := checkCapacities(in); err != nil {
		return nil, err
	}
	g, err := s.graph(ctx)
	if err != nil {
		return nil, err
	}
	reps := make([]PlanReplace, len(in))
	for i, p := range in {
		layout, err := validLayout(g, p.Capacity, p.Tables)
		if err != nil {
			return nil, err
		}
		pinned := pinnedClusterKeys(g, layout)
		for ti := range layout.Tables {
			for si, seat := range layout.Tables[ti].Seats {
				if c, ok := g.ClusterOf(seat.Guest); ok && pinned[c.Key] {
					layout.Tables[ti].Seats[si].Pinned = true
				}
			}
		}
		reps[i] = PlanReplace{Capacity: p.Capacity, ExpectedVersion: p.BasedOn, Plan: seating.ExpandDisabled(g, layout)}
	}
	sort.Slice(reps, func(i, j int) bool { return reps[i].Capacity < reps[j].Capacity })
	states, err := s.plans.ReplacePlans(ctx, reps)
	if err != nil {
		return nil, err
	}
	out := make([]Evaluated, len(states))
	for i, st := range states {
		out[i] = Evaluated{State: st, Eval: seating.Evaluate(g, st.Plan)}
	}
	return out, nil
}

// checkCapacities requires exactly the four capacities, each once.
func checkCapacities(in []PlanInput) error {
	if len(in) != len(Capacities) {
		return apperr.Validation{Field: "plans", Message: fmt.Sprintf("Exactly %d plans are required (capacities 9, 10, 11, 12).", len(Capacities))}
	}
	seen := map[int]bool{}
	for _, p := range in {
		if !slices.Contains(Capacities[:], p.Capacity) {
			return apperr.Validation{Field: "plans", Message: fmt.Sprintf("Unknown capacity %d.", p.Capacity)}
		}
		if seen[p.Capacity] {
			return apperr.Validation{Field: "plans", Message: fmt.Sprintf("Capacity %d appears more than once.", p.Capacity)}
		}
		seen[p.Capacity] = true
	}
	return nil
}

// Seat moves the guest's WHOLE cluster (every member, disabled ones included) to the table and
// sets its pin. Overfilling is allowed: the evaluation reports it. A table that does not exist
// in this plan is a validation error on tableNumber; an unknown guest is apperr.ErrNotFound.
func (s *Service) Seat(ctx context.Context, capacity int, guestID int64, table int, pinned bool) (Evaluated, error) {
	g, err := s.graph(ctx)
	if err != nil {
		return Evaluated{}, err
	}
	c, ok := g.ClusterOf(guestID)
	if !ok {
		return Evaluated{}, apperr.ErrNotFound
	}
	current, err := s.plans.Get(ctx, capacity)
	if err != nil {
		return Evaluated{}, err
	}
	if !hasTable(current.Plan, table) {
		return Evaluated{}, apperr.Validation{Field: "tableNumber", Message: fmt.Sprintf("Table %d does not exist in this plan.", table)}
	}
	stored, err := s.plans.SeatCluster(ctx, capacity, c.Members, table, pinned)
	if err != nil {
		return Evaluated{}, err
	}
	return Evaluated{State: stored, Eval: seating.Evaluate(g, stored.Plan)}, nil
}

// Unseat moves the guest's whole cluster back to the unseated tray (assignments and pin removed).
func (s *Service) Unseat(ctx context.Context, capacity int, guestID int64) (Evaluated, error) {
	g, err := s.graph(ctx)
	if err != nil {
		return Evaluated{}, err
	}
	c, ok := g.ClusterOf(guestID)
	if !ok {
		return Evaluated{}, apperr.ErrNotFound
	}
	stored, err := s.plans.UnseatCluster(ctx, capacity, c.Members)
	if err != nil {
		return Evaluated{}, err
	}
	return Evaluated{State: stored, Eval: seating.Evaluate(g, stored.Plan)}, nil
}

// AddTable appends an empty table (number = previous count + 1).
func (s *Service) AddTable(ctx context.Context, capacity int) (Evaluated, error) {
	return s.edit(ctx, func() (PlanState, error) { return s.plans.AddTable(ctx, capacity) })
}

// RemoveTable deletes a table: its guests become unseated and later tables are renumbered
// down by one.
func (s *Service) RemoveTable(ctx context.Context, capacity, number int) (Evaluated, error) {
	return s.edit(ctx, func() (PlanState, error) { return s.plans.RemoveTable(ctx, capacity, number) })
}

// Reset deletes the plan: all its tables, assignments and pins go and the version is bumped
// (so an older Generate or undo is stale), leaving an empty plan. Not version-checked.
func (s *Service) Reset(ctx context.Context, capacity int) (Evaluated, error) {
	return s.edit(ctx, func() (PlanState, error) { return s.plans.ClearPlan(ctx, capacity) })
}

// edit runs a store mutation that needs no cluster resolution and evaluates its result.
func (s *Service) edit(ctx context.Context, mutate func() (PlanState, error)) (Evaluated, error) {
	g, err := s.graph(ctx)
	if err != nil {
		return Evaluated{}, err
	}
	stored, err := mutate()
	if err != nil {
		return Evaluated{}, err
	}
	return Evaluated{State: stored, Eval: seating.Evaluate(g, stored.Plan)}, nil
}

// graph builds the cluster graph over all guests. The same projection (guests.ToSeating) and the
// same constructor (seating.BuildGraph) as GET /clusters.
func (s *Service) graph(ctx context.Context) (seating.Graph, error) {
	gs, ls, err := s.guests.List(ctx)
	if err != nil {
		return seating.Graph{}, err
	}
	sg, sl := guests.ToSeating(gs, ls)
	return seating.BuildGraph(sg, sl), nil
}

// validLayout checks one plan's layout and returns it as a Plan with tables ordered 1..k. The
// input is not modified.
func validLayout(g seating.Graph, capacity int, tables []seating.Table) (seating.Plan, error) {
	bad := func(msg string, args ...any) error {
		return apperr.Validation{Field: "plans", Message: fmt.Sprintf("Plan %d: ", capacity) + fmt.Sprintf(msg, args...)}
	}
	out := seating.Plan{Capacity: capacity, Tables: make([]seating.Table, len(tables))}
	for i, t := range tables {
		out.Tables[i] = seating.Table{Number: t.Number, Seats: append([]seating.Seat(nil), t.Seats...)}
	}
	sort.SliceStable(out.Tables, func(i, j int) bool { return out.Tables[i].Number < out.Tables[j].Number })
	for i, t := range out.Tables {
		if t.Number != i+1 {
			return seating.Plan{}, bad("Table numbers must be 1..%d without gaps or repeats.", len(tables))
		}
	}
	seen := map[int64]bool{}
	for _, t := range out.Tables {
		for _, seat := range t.Seats {
			if _, known := g.ClusterOf(seat.Guest); !known {
				return seating.Plan{}, bad("Unknown guest id %d.", seat.Guest)
			}
			if seen[seat.Guest] {
				return seating.Plan{}, bad("Guest %d is seated more than once.", seat.Guest)
			}
			seen[seat.Guest] = true
		}
	}
	return out, nil
}

// pinnedClusterKeys returns the keys of the clusters that have a pinned seat in p.
func pinnedClusterKeys(g seating.Graph, p seating.Plan) map[int64]bool {
	keys := map[int64]bool{}
	for _, t := range p.Tables {
		for _, seat := range t.Seats {
			if !seat.Pinned {
				continue
			}
			if c, ok := g.ClusterOf(seat.Guest); ok {
				keys[c.Key] = true
			}
		}
	}
	return keys
}

func hasTable(p seating.Plan, number int) bool {
	for _, t := range p.Tables {
		if t.Number == number {
			return true
		}
	}
	return false
}
