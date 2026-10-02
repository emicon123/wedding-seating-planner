package scenarios_test

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"testing"

	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/guests"
	"github.com/wojtekrpi/stoliki/backend-go/internal/scenarios"
	"github.com/wojtekrpi/stoliki/backend-go/internal/seating"
	"github.com/wojtekrpi/stoliki/backend-go/internal/store"
)

// countingSource wraps the real guest store and counts List calls ("Calculate builds one graph").
type countingSource struct {
	scenarios.GuestSource
	lists int
}

func (c *countingSource) List(ctx context.Context) ([]guests.Guest, []guests.Link, error) {
	c.lists++
	return c.GuestSource.List(ctx)
}

type env struct {
	plans  *scenarios.Service
	guests *guests.Service
	source *countingSource
	store  *store.Scenarios
}

// newEnv wires the real services over a real migrated SQLite file (no DB mocks) and creates
// n enabled guests named G01.. with ids 1..n.
func newEnv(t *testing.T, n int) *env {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "stoliki.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := store.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	gstore := store.NewGuests(db)
	e := &env{guests: guests.NewService(gstore), source: &countingSource{GuestSource: gstore}, store: store.NewScenarios(db)}
	e.plans = scenarios.NewService(e.store, e.source)
	for i := 1; i <= n; i++ {
		if _, err := e.guests.Create(context.Background(), guests.NewGuest{FirstName: fmt.Sprintf("G%02d", i), Enabled: true}); err != nil {
			t.Fatal(err)
		}
	}
	return e
}

func (e *env) link(t *testing.T, a, b int64, level seating.LinkLevel) {
	t.Helper()
	if _, err := e.guests.SetLink(context.Background(), a, b, level); err != nil {
		t.Fatal(err)
	}
}

func (e *env) toggle(t *testing.T, enabled bool, ids ...int64) {
	t.Helper()
	if _, _, err := e.guests.Toggle(context.Background(), ids, enabled); err != nil {
		t.Fatal(err)
	}
}

func table(number int, ids ...int64) seating.Table {
	tb := seating.Table{Number: number}
	for _, id := range ids {
		tb.Seats = append(tb.Seats, seating.Seat{Guest: id})
	}
	return tb
}

func rng(from, to int64) []int64 {
	var out []int64
	for i := from; i <= to; i++ {
		out = append(out, i)
	}
	return out
}

func plan(t *testing.T, e *env, capacity int) scenarios.Evaluated {
	t.Helper()
	all, err := e.plans.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, ev := range all {
		if ev.State.Plan.Capacity == capacity {
			return ev
		}
	}
	t.Fatalf("no plan %d", capacity)
	return scenarios.Evaluated{}
}

func tableOf(p seating.Plan, guest int64) (table int, pinned, ok bool) {
	for _, t := range p.Tables {
		for _, s := range t.Seats {
			if s.Guest == guest {
				return t.Number, s.Pinned, true
			}
		}
	}
	return 0, false, false
}

func hasViolation(ev seating.Evaluation, code seating.ViolationCode) bool {
	return slices.ContainsFunc(ev.Violations, func(v seating.Violation) bool { return v.Code == code })
}

func wantValidation(t *testing.T, err error, field string) {
	t.Helper()
	var v apperr.Validation
	if !errors.As(err, &v) || v.Field != field {
		t.Fatalf("err = %v, want Validation on %q", err, field)
	}
}

func TestListReturnsThreeEvaluatedEmptyPlans(t *testing.T) {
	e := newEnv(t, 7)
	got, err := e.plans.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("List = %d, want 3", len(got))
	}
	for i, c := range []int{8, 10, 12} {
		ev := got[i]
		if ev.State.Plan.Capacity != c || ev.State.Version != 1 {
			t.Errorf("plan %d = %+v", i, ev.State)
		}
		// an empty plan with 7 enabled guests: they are all unseated, which needs recalculation
		if ev.Eval.Summary.Unseated != 7 || !ev.Eval.Summary.NeedsRecalculation || !hasViolation(ev.Eval, seating.ViolUnseated) {
			t.Errorf("plan %d summary = %+v", c, ev.Eval.Summary)
		}
	}
}

func TestCalculate(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 24)
	e.link(t, 1, 2, seating.Must) // cluster {1,2}

	e.source.lists = 0
	props, err := e.plans.Calculate(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if e.source.lists != 1 {
		t.Errorf("guest list read %d times, want 1 (one graph for all three capacities)", e.source.lists)
	}
	if len(props) != 3 {
		t.Fatalf("Calculate = %d proposals, want 3", len(props))
	}
	wantTables := map[int]int{8: 3, 10: 3, 12: 2}
	for i, c := range []int{8, 10, 12} {
		p := props[i]
		if p.Plan.Capacity != c || p.BasedOnVersion != 1 {
			t.Errorf("proposal %d = capacity %d basedOn %d", i, p.Plan.Capacity, p.BasedOnVersion)
		}
		if len(p.Plan.Tables) != wantTables[c] || p.Eval.Summary.NeedsRecalculation || p.Eval.Summary.Seated != 24 {
			t.Errorf("capacity %d: %d tables, summary %+v", c, len(p.Plan.Tables), p.Eval.Summary)
		}
		a, _, _ := tableOf(p.Plan, 1)
		b, _, _ := tableOf(p.Plan, 2)
		if a == 0 || a != b {
			t.Errorf("capacity %d: cluster {1,2} split over tables %d and %d", c, a, b)
		}
	}

	t.Run("stores nothing", func(t *testing.T) {
		for _, ev := range mustList(t, e) {
			if ev.State.Version != 1 || len(ev.State.Plan.Tables) != 0 {
				t.Errorf("plan %d changed: %+v", ev.State.Plan.Capacity, ev.State)
			}
		}
	})

	t.Run("pinned clusters stay put and are flagged in the proposal", func(t *testing.T) {
		e := newEnv(t, 24)
		if _, err := e.plans.Accept(ctx, 10, 1, []seating.Table{table(1, rng(1, 8)...), table(2, rng(9, 16)...), table(3, rng(17, 24)...)}); err != nil {
			t.Fatal(err)
		}
		if _, err := e.plans.Seat(ctx, 10, 5, 3, true); err != nil { // pin 5 at table 3
			t.Fatal(err)
		}
		props, err := e.plans.Calculate(ctx)
		if err != nil {
			t.Fatal(err)
		}
		p10 := props[1]
		if n, pinned, _ := tableOf(p10.Plan, 5); n != 3 || !pinned {
			t.Errorf("guest 5 at table %d pinned=%v, want table 3 pinned", n, pinned)
		}
		if p10.BasedOnVersion != 3 {
			t.Errorf("basedOnVersion = %d, want 3 (accept + pin)", p10.BasedOnVersion)
		}
	})
}

func mustList(t *testing.T, e *env) []scenarios.Evaluated {
	t.Helper()
	got, err := e.plans.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestAcceptValidation(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 12)
	tests := []struct {
		name      string
		tables    []seating.Table
		wantField string
	}{
		{"gap in numbering", []seating.Table{table(1, 1), table(3, 2)}, "tables"},
		{"does not start at 1", []seating.Table{table(2, 1)}, "tables"},
		{"duplicate table number", []seating.Table{table(1, 1), table(1, 2)}, "tables"},
		{"table number zero", []seating.Table{table(0, 1)}, "tables"},
		{"guest at two tables", []seating.Table{table(1, 1, 2), table(2, 2, 3)}, "tables"},
		{"guest twice at one table", []seating.Table{table(1, 1, 1)}, "tables"},
		{"unknown guest", []seating.Table{table(1, 1, 999)}, "tables"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := e.plans.Accept(ctx, 10, 1, tc.tables)
			wantValidation(t, err, tc.wantField)
			if ev := plan(t, e, 10); ev.State.Version != 1 || len(ev.State.Plan.Tables) != 0 {
				t.Errorf("a rejected accept changed the plan: %+v", ev.State)
			}
		})
	}

	t.Run("unsorted but complete numbering is accepted and stored 1..k", func(t *testing.T) {
		got, err := e.plans.Accept(ctx, 10, 1, []seating.Table{table(2, 3, 4), table(1, 1, 2)})
		if err != nil {
			t.Fatal(err)
		}
		if n := got.State.Plan.Tables; len(n) != 2 || n[0].Number != 1 || n[1].Number != 2 {
			t.Errorf("tables = %+v", n)
		}
		if tb, _, _ := tableOf(got.State.Plan, 1); tb != 1 {
			t.Errorf("guest 1 at table %d", tb)
		}
	})

	t.Run("an empty layout is valid (clears the plan)", func(t *testing.T) {
		got, err := e.plans.Accept(ctx, 12, 1, nil)
		if err != nil || len(got.State.Plan.Tables) != 0 || got.State.Version != 2 {
			t.Errorf("got %+v, %v", got.State, err)
		}
	})

	t.Run("unknown capacity is not found", func(t *testing.T) {
		if _, err := e.plans.Accept(ctx, 9, 1, nil); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})
}

func TestAcceptVersionConflict(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 6)
	if _, err := e.plans.Accept(ctx, 8, 1, []seating.Table{table(1, 1, 2)}); err != nil { // -> version 2
		t.Fatal(err)
	}
	_, err := e.plans.Accept(ctx, 8, 1, []seating.Table{table(1, 3)}) // stale
	if !errors.Is(err, apperr.ErrVersionConflict) {
		t.Fatalf("err = %v, want ErrVersionConflict", err)
	}
	if ev := plan(t, e, 8); ev.State.Version != 2 {
		t.Errorf("version = %d, want 2", ev.State.Version)
	}
	// the other plans are independent
	if _, err := e.plans.Accept(ctx, 10, 1, []seating.Table{table(1, 3)}); err != nil {
		t.Errorf("accept on plan 10: %v", err)
	}
}

func TestAcceptExpandsDisabledMembersAndKeepsPins(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 10)
	e.link(t, 1, 2, seating.Must)
	e.link(t, 1, 3, seating.Must) // cluster {1,2,3}; 3 is a disabled child
	e.toggle(t, false, 3)

	got, err := e.plans.Accept(ctx, 10, 1, []seating.Table{table(1, 1, 2, 4, 5), table(2, 6, 7, 8, 9, 10)})
	if err != nil {
		t.Fatal(err)
	}
	if tb, _, ok := tableOf(got.State.Plan, 3); !ok || tb != 1 {
		t.Errorf("disabled guest 3 at table %d (seated %v), want table 1 with its cluster", tb, ok)
	}
	if got.Eval.Tables[0].Fill != 4 { // 1,2,4,5 - the disabled child does not count
		t.Errorf("fill = %d, want 4", got.Eval.Tables[0].Fill)
	}

	t.Run("pins of previously pinned clusters survive a later accept, whichever table they land on", func(t *testing.T) {
		if _, err := e.plans.Seat(ctx, 10, 2, 2, true); err != nil { // pin cluster {1,2,3} at table 2
			t.Fatal(err)
		}
		cur := plan(t, e, 10).State
		got, err := e.plans.Accept(ctx, 10, cur.Version, []seating.Table{table(1, 4, 5, 6, 7, 8), table(2, 1, 2, 9, 10)})
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range []int64{1, 2, 3} {
			if tb, pinned, ok := tableOf(got.State.Plan, id); !ok || tb != 2 || !pinned {
				t.Errorf("guest %d: table %d pinned %v seated %v, want table 2 pinned", id, tb, pinned, ok)
			}
		}
		if _, pinned, _ := tableOf(got.State.Plan, 4); pinned {
			t.Error("guest 4 must not become pinned")
		}
		if !got.Eval.Tables[1].Clusters[0].Pinned {
			t.Errorf("evaluation does not show the pin: %+v", got.Eval.Tables[1])
		}
	})
}

func TestSeatMovesWholeClusterIncludingDisabled(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 10)
	e.link(t, 1, 2, seating.Must)
	e.link(t, 2, 3, seating.Must) // cluster {1,2,3}, key 1
	e.toggle(t, false, 3)
	if _, err := e.plans.Accept(ctx, 10, 1, []seating.Table{table(1, 1, 2, 4, 5, 6), table(2, 7, 8, 9, 10)}); err != nil {
		t.Fatal(err)
	}

	// addressed through ANY member, even a disabled one
	for _, via := range []int64{2, 3} {
		t.Run(fmt.Sprintf("via member %d", via), func(t *testing.T) {
			for _, target := range []int{2, 1} {
				got, err := e.plans.Seat(ctx, 10, via, target, false)
				if err != nil {
					t.Fatal(err)
				}
				for _, id := range []int64{1, 2, 3} {
					if tb, _, ok := tableOf(got.State.Plan, id); !ok || tb != target {
						t.Errorf("guest %d at table %d, want %d", id, tb, target)
					}
				}
			}
		})
	}

	t.Run("pin and unpin apply to the whole cluster", func(t *testing.T) {
		got, err := e.plans.Seat(ctx, 10, 1, 1, true)
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range []int64{1, 2, 3} {
			if _, pinned, _ := tableOf(got.State.Plan, id); !pinned {
				t.Errorf("guest %d not pinned", id)
			}
		}
		if !got.Eval.Tables[0].Clusters[0].Pinned {
			t.Errorf("pin missing in the evaluation: %+v", got.Eval.Tables[0])
		}
		got, err = e.plans.Seat(ctx, 10, 3, 1, false)
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range []int64{1, 2, 3} {
			if _, pinned, _ := tableOf(got.State.Plan, id); pinned {
				t.Errorf("guest %d still pinned", id)
			}
		}
	})

	t.Run("version bumps on every move", func(t *testing.T) {
		before := plan(t, e, 10).State.Version
		got, err := e.plans.Seat(ctx, 10, 1, 2, false)
		if err != nil || got.State.Version != before+1 {
			t.Errorf("version %d -> %d, %v", before, got.State.Version, err)
		}
	})

	t.Run("other plans are untouched", func(t *testing.T) {
		if ev := plan(t, e, 8); ev.State.Version != 1 {
			t.Errorf("plan 8 version = %d", ev.State.Version)
		}
	})
}

func TestSeatErrors(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 8)
	if _, err := e.plans.Accept(ctx, 10, 1, []seating.Table{table(1, rng(1, 8)...)}); err != nil {
		t.Fatal(err)
	}
	t.Run("unknown table is a validation error on tableNumber", func(t *testing.T) {
		for _, n := range []int{0, 2, -1} {
			_, err := e.plans.Seat(ctx, 10, 1, n, false)
			wantValidation(t, err, "tableNumber")
		}
	})
	t.Run("unknown guest and unknown capacity are not found", func(t *testing.T) {
		if _, err := e.plans.Seat(ctx, 10, 999, 1, false); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("unknown guest: %v", err)
		}
		if _, err := e.plans.Seat(ctx, 9, 1, 1, false); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("unknown capacity: %v", err)
		}
		if _, err := e.plans.Unseat(ctx, 10, 999); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("unseat unknown guest: %v", err)
		}
	})
}

func TestSeatOverfillIsAllowedAndReported(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 10)
	if _, err := e.plans.Accept(ctx, 8, 1, []seating.Table{table(1, rng(1, 8)...), table(2, 9, 10)}); err != nil {
		t.Fatal(err)
	}
	got, err := e.plans.Seat(ctx, 8, 9, 1, false) // table 1 is full (8/8)
	if err != nil {
		t.Fatalf("overfilling must not be blocked: %v", err)
	}
	if !hasViolation(got.Eval, seating.ViolOverCapacity) || !got.Eval.Summary.NeedsRecalculation || got.Eval.Tables[0].Fill != 9 {
		t.Errorf("summary %+v violations %+v", got.Eval.Summary, got.Eval.Violations)
	}
}

func TestUnseatMovesWholeClusterToTheTray(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 8)
	e.link(t, 1, 2, seating.Must)
	e.toggle(t, false, 2)
	if _, err := e.plans.Accept(ctx, 10, 1, []seating.Table{table(1, 1, 3, 4, 5, 6, 7, 8)}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.plans.Seat(ctx, 10, 1, 1, true); err != nil {
		t.Fatal(err)
	}
	got, err := e.plans.Unseat(ctx, 10, 2) // via the disabled member
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []int64{1, 2} {
		if _, _, ok := tableOf(got.State.Plan, id); ok {
			t.Errorf("guest %d is still seated", id)
		}
	}
	if len(got.Eval.Unseated) != 1 || got.Eval.Unseated[0].ClusterKey != 1 || !slices.Equal(got.Eval.Unseated[0].Guests, []int64{1}) {
		t.Errorf("unseated = %+v, want cluster 1 with enabled member 1", got.Eval.Unseated)
	}
	if !hasViolation(got.Eval, seating.ViolUnseated) {
		t.Errorf("violations = %+v", got.Eval.Violations)
	}
	// idempotent
	if _, err := e.plans.Unseat(ctx, 10, 1); err != nil {
		t.Errorf("second unseat: %v", err)
	}
}

func TestAddAndRemoveTable(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 12)
	if _, err := e.plans.Accept(ctx, 10, 1, []seating.Table{table(1, rng(1, 4)...), table(2, rng(5, 8)...), table(3, 9, 10), table(4, 11, 12)}); err != nil {
		t.Fatal(err)
	}
	got, err := e.plans.AddTable(ctx, 10)
	if err != nil || len(got.State.Plan.Tables) != 5 || got.State.Plan.Tables[4].Number != 5 || got.Eval.Summary.TableCount != 5 {
		t.Fatalf("AddTable: %+v, %v", got.State, err)
	}

	got, err = e.plans.RemoveTable(ctx, 10, 2)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(got.State.Plan.Tables); n != 4 {
		t.Fatalf("tables = %d, want 4", n)
	}
	for i, tb := range got.State.Plan.Tables {
		if tb.Number != i+1 {
			t.Errorf("table %d has number %d (numbers must stay 1..k)", i, tb.Number)
		}
	}
	if _, _, ok := tableOf(got.State.Plan, 5); ok {
		t.Error("guest 5 (table 2) must be unseated")
	}
	if tb, _, _ := tableOf(got.State.Plan, 9); tb != 2 {
		t.Errorf("guest 9 (was table 3) at table %d, want 2", tb)
	}
	if !hasViolation(got.Eval, seating.ViolUnseated) {
		t.Errorf("violations = %+v", got.Eval.Violations)
	}

	if _, err := e.plans.RemoveTable(ctx, 10, 9); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("RemoveTable(9) err = %v, want ErrNotFound", err)
	}
	if _, err := e.plans.AddTable(ctx, 9); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("AddTable(9) err = %v, want ErrNotFound", err)
	}
}

// Flow 3 (sequence diagram): a re-enabled child rides along to its cluster's full table; the
// plan then needs recalculation, and nothing regenerates by itself.
func TestReEnabledGuestOverfillsTableAndNeedsRecalculation(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 9)
	e.link(t, 1, 2, seating.Must)
	e.link(t, 1, 3, seating.Must) // cluster {1,2,3}
	e.toggle(t, false, 3)

	// 8 enabled guests at table 1 of the 8-seat plan: the plan is complete (no violations)
	// and the disabled child 3 rides along via ExpandDisabled.
	got, err := e.plans.Accept(ctx, 8, 1, []seating.Table{table(1, 1, 2, 4, 5, 6, 7, 8, 9)})
	if err != nil {
		t.Fatal(err)
	}
	if got.Eval.Summary.NeedsRecalculation || got.Eval.Tables[0].Fill != 8 {
		t.Fatalf("precondition: fill %d summary %+v", got.Eval.Tables[0].Fill, got.Eval.Summary)
	}

	e.toggle(t, true, 3)
	after := plan(t, e, 8)
	if after.State.Version != got.State.Version {
		t.Errorf("toggling a guest must not touch the plan (version %d -> %d)", got.State.Version, after.State.Version)
	}
	if tb, _, ok := tableOf(after.State.Plan, 3); !ok || tb != 1 {
		t.Fatalf("re-enabled guest 3 at table %d (seated %v), want table 1", tb, ok)
	}
	if after.Eval.Tables[0].Fill != 9 || !hasViolation(after.Eval, seating.ViolOverCapacity) || !after.Eval.Summary.NeedsRecalculation {
		t.Errorf("fill %d, summary %+v, violations %+v", after.Eval.Tables[0].Fill, after.Eval.Summary, after.Eval.Violations)
	}

	// a never-seated guest re-enabled shows up in the tray
	e2 := newEnv(t, 2)
	e2.toggle(t, false, 2)
	if _, err := e2.plans.Accept(ctx, 10, 1, []seating.Table{table(1, 1)}); err != nil {
		t.Fatal(err)
	}
	e2.toggle(t, true, 2)
	if ev := plan(t, e2, 10); !hasViolation(ev.Eval, seating.ViolUnseated) || !ev.Eval.Summary.NeedsRecalculation {
		t.Errorf("violations = %+v", ev.Eval.Violations)
	}
}
