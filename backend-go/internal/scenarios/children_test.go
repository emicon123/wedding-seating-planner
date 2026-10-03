package scenarios_test

import (
	"context"
	"testing"

	"github.com/wojtekrpi/stoliki/backend-go/internal/guests"
	"github.com/wojtekrpi/stoliki/backend-go/internal/seating"
)

// setChild flips a guest's isChild flag through the real guests service (task 014).
func (e *env) setChild(t *testing.T, child bool, ids ...int64) {
	t.Helper()
	ctx := context.Background()
	all, _, err := e.guests.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		for _, g := range all {
			if g.ID == id {
				if _, _, err := e.guests.Update(ctx, id, guests.Patch{IsChild: &child}, g.Version); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
}

func scoreOf(ev seating.Evaluation, id int64) seating.GuestScore {
	for _, gs := range ev.GuestScores {
		if gs.Guest == id {
			return gs
		}
	}
	return seating.GuestScore{}
}

// Children take seats but are not scored: the flag set in the guests table reaches the
// plans (list, replace, calculate) through guests.ToSeating.
func TestChildrenAreSeatedButNotScored(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t, 24)
	// family {1..5}: adults 1, 2, children 3, 4, 5; its adult 1 prefers the single guest 6.
	for i := int64(1); i < 5; i++ {
		e.link(t, i, i+1, seating.Must)
	}
	e.link(t, 1, 6, seating.Preferred)
	e.setChild(t, true, 3, 4, 5)

	ev, err := e.accept(ctx, uk(10), startVersion(uk(10)), []seating.Table{table(1, rng(1, 8)...), table(2, rng(9, 16)...), table(3, rng(17, 24)...)})
	if err != nil {
		t.Fatal(err)
	}
	if ev.Eval.Tables[0].Fill != 8 || ev.Eval.Summary.NeedsRecalculation || len(ev.Eval.Violations) != 0 {
		t.Errorf("fill %d, violations %+v: children must take seats", ev.Eval.Tables[0].Fill, ev.Eval.Violations)
	}
	for _, id := range []int64{3, 4, 5} {
		if got := scoreOf(ev.Eval, id); got != (seating.GuestScore{Guest: id, Table: 1}) {
			t.Errorf("child %d = %+v, want all zeros at table 1", id, got)
		}
	}
	// adults 1, 2 receive 1 (the single adult 6); 6 receives 2 (the two adults of the family)
	if a, b, c := scoreOf(ev.Eval, 1).Satisfaction, scoreOf(ev.Eval, 2).Satisfaction, scoreOf(ev.Eval, 6).Satisfaction; a != 1 || b != 1 || c != 2 {
		t.Errorf("adult satisfactions %v %v %v, want 1 1 2", a, b, c)
	}
	if ev.Eval.Tables[0].Score != 4 || ev.Eval.Summary.Isolated != 0 {
		t.Errorf("table score %v isolated %d, want 4 and 0", ev.Eval.Tables[0].Score, ev.Eval.Summary.Isolated)
	}

	t.Run("changing isChild changes scores, never fill or violations", func(t *testing.T) {
		e.setChild(t, false, 3)
		after := plan(t, e, uk(10))
		if after.Eval.Tables[0].Fill != 8 || len(after.Eval.Violations) != 0 {
			t.Errorf("fill %d violations %+v after un-flagging a child", after.Eval.Tables[0].Fill, after.Eval.Violations)
		}
		if got := scoreOf(after.Eval, 6).Satisfaction; got != 3 {
			t.Errorf("guest 6 satisfaction %v, want 3 (adult 3 now counts)", got)
		}
		if got := scoreOf(after.Eval, 3).Satisfaction; got != 1 {
			t.Errorf("guest 3 satisfaction %v, want 1 (now an adult)", got)
		}
	})

	t.Run("calculate: children never scored, fill counts them, floor holds", func(t *testing.T) {
		e.setChild(t, true, 3)
		props, err := e.plans.Calculate(ctx)
		if err != nil {
			t.Fatal(err)
		}
		for i, p := range props {
			if p.Eval.Summary.Seated != 24 || p.Eval.Summary.NeedsRecalculation {
				t.Errorf("proposal %d: summary %+v", i, p.Eval.Summary)
			}
			for _, id := range []int64{3, 4, 5} {
				if got := scoreOf(p.Eval, id); got != (seating.GuestScore{Guest: id, Table: got.Table}) || got.Table == 0 {
					t.Errorf("proposal %d child %d = %+v, want seated with all-zero score", i, id, got)
				}
			}
			a, _, _ := tableOf(p.Plan, 1)
			if b, _, _ := tableOf(p.Plan, 3); a != b {
				t.Errorf("proposal %d: family split (%d vs %d)", i, a, b)
			}
		}
	})
}
