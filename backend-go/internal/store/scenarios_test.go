package store

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"testing"

	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/seating"
)

// newScenarios returns the Scenarios store and a Guests store over one migrated temp DB,
// plus n guests (ids 1..n) so assignments have something to point at.
func newScenarios(t *testing.T, n int) (*Scenarios, *sql.DB) {
	t.Helper()
	gs, db := newGuests(t)
	for i := 0; i < n; i++ {
		mustCreate(t, gs, "G"+string(rune('A'+i)), nil)
	}
	return NewScenarios(db), db
}

// layout builds a plan for capacity with tables numbered 1..len(tables); each table lists its guests.
func layout(capacity int, tables ...[]int64) seating.Plan {
	p := seating.Plan{Capacity: capacity}
	for i, ids := range tables {
		tb := seating.Table{Number: i + 1}
		for _, id := range ids {
			tb.Seats = append(tb.Seats, seating.Seat{Guest: id})
		}
		p.Tables = append(p.Tables, tb)
	}
	return p
}

// tableOf returns guest -> table number and guest -> pinned for the plan.
func tableOf(p seating.Plan) (map[int64]int, map[int64]bool) {
	at, pin := map[int64]int{}, map[int64]bool{}
	for _, t := range p.Tables {
		for _, s := range t.Seats {
			at[s.Guest] = t.Number
			pin[s.Guest] = s.Pinned
		}
	}
	return at, pin
}

func numbers(p seating.Plan) []int {
	out := make([]int, len(p.Tables))
	for i, t := range p.Tables {
		out[i] = t.Number
	}
	return out
}

func TestScenariosListReturnsThreeOrdered(t *testing.T) {
	s, _ := newScenarios(t, 0)
	got, err := s.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("List = %d scenarios, want 3", len(got))
	}
	for i, want := range []int{8, 10, 12} {
		if got[i].Plan.Capacity != want || got[i].Version != 1 || len(got[i].Plan.Tables) != 0 {
			t.Errorf("scenario %d = %+v, want empty capacity %d at version 1", i, got[i], want)
		}
	}
}

func TestScenariosGet(t *testing.T) {
	ctx := context.Background()
	s, _ := newScenarios(t, 0)
	got, err := s.Get(ctx, 10)
	if err != nil || got.Plan.Capacity != 10 {
		t.Fatalf("Get(10) = %+v, %v", got, err)
	}
	if _, err := s.Get(ctx, 9); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("Get(9) err = %v, want ErrNotFound", err)
	}
}

func TestScenariosReplacePlan(t *testing.T) {
	ctx := context.Background()
	s, _ := newScenarios(t, 4)

	t.Run("replaces tables, seats and pins and bumps the version", func(t *testing.T) {
		p := layout(10, []int64{1, 2}, []int64{3})
		p.Tables[0].Seats[1].Pinned = true
		got, err := s.ReplacePlan(ctx, 10, 1, p)
		if err != nil {
			t.Fatal(err)
		}
		if got.Version != 2 || !slices.Equal(numbers(got.Plan), []int{1, 2}) {
			t.Fatalf("state = %+v", got)
		}
		at, pin := tableOf(got.Plan)
		if at[1] != 1 || at[2] != 1 || at[3] != 2 || len(at) != 3 || !pin[2] || pin[1] || pin[3] {
			t.Errorf("seats = %v pins = %v", at, pin)
		}

		// a second replace drops everything the first one stored
		got, err = s.ReplacePlan(ctx, 10, 2, layout(10, []int64{4}))
		if err != nil {
			t.Fatal(err)
		}
		at, _ = tableOf(got.Plan)
		if got.Version != 3 || len(got.Plan.Tables) != 1 || len(at) != 1 || at[4] != 1 {
			t.Errorf("state = %+v", got)
		}
	})

	t.Run("stale version is ErrVersionConflict and changes nothing", func(t *testing.T) {
		before, _ := s.Get(ctx, 10)
		_, err := s.ReplacePlan(ctx, 10, before.Version-1, layout(10, []int64{1}))
		if !errors.Is(err, apperr.ErrVersionConflict) {
			t.Fatalf("err = %v, want ErrVersionConflict", err)
		}
		after, _ := s.Get(ctx, 10)
		if after.Version != before.Version || len(after.Plan.Tables) != len(before.Plan.Tables) {
			t.Errorf("state changed: %+v -> %+v", before, after)
		}
	})

	t.Run("only the addressed scenario changes", func(t *testing.T) {
		for _, c := range []int{8, 12} {
			if got, _ := s.Get(ctx, c); got.Version != 1 || len(got.Plan.Tables) != 0 {
				t.Errorf("scenario %d = %+v, want untouched", c, got)
			}
		}
	})

	t.Run("unknown capacity", func(t *testing.T) {
		if _, err := s.ReplacePlan(ctx, 9, 1, layout(9)); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("unknown guest rolls everything back", func(t *testing.T) {
		before, _ := s.Get(ctx, 12)
		_, err := s.ReplacePlan(ctx, 12, before.Version, layout(12, []int64{1, 999}))
		if !errors.Is(err, apperr.ErrNotFound) {
			t.Fatalf("err = %v, want ErrNotFound", err)
		}
		if after, _ := s.Get(ctx, 12); after.Version != before.Version || len(after.Plan.Tables) != 0 {
			t.Errorf("state = %+v, want untouched", after)
		}
	})
}

func TestScenariosSeatCluster(t *testing.T) {
	ctx := context.Background()
	s, _ := newScenarios(t, 4)
	if _, err := s.ReplacePlan(ctx, 8, 1, layout(8, []int64{1}, []int64{2}, nil)); err != nil { // version 2
		t.Fatal(err)
	}

	t.Run("upserts every member (moves seated, seats unseated) with the pin", func(t *testing.T) {
		got, err := s.SeatCluster(ctx, 8, []int64{1, 3, 4}, 3, true)
		if err != nil {
			t.Fatal(err)
		}
		at, pin := tableOf(got.Plan)
		if got.Version != 3 || at[1] != 3 || at[3] != 3 || at[4] != 3 || at[2] != 2 {
			t.Fatalf("version %d seats %v", got.Version, at)
		}
		if !pin[1] || !pin[3] || !pin[4] || pin[2] {
			t.Errorf("pins = %v", pin)
		}
		if len(got.Plan.Tables[0].Seats) != 0 { // table 1 lost its only guest
			t.Errorf("table 1 seats = %v", got.Plan.Tables[0].Seats)
		}
	})

	t.Run("seating again unpins when asked to", func(t *testing.T) {
		got, err := s.SeatCluster(ctx, 8, []int64{1, 3, 4}, 3, false)
		if err != nil {
			t.Fatal(err)
		}
		if _, pin := tableOf(got.Plan); pin[1] || pin[3] || pin[4] {
			t.Errorf("pins = %v, want none", pin)
		}
	})

	t.Run("unknown table is ErrNotFound and changes nothing", func(t *testing.T) {
		before, _ := s.Get(ctx, 8)
		if _, err := s.SeatCluster(ctx, 8, []int64{1}, 9, false); !errors.Is(err, apperr.ErrNotFound) {
			t.Fatalf("err = %v, want ErrNotFound", err)
		}
		if after, _ := s.Get(ctx, 8); after.Version != before.Version {
			t.Errorf("version %d -> %d", before.Version, after.Version)
		}
	})

	t.Run("a table of another scenario is not a valid target (same number, other plan)", func(t *testing.T) {
		// Scenario 10 has no tables at all, so table 1 does not exist there.
		if _, err := s.SeatCluster(ctx, 10, []int64{1}, 1, false); !errors.Is(err, apperr.ErrNotFound) {
			t.Fatalf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("unknown guest is ErrNotFound and rolls back the members already seated", func(t *testing.T) {
		before, _ := s.Get(ctx, 8)
		if _, err := s.SeatCluster(ctx, 8, []int64{2, 999}, 1, false); !errors.Is(err, apperr.ErrNotFound) {
			t.Fatalf("err = %v, want ErrNotFound", err)
		}
		after, _ := s.Get(ctx, 8)
		if at, _ := tableOf(after.Plan); at[2] != 2 || after.Version != before.Version {
			t.Errorf("guest 2 moved or version bumped: %v v%d", at, after.Version)
		}
	})
}

func TestScenariosUnseatCluster(t *testing.T) {
	ctx := context.Background()
	s, _ := newScenarios(t, 3)
	p := layout(10, []int64{1, 2}, []int64{3})
	p.Tables[0].Seats[0].Pinned = true
	if _, err := s.ReplacePlan(ctx, 10, 1, p); err != nil {
		t.Fatal(err)
	}
	got, err := s.UnseatCluster(ctx, 10, []int64{1, 2})
	if err != nil {
		t.Fatal(err)
	}
	at, _ := tableOf(got.Plan)
	if got.Version != 3 || len(at) != 1 || at[3] != 2 || len(got.Plan.Tables) != 2 {
		t.Errorf("state = %+v seats %v", got, at)
	}
	// idempotent: unseating the unseated still succeeds (and bumps the version)
	got, err = s.UnseatCluster(ctx, 10, []int64{1, 2})
	if err != nil || got.Version != 4 {
		t.Errorf("repeat = %+v, %v", got, err)
	}
}

func TestScenariosAddTable(t *testing.T) {
	ctx := context.Background()
	s, _ := newScenarios(t, 0)
	for want := 1; want <= 3; want++ {
		got, err := s.AddTable(ctx, 12)
		if err != nil {
			t.Fatal(err)
		}
		if got.Version != int64(want+1) || len(got.Plan.Tables) != want || got.Plan.Tables[want-1].Number != want {
			t.Fatalf("after add %d: %+v", want, got)
		}
	}
	if _, err := s.AddTable(ctx, 9); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("AddTable(9) err = %v, want ErrNotFound", err)
	}
}

func TestScenariosRemoveTableRenumbers(t *testing.T) {
	ctx := context.Background()
	s, _ := newScenarios(t, 5)
	p := layout(10, []int64{1}, []int64{2, 3}, []int64{4}, []int64{5})
	p.Tables[2].Seats[0].Pinned = true
	if _, err := s.ReplacePlan(ctx, 10, 1, p); err != nil { // version 2
		t.Fatal(err)
	}

	got, err := s.RemoveTable(ctx, 10, 2)
	if err != nil {
		t.Fatal(err)
	}
	if got.Version != 3 || !slices.Equal(numbers(got.Plan), []int{1, 2, 3}) {
		t.Fatalf("state = %+v", got)
	}
	at, pin := tableOf(got.Plan)
	if _, seated := at[2]; seated {
		t.Error("guest 2 should be unseated")
	}
	if _, seated := at[3]; seated {
		t.Error("guest 3 should be unseated")
	}
	if at[1] != 1 || at[4] != 2 || at[5] != 3 || !pin[4] {
		t.Errorf("seats %v pins %v: guests 4,5 must follow their tables down (3->2, 4->3)", at, pin)
	}

	t.Run("removing the last table needs no renumbering", func(t *testing.T) {
		got, err := s.RemoveTable(ctx, 10, 3)
		if err != nil || !slices.Equal(numbers(got.Plan), []int{1, 2}) {
			t.Fatalf("got %+v, %v", got, err)
		}
	})
	t.Run("unknown table is ErrNotFound and bumps nothing", func(t *testing.T) {
		before, _ := s.Get(ctx, 10)
		if _, err := s.RemoveTable(ctx, 10, 7); !errors.Is(err, apperr.ErrNotFound) {
			t.Fatalf("err = %v, want ErrNotFound", err)
		}
		if after, _ := s.Get(ctx, 10); after.Version != before.Version {
			t.Errorf("version %d -> %d", before.Version, after.Version)
		}
	})
}

func TestScenariosClearPlan(t *testing.T) {
	ctx := context.Background()
	s, db := newScenarios(t, 4)
	p := layout(10, []int64{1, 2}, []int64{3})
	p.Tables[0].Seats[1].Pinned = true
	if _, err := s.ReplacePlan(ctx, 10, 1, p); err != nil { // version 2
		t.Fatal(err)
	}
	if _, err := s.ReplacePlan(ctx, 8, 1, layout(8, []int64{4})); err != nil { // version 2
		t.Fatal(err)
	}
	plan8Before, _ := s.Get(ctx, 8)

	count := func(query string, args ...any) (n int) {
		t.Helper()
		if err := db.QueryRowContext(ctx, query, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	const perScenario = "(SELECT id FROM scenario WHERE capacity = ?)"

	got, err := s.ClearPlan(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if got.Version != 3 || got.Plan.Capacity != 10 || len(got.Plan.Tables) != 0 {
		t.Fatalf("ClearPlan(10) = %+v, want an empty plan at version 3", got)
	}
	if fresh, _ := s.Get(ctx, 10); fresh.Version != 3 || len(fresh.Plan.Tables) != 0 {
		t.Errorf("Get(10) = %+v", fresh)
	}
	// cascade: dining_table -> assignment (pins live on the assignment row)
	if n := count("SELECT COUNT(*) FROM dining_table WHERE scenario_id = "+perScenario, 10); n != 0 {
		t.Errorf("%d dining_table rows left for scenario 10", n)
	}
	if n := count("SELECT COUNT(*) FROM assignment WHERE scenario_id = "+perScenario, 10); n != 0 {
		t.Errorf("%d assignment rows left for scenario 10", n)
	}

	t.Run("other scenarios are untouched", func(t *testing.T) {
		plan8After, _ := s.Get(ctx, 8)
		if plan8After.Version != plan8Before.Version || !slices.Equal(numbers(plan8After.Plan), numbers(plan8Before.Plan)) {
			t.Errorf("plan 8 changed: %+v -> %+v", plan8Before, plan8After)
		}
		if at, _ := tableOf(plan8After.Plan); at[4] != 1 || len(at) != 1 {
			t.Errorf("plan 8 seats = %v", at)
		}
		if got, _ := s.Get(ctx, 12); got.Version != 1 {
			t.Errorf("plan 12 version = %d, want 1", got.Version)
		}
		if n := count("SELECT COUNT(*) FROM assignment WHERE scenario_id = "+perScenario, 8); n != 1 {
			t.Errorf("plan 8 has %d assignment rows, want 1", n)
		}
	})

	t.Run("an empty plan clears again; only the version moves", func(t *testing.T) {
		again, err := s.ClearPlan(ctx, 10)
		if err != nil || again.Version != 4 || len(again.Plan.Tables) != 0 {
			t.Errorf("repeat = %+v, %v", again, err)
		}
	})
}

func TestScenariosClearPlanUnknownCapacity(t *testing.T) {
	s, _ := newScenarios(t, 0)
	if _, err := s.ClearPlan(context.Background(), 9); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("ClearPlan(9) err = %v, want ErrNotFound", err)
	}
}

func TestScenariosTableMustBelongToTheAssignmentsScenario(t *testing.T) {
	// DB-enforced (composite FK): a raw insert pointing scenario 8's assignment at a table of
	// scenario 10 must fail, whatever the store does.
	ctx := context.Background()
	s, db := newScenarios(t, 1)
	if _, err := s.AddTable(ctx, 10); err != nil {
		t.Fatal(err)
	}
	_, err := db.ExecContext(ctx, `INSERT INTO assignment (scenario_id, guest_id, table_id)
		SELECT (SELECT id FROM scenario WHERE capacity = 8), 1, id FROM dining_table`)
	if err == nil {
		t.Fatal("cross-scenario assignment was accepted")
	}
}

func TestScenariosDeletedGuestLeavesItsSeat(t *testing.T) {
	ctx := context.Background()
	gs, db := newGuests(t)
	mustCreate(t, gs, "A", nil)
	mustCreate(t, gs, "B", nil)
	s := NewScenarios(db)
	if _, err := s.ReplacePlan(ctx, 10, 1, layout(10, []int64{1, 2})); err != nil {
		t.Fatal(err)
	}
	if err := gs.Delete(ctx, 1); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(ctx, 10)
	if at, _ := tableOf(got.Plan); len(at) != 1 || at[2] != 1 {
		t.Errorf("seats = %v", at)
	}
}
