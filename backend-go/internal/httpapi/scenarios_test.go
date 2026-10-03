package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
)

// seedGuests creates n guests G01.. (ids 1..n).
func seedGuests(t *testing.T, h http.Handler, n int) {
	t.Helper()
	names := make([]string, n)
	for i := range names {
		names[i] = fmt.Sprintf("G%02d", i+1)
	}
	seed(t, h, names...)
}

// startVer is the version of an untouched plan on a fresh database: migration 00002 bumps the
// plan it converts from 8 to 9 seats (also when the database is new).
func startVer(capacity oapi.Capacity) int {
	if capacity == 9 {
		return 2
	}
	return 1
}

func listScenarios(t *testing.T, h http.Handler) oapi.ScenarioListResponse {
	t.Helper()
	rec := do(h, http.MethodGet, api+"/scenarios", "")
	expect(t, rec, http.StatusOK, "")
	return decode[oapi.ScenarioListResponse](t, rec)
}

func scenarioOf(t *testing.T, list oapi.ScenarioListResponse, capacity int) oapi.Scenario {
	t.Helper()
	for _, s := range list.Data {
		if int(s.Capacity) == capacity {
			return s
		}
	}
	t.Fatalf("no scenario %d", capacity)
	return oapi.Scenario{}
}

func calculate(t *testing.T, h http.Handler) oapi.ProposalListResponse {
	t.Helper()
	rec := do(h, http.MethodPost, api+"/scenarios/calculate", "")
	expect(t, rec, http.StatusOK, "")
	return decode[oapi.ProposalListResponse](t, rec)
}

// layoutOf maps a plan as the SPA does: its clusters' guest ids per table, and the guests of
// its pinned clusters as pinnedGuestIds.
func layoutOf(capacity oapi.Capacity, basedOn int, plan oapi.SeatingPlan) oapi.ScenarioLayout {
	tables := make([]oapi.TableLayout, 0, len(plan.Tables))
	for _, tb := range plan.Tables {
		ids, pinned := []int64{}, []int64{}
		for _, c := range tb.Clusters {
			ids = append(ids, c.GuestIds...)
			if c.Pinned {
				pinned = append(pinned, c.GuestIds...)
			}
		}
		tables = append(tables, oapi.TableLayout{Number: tb.Number, GuestIds: ids, PinnedGuestIds: pinned})
	}
	return oapi.ScenarioLayout{Capacity: capacity, BasedOnVersion: basedOn, Tables: tables}
}

// proposalLayouts is "Generuj plany" as the SPA sends it: the four proposals' tables, basedOn
// = the version of each proposal (the plan the client had on screen).
func proposalLayouts(props oapi.ProposalListResponse) []oapi.ScenarioLayout {
	out := make([]oapi.ScenarioLayout, len(props.Data))
	for i, p := range props.Data {
		out[i] = layoutOf(p.Capacity, p.BasedOnVersion, p.Plan)
	}
	return out
}

// storedLayouts re-sends the stored plans unchanged (basedOn = their current versions).
func storedLayouts(list oapi.ScenarioListResponse) []oapi.ScenarioLayout {
	out := make([]oapi.ScenarioLayout, len(list.Data))
	for i, s := range list.Data {
		out[i] = layoutOf(s.Capacity, *s.Version, s.Plan)
	}
	return out
}

func replaceBody(t *testing.T, plans []oapi.ScenarioLayout) string {
	t.Helper()
	b, err := json.Marshal(oapi.ScenariosReplace{Plans: plans})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func replace(t *testing.T, h http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	return do(h, http.MethodPut, api+"/scenarios", body)
}

func replaceOK(t *testing.T, h http.Handler, plans []oapi.ScenarioLayout) oapi.ScenarioListResponse {
	t.Helper()
	rec := replace(t, h, replaceBody(t, plans))
	expect(t, rec, http.StatusOK, "")
	got := decode[oapi.ScenarioListResponse](t, rec)
	if got.Meta.RequestId == nil || got.Page.Total == nil || *got.Page.Total != 4 || len(got.Data) != 4 {
		t.Fatalf("envelope = %+v", got)
	}
	return got
}

func scenarioResponse(t *testing.T, rec *httptest.ResponseRecorder, status int) oapi.Scenario {
	t.Helper()
	expect(t, rec, status, "")
	got := decode[oapi.ScenarioResponse](t, rec)
	if got.Meta.RequestId == nil || *got.Meta.RequestId == "" {
		t.Error("meta.requestId missing")
	}
	return got.Data
}

func seatPath(capacity int, guest int64) string {
	return fmt.Sprintf("%s/scenarios/%d/assignments/%d", api, capacity, guest)
}

func tableOfGuest(s oapi.Scenario, guest int64) (table int, pinned, ok bool) {
	for _, tb := range s.Plan.Tables {
		for _, c := range tb.Clusters {
			if slices.Contains(c.GuestIds, guest) {
				return tb.Number, c.Pinned, true
			}
		}
	}
	return 0, false, false
}

func violationCodes(s oapi.Scenario) []oapi.ViolationCode {
	var out []oapi.ViolationCode
	for _, v := range s.Plan.Violations {
		out = append(out, v.Code)
	}
	return out
}

func TestListScenarios(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 7)

	rec := do(h, http.MethodGet, api+"/scenarios", "")
	expect(t, rec, http.StatusOK, "")
	list := decode[oapi.ScenarioListResponse](t, rec)
	if list.Meta.RequestId == nil || list.Page.Total == nil || *list.Page.Total != 4 || len(list.Data) != 4 {
		t.Fatalf("envelope = %+v", list)
	}
	for i, c := range []oapi.Capacity{9, 10, 11, 12} {
		s := list.Data[i]
		if s.Capacity != c || s.Version == nil || *s.Version != startVer(c) {
			t.Errorf("scenario %d = %d v%v", i, s.Capacity, s.Version)
		}
		sum := s.Plan.Summary
		if sum.TableCount != 0 || sum.SeatedCount != 0 || sum.UnseatedCount != 7 || sum.ViolationCount != 1 || !sum.NeedsRecalculation {
			t.Errorf("summary = %+v", sum)
		}
		if len(s.Plan.Unseated) != 7 || len(s.Plan.GuestScores) != 7 {
			t.Errorf("unseated %d scores %d, want 7", len(s.Plan.Unseated), len(s.Plan.GuestScores))
		}
	}

	t.Run("JSON shape: arrays are [] and unseated guests have tableNumber null", func(t *testing.T) {
		var raw struct {
			Data []struct {
				Plan struct {
					Tables      json.RawMessage `json:"tables"`
					GuestScores []map[string]any
					Violations  []map[string]any
				} `json:"plan"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
			t.Fatal(err)
		}
		p := raw.Data[0].Plan
		if string(p.Tables) != "[]" {
			t.Errorf("tables = %s, want []", p.Tables)
		}
		for _, gs := range p.GuestScores {
			if v, present := gs["tableNumber"]; !present || v != nil {
				t.Errorf("guest score tableNumber = %v (present %v), want null", v, present)
			}
		}
		if len(p.Violations) != 1 || p.Violations[0]["code"] != "unseated_guests" || p.Violations[0]["tableNumber"] != nil {
			t.Errorf("violations = %v", p.Violations)
		}
		if _, ok := p.Violations[0]["tableNumber"]; !ok {
			t.Error("violation.tableNumber must be present (null), not omitted")
		}
		if msg, _ := p.Violations[0]["message"].(string); msg == "" || strings.Contains(msg, "G0") {
			t.Errorf("message = %q (must exist and must not contain guest names)", msg)
		}
	})
}

// Flow 1: calculate stores nothing; PUT /scenarios stores all four proposals; a stale PUT is 409.
func TestCalculateThenReplaceAllFour(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 36)
	putLink(t, h, "1-2", 0) // cluster {1,2,3}
	putLink(t, h, "2-3", 0)
	putLink(t, h, "4-5", 0) // cluster {4,5}
	putLink(t, h, "1-4", 1) // preferred
	putLink(t, h, "6-7", 2)

	props := calculate(t, h)
	if props.Meta.RequestId == nil || props.Page.Total == nil || *props.Page.Total != 4 || len(props.Data) != 4 {
		t.Fatalf("envelope = %+v", props)
	}
	// 36 guests, floor 8: four tables of 9 at capacities 9, 10 and 11; three of 12 at capacity 12
	wantTables := map[oapi.Capacity]int{9: 4, 10: 4, 11: 4, 12: 3}
	for i, c := range []oapi.Capacity{9, 10, 11, 12} {
		p := props.Data[i]
		if p.Capacity != c || p.BasedOnVersion != startVer(c) {
			t.Errorf("proposal %d = %d basedOn %d", i, p.Capacity, p.BasedOnVersion)
		}
		sum := p.Plan.Summary
		if sum.TableCount != wantTables[c] || sum.SeatedCount != 36 || sum.UnseatedCount != 0 || sum.NeedsRecalculation || sum.ViolationCount != 0 {
			t.Errorf("capacity %d summary = %+v", c, sum)
		}
		for _, sc := range p.Plan.GuestScores {
			if !sc.TableNumber.IsSpecified() || sc.TableNumber.IsNull() {
				t.Errorf("guest %d tableNumber = %+v, want a number", sc.GuestId, sc.TableNumber)
			}
		}
	}

	t.Run("calculate stored nothing", func(t *testing.T) {
		for _, s := range listScenarios(t, h).Data {
			if *s.Version != startVer(s.Capacity) || len(s.Plan.Tables) != 0 {
				t.Errorf("scenario %d changed: v%d, %d tables", s.Capacity, *s.Version, len(s.Plan.Tables))
			}
		}
	})

	t.Run("PUT /scenarios stores all four proposals at once", func(t *testing.T) {
		got := replaceOK(t, h, proposalLayouts(props))
		for i, p := range props.Data {
			s := got.Data[i]
			if s.Capacity != p.Capacity || *s.Version != startVer(p.Capacity)+1 || s.Plan.Summary.TableCount != p.Plan.Summary.TableCount ||
				s.Plan.Summary.NeedsRecalculation || s.Plan.Summary.SeatedCount != 36 {
				t.Errorf("stored %d = v%d %+v", s.Capacity, *s.Version, s.Plan.Summary)
			}
			if s.Plan.Summary.Score != p.Plan.Summary.Score {
				t.Errorf("score %v != proposed %v", s.Plan.Summary.Score, p.Plan.Summary.Score)
			}
		}
	})

	t.Run("GET /scenarios now returns the stored plans", func(t *testing.T) {
		for _, s := range listScenarios(t, h).Data {
			if *s.Version != startVer(s.Capacity)+1 || s.Plan.Summary.TableCount != wantTables[s.Capacity] {
				t.Errorf("scenario %d = v%d, %d tables", s.Capacity, *s.Version, s.Plan.Summary.TableCount)
			}
		}
	})

	t.Run("a stale PUT (the proposals again) is 409 version_conflict", func(t *testing.T) {
		expect(t, replace(t, h, replaceBody(t, proposalLayouts(props))), http.StatusConflict, oapi.ErrorCodeVersionConflict)
	})
}

// plansJSON builds a PUT /scenarios body: plan 10 as given, the other three empty with their
// current (fresh database) versions.
func plansJSON(plan10 string) string {
	return fmt.Sprintf(`{"plans":[{"capacity":9,"basedOnVersion":2,"tables":[]},%s,{"capacity":11,"basedOnVersion":1,"tables":[]},{"capacity":12,"basedOnVersion":1,"tables":[]}]}`, plan10)
}

func TestReplaceScenariosErrors(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 6)
	p10 := func(tables string) string { return `{"capacity":10,"basedOnVersion":1,"tables":` + tables + `}` }
	cases := []struct {
		name       string
		body       string
		wantStatus int
		wantCode   oapi.ErrorCode
		wantField  string
	}{
		{"gap in table numbers", plansJSON(p10(`[{"number":1,"guestIds":[1],"pinnedGuestIds":[]},{"number":3,"guestIds":[2],"pinnedGuestIds":[]}]`)), 422, oapi.ErrorCodeValidationFailed, "plans"},
		{"guest at two tables", plansJSON(p10(`[{"number":1,"guestIds":[1,2],"pinnedGuestIds":[]},{"number":2,"guestIds":[2],"pinnedGuestIds":[]}]`)), 422, oapi.ErrorCodeValidationFailed, "plans"},
		{"unknown guest", plansJSON(p10(`[{"number":1,"guestIds":[1,99],"pinnedGuestIds":[]}]`)), 422, oapi.ErrorCodeValidationFailed, "plans"},
		{"pinned guest not at that table", plansJSON(p10(`[{"number":1,"guestIds":[1],"pinnedGuestIds":[2]}]`)), 422, oapi.ErrorCodeValidationFailed, "plans"},
		{"only three plans", `{"plans":[{"capacity":9,"basedOnVersion":2,"tables":[]},{"capacity":10,"basedOnVersion":1,"tables":[]},{"capacity":11,"basedOnVersion":1,"tables":[]}]}`, 422, oapi.ErrorCodeValidationFailed, "plans"},
		{"capacity repeated", `{"plans":[{"capacity":9,"basedOnVersion":2,"tables":[]},{"capacity":10,"basedOnVersion":1,"tables":[]},{"capacity":11,"basedOnVersion":1,"tables":[]},{"capacity":11,"basedOnVersion":1,"tables":[]}]}`, 422, oapi.ErrorCodeValidationFailed, "plans"},
		{"capacity 8 (removed)", `{"plans":[{"capacity":8,"basedOnVersion":1,"tables":[]},{"capacity":10,"basedOnVersion":1,"tables":[]},{"capacity":11,"basedOnVersion":1,"tables":[]},{"capacity":12,"basedOnVersion":1,"tables":[]}]}`, 422, oapi.ErrorCodeValidationFailed, "plans"},
		{"stale version", plansJSON(`{"capacity":10,"basedOnVersion":5,"tables":[]}`), 409, oapi.ErrorCodeVersionConflict, "plans"},
		{"basedOnVersion below 1", plansJSON(`{"capacity":10,"basedOnVersion":0,"tables":[]}`), 400, oapi.ErrorCodeBadRequest, "basedOnVersion"},
		{"missing plans", `{}`, 400, oapi.ErrorCodeBadRequest, "plans"},
		{"unknown top-level field", `{"plans":[],"extra":1}`, 400, oapi.ErrorCodeBadRequest, "extra"},
		{"malformed body", `{"plans":`, 400, oapi.ErrorCodeBadRequest, ""},
		{"no body", ``, 400, oapi.ErrorCodeBadRequest, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := replace(t, h, tc.body)
			expect(t, rec, tc.wantStatus, tc.wantCode)
			if tc.wantField != "" {
				if f := fieldOf(decodeError(t, rec).Errors[0]); f == nil || *f != tc.wantField {
					t.Errorf("field = %v, want %q", f, tc.wantField)
				}
			}
			for _, s := range listScenarios(t, h).Data {
				if *s.Version != startVer(s.Capacity) || len(s.Plan.Tables) != 0 {
					t.Fatalf("a rejected PUT changed scenario %d (v%d, %d tables)", s.Capacity, *s.Version, len(s.Plan.Tables))
				}
			}
		})
	}

	t.Run("the 409 names the stale plan", func(t *testing.T) {
		rec := replace(t, h, plansJSON(`{"capacity":10,"basedOnVersion":5,"tables":[]}`))
		if msg := decodeError(t, rec).Errors[0].Message; !strings.Contains(msg, "Plan 10") || !strings.Contains(msg, "version 1") {
			t.Errorf("message = %q", msg)
		}
	})

	t.Run("the old per-plan accept route is gone", func(t *testing.T) {
		rec := do(h, http.MethodPut, api+"/scenarios/10/assignments", `{"basedOnVersion":1,"tables":[]}`)
		if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("status = %d, want 404 or 405", rec.Code)
		}
	})
}

// Pins are explicit in the body and cover the whole cluster; disabled members ride along.
func TestReplaceScenariosPinsAndDisabledMembers(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 10)
	putLink(t, h, "1-2", 0)
	putLink(t, h, "1-3", 0) // cluster {1,2,3}
	expect(t, do(h, http.MethodPatch, api+"/guests", `{"guestIds":[3],"enabled":false}`), http.StatusOK, "")

	plans := storedLayouts(listScenarios(t, h))
	for i := range plans {
		plans[i].Tables = []oapi.TableLayout{
			{Number: 1, GuestIds: []int64{4, 5, 6, 7, 8}, PinnedGuestIds: []int64{}},
			{Number: 2, GuestIds: []int64{1, 2, 9, 10}, PinnedGuestIds: []int64{2}}, // pin via ONE member
		}
	}
	got := replaceOK(t, h, plans)
	for _, s := range got.Data {
		for _, id := range []int64{1, 2} {
			if tb, pinned, ok := tableOfGuest(s, id); !ok || tb != 2 || !pinned {
				t.Errorf("plan %d guest %d: table %d pinned %v seated %v", s.Capacity, id, tb, pinned, ok)
			}
		}
		if _, pinned, _ := tableOfGuest(s, 4); pinned {
			t.Errorf("plan %d: guest 4 must not be pinned", s.Capacity)
		}
		if s.Plan.Tables[1].Fill != 4 { // 1,2,9,10; the disabled child 3 rides along but does not count
			t.Errorf("plan %d table 2 fill = %d, want 4", s.Capacity, s.Plan.Tables[1].Fill)
		}
		if *s.Version != startVer(s.Capacity)+1 {
			t.Errorf("plan %d version = %d", s.Capacity, *s.Version)
		}
	}

	// the disabled child sits at its cluster's table, pinned: re-enabling it shows it there
	expect(t, do(h, http.MethodPatch, api+"/guests", `{"guestIds":[3],"enabled":true}`), http.StatusOK, "")
	if tb, pinned, ok := tableOfGuest(scenarioOf(t, listScenarios(t, h), 10), 3); !ok || tb != 2 || !pinned {
		t.Errorf("re-enabled guest 3: table %d pinned %v seated %v, want table 2 pinned", tb, pinned, ok)
	}

	t.Run("pins are not carried over from the stored plan", func(t *testing.T) {
		plans := storedLayouts(listScenarios(t, h))
		for i := range plans {
			for j := range plans[i].Tables {
				plans[i].Tables[j].PinnedGuestIds = []int64{}
			}
		}
		for _, s := range replaceOK(t, h, plans).Data {
			if _, pinned, _ := tableOfGuest(s, 1); pinned {
				t.Errorf("plan %d: guest 1 still pinned", s.Capacity)
			}
		}
	})
}

// "Generuj plany" then "Cofnij", end to end over HTTP.
func TestReplaceScenariosGenerateThenUndo(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 24)
	putLink(t, h, "1-2", 0)
	before := replaceOK(t, h, func() []oapi.ScenarioLayout { // hand-made plans, plan 10 with a pin
		plans := storedLayouts(listScenarios(t, h))
		for i := range plans {
			plans[i].Tables = []oapi.TableLayout{
				{Number: 1, GuestIds: rangeIDs(1, 12), PinnedGuestIds: []int64{}},
				{Number: 2, GuestIds: rangeIDs(13, 24), PinnedGuestIds: []int64{}},
			}
		}
		plans[1].Tables[0].PinnedGuestIds = []int64{1, 2}
		return plans
	}())

	// Generate: snapshot (GET) -> calculate -> PUT with the snapshot's versions
	snapshot := storedLayouts(listScenarios(t, h))
	generated := replaceOK(t, h, func() []oapi.ScenarioLayout {
		plans := proposalLayouts(calculate(t, h))
		for i := range plans {
			plans[i].BasedOnVersion = snapshot[i].BasedOnVersion
		}
		return plans
	}())
	if _, pinned, ok := tableOfGuest(scenarioOf(t, generated, 10), 1); !ok || !pinned {
		t.Errorf("Generate lost the pin (pinned %v seated %v)", pinned, ok)
	}

	// Cofnij: the snapshot with the versions Generate returned
	for i := range snapshot {
		snapshot[i].BasedOnVersion = *generated.Data[i].Version
	}
	restored := replaceOK(t, h, snapshot)
	for i, s := range restored.Data {
		b := before.Data[i]
		if len(s.Plan.Tables) != len(b.Plan.Tables) || s.Plan.Summary != b.Plan.Summary || *s.Version != *b.Version+2 {
			t.Errorf("plan %d not restored: v%d %+v, want %+v", s.Capacity, *s.Version, s.Plan.Summary, b.Plan.Summary)
		}
		for _, id := range []int64{1, 2, 13} {
			tb1, p1, _ := tableOfGuest(s, id)
			tb2, p2, _ := tableOfGuest(b, id)
			if tb1 != tb2 || p1 != p2 {
				t.Errorf("plan %d guest %d: table %d pinned %v, want table %d pinned %v", s.Capacity, id, tb1, p1, tb2, p2)
			}
		}
	}

	t.Run("after an edit the undo is 409 and changes nothing", func(t *testing.T) {
		scenarioResponse(t, do(h, http.MethodPut, seatPath(11, 20), `{"tableNumber":1,"pinned":false}`), http.StatusOK)
		now := listScenarios(t, h)
		for i := range snapshot {
			snapshot[i].BasedOnVersion = *restored.Data[i].Version
		}
		expect(t, replace(t, h, replaceBody(t, snapshot)), http.StatusConflict, oapi.ErrorCodeVersionConflict)
		after := listScenarios(t, h)
		for i := range after.Data {
			if *after.Data[i].Version != *now.Data[i].Version || after.Data[i].Plan.Summary != now.Data[i].Plan.Summary {
				t.Errorf("plan %d changed by a rejected undo", after.Data[i].Capacity)
			}
		}
	})
}

// acceptLayout stores `tables` (lists of guest ids) in plan `capacity` through PUT /scenarios
// (re-sending the other three plans unchanged) and returns that scenario.
func acceptLayout(t *testing.T, h http.Handler, capacity int, tables ...[]int64) oapi.Scenario {
	t.Helper()
	plans := storedLayouts(listScenarios(t, h))
	for i := range plans {
		if int(plans[i].Capacity) != capacity {
			continue
		}
		plans[i].Tables = make([]oapi.TableLayout, len(tables))
		for j, ids := range tables {
			plans[i].Tables[j] = oapi.TableLayout{Number: j + 1, GuestIds: ids, PinnedGuestIds: []int64{}}
		}
	}
	return scenarioOf(t, replaceOK(t, h, plans), capacity)
}

func rangeIDs(from, to int64) []int64 {
	var out []int64
	for i := from; i <= to; i++ {
		out = append(out, i)
	}
	return out
}

func TestMovePinAndUnseatCluster(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 10)
	putLink(t, h, "1-2", 0)
	putLink(t, h, "2-3", 0) // cluster {1,2,3}
	expect(t, do(h, http.MethodPatch, api+"/guests", `{"guestIds":[3],"enabled":false}`), http.StatusOK, "")
	acceptLayout(t, h, 10, []int64{1, 2, 4, 5, 6}, []int64{7, 8, 9, 10}, nil)

	t.Run("moving ONE member moves the whole cluster, with the pin", func(t *testing.T) {
		got := scenarioResponse(t, do(h, http.MethodPut, seatPath(10, 2), `{"tableNumber":2,"pinned":true}`), http.StatusOK)
		for _, id := range []int64{1, 2} {
			if tb, pinned, ok := tableOfGuest(got, id); !ok || tb != 2 || !pinned {
				t.Errorf("guest %d: table %d pinned %v seated %v", id, tb, pinned, ok)
			}
		}
		if *got.Version != 3 || got.Plan.Tables[1].Fill != 6 || got.Plan.Tables[0].Fill != 3 {
			t.Errorf("v%d fills %d/%d", *got.Version, got.Plan.Tables[0].Fill, got.Plan.Tables[1].Fill)
		}
		// the disabled member is invisible in the plan but moved with its cluster: moving it back
		// via the disabled guest's id works and brings the whole cluster along.
		back := scenarioResponse(t, do(h, http.MethodPut, seatPath(10, 3), `{"tableNumber":1,"pinned":false}`), http.StatusOK)
		for _, id := range []int64{1, 2} {
			if tb, pinned, _ := tableOfGuest(back, id); tb != 1 || pinned {
				t.Errorf("guest %d at table %d pinned %v, want table 1 unpinned", id, tb, pinned)
			}
		}
	})

	t.Run("unpin keeps the table", func(t *testing.T) {
		scenarioResponse(t, do(h, http.MethodPut, seatPath(10, 1), `{"tableNumber":1,"pinned":true}`), http.StatusOK)
		got := scenarioResponse(t, do(h, http.MethodPut, seatPath(10, 1), `{"tableNumber":1,"pinned":false}`), http.StatusOK)
		if tb, pinned, _ := tableOfGuest(got, 1); tb != 1 || pinned {
			t.Errorf("table %d pinned %v", tb, pinned)
		}
	})

	t.Run("overfilling is allowed: 200 with over_capacity and needsRecalculation", func(t *testing.T) {
		h := newAPI(t) // own data: here the whole cluster {1,2,3} is enabled
		seedGuests(t, h, 10)
		putLink(t, h, "1-2", 0)
		putLink(t, h, "2-3", 0)
		acceptLayout(t, h, 9, rangeIDs(1, 3), rangeIDs(4, 10))                                                               // plan 9: fills 3 and 7
		got := scenarioResponse(t, do(h, http.MethodPut, seatPath(9, 1), `{"tableNumber":2,"pinned":false}`), http.StatusOK) // 7 + cluster{1,2,3} = 10 > 9
		var over *oapi.Violation
		for i, v := range got.Plan.Violations {
			if v.Code == oapi.OverCapacity {
				over = &got.Plan.Violations[i]
			}
		}
		if over == nil || over.TableNumber.IsNull() || over.TableNumber.MustGet() != 2 || got.Plan.Tables[1].Fill != 10 || !got.Plan.Summary.NeedsRecalculation {
			t.Errorf("fill %d violations %+v", got.Plan.Tables[1].Fill, got.Plan.Violations)
		}
	})

	t.Run("422 on an unknown table, field tableNumber", func(t *testing.T) {
		for _, n := range []int{0, 9} {
			rec := do(h, http.MethodPut, seatPath(10, 1), fmt.Sprintf(`{"tableNumber":%d,"pinned":false}`, n))
			expect(t, rec, http.StatusUnprocessableEntity, oapi.ErrorCodeValidationFailed)
			if f := fieldOf(decodeError(t, rec).Errors[0]); f == nil || *f != "tableNumber" {
				t.Errorf("field = %v", f)
			}
		}
	})

	t.Run("404 unknown guest or capacity, 400 bad id", func(t *testing.T) {
		expect(t, do(h, http.MethodPut, seatPath(10, 999), `{"tableNumber":1,"pinned":false}`), http.StatusNotFound, oapi.ErrorCodeNotFound)
		expect(t, do(h, http.MethodPut, seatPath(8, 1), `{"tableNumber":1,"pinned":false}`), http.StatusNotFound, oapi.ErrorCodeNotFound)
		expect(t, do(h, http.MethodDelete, seatPath(10, 999), ""), http.StatusNotFound, oapi.ErrorCodeNotFound)
		expect(t, do(h, http.MethodPut, api+"/scenarios/10/assignments/abc", `{"tableNumber":1,"pinned":false}`), http.StatusBadRequest, oapi.ErrorCodeBadRequest)
	})

	t.Run("DELETE moves the whole cluster to the tray, idempotently", func(t *testing.T) {
		got := scenarioResponse(t, do(h, http.MethodDelete, seatPath(10, 3), ""), http.StatusOK) // via the disabled member
		for _, id := range []int64{1, 2} {
			if _, _, ok := tableOfGuest(got, id); ok {
				t.Errorf("guest %d still seated", id)
			}
		}
		if len(got.Plan.Unseated) != 1 || !slices.Equal(got.Plan.Unseated[0].GuestIds, []int64{1, 2}) || got.Plan.Unseated[0].ClusterKey != 1 {
			t.Errorf("unseated = %+v", got.Plan.Unseated)
		}
		if !slices.Contains(violationCodes(got), oapi.UnseatedGuests) {
			t.Errorf("violations = %v", violationCodes(got))
		}
		scenarioResponse(t, do(h, http.MethodDelete, seatPath(10, 1), ""), http.StatusOK)
	})
}

func TestAddAndDeleteTable(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 12)
	acceptLayout(t, h, 12, rangeIDs(1, 3), rangeIDs(4, 6), rangeIDs(7, 9), rangeIDs(10, 12))

	got := scenarioResponse(t, do(h, http.MethodPost, api+"/scenarios/12/tables", ""), http.StatusCreated)
	if got.Plan.Summary.TableCount != 5 || got.Plan.Tables[4].Number != 5 || got.Plan.Tables[4].Fill != 0 || len(got.Plan.Tables[4].Clusters) != 0 {
		t.Errorf("after add: %+v", got.Plan.Summary)
	}

	got = scenarioResponse(t, do(h, http.MethodDelete, api+"/scenarios/12/tables/2", ""), http.StatusOK)
	if got.Plan.Summary.TableCount != 4 {
		t.Fatalf("tables = %d", got.Plan.Summary.TableCount)
	}
	for i, tb := range got.Plan.Tables {
		if tb.Number != i+1 {
			t.Errorf("table %d numbered %d", i, tb.Number)
		}
	}
	if _, _, ok := tableOfGuest(got, 5); ok {
		t.Error("guest 5 should be unseated")
	}
	if tb, _, _ := tableOfGuest(got, 7); tb != 2 {
		t.Errorf("guest 7 at table %d, want 2 (renumbered)", tb)
	}
	if got.Plan.Summary.UnseatedCount != 3 || !got.Plan.Summary.NeedsRecalculation {
		t.Errorf("summary = %+v", got.Plan.Summary)
	}

	expect(t, do(h, http.MethodDelete, api+"/scenarios/12/tables/9", ""), http.StatusNotFound, oapi.ErrorCodeNotFound)
	expect(t, do(h, http.MethodDelete, api+"/scenarios/12/tables/x", ""), http.StatusBadRequest, oapi.ErrorCodeBadRequest)
	expect(t, do(h, http.MethodPost, api+"/scenarios/8/tables", ""), http.StatusNotFound, oapi.ErrorCodeNotFound)
}

func TestResetPlan(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 36)
	putLink(t, h, "1-2", 0)
	props := calculate(t, h)
	replaceOK(t, h, proposalLayouts(props))
	pin := scenarioResponse(t, do(h, http.MethodPut, seatPath(10, 1), `{"tableNumber":1,"pinned":true}`), http.StatusOK)
	if _, pinned, ok := tableOfGuest(pin, 1); !ok || !pinned {
		t.Fatalf("precondition: guest 1 pinned %v seated %v", pinned, ok)
	}
	before := listScenarios(t, h)
	old10 := scenarioOf(t, before, 10)

	rec := do(h, http.MethodDelete, api+"/scenarios/10/tables", "")
	got := scenarioResponse(t, rec, http.StatusOK)
	if !strings.Contains(rec.Body.String(), `"tables":[]`) {
		t.Errorf("plan.tables must be an empty array, body: %s", rec.Body)
	}
	if got.Capacity != 10 || len(got.Plan.Tables) != 0 || got.Plan.Summary.TableCount != 0 ||
		got.Plan.Summary.SeatedCount != 0 || got.Plan.Summary.UnseatedCount != 36 || !got.Plan.Summary.NeedsRecalculation {
		t.Errorf("reset plan = capacity %d summary %+v", got.Capacity, got.Plan.Summary)
	}
	if !slices.Contains(violationCodes(got), oapi.UnseatedGuests) {
		t.Errorf("violations = %v, want unseated_guests", violationCodes(got))
	}
	if *got.Version != *old10.Version+1 {
		t.Errorf("version = %d, want %d", *got.Version, *old10.Version+1)
	}

	t.Run("GET /scenarios still lists four plans; the others are unchanged", func(t *testing.T) {
		after := listScenarios(t, h)
		if len(after.Data) != 4 {
			t.Fatalf("scenarios = %d, want 4", len(after.Data))
		}
		if s := scenarioOf(t, after, 10); len(s.Plan.Tables) != 0 || *s.Version != *got.Version {
			t.Errorf("plan 10 = v%d, %d tables", *s.Version, len(s.Plan.Tables))
		}
		for _, c := range []int{9, 11, 12} {
			b, a := scenarioOf(t, before, c), scenarioOf(t, after, c)
			if *a.Version != *b.Version || a.Plan.Summary != b.Plan.Summary || len(a.Plan.Tables) != len(b.Plan.Tables) || len(a.Plan.Tables) == 0 {
				t.Errorf("plan %d changed: v%d -> v%d, %d -> %d tables", c, *b.Version, *a.Version, len(b.Plan.Tables), len(a.Plan.Tables))
			}
		}
	})

	t.Run("repeating it is 200 again (only the version moves)", func(t *testing.T) {
		again := scenarioResponse(t, do(h, http.MethodDelete, api+"/scenarios/10/tables", ""), http.StatusOK)
		if len(again.Plan.Tables) != 0 || *again.Version != *got.Version+1 {
			t.Errorf("repeat = v%d, %d tables", *again.Version, len(again.Plan.Tables))
		}
	})

	t.Run("a proposal generated before the reset is stale", func(t *testing.T) {
		expect(t, replace(t, h, replaceBody(t, proposalLayouts(props))), http.StatusConflict, oapi.ErrorCodeVersionConflict)
	})

	t.Run("errors", func(t *testing.T) {
		expect(t, do(h, http.MethodDelete, api+"/scenarios/8/tables", ""), http.StatusNotFound, oapi.ErrorCodeNotFound)
		rec := do(h, http.MethodDelete, api+"/scenarios/abc/tables", "")
		expect(t, rec, http.StatusBadRequest, oapi.ErrorCodeBadRequest)
		if f, err := decodeError(t, rec).Errors[0].Field.Get(); err != nil || f != "capacity" {
			t.Errorf("error field = %q (%v), want capacity", f, err)
		}
	})
}

// Flow 3, end to end: a re-enabled child rides along to its cluster's full table; GET /scenarios
// then shows the overfill with needsRecalculation, and nothing was regenerated.
func TestReEnabledGuestNeedsRecalculation(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 10)
	putLink(t, h, "1-2", 0)
	putLink(t, h, "1-3", 0) // cluster {1,2,3}
	expect(t, do(h, http.MethodPatch, api+"/guests", `{"guestIds":[3],"enabled":false}`), http.StatusOK, "")

	acc := acceptLayout(t, h, 9, []int64{1, 2, 4, 5, 6, 7, 8, 9, 10}) // 9/9 enabled; child 3 rides along
	if acc.Plan.Summary.NeedsRecalculation || acc.Plan.Tables[0].Fill != 9 {
		t.Fatalf("precondition: %+v", acc.Plan.Summary)
	}

	expect(t, do(h, http.MethodPatch, api+"/guests", `{"guestIds":[3],"enabled":true}`), http.StatusOK, "")
	got := scenarioOf(t, listScenarios(t, h), 9)
	if *got.Version != *acc.Version {
		t.Errorf("plan version %d -> %d: re-enabling must not touch plans", *acc.Version, *got.Version)
	}
	if tb, _, ok := tableOfGuest(got, 3); !ok || tb != 1 {
		t.Errorf("guest 3 at table %d (seated %v), want table 1", tb, ok)
	}
	if got.Plan.Tables[0].Fill != 10 || !got.Plan.Summary.NeedsRecalculation || !slices.Contains(violationCodes(got), oapi.OverCapacity) {
		t.Errorf("fill %d summary %+v codes %v", got.Plan.Tables[0].Fill, got.Plan.Summary, violationCodes(got))
	}
	// the other plans have no tables: they need recalculation too, because everyone is unseated
	if o := scenarioOf(t, listScenarios(t, h), 10); !o.Plan.Summary.NeedsRecalculation {
		t.Error("plan 10 should need recalculation")
	}

	// regenerate: 10 guests fit one 12-seat table (the floor is waived for one table); at 9 seats
	// no table count satisfies the floor of 8, so that proposal is best-effort with violations
	prop := calculate(t, h).Data[3]
	if prop.Capacity != 12 || prop.Plan.Summary.NeedsRecalculation || prop.Plan.Summary.SeatedCount != 10 {
		t.Errorf("proposal summary = %+v", prop.Plan.Summary)
	}
}

// Floor 8: proposals never fail. When no table count satisfies the floor (12 guests at 9 seats),
// the best-effort layout is returned with under_floor; a single table waives the floor.
func TestCalculateFloorCases(t *testing.T) {
	tests := []struct {
		name         string
		guests       int
		capacity     int
		wantTables   int
		wantUnder    bool // under_floor violation expected
		wantComplete bool // no violations at all
	}{
		{"12 guests at 9: infeasible, best effort", 12, 9, 2, true, false},
		{"10 guests at 12: one table, floor waived", 10, 12, 1, false, true},
		{"28 guests at 12: three tables of at least 8", 28, 12, 3, false, true},
		{"24 guests at 10: three tables of 8", 24, 10, 3, false, true},
		{"23 guests at 11: infeasible, best effort", 23, 11, 3, true, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := newAPI(t)
			seedGuests(t, h, tc.guests)
			var prop *oapi.Proposal
			for _, p := range calculate(t, h).Data {
				if int(p.Capacity) == tc.capacity {
					prop = &p
				}
			}
			if prop == nil {
				t.Fatalf("no proposal for capacity %d", tc.capacity)
			}
			sum := prop.Plan.Summary
			if sum.SeatedCount != tc.guests || sum.UnseatedCount != 0 {
				t.Errorf("seated %d unseated %d, want everyone seated", sum.SeatedCount, sum.UnseatedCount)
			}
			if tc.wantTables != 0 && sum.TableCount != tc.wantTables {
				t.Errorf("tables = %d, want %d", sum.TableCount, tc.wantTables)
			}
			codes := make([]oapi.ViolationCode, 0, len(prop.Plan.Violations))
			for _, v := range prop.Plan.Violations {
				codes = append(codes, v.Code)
			}
			if tc.wantUnder && !slices.Contains(codes, oapi.UnderFloor) {
				t.Errorf("violations = %v, want under_floor", codes)
			}
			if tc.wantComplete && (len(codes) != 0 || sum.NeedsRecalculation) {
				t.Errorf("violations = %v, want none", codes)
			}
			if sum.TableCount > 1 && !tc.wantUnder {
				for _, tb := range prop.Plan.Tables {
					if tb.Fill < 8 && len(codes) == 0 {
						t.Errorf("table %d has %d guests, below the floor, without a violation", tb.Number, tb.Fill)
					}
				}
			}
		})
	}
}

// GET/POST/DELETE on capacity 8 (removed by task 006) is 404, not a validation error.
func TestRemovedCapacity8IsNotFound(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 3)
	expect(t, do(h, http.MethodDelete, api+"/scenarios/8/tables", ""), http.StatusNotFound, oapi.ErrorCodeNotFound)
	expect(t, do(h, http.MethodPost, api+"/scenarios/8/tables", ""), http.StatusNotFound, oapi.ErrorCodeNotFound)
	for _, s := range listScenarios(t, h).Data {
		if s.Capacity == 8 {
			t.Error("capacity 8 listed")
		}
	}
}
