package scenarios_test

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
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

// startVersion is the version of an untouched plan on a fresh database: migration 00002 bumps
// the plan it converts from 8 to 9 seats (also when the database is new).
func startVersion(k scenarios.Key) int64 {
	if k == uk(9) {
		return 2
	}
	return 1
}

// uk is the key of a uniform plan; mixedKey the mixed plan's.
func uk(capacity int) scenarios.Key { return scenarios.Key{Capacity: capacity} }

var mixedKey = scenarios.Key{Capacity: 12, Mixed: true}

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

func plan(t *testing.T, e *env, key scenarios.Key) scenarios.Evaluated {
	t.Helper()
	all, err := e.plans.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, ev := range all {
		if ev.State.Key() == key {
			return ev
		}
	}
	t.Fatalf("no plan %v", key)
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

func TestListReturnsFiveEvaluatedEmptyPlans(t *testing.T) {
	e := newEnv(t, 7)
	got, err := e.plans.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 5 {
		t.Fatalf("List = %d, want 5", len(got))
	}
	for i, c := range scenarios.Keys {
		ev := got[i]
		if ev.State.Key() != c || ev.State.Version != startVersion(c) {
			t.Errorf("plan %d = %+v", i, ev.State)
		}
		// an empty plan with 7 enabled guests: they are all unseated, which needs recalculation
		if ev.Eval.Summary.Unseated != 7 || !ev.Eval.Summary.NeedsRecalculation || !hasViolation(ev.Eval, seating.ViolUnseated) {
			t.Errorf("plan %v summary = %+v", c, ev.Eval.Summary)
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
		t.Errorf("guest list read %d times, want 1 (one graph for all five plans)", e.source.lists)
	}
	if len(props) != 5 {
		t.Fatalf("Calculate = %d proposals, want 5", len(props))
	}
	// 24 guests, floor 8: three tables of 8 at capacities 9, 10 and 11; two of 12 at capacity 12
	// and in the mixed plan (floor 9: k in [2, 2] at 24 guests)
	wantTables := map[scenarios.Key]int{uk(9): 3, uk(10): 3, uk(11): 3, uk(12): 2, mixedKey: 2}
	for i, c := range scenarios.Keys {
		p := props[i]
		if p.Plan.Capacity != c.Capacity || p.Plan.Mixed != c.Mixed || p.BasedOnVersion != startVersion(c) {
			t.Errorf("proposal %d = capacity %d mixed %v basedOn %d", i, p.Plan.Capacity, p.Plan.Mixed, p.BasedOnVersion)
		}
		if len(p.Plan.Tables) != wantTables[c] || p.Eval.Summary.NeedsRecalculation || p.Eval.Summary.Seated != 24 {
			t.Errorf("plan %v: %d tables, summary %+v", c, len(p.Plan.Tables), p.Eval.Summary)
		}
		a, _, _ := tableOf(p.Plan, 1)
		b, _, _ := tableOf(p.Plan, 2)
		if a == 0 || a != b {
			t.Errorf("plan %v: cluster {1,2} split over tables %d and %d", c, a, b)
		}
	}

	t.Run("stores nothing", func(t *testing.T) {
		for _, ev := range mustList(t, e) {
			if ev.State.Version != startVersion(ev.State.Key()) || len(ev.State.Plan.Tables) != 0 {
				t.Errorf("plan %v changed: %+v", ev.State.Key(), ev.State)
			}
		}
	})

	t.Run("pinned clusters stay put and are flagged in the proposal", func(t *testing.T) {
		e := newEnv(t, 24)
		if _, err := e.accept(ctx, uk(10), 1, []seating.Table{table(1, rng(1, 8)...), table(2, rng(9, 16)...), table(3, rng(17, 24)...)}); err != nil {
			t.Fatal(err)
		}
		if _, err := e.plans.Seat(ctx, uk(10), 5, 3, true); err != nil { // pin 5 at table 3
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

// inputs returns the five stored plans as the PlanInputs a client would send back unchanged
// (current versions, current tables, pins as seat flags).
func (e *env) inputs(t *testing.T) []scenarios.PlanInput {
	t.Helper()
	out, err := e.currentInputs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func (e *env) currentInputs(ctx context.Context) ([]scenarios.PlanInput, error) {
	states, err := e.store.List(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]scenarios.PlanInput, len(states))
	for i, st := range states {
		out[i] = scenarios.PlanInput{Key: st.Key(), BasedOn: st.Version, Tables: st.Plan.Tables}
	}
	return out, nil
}

// accept stores `tables` as plan `key` (under basedOn) through the only write path there
// is, Replace, re-sending the other four plans unchanged, and returns the evaluated plan.
func (e *env) accept(ctx context.Context, key scenarios.Key, basedOn int64, tables []seating.Table) (scenarios.Evaluated, error) {
	in, err := e.currentInputs(ctx)
	if err != nil {
		return scenarios.Evaluated{}, err
	}
	for i := range in {
		if in[i].Key == key {
			in[i].BasedOn, in[i].Tables = basedOn, tables
		}
	}
	all, err := e.plans.Replace(ctx, in)
	if err != nil {
		return scenarios.Evaluated{}, err
	}
	for _, ev := range all {
		if ev.State.Key() == key {
			return ev, nil
		}
	}
	return scenarios.Evaluated{}, errors.New("plan missing from the result")
}

// snapshot is every plan's version and plan, for "nothing was written" assertions.
func snapshot(t *testing.T, e *env) []scenarios.PlanState {
	t.Helper()
	states, err := e.store.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return states
}

func unchanged(t *testing.T, e *env, before []scenarios.PlanState) {
	t.Helper()
	if after := snapshot(t, e); !reflect.DeepEqual(before, after) {
		t.Errorf("a rejected Replace changed the plans:\nbefore %+v\nafter  %+v", before, after)
	}
}

func TestReplaceValidation(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 12)
	before := snapshot(t, e)

	t.Run("keys must be 9, 10, 11, 12 and mixed, each once", func(t *testing.T) {
		in := e.inputs(t)
		dup := slices.Clone(in)
		dup[3].Key = uk(11)
		dupMixed := slices.Clone(in)
		dupMixed[3].Key = mixedKey // mixed twice, plan 12 missing
		bad8 := slices.Clone(in)
		bad8[0].Key = uk(8)
		badMixed := slices.Clone(in)
		badMixed[4].Key = scenarios.Key{Capacity: 11, Mixed: true}
		unset := slices.Clone(in)
		unset[2].Key = scenarios.Key{}
		for name, bad := range map[string][]scenarios.PlanInput{
			"four plans": in[:4], "six plans": append(slices.Clone(in), in[0]), "no plans": nil,
			"repeated key": dup, "mixed twice": dupMixed,
			"capacity 8": bad8, "mixed with capacity 11": badMixed, "no key": unset,
		} {
			_, err := e.plans.Replace(ctx, bad)
			if v := (apperr.Validation{}); !errors.As(err, &v) || v.Field != "plans" {
				t.Errorf("%s: err = %v, want Validation on plans", name, err)
			}
		}
		unchanged(t, e, before)
	})

	layouts := []struct {
		name   string
		tables []seating.Table
	}{
		{"gap in numbering", []seating.Table{table(1, 1), table(3, 2)}},
		{"does not start at 1", []seating.Table{table(2, 1)}},
		{"duplicate table number", []seating.Table{table(1, 1), table(1, 2)}},
		{"table number zero", []seating.Table{table(0, 1)}},
		{"guest at two tables", []seating.Table{table(1, 1, 2), table(2, 2, 3)}},
		{"guest twice at one table", []seating.Table{table(1, 1, 1)}},
		{"unknown guest", []seating.Table{table(1, 1, 999)}},
	}
	for _, tc := range layouts {
		t.Run(tc.name+" in the last plan rejects all five", func(t *testing.T) {
			in := e.inputs(t)
			in[0].Tables = []seating.Table{table(1, 1, 2)} // a valid plan before the bad one
			in[4].Tables = tc.tables
			_, err := e.plans.Replace(ctx, in)
			var v apperr.Validation
			if !errors.As(err, &v) || v.Field != "plans" || !strings.Contains(v.Message, "Plan mixed") {
				t.Fatalf("err = %v, want Validation on plans naming plan mixed", err)
			}
			unchanged(t, e, before)
		})
	}

	t.Run("unsorted but complete numbering is accepted and stored 1..k", func(t *testing.T) {
		got, err := e.accept(ctx, uk(10), 1, []seating.Table{table(2, 3, 4), table(1, 1, 2)})
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

	t.Run("an empty layout is valid (clears the plan) and an empty table is kept", func(t *testing.T) {
		v := plan(t, e, uk(12)).State.Version
		got, err := e.accept(ctx, uk(12), v, nil)
		if err != nil || len(got.State.Plan.Tables) != 0 || got.State.Version != v+1 {
			t.Errorf("got %+v, %v", got.State, err)
		}
		got, err = e.accept(ctx, uk(12), v+1, []seating.Table{table(1, 1), table(2)})
		if err != nil || len(got.State.Plan.Tables) != 2 || got.State.Version != v+2 {
			t.Errorf("got %+v, %v", got.State, err)
		}
	})
}

func TestReplaceStoresAllFiveAndBumpsVersions(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 12)
	in := e.inputs(t)
	for i := range in { // sent in a scrambled order: the result is ordered 9, 10, 11, 12, mixed anyway
		in[i].Tables = []seating.Table{table(1, rng(1, 8)...), table(2, rng(9, 12)...)}
	}
	in[0], in[4] = in[4], in[0]
	in[1], in[3] = in[3], in[1]
	got, err := e.plans.Replace(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 5 {
		t.Fatalf("Replace returned %d plans, want 5", len(got))
	}
	for i, c := range scenarios.Keys {
		ev := got[i]
		if ev.State.Key() != c || ev.State.Version != startVersion(c)+1 || len(ev.State.Plan.Tables) != 2 || ev.Eval.Summary.Seated != 12 {
			t.Errorf("plan %v = %+v summary %+v", c, ev.State, ev.Eval.Summary)
		}
		if stored := plan(t, e, c); !reflect.DeepEqual(stored.State, ev.State) {
			t.Errorf("plan %v: returned %+v, stored %+v", c, ev.State, stored.State)
		}
	}
}

func TestReplaceVersionConflictChangesNothing(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 6)
	if _, err := e.accept(ctx, uk(11), 1, []seating.Table{table(1, 1, 2)}); err != nil { // plan 11 -> version 2
		t.Fatal(err)
	}
	before := snapshot(t, e)

	for _, stale := range scenarios.Keys { // whichever single plan is stale, none of the five changes
		in := e.inputs(t)
		for i := range in {
			in[i].Tables = []seating.Table{table(1, 3, 4)}
			if in[i].Key == stale {
				in[i].BasedOn--
			}
		}
		_, err := e.plans.Replace(ctx, in)
		var sv apperr.StaleVersion
		if !errors.Is(err, apperr.ErrVersionConflict) || !errors.As(err, &sv) || sv.Plan != stale.String() {
			t.Fatalf("stale plan %v: err = %v, want StaleVersion for that plan", stale, err)
		}
		unchanged(t, e, before)
	}
}

func TestReplaceDisabledMembersRideAlongAndPinsAreExplicit(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 10)
	e.link(t, 1, 2, seating.Must)
	e.link(t, 1, 3, seating.Must) // cluster {1,2,3}; 3 is a disabled child
	e.toggle(t, false, 3)

	got, err := e.accept(ctx, uk(10), 1, []seating.Table{table(1, 1, 2, 4, 5), table(2, 6, 7, 8, 9, 10)})
	if err != nil {
		t.Fatal(err)
	}
	if tb, _, ok := tableOf(got.State.Plan, 3); !ok || tb != 1 {
		t.Errorf("disabled guest 3 at table %d (seated %v), want table 1 with its cluster", tb, ok)
	}
	if got.Eval.Tables[0].Fill != 4 { // 1,2,4,5 - the disabled child does not count
		t.Errorf("fill = %d, want 4", got.Eval.Tables[0].Fill)
	}

	t.Run("a pin on one member pins the whole cluster, disabled members included", func(t *testing.T) {
		tables := []seating.Table{table(1, 4, 5, 6, 7, 8), table(2, 1, 2, 9, 10)}
		tables[1].Seats[1].Pinned = true // only guest 2 carries the flag
		got, err := e.accept(ctx, uk(10), got.State.Version, tables)
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

		// pins are explicit: the stored pin is NOT carried over when the next layout has none
		next, err := e.accept(ctx, uk(10), got.State.Version, []seating.Table{table(1, 4, 5, 6, 7, 8), table(2, 1, 2, 9, 10)})
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range []int64{1, 2, 3} {
			if _, pinned, _ := tableOf(next.State.Plan, id); pinned {
				t.Errorf("guest %d is still pinned after a layout without pins", id)
			}
		}
	})

	t.Run("a cluster with no listed enabled member gets no assignment", func(t *testing.T) {
		got, err := e.accept(ctx, uk(10), plan(t, e, uk(10)).State.Version, []seating.Table{table(1, 4, 5)})
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range []int64{1, 2, 3} {
			if _, _, ok := tableOf(got.State.Plan, id); ok {
				t.Errorf("guest %d is seated", id)
			}
		}
	})

	t.Run("a cluster split across tables rides along with its lowest listed enabled member", func(t *testing.T) {
		got, err := e.accept(ctx, uk(10), plan(t, e, uk(10)).State.Version, []seating.Table{table(1, 2, 4), table(2, 1, 5)})
		if err != nil {
			t.Fatal(err)
		}
		if tb, _, _ := tableOf(got.State.Plan, 3); tb != 2 { // lowest listed enabled member is 1, at table 2
			t.Errorf("disabled guest 3 at table %d, want 2", tb)
		}
	})
}

// The round trip behind "Generuj plany" + "Cofnij": GET (snapshot) -> calculate -> replace with
// the snapshot's versions -> replace with the snapshot using the returned versions restores the
// exact tables, assignments and pins.
func TestReplaceUndoRestoresTheSnapshotExactly(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 24)
	e.link(t, 1, 2, seating.Must)
	e.link(t, 1, 3, seating.Must)
	e.toggle(t, false, 3)
	// hand-made plans with a pin and a disabled member riding along, in three of the five plans
	start := e.inputs(t)
	for i := range start {
		switch start[i].Key {
		case uk(10):
			tables := []seating.Table{table(1, 1, 2, 4, 5, 6, 7, 8, 9), table(2, rng(10, 24)...)}
			tables[0].Seats[0].Pinned = true
			start[i].Tables = tables
		case uk(12):
			start[i].Tables = []seating.Table{table(1, rng(4, 15)...), table(2), table(3, 1, 2)}
		case mixedKey:
			tables := []seating.Table{table(1, rng(4, 12)...), table(2, 1, 2, 13, 14, 15, 16, 17, 18)}
			tables[1].Seats[3].Pinned = true
			start[i].Tables = tables
		}
	}
	if _, err := e.plans.Replace(ctx, start); err != nil {
		t.Fatal(err)
	}
	snap := snapshot(t, e)

	props, err := e.plans.Calculate(ctx)
	if err != nil {
		t.Fatal(err)
	}
	generate := make([]scenarios.PlanInput, len(props))
	for i, p := range props {
		generate[i] = scenarios.PlanInput{Key: scenarios.Key{Capacity: p.Plan.Capacity, Mixed: p.Plan.Mixed}, BasedOn: snap[i].Version, Tables: p.Plan.Tables}
	}
	generated, err := e.plans.Replace(ctx, generate)
	if err != nil {
		t.Fatal(err)
	}
	if tb, pinned, _ := tableOf(generated[1].State.Plan, 1); !pinned || tb == 0 {
		t.Errorf("Generate lost the pin on guest 1: table %d pinned %v", tb, pinned)
	}

	undo := make([]scenarios.PlanInput, len(snap))
	for i, st := range snap {
		undo[i] = scenarios.PlanInput{Key: st.Key(), BasedOn: generated[i].State.Version, Tables: st.Plan.Tables}
	}
	restored, err := e.plans.Replace(ctx, undo)
	if err != nil {
		t.Fatal(err)
	}
	for i, st := range snap {
		if !reflect.DeepEqual(restored[i].State.Plan, st.Plan) {
			t.Errorf("plan %v not restored:\nwant %+v\ngot  %+v", st.Key(), st.Plan, restored[i].State.Plan)
		}
		if want := st.Version + 2; restored[i].State.Version != want {
			t.Errorf("plan %v version = %d, want %d", st.Key(), restored[i].State.Version, want)
		}
	}

	t.Run("an edit after the Generate makes the undo a conflict that changes nothing", func(t *testing.T) {
		if _, err := e.plans.Seat(ctx, uk(10), 6, 2, false); err != nil { // an edit bumps plan 10
			t.Fatal(err)
		}
		before := snapshot(t, e)
		stale := make([]scenarios.PlanInput, len(snap))
		for i, st := range snap {
			stale[i] = scenarios.PlanInput{Key: st.Key(), BasedOn: restored[i].State.Version, Tables: st.Plan.Tables}
		}
		if _, err := e.plans.Replace(ctx, stale); !errors.Is(err, apperr.ErrVersionConflict) {
			t.Fatalf("err = %v, want ErrVersionConflict", err)
		}
		unchanged(t, e, before)
	})
}

func TestSeatMovesWholeClusterIncludingDisabled(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 10)
	e.link(t, 1, 2, seating.Must)
	e.link(t, 2, 3, seating.Must) // cluster {1,2,3}, key 1
	e.toggle(t, false, 3)
	if _, err := e.accept(ctx, uk(10), 1, []seating.Table{table(1, 1, 2, 4, 5, 6), table(2, 7, 8, 9, 10)}); err != nil {
		t.Fatal(err)
	}

	v11 := plan(t, e, uk(11)).State.Version

	// addressed through ANY member, even a disabled one
	for _, via := range []int64{2, 3} {
		t.Run(fmt.Sprintf("via member %d", via), func(t *testing.T) {
			for _, target := range []int{2, 1} {
				got, err := e.plans.Seat(ctx, uk(10), via, target, false)
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
		got, err := e.plans.Seat(ctx, uk(10), 1, 1, true)
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
		got, err = e.plans.Seat(ctx, uk(10), 3, 1, false)
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
		before := plan(t, e, uk(10)).State.Version
		got, err := e.plans.Seat(ctx, uk(10), 1, 2, false)
		if err != nil || got.State.Version != before+1 {
			t.Errorf("version %d -> %d, %v", before, got.State.Version, err)
		}
	})

	t.Run("other plans are untouched", func(t *testing.T) {
		if ev := plan(t, e, uk(11)); ev.State.Version != v11 {
			t.Errorf("plan 11 version = %d", ev.State.Version)
		}
	})
}

func TestSeatErrors(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 8)
	if _, err := e.accept(ctx, uk(10), 1, []seating.Table{table(1, rng(1, 8)...)}); err != nil {
		t.Fatal(err)
	}
	t.Run("unknown table is a validation error on tableNumber", func(t *testing.T) {
		for _, n := range []int{0, 2, -1} {
			_, err := e.plans.Seat(ctx, uk(10), 1, n, false)
			wantValidation(t, err, "tableNumber")
		}
	})
	t.Run("unknown guest and unknown plan are not found", func(t *testing.T) {
		if _, err := e.plans.Seat(ctx, uk(10), 999, 1, false); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("unknown guest: %v", err)
		}
		if _, err := e.plans.Seat(ctx, uk(8), 1, 1, false); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("unknown plan: %v", err)
		}
		if _, err := e.plans.Unseat(ctx, uk(10), 999); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("unseat unknown guest: %v", err)
		}
	})
}

func TestSeatOverfillIsAllowedAndReported(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 10)
	if _, err := e.accept(ctx, uk(9), startVersion(uk(9)), []seating.Table{table(1, rng(1, 9)...), table(2, 10)}); err != nil {
		t.Fatal(err)
	}
	got, err := e.plans.Seat(ctx, uk(9), 10, 1, false) // table 1 is full (9/9)
	if err != nil {
		t.Fatalf("overfilling must not be blocked: %v", err)
	}
	if !hasViolation(got.Eval, seating.ViolOverCapacity) || !got.Eval.Summary.NeedsRecalculation || got.Eval.Tables[0].Fill != 10 {
		t.Errorf("summary %+v violations %+v", got.Eval.Summary, got.Eval.Violations)
	}
}

func TestUnseatMovesWholeClusterToTheTray(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 8)
	e.link(t, 1, 2, seating.Must)
	e.toggle(t, false, 2)
	if _, err := e.accept(ctx, uk(10), 1, []seating.Table{table(1, 1, 3, 4, 5, 6, 7, 8)}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.plans.Seat(ctx, uk(10), 1, 1, true); err != nil {
		t.Fatal(err)
	}
	got, err := e.plans.Unseat(ctx, uk(10), 2) // via the disabled member
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
	if _, err := e.plans.Unseat(ctx, uk(10), 1); err != nil {
		t.Errorf("second unseat: %v", err)
	}
}

func TestAddAndRemoveTable(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 12)
	if _, err := e.accept(ctx, uk(10), 1, []seating.Table{table(1, rng(1, 4)...), table(2, rng(5, 8)...), table(3, 9, 10), table(4, 11, 12)}); err != nil {
		t.Fatal(err)
	}
	got, err := e.plans.AddTable(ctx, uk(10))
	if err != nil || len(got.State.Plan.Tables) != 5 || got.State.Plan.Tables[4].Number != 5 || got.Eval.Summary.TableCount != 5 {
		t.Fatalf("AddTable: %+v, %v", got.State, err)
	}

	got, err = e.plans.RemoveTable(ctx, uk(10), 2)
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

	if _, err := e.plans.RemoveTable(ctx, uk(10), 9); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("RemoveTable(9) err = %v, want ErrNotFound", err)
	}
	if _, err := e.plans.AddTable(ctx, uk(8)); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("AddTable(8) err = %v, want ErrNotFound", err)
	}
}

// Flow 3 (sequence diagram): a re-enabled child rides along to its cluster's full table; the
// plan then needs recalculation, and nothing regenerates by itself.
func TestReEnabledGuestOverfillsTableAndNeedsRecalculation(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 10)
	e.link(t, 1, 2, seating.Must)
	e.link(t, 1, 3, seating.Must) // cluster {1,2,3}
	e.toggle(t, false, 3)

	// 9 enabled guests at table 1 of the 9-seat plan: the plan is complete (no violations)
	// and the disabled child 3 rides along via ExpandDisabled.
	got, err := e.accept(ctx, uk(9), startVersion(uk(9)), []seating.Table{table(1, 1, 2, 4, 5, 6, 7, 8, 9, 10)})
	if err != nil {
		t.Fatal(err)
	}
	if got.Eval.Summary.NeedsRecalculation || got.Eval.Tables[0].Fill != 9 {
		t.Fatalf("precondition: fill %d summary %+v", got.Eval.Tables[0].Fill, got.Eval.Summary)
	}

	e.toggle(t, true, 3)
	after := plan(t, e, uk(9))
	if after.State.Version != got.State.Version {
		t.Errorf("toggling a guest must not touch the plan (version %d -> %d)", got.State.Version, after.State.Version)
	}
	if tb, _, ok := tableOf(after.State.Plan, 3); !ok || tb != 1 {
		t.Fatalf("re-enabled guest 3 at table %d (seated %v), want table 1", tb, ok)
	}
	if after.Eval.Tables[0].Fill != 10 || !hasViolation(after.Eval, seating.ViolOverCapacity) || !after.Eval.Summary.NeedsRecalculation {
		t.Errorf("fill %d, summary %+v, violations %+v", after.Eval.Tables[0].Fill, after.Eval.Summary, after.Eval.Violations)
	}

	// a never-seated guest re-enabled shows up in the tray
	e2 := newEnv(t, 2)
	e2.toggle(t, false, 2)
	if _, err := e2.accept(ctx, uk(10), 1, []seating.Table{table(1, 1)}); err != nil {
		t.Fatal(err)
	}
	e2.toggle(t, true, 2)
	if ev := plan(t, e2, uk(10)); !hasViolation(ev.Eval, seating.ViolUnseated) || !ev.Eval.Summary.NeedsRecalculation {
		t.Errorf("violations = %+v", ev.Eval.Violations)
	}
}

func TestResetEmptiesThePlanAndNeedsRecalculation(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 8)
	e.link(t, 1, 2, seating.Must)
	e.link(t, 1, 3, seating.Must) // cluster {1,2,3}; 3 is a disabled child seated with it
	e.toggle(t, false, 3)

	if _, err := e.accept(ctx, uk(10), 1, []seating.Table{table(1, 1, 2, 4, 5), table(2, 6, 7, 8)}); err != nil {
		t.Fatal(err)
	}
	seated, err := e.plans.Seat(ctx, uk(10), 1, 1, true) // pin the cluster {1,2,3}
	if err != nil {
		t.Fatal(err)
	}
	if _, pinned, ok := tableOf(seated.State.Plan, 3); !ok || !pinned {
		t.Fatalf("precondition: disabled guest 3 pinned %v seated %v", pinned, ok)
	}
	other := plan(t, e, uk(11)) // an untouched plan, to prove the reset is per scenario

	got, err := e.plans.Reset(ctx, uk(10))
	if err != nil {
		t.Fatal(err)
	}
	if len(got.State.Plan.Tables) != 0 || got.State.Key() != uk(10) || got.State.Version != seated.State.Version+1 {
		t.Fatalf("state = %+v, want an empty plan at version %d", got.State, seated.State.Version+1)
	}
	if got.Eval.Summary.TableCount != 0 || got.Eval.Summary.Unseated != 7 || !got.Eval.Summary.NeedsRecalculation {
		t.Errorf("summary = %+v", got.Eval.Summary)
	}
	if len(got.Eval.Violations) != 1 || got.Eval.Violations[0].Code != seating.ViolUnseated {
		t.Fatalf("violations = %+v, want exactly unseated_guests", got.Eval.Violations)
	}
	if want := []seating.GuestID{1, 2, 4, 5, 6, 7, 8}; !slices.Equal(got.Eval.Violations[0].Guests, want) {
		t.Errorf("unseated guests = %v, want every enabled guest %v", got.Eval.Violations[0].Guests, want)
	}
	if after := plan(t, e, uk(11)); after.State.Version != other.State.Version {
		t.Errorf("plan 11 version %d -> %d", other.State.Version, after.State.Version)
	}

	t.Run("pins are gone: the next proposal is free of them", func(t *testing.T) {
		proposals, err := e.plans.Calculate(ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, pr := range proposals {
			if pr.Plan.Capacity != 10 || pr.Plan.Mixed {
				continue
			}
			if len(pr.Plan.Tables) == 0 {
				t.Fatal("proposal has no tables")
			}
			for _, tb := range pr.Plan.Tables {
				for _, seat := range tb.Seats {
					if seat.Pinned {
						t.Errorf("guest %d is pinned in the proposal", seat.Guest)
					}
				}
			}
		}
	})
}

func TestResetWithNoEnabledGuestsHasNoViolation(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 3)
	if _, err := e.accept(ctx, uk(12), 1, []seating.Table{table(1, 1, 2, 3)}); err != nil {
		t.Fatal(err)
	}
	e.toggle(t, false, 1, 2, 3)

	got, err := e.plans.Reset(ctx, uk(12))
	if err != nil {
		t.Fatal(err)
	}
	if len(got.State.Plan.Tables) != 0 || len(got.Eval.Violations) != 0 || got.Eval.Summary.NeedsRecalculation {
		t.Errorf("state %+v summary %+v violations %+v, want an empty plan without violations", got.State, got.Eval.Summary, got.Eval.Violations)
	}
	if _, err := e.plans.Reset(ctx, uk(8)); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("Reset(8) err = %v, want ErrNotFound", err)
	}
}

func TestResetMakesOlderProposalsStale(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 12)
	proposals, err := e.plans.Calculate(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var p scenarios.Proposal
	for _, pr := range proposals {
		if pr.Plan.Capacity == 10 && !pr.Plan.Mixed {
			p = pr
		}
	}
	if _, err := e.plans.Reset(ctx, uk(10)); err != nil {
		t.Fatal(err)
	}
	if _, err := e.accept(ctx, uk(10), p.BasedOnVersion, p.Plan.Tables); !errors.Is(err, apperr.ErrVersionConflict) {
		t.Fatalf("Accept after Reset err = %v, want ErrVersionConflict", err)
	}
}

// exampleL sets up docs/architecture/03-seating-model.md example L with 36 guests: two groups
// of six clusters of 3 (ids consecutive, group 0), every pair of clusters inside a group linked
// at level 1, no link between the groups. Plan 12 needs three tables (36 stranger pairs); the
// mixed plan (floor 9, any k in [3, 4], bilans) takes four tables of 9 with none.
func exampleL(t *testing.T) *env {
	t.Helper()
	e := newEnv(t, 36)
	for first := int64(1); first < 36; first += 3 {
		e.link(t, first, first+1, seating.Must)
		e.link(t, first, first+2, seating.Must)
	}
	for _, grp := range [][]int64{{1, 4, 7, 10, 13, 16}, {19, 22, 25, 28, 31, 34}} {
		for i, a := range grp {
			for _, b := range grp[i+1:] {
				e.link(t, a, b, seating.Preferred)
			}
		}
	}
	return e
}

func TestCalculateMixedPlanMayTakeMoreTables(t *testing.T) {
	e := exampleL(t)
	props, err := e.plans.Calculate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(props) != 5 {
		t.Fatalf("%d proposals", len(props))
	}
	p12, pm := props[3], props[4]
	if p12.Plan.Mixed || !pm.Plan.Mixed || pm.Plan.Capacity != 12 {
		t.Fatalf("plans 4 and 5 = (%d, %v) and (%d, %v)", p12.Plan.Capacity, p12.Plan.Mixed, pm.Plan.Capacity, pm.Plan.Mixed)
	}
	if len(p12.Plan.Tables) != 3 || p12.Eval.Summary.StrangerPairs != 36 {
		t.Errorf("plan 12: %d tables, %d stranger pairs; want 3 and 36", len(p12.Plan.Tables), p12.Eval.Summary.StrangerPairs)
	}
	if len(pm.Plan.Tables) != 4 || pm.Eval.Summary.StrangerPairs != 0 || pm.Eval.Summary.NeedsRecalculation || pm.Eval.Summary.Seated != 36 {
		t.Errorf("mixed: %d tables, summary %+v; want 4 tables, 0 stranger pairs", len(pm.Plan.Tables), pm.Eval.Summary)
	}
	for _, tb := range pm.Eval.Tables {
		if tb.Fill < seating.MixedFloor || tb.Fill > 12 {
			t.Errorf("mixed table %d has %d guests", tb.Number, tb.Fill)
		}
	}
	if again, err := e.plans.Calculate(context.Background()); err != nil || !reflect.DeepEqual(again, props) {
		t.Errorf("a second Calculate differs (parallel Generate must be deterministic and ordered): %v", err)
	}
}

func TestMixedPlanEditsTouchOnlyThatPlan(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 14)
	if _, err := e.accept(ctx, mixedKey, 1, []seating.Table{table(1, rng(1, 12)...), table(2, 13, 14)}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.accept(ctx, uk(12), plan(t, e, uk(12)).State.Version, []seating.Table{table(1, rng(1, 8)...), table(2, rng(9, 14)...)}); err != nil {
		t.Fatal(err)
	}
	before12 := plan(t, e, uk(12)).State

	got, err := e.plans.Seat(ctx, mixedKey, 13, 1, true) // table 1 now holds 13: over capacity 12
	if err != nil {
		t.Fatal(err)
	}
	if !got.State.Plan.Mixed || got.State.Plan.Capacity != 12 || got.Eval.Tables[0].Fill != 13 ||
		!hasViolation(got.Eval, seating.ViolOverCapacity) || !got.Eval.Summary.NeedsRecalculation {
		t.Errorf("mixed table of 13: state %+v summary %+v violations %+v", got.State.Plan, got.Eval.Summary, got.Eval.Violations)
	}
	if got, err = e.plans.Unseat(ctx, mixedKey, 14); err != nil || len(got.Eval.Unseated) != 1 {
		t.Fatalf("Unseat(mixed) = %+v, %v", got.Eval.Unseated, err)
	}
	if got, err = e.plans.AddTable(ctx, mixedKey); err != nil || len(got.State.Plan.Tables) != 3 {
		t.Fatalf("AddTable(mixed) = %+v, %v", got.State.Plan.Tables, err)
	}
	if got, err = e.plans.RemoveTable(ctx, mixedKey, 3); err != nil || len(got.State.Plan.Tables) != 2 {
		t.Fatalf("RemoveTable(mixed) = %+v, %v", got.State.Plan.Tables, err)
	}
	if after := plan(t, e, uk(12)).State; !reflect.DeepEqual(after, before12) {
		t.Errorf("plan 12 changed by edits of the mixed plan:\n%+v\n%+v", before12, after)
	}

	beforeMixed := plan(t, e, mixedKey).State
	if _, err := e.plans.Seat(ctx, uk(12), 1, 2, false); err != nil {
		t.Fatal(err)
	}
	if got, err = e.plans.Reset(ctx, uk(12)); err != nil || len(got.State.Plan.Tables) != 0 {
		t.Fatalf("Reset(12) = %+v, %v", got.State, err)
	}
	if after := plan(t, e, mixedKey).State; !reflect.DeepEqual(after, beforeMixed) {
		t.Errorf("the mixed plan changed by edits of plan 12:\n%+v\n%+v", beforeMixed, after)
	}
	if got, err = e.plans.Reset(ctx, mixedKey); err != nil || len(got.State.Plan.Tables) != 0 || got.State.Key() != mixedKey {
		t.Fatalf("Reset(mixed) = %+v, %v", got.State, err)
	}
	if _, err := e.plans.Reset(ctx, scenarios.Key{Capacity: 9, Mixed: true}); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("Reset(9, mixed) err = %v, want ErrNotFound", err)
	}
}

func TestKeys(t *testing.T) {
	tests := []struct {
		in   string
		want scenarios.Key
		ok   bool
	}{
		{"9", uk(9), true}, {"10", uk(10), true}, {"11", uk(11), true}, {"12", uk(12), true}, {"mixed", mixedKey, true},
		{"8", scenarios.Key{}, false}, {"13", scenarios.Key{}, false}, {"", scenarios.Key{}, false}, {"Mixed", scenarios.Key{}, false},
		{"012", scenarios.Key{}, false}, {"+9", scenarios.Key{}, false}, {" 9", scenarios.Key{}, false}, {"foo", scenarios.Key{}, false},
	}
	for _, tc := range tests {
		got, ok := scenarios.ParseKey(tc.in)
		if got != tc.want || ok != tc.ok {
			t.Errorf("ParseKey(%q) = %v, %v; want %v, %v", tc.in, got, ok, tc.want, tc.ok)
		}
	}
	for i, k := range scenarios.Keys {
		if back, ok := scenarios.ParseKey(k.String()); !ok || back != k {
			t.Errorf("Keys[%d] = %v does not round-trip through %q", i, k, k.String())
		}
	}
	if scenarios.Keys[3].String() != "12" || scenarios.Keys[4].String() != "mixed" {
		t.Errorf("Keys = %v", scenarios.Keys)
	}
	if st := (scenarios.PlanState{Plan: seating.Plan{Capacity: 12, Mixed: true}}); st.Key() != mixedKey {
		t.Errorf("PlanState.Key() = %v", st.Key())
	}
}

// BenchmarkCalculate100 measures the whole Calculate path (one graph, five proposals, real
// SQLite reads) for ~100 guests in families of 1..5 with partner links. The five plans run
// in parallel. This list has ~25 clusters, so the budget scaled by annealSteps is small (~0.3 s on the
// Pi); the 46-cluster real-shaped case takes ~3.3 s (BenchmarkProposeTight/generate5, task 012).
func BenchmarkCalculate100(b *testing.B) {
	ctx := context.Background()
	db, err := store.Open(filepath.Join(b.TempDir(), "stoliki.db"))
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { db.Close() })
	if err := store.Migrate(ctx, db); err != nil {
		b.Fatal(err)
	}
	gstore := store.NewGuests(db)
	gs := guests.NewService(gstore)
	svc := scenarios.NewService(store.NewScenarios(db), gstore)
	for i := 1; i <= 100; i++ {
		if _, err := gs.Create(ctx, guests.NewGuest{FirstName: fmt.Sprintf("G%03d", i), Enabled: true}); err != nil {
			b.Fatal(err)
		}
	}
	for first := int64(1); first <= 100; first += 4 { // families of 4 (group 0), every 3rd family linked to the next (group 1)
		for m := first + 1; m < first+4 && m <= 100; m++ {
			if _, err := gs.SetLink(ctx, first, m, seating.Must); err != nil {
				b.Fatal(err)
			}
		}
		if first%3 == 1 && first+4 <= 100 {
			if _, err := gs.SetLink(ctx, first, first+4, seating.Preferred); err != nil {
				b.Fatal(err)
			}
		}
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		props, err := svc.Calculate(ctx)
		if err != nil || len(props) != 5 {
			b.Fatalf("Calculate = %d proposals, %v", len(props), err)
		}
	}
}
