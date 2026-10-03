package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
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
func startVer(key oapi.PlanKey) int {
	if key == oapi.Seats9 {
		return 2
	}
	return 1
}

// allKeys is the canonical order of the five plans.
var allKeys = []oapi.PlanKey{oapi.Seats9, oapi.Seats10, oapi.Seats11, oapi.Seats12, oapi.Mixed}

func capacityOf(k oapi.PlanKey) oapi.Capacity {
	n, _ := strconv.Atoi(string(k))
	return oapi.Capacity(n)
}

func listScenarios(t *testing.T, h http.Handler) oapi.ScenarioListResponse {
	t.Helper()
	rec := do(h, http.MethodGet, api+"/scenarios", "")
	expect(t, rec, http.StatusOK, "")
	return decode[oapi.ScenarioListResponse](t, rec)
}

func scenarioOf(t *testing.T, list oapi.ScenarioListResponse, key oapi.PlanKey) oapi.Scenario {
	t.Helper()
	for _, s := range list.Data {
		if s.Key == key {
			return s
		}
	}
	t.Fatalf("no scenario %s", key)
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
func layoutOf(key oapi.PlanKey, basedOn int, plan oapi.SeatingPlan) oapi.ScenarioLayout {
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
	return oapi.ScenarioLayout{Key: key, BasedOnVersion: basedOn, Tables: tables}
}

// proposalLayouts is "Generuj plany" as the SPA sends it: the five proposals' tables, basedOn
// = the version of each proposal (the plan the client had on screen).
func proposalLayouts(props oapi.ProposalListResponse) []oapi.ScenarioLayout {
	out := make([]oapi.ScenarioLayout, len(props.Data))
	for i, p := range props.Data {
		out[i] = layoutOf(p.Key, p.BasedOnVersion, p.Plan)
	}
	return out
}

// storedLayouts re-sends the stored plans unchanged (basedOn = their current versions).
func storedLayouts(list oapi.ScenarioListResponse) []oapi.ScenarioLayout {
	out := make([]oapi.ScenarioLayout, len(list.Data))
	for i, s := range list.Data {
		out[i] = layoutOf(s.Key, *s.Version, s.Plan)
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
	if got.Meta.RequestId == nil || got.Page.Total == nil || *got.Page.Total != 5 || len(got.Data) != 5 {
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

// seatPath addresses a plan by its key: 9..12 (int) or "mixed".
func seatPath(planKey any, guest int64) string {
	return fmt.Sprintf("%s/scenarios/%v/assignments/%d", api, planKey, guest)
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
	if list.Meta.RequestId == nil || list.Page.Total == nil || *list.Page.Total != 5 || len(list.Data) != 5 {
		t.Fatalf("envelope = %+v", list)
	}
	for i, c := range allKeys {
		s := list.Data[i]
		wantCapacity := oapi.Capacity(12)
		if c != oapi.Mixed {
			wantCapacity = capacityOf(c)
		}
		if s.Key != c || s.Capacity != wantCapacity || s.Version == nil || *s.Version != startVer(c) {
			t.Errorf("scenario %d = key %s capacity %d v%v", i, s.Key, s.Capacity, s.Version)
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

// Flow 1: calculate stores nothing; PUT /scenarios stores all five proposals; a stale PUT is 409.
func TestCalculateThenReplaceAllFive(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 36)
	putLink(t, h, "1-2", 0) // cluster {1,2,3}
	putLink(t, h, "2-3", 0)
	putLink(t, h, "4-5", 0) // cluster {4,5}
	putLink(t, h, "1-4", 1) // preferred
	putLink(t, h, "6-7", 2)

	props := calculate(t, h)
	if props.Meta.RequestId == nil || props.Page.Total == nil || *props.Page.Total != 5 || len(props.Data) != 5 {
		t.Fatalf("envelope = %+v", props)
	}
	// 36 guests, floor 8: four tables of 9 at capacities 9, 10 and 11; three of 12 at capacity 12
	// and in the mixed plan (nobody is isolated at 3 tables, so it takes no extra one)
	wantTables := map[oapi.PlanKey]int{oapi.Seats9: 4, oapi.Seats10: 4, oapi.Seats11: 4, oapi.Seats12: 3, oapi.Mixed: 3}
	for i, c := range allKeys {
		p := props.Data[i]
		if p.Key != c || (c == oapi.Mixed && p.Capacity != 12) || p.BasedOnVersion != startVer(c) {
			t.Errorf("proposal %d = key %s capacity %d basedOn %d", i, p.Key, p.Capacity, p.BasedOnVersion)
		}
		sum := p.Plan.Summary
		if sum.TableCount != wantTables[c] || sum.SeatedCount != 36 || sum.UnseatedCount != 0 || sum.NeedsRecalculation || sum.ViolationCount != 0 {
			t.Errorf("plan %s summary = %+v", c, sum)
		}
		for _, sc := range p.Plan.GuestScores {
			if !sc.TableNumber.IsSpecified() || sc.TableNumber.IsNull() {
				t.Errorf("guest %d tableNumber = %+v, want a number", sc.GuestId, sc.TableNumber)
			}
		}
	}

	t.Run("calculate stored nothing", func(t *testing.T) {
		for _, s := range listScenarios(t, h).Data {
			if *s.Version != startVer(s.Key) || len(s.Plan.Tables) != 0 {
				t.Errorf("scenario %s changed: v%d, %d tables", s.Key, *s.Version, len(s.Plan.Tables))
			}
		}
	})

	t.Run("PUT /scenarios stores all five proposals at once", func(t *testing.T) {
		got := replaceOK(t, h, proposalLayouts(props))
		for i, p := range props.Data {
			s := got.Data[i]
			if s.Key != p.Key || s.Capacity != p.Capacity || *s.Version != startVer(p.Key)+1 || s.Plan.Summary.TableCount != p.Plan.Summary.TableCount ||
				s.Plan.Summary.NeedsRecalculation || s.Plan.Summary.SeatedCount != 36 {
				t.Errorf("stored %s = v%d %+v", s.Key, *s.Version, s.Plan.Summary)
			}
			if s.Plan.Summary.Score != p.Plan.Summary.Score {
				t.Errorf("score %v != proposed %v", s.Plan.Summary.Score, p.Plan.Summary.Score)
			}
		}
	})

	t.Run("GET /scenarios now returns the stored plans", func(t *testing.T) {
		for _, s := range listScenarios(t, h).Data {
			if *s.Version != startVer(s.Key)+1 || s.Plan.Summary.TableCount != wantTables[s.Key] {
				t.Errorf("scenario %s = v%d, %d tables", s.Key, *s.Version, s.Plan.Summary.TableCount)
			}
		}
	})

	t.Run("a stale PUT (the proposals again) is 409 version_conflict", func(t *testing.T) {
		expect(t, replace(t, h, replaceBody(t, proposalLayouts(props))), http.StatusConflict, oapi.ErrorCodeVersionConflict)
	})
}

// plansJSON builds a PUT /scenarios body: plan 10 as given, the other four empty with their
// current (fresh database) versions.
func plansJSON(plan10 string) string {
	return fmt.Sprintf(`{"plans":[{"key":"9","basedOnVersion":2,"tables":[]},%s,{"key":"11","basedOnVersion":1,"tables":[]},{"key":"12","basedOnVersion":1,"tables":[]},{"key":"mixed","basedOnVersion":1,"tables":[]}]}`, plan10)
}

func TestReplaceScenariosErrors(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 6)
	p10 := func(tables string) string { return `{"key":"10","basedOnVersion":1,"tables":` + tables + `}` }
	const (
		e9, e10, e11 = `{"key":"9","basedOnVersion":2,"tables":[]}`, `{"key":"10","basedOnVersion":1,"tables":[]}`, `{"key":"11","basedOnVersion":1,"tables":[]}`
		e12, eMixed  = `{"key":"12","basedOnVersion":1,"tables":[]}`, `{"key":"mixed","basedOnVersion":1,"tables":[]}`
	)
	body := func(plans ...string) string { return `{"plans":[` + strings.Join(plans, ",") + `]}` }
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
		{"only three plans", body(e9, e10, e11), 422, oapi.ErrorCodeValidationFailed, "plans"},
		{"the old four plans (no mixed)", body(e9, e10, e11, e12), 422, oapi.ErrorCodeValidationFailed, "plans"},
		{"key repeated", body(e9, e10, e11, e11, eMixed), 422, oapi.ErrorCodeValidationFailed, "plans"},
		{"mixed twice", body(e9, e10, e11, eMixed, eMixed), 422, oapi.ErrorCodeValidationFailed, "plans"},
		{"capacity 8 (removed)", body(`{"key":"8","basedOnVersion":1,"tables":[]}`, e10, e11, e12, eMixed), 422, oapi.ErrorCodeValidationFailed, "plans"},
		{"unknown key", body(`{"key":"foo","basedOnVersion":1,"tables":[]}`, e10, e11, e12, eMixed), 422, oapi.ErrorCodeValidationFailed, "plans"},
		{"old body with capacity instead of key", body(`{"capacity":9,"basedOnVersion":2,"tables":[]}`, e10, e11, e12, eMixed), 422, oapi.ErrorCodeValidationFailed, "plans"},
		{"stale version", plansJSON(`{"key":"10","basedOnVersion":5,"tables":[]}`), 409, oapi.ErrorCodeVersionConflict, "plans"},
		{"basedOnVersion below 1", plansJSON(`{"key":"10","basedOnVersion":0,"tables":[]}`), 400, oapi.ErrorCodeBadRequest, "basedOnVersion"},
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
				if *s.Version != startVer(s.Key) || len(s.Plan.Tables) != 0 {
					t.Fatalf("a rejected PUT changed scenario %s (v%d, %d tables)", s.Key, *s.Version, len(s.Plan.Tables))
				}
			}
		})
	}

	t.Run("the 409 names the stale plan", func(t *testing.T) {
		rec := replace(t, h, plansJSON(`{"key":"10","basedOnVersion":5,"tables":[]}`))
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
				t.Errorf("plan %s guest %d: table %d pinned %v seated %v", s.Key, id, tb, pinned, ok)
			}
		}
		if _, pinned, _ := tableOfGuest(s, 4); pinned {
			t.Errorf("plan %s: guest 4 must not be pinned", s.Key)
		}
		if s.Plan.Tables[1].Fill != 4 { // 1,2,9,10; the disabled child 3 rides along but does not count
			t.Errorf("plan %s table 2 fill = %d, want 4", s.Key, s.Plan.Tables[1].Fill)
		}
		if *s.Version != startVer(s.Key)+1 {
			t.Errorf("plan %s version = %d", s.Key, *s.Version)
		}
	}

	// the disabled child sits at its cluster's table, pinned: re-enabling it shows it there
	expect(t, do(h, http.MethodPatch, api+"/guests", `{"guestIds":[3],"enabled":true}`), http.StatusOK, "")
	if tb, pinned, ok := tableOfGuest(scenarioOf(t, listScenarios(t, h), "10"), 3); !ok || tb != 2 || !pinned {
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
				t.Errorf("plan %s: guest 1 still pinned", s.Key)
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
	if _, pinned, ok := tableOfGuest(scenarioOf(t, generated, "10"), 1); !ok || !pinned {
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
			t.Errorf("plan %s not restored: v%d %+v, want %+v", s.Key, *s.Version, s.Plan.Summary, b.Plan.Summary)
		}
		for _, id := range []int64{1, 2, 13} {
			tb1, p1, _ := tableOfGuest(s, id)
			tb2, p2, _ := tableOfGuest(b, id)
			if tb1 != tb2 || p1 != p2 {
				t.Errorf("plan %s guest %d: table %d pinned %v, want table %d pinned %v", s.Key, id, tb1, p1, tb2, p2)
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
				t.Errorf("plan %s changed by a rejected undo", after.Data[i].Key)
			}
		}
	})
}

// acceptLayout stores `tables` (lists of guest ids) in plan `key` through PUT /scenarios
// (re-sending the other four plans unchanged) and returns that scenario.
func acceptLayout(t *testing.T, h http.Handler, key oapi.PlanKey, tables ...[]int64) oapi.Scenario {
	t.Helper()
	plans := storedLayouts(listScenarios(t, h))
	for i := range plans {
		if plans[i].Key != key {
			continue
		}
		plans[i].Tables = make([]oapi.TableLayout, len(tables))
		for j, ids := range tables {
			plans[i].Tables[j] = oapi.TableLayout{Number: j + 1, GuestIds: ids, PinnedGuestIds: []int64{}}
		}
	}
	return scenarioOf(t, replaceOK(t, h, plans), key)
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
	acceptLayout(t, h, "10", []int64{1, 2, 4, 5, 6}, []int64{7, 8, 9, 10}, nil)

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
		acceptLayout(t, h, "9", rangeIDs(1, 3), rangeIDs(4, 10))                                                             // plan 9: fills 3 and 7
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

	t.Run("404 unknown guest or plan, 400 bad id", func(t *testing.T) {
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
	acceptLayout(t, h, "12", rangeIDs(1, 3), rangeIDs(4, 6), rangeIDs(7, 9), rangeIDs(10, 12))

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
	old10 := scenarioOf(t, before, "10")

	rec := do(h, http.MethodDelete, api+"/scenarios/10/tables", "")
	got := scenarioResponse(t, rec, http.StatusOK)
	if !strings.Contains(rec.Body.String(), `"tables":[]`) {
		t.Errorf("plan.tables must be an empty array, body: %s", rec.Body)
	}
	if got.Key != oapi.Seats10 || got.Capacity != 10 || len(got.Plan.Tables) != 0 || got.Plan.Summary.TableCount != 0 ||
		got.Plan.Summary.SeatedCount != 0 || got.Plan.Summary.UnseatedCount != 36 || !got.Plan.Summary.NeedsRecalculation {
		t.Errorf("reset plan = key %s summary %+v", got.Key, got.Plan.Summary)
	}
	if !slices.Contains(violationCodes(got), oapi.UnseatedGuests) {
		t.Errorf("violations = %v, want unseated_guests", violationCodes(got))
	}
	if *got.Version != *old10.Version+1 {
		t.Errorf("version = %d, want %d", *got.Version, *old10.Version+1)
	}

	t.Run("GET /scenarios still lists five plans; the others are unchanged", func(t *testing.T) {
		after := listScenarios(t, h)
		if len(after.Data) != 5 {
			t.Fatalf("scenarios = %d, want 5", len(after.Data))
		}
		if s := scenarioOf(t, after, "10"); len(s.Plan.Tables) != 0 || *s.Version != *got.Version {
			t.Errorf("plan 10 = v%d, %d tables", *s.Version, len(s.Plan.Tables))
		}
		for _, c := range []oapi.PlanKey{oapi.Seats9, oapi.Seats11, oapi.Seats12, oapi.Mixed} {
			b, a := scenarioOf(t, before, c), scenarioOf(t, after, c)
			if *a.Version != *b.Version || a.Plan.Summary != b.Plan.Summary || len(a.Plan.Tables) != len(b.Plan.Tables) || len(a.Plan.Tables) == 0 {
				t.Errorf("plan %s changed: v%d -> v%d, %d -> %d tables", c, *b.Version, *a.Version, len(b.Plan.Tables), len(a.Plan.Tables))
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
		for _, key := range []string{"abc", "13", "0", "Mixed", "012"} { // an unknown key is a 404, like an unknown capacity always was
			expect(t, do(h, http.MethodDelete, api+"/scenarios/"+key+"/tables", ""), http.StatusNotFound, oapi.ErrorCodeNotFound)
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

	acc := acceptLayout(t, h, "9", []int64{1, 2, 4, 5, 6, 7, 8, 9, 10}) // 9/9 enabled; child 3 rides along
	if acc.Plan.Summary.NeedsRecalculation || acc.Plan.Tables[0].Fill != 9 {
		t.Fatalf("precondition: %+v", acc.Plan.Summary)
	}

	expect(t, do(h, http.MethodPatch, api+"/guests", `{"guestIds":[3],"enabled":true}`), http.StatusOK, "")
	got := scenarioOf(t, listScenarios(t, h), "9")
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
	if o := scenarioOf(t, listScenarios(t, h), "10"); !o.Plan.Summary.NeedsRecalculation {
		t.Error("plan 10 should need recalculation")
	}

	// regenerate: 10 guests fit one 12-seat table (the floor is waived for one table); at 9 seats
	// no table count satisfies the floor of 8, so that proposal is best-effort with violations
	prop := calculate(t, h).Data[3]
	if prop.Key != oapi.Seats12 || prop.Capacity != 12 || prop.Plan.Summary.NeedsRecalculation || prop.Plan.Summary.SeatedCount != 10 {
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
				if int(p.Capacity) == tc.capacity && p.Key != oapi.Mixed {
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
		if s.Capacity == 8 || s.Key == "8" {
			t.Error("capacity 8 listed")
		}
	}
}

// Task 013: the mixed plan is addressed as /scenarios/mixed/...; plan 12 and the mixed plan share
// capacity 12 but are two plans.
func TestMixedPlanEndpoints(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 14)

	t.Run("GET /scenarios lists it fifth with key mixed and capacity 12", func(t *testing.T) {
		list := listScenarios(t, h)
		if len(list.Data) != 5 || list.Data[3].Key != oapi.Seats12 || list.Data[4].Key != oapi.Mixed || list.Data[4].Capacity != 12 || list.Data[3].Capacity != 12 {
			t.Fatalf("scenarios = %+v", list.Data)
		}
		var raw struct{ Data []map[string]any }
		rec := do(h, http.MethodGet, api+"/scenarios", "")
		if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
			t.Fatal(err)
		}
		if raw.Data[4]["key"] != "mixed" || raw.Data[4]["capacity"] != float64(12) || raw.Data[0]["key"] != "9" {
			t.Errorf("JSON key/capacity = %v / %v / %v", raw.Data[4]["key"], raw.Data[4]["capacity"], raw.Data[0]["key"])
		}
	})

	t.Run("calculate: five proposals with a key each, the last one mixed", func(t *testing.T) {
		props := calculate(t, h)
		for i, k := range allKeys {
			if props.Data[i].Key != k {
				t.Errorf("proposal %d key = %s, want %s", i, props.Data[i].Key, k)
			}
		}
	})

	acceptLayout(t, h, "12", rangeIDs(1, 8), rangeIDs(9, 14))
	acceptLayout(t, h, "mixed", rangeIDs(1, 12), rangeIDs(13, 14))
	before12 := scenarioOf(t, listScenarios(t, h), "12")

	t.Run("seat, unseat, add and delete a table, reset: only the mixed plan changes", func(t *testing.T) {
		got := scenarioResponse(t, do(h, http.MethodPut, seatPath("mixed", 13), `{"tableNumber":1,"pinned":true}`), http.StatusOK)
		if got.Key != oapi.Mixed || got.Capacity != 12 || got.Plan.Tables[0].Fill != 13 || !slices.Contains(violationCodes(got), oapi.OverCapacity) {
			t.Errorf("seat: key %s fill %d violations %v", got.Key, got.Plan.Tables[0].Fill, violationCodes(got))
		}
		if got = scenarioResponse(t, do(h, http.MethodDelete, seatPath("mixed", 14), ""), http.StatusOK); got.Key != oapi.Mixed || len(got.Plan.Unseated) != 1 {
			t.Errorf("unseat: %+v", got.Plan.Unseated)
		}
		if got = scenarioResponse(t, do(h, http.MethodPost, api+"/scenarios/mixed/tables", ""), http.StatusCreated); got.Key != oapi.Mixed || got.Plan.Summary.TableCount != 3 {
			t.Errorf("add table: key %s tables %d", got.Key, got.Plan.Summary.TableCount)
		}
		if got = scenarioResponse(t, do(h, http.MethodDelete, api+"/scenarios/mixed/tables/3", ""), http.StatusOK); got.Plan.Summary.TableCount != 2 {
			t.Errorf("delete table: tables %d", got.Plan.Summary.TableCount)
		}
		after12 := scenarioOf(t, listScenarios(t, h), "12")
		if *after12.Version != *before12.Version || after12.Plan.Summary != before12.Plan.Summary {
			t.Errorf("plan 12 changed by edits of the mixed plan")
		}
		got = scenarioResponse(t, do(h, http.MethodDelete, api+"/scenarios/mixed/tables", ""), http.StatusOK)
		if got.Key != oapi.Mixed || len(got.Plan.Tables) != 0 {
			t.Errorf("reset: key %s tables %d", got.Key, len(got.Plan.Tables))
		}
		after12 = scenarioOf(t, listScenarios(t, h), "12")
		if *after12.Version != *before12.Version || len(after12.Plan.Tables) != 2 {
			t.Errorf("plan 12 changed by deleting the mixed plan: v%d, %d tables", *after12.Version, len(after12.Plan.Tables))
		}
	})

	t.Run("an unknown plan key is 404 not_found on every per-plan route", func(t *testing.T) {
		for _, key := range []string{"13", "8", "foo", "Mixed", "mixed2"} {
			for _, r := range []struct{ method, path, body string }{
				{http.MethodPut, "/scenarios/" + key + "/assignments/1", `{"tableNumber":1,"pinned":false}`},
				{http.MethodDelete, "/scenarios/" + key + "/assignments/1", ""},
				{http.MethodPost, "/scenarios/" + key + "/tables", ""},
				{http.MethodDelete, "/scenarios/" + key + "/tables/1", ""},
				{http.MethodDelete, "/scenarios/" + key + "/tables", ""},
			} {
				expect(t, do(h, r.method, api+r.path, r.body), http.StatusNotFound, oapi.ErrorCodeNotFound)
			}
		}
	})

	t.Run("a stale mixed version names the plan in the 409", func(t *testing.T) {
		plans := storedLayouts(listScenarios(t, h))
		plans[4].BasedOnVersion--
		rec := replace(t, h, replaceBody(t, plans))
		expect(t, rec, http.StatusConflict, oapi.ErrorCodeVersionConflict)
		if msg := decodeError(t, rec).Errors[0].Message; !strings.Contains(msg, "Plan mixed") {
			t.Errorf("message = %q", msg)
		}
	})

	t.Run("PUT /scenarios round-trips the mixed plan (key, tables)", func(t *testing.T) {
		plans := storedLayouts(listScenarios(t, h))
		plans[4].Tables = []oapi.TableLayout{{Number: 1, GuestIds: rangeIDs(1, 9), PinnedGuestIds: []int64{}}, {Number: 2, GuestIds: rangeIDs(10, 14), PinnedGuestIds: []int64{10}}}
		got := replaceOK(t, h, plans)
		if m := got.Data[4]; m.Key != oapi.Mixed || m.Plan.Summary.TableCount != 2 || m.Plan.Summary.SeatedCount != 14 {
			t.Errorf("mixed = %+v", m.Plan.Summary)
		}
		if tb, pinned, _ := tableOfGuest(got.Data[4], 10); tb != 2 || !pinned {
			t.Errorf("guest 10: table %d pinned %v", tb, pinned)
		}
		if got.Data[3].Plan.Summary.TableCount != 2 || got.Data[3].Plan.Summary.SeatedCount != 14 {
			t.Errorf("plan 12 was disturbed: %+v", got.Data[3].Plan.Summary)
		}
	})
}

// Task 014: a child takes a seat (fill) but is not scored: zeros for the child, adults-only
// scores for everybody else; PATCH isChild changes scores, never fill or violations.
func TestChildrenAreSeatedButNotScoredOverHTTP(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 24)
	for i := 1; i < 5; i++ { // family {1..5}: adults 1, 2; children 3, 4, 5
		expect(t, do(h, http.MethodPut, fmt.Sprintf("%s/guest-links/%d-%d", api, i, i+1), `{"level":0}`), http.StatusOK, "")
	}
	putLink(t, h, "1-6", 1) // adult 1 prefers the single guest 6
	setChild := func(id int64, child bool) {
		t.Helper()
		list := decode[oapi.GuestListResponse](t, do(h, http.MethodGet, api+"/guests", ""))
		for _, g := range list.Data {
			if *g.Id == id {
				expect(t, do(h, http.MethodPatch, fmt.Sprintf("%s/guests/%d", api, id), fmt.Sprintf(`{"version":%d,"isChild":%v}`, *g.Version, child)), http.StatusOK, "")
				return
			}
		}
		t.Fatalf("guest %d not listed", id)
	}
	for i := int64(3); i <= 5; i++ {
		setChild(i, true)
	}

	sc := acceptLayout(t, h, oapi.Seats10, rangeIDs(1, 8), rangeIDs(9, 16), rangeIDs(17, 24))
	score := func(s oapi.Scenario, id int64) oapi.GuestScore {
		for _, gs := range s.Plan.GuestScores {
			if gs.GuestId == id {
				return gs
			}
		}
		t.Fatalf("no score for %d", id)
		return oapi.GuestScore{}
	}
	if sc.Plan.Tables[0].Fill != 8 || len(sc.Plan.Violations) != 0 || sc.Plan.Summary.NeedsRecalculation {
		t.Fatalf("fill %d, violations %v: children must take seats", sc.Plan.Tables[0].Fill, violationCodes(sc))
	}
	for _, id := range []int64{3, 4, 5} {
		gs := score(sc, id)
		if gs.Satisfaction != 0 || gs.PreferredTotal != 0 || gs.PreferredAtTable != 0 || gs.FallbackAtTable != 0 || gs.StrangersAtTable != 0 {
			t.Errorf("child %d = %+v, want all zeros", id, gs)
		}
	}
	if score(sc, 1).Satisfaction != 1 || score(sc, 6).Satisfaction != 2 || sc.Plan.Tables[0].Score != 4 || sc.Plan.Summary.Score != 4 {
		t.Errorf("adults 1/6 = %v/%v, table score %v, plan score %v, want 1/2/4/4", score(sc, 1).Satisfaction, score(sc, 6).Satisfaction, sc.Plan.Tables[0].Score, sc.Plan.Summary.Score)
	}

	// calculate: the child stays seated with its family and unscored
	for _, p := range calculate(t, h).Data {
		for _, id := range []int64{3, 4, 5} {
			var found bool
			for _, gs := range p.Plan.GuestScores {
				if gs.GuestId == id {
					found = true
					if gs.Satisfaction != 0 || gs.TableNumber == nil {
						t.Errorf("plan %v child %d = %+v, want seated and 0", p.Key, id, gs)
					}
				}
			}
			if !found {
				t.Errorf("plan %v: no score for child %d", p.Key, id)
			}
		}
	}

	// un-flag child 3: the score changes, fill and violations do not
	setChild(3, false)
	after := scenarioOf(t, listScenarios(t, h), oapi.Seats10)
	if after.Plan.Tables[0].Fill != 8 || len(after.Plan.Violations) != 0 || score(after, 6).Satisfaction != 3 {
		t.Errorf("after un-flagging: fill %d violations %v satisfaction of 6 = %v, want 8, none, 3", after.Plan.Tables[0].Fill, violationCodes(after), score(after, 6).Satisfaction)
	}
}
