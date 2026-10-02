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

// acceptBody turns a proposal's tables into the AcceptPlan request body.
func acceptBody(t *testing.T, p oapi.Proposal) string {
	t.Helper()
	tables := make([]oapi.TableLayout, 0, len(p.Plan.Tables))
	for _, tb := range p.Plan.Tables {
		ids := []int64{}
		for _, c := range tb.Clusters {
			ids = append(ids, c.GuestIds...)
		}
		tables = append(tables, oapi.TableLayout{Number: tb.Number, GuestIds: ids})
	}
	b, err := json.Marshal(oapi.AcceptPlan{BasedOnVersion: p.BasedOnVersion, Tables: tables})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func accept(t *testing.T, h http.Handler, capacity int, body string) *httptest.ResponseRecorder {
	t.Helper()
	return do(h, http.MethodPut, fmt.Sprintf("%s/scenarios/%d/assignments", api, capacity), body)
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
	if list.Meta.RequestId == nil || list.Page.Total == nil || *list.Page.Total != 3 || len(list.Data) != 3 {
		t.Fatalf("envelope = %+v", list)
	}
	for i, c := range []oapi.Capacity{8, 10, 12} {
		s := list.Data[i]
		if s.Capacity != c || s.Version == nil || *s.Version != 1 {
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

// Flow 1: calculate stores nothing; accepting all three fills the plans; a stale accept is 409.
func TestCalculateThenAcceptAllThree(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 30)
	putLink(t, h, "1-2", 0) // cluster {1,2,3}
	putLink(t, h, "2-3", 0)
	putLink(t, h, "4-5", 0) // cluster {4,5}
	putLink(t, h, "1-4", 1) // preferred
	putLink(t, h, "6-7", 2)

	props := calculate(t, h)
	if props.Meta.RequestId == nil || props.Page.Total == nil || *props.Page.Total != 3 || len(props.Data) != 3 {
		t.Fatalf("envelope = %+v", props)
	}
	wantTables := map[oapi.Capacity]int{8: 4, 10: 3, 12: 3}
	for i, c := range []oapi.Capacity{8, 10, 12} {
		p := props.Data[i]
		if p.Capacity != c || p.BasedOnVersion != 1 {
			t.Errorf("proposal %d = %d basedOn %d", i, p.Capacity, p.BasedOnVersion)
		}
		sum := p.Plan.Summary
		if sum.TableCount != wantTables[c] || sum.SeatedCount != 30 || sum.UnseatedCount != 0 || sum.NeedsRecalculation || sum.ViolationCount != 0 {
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
			if *s.Version != 1 || len(s.Plan.Tables) != 0 {
				t.Errorf("scenario %d changed: v%d, %d tables", s.Capacity, *s.Version, len(s.Plan.Tables))
			}
		}
	})

	for _, p := range props.Data {
		t.Run(fmt.Sprintf("accept %d", p.Capacity), func(t *testing.T) {
			got := scenarioResponse(t, accept(t, h, int(p.Capacity), acceptBody(t, p)), http.StatusOK)
			if *got.Version != 2 || got.Plan.Summary.TableCount != p.Plan.Summary.TableCount ||
				got.Plan.Summary.NeedsRecalculation || got.Plan.Summary.SeatedCount != 30 {
				t.Errorf("accepted = v%d %+v", *got.Version, got.Plan.Summary)
			}
			if got.Plan.Summary.Score != p.Plan.Summary.Score {
				t.Errorf("score %v != proposed %v", got.Plan.Summary.Score, p.Plan.Summary.Score)
			}
		})
	}

	t.Run("GET /scenarios now returns the accepted plans", func(t *testing.T) {
		for _, s := range listScenarios(t, h).Data {
			if *s.Version != 2 || s.Plan.Summary.TableCount != wantTables[s.Capacity] {
				t.Errorf("scenario %d = v%d, %d tables", s.Capacity, *s.Version, s.Plan.Summary.TableCount)
			}
		}
	})

	t.Run("a stale accept is 409 version_conflict", func(t *testing.T) {
		expect(t, accept(t, h, 10, acceptBody(t, props.Data[1])), http.StatusConflict, oapi.ErrorCodeVersionConflict)
	})
}

func TestAcceptErrors(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 6)
	cases := []struct {
		name       string
		capacity   int
		body       string
		wantStatus int
		wantCode   oapi.ErrorCode
		wantField  string
	}{
		{"gap in table numbers", 10, `{"basedOnVersion":1,"tables":[{"number":1,"guestIds":[1]},{"number":3,"guestIds":[2]}]}`, 422, oapi.ErrorCodeValidationFailed, "tables"},
		{"guest at two tables", 10, `{"basedOnVersion":1,"tables":[{"number":1,"guestIds":[1,2]},{"number":2,"guestIds":[2]}]}`, 422, oapi.ErrorCodeValidationFailed, "tables"},
		{"unknown guest", 10, `{"basedOnVersion":1,"tables":[{"number":1,"guestIds":[1,99]}]}`, 422, oapi.ErrorCodeValidationFailed, "tables"},
		{"stale version", 10, `{"basedOnVersion":5,"tables":[]}`, 409, oapi.ErrorCodeVersionConflict, "version"},
		{"basedOnVersion below 1", 10, `{"basedOnVersion":0,"tables":[]}`, 400, oapi.ErrorCodeBadRequest, "basedOnVersion"},
		{"unknown capacity", 9, `{"basedOnVersion":1,"tables":[]}`, 404, oapi.ErrorCodeNotFound, ""},
		{"malformed body", 10, `{"basedOnVersion":`, 400, oapi.ErrorCodeBadRequest, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := accept(t, h, tc.capacity, tc.body)
			expect(t, rec, tc.wantStatus, tc.wantCode)
			if tc.wantField != "" {
				if f := fieldOf(decodeError(t, rec).Errors[0]); f == nil || *f != tc.wantField {
					t.Errorf("field = %v, want %q", f, tc.wantField)
				}
			}
		})
	}
	for _, s := range listScenarios(t, h).Data {
		if *s.Version != 1 {
			t.Errorf("a rejected accept bumped scenario %d to v%d", s.Capacity, *s.Version)
		}
	}
}

// acceptLayout stores `tables` (lists of guest ids) in plan `capacity` and returns the scenario.
func acceptLayout(t *testing.T, h http.Handler, capacity int, tables ...[]int64) oapi.Scenario {
	t.Helper()
	cur := scenarioOf(t, listScenarios(t, h), capacity)
	layout := make([]oapi.TableLayout, len(tables))
	for i, ids := range tables {
		layout[i] = oapi.TableLayout{Number: i + 1, GuestIds: ids}
	}
	b, _ := json.Marshal(oapi.AcceptPlan{BasedOnVersion: *cur.Version, Tables: layout})
	return scenarioResponse(t, accept(t, h, capacity, string(b)), http.StatusOK)
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
		acceptLayout(t, h, 8, rangeIDs(1, 2), rangeIDs(4, 10))                                                               // plan 8: fills 2 and 7
		got := scenarioResponse(t, do(h, http.MethodPut, seatPath(8, 1), `{"tableNumber":2,"pinned":false}`), http.StatusOK) // 7 + cluster{1,2} = 9 > 8
		var over *oapi.Violation
		for i, v := range got.Plan.Violations {
			if v.Code == oapi.OverCapacity {
				over = &got.Plan.Violations[i]
			}
		}
		if over == nil || over.TableNumber.IsNull() || over.TableNumber.MustGet() != 2 || got.Plan.Tables[1].Fill != 9 || !got.Plan.Summary.NeedsRecalculation {
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
		expect(t, do(h, http.MethodPut, seatPath(9, 1), `{"tableNumber":1,"pinned":false}`), http.StatusNotFound, oapi.ErrorCodeNotFound)
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
	expect(t, do(h, http.MethodPost, api+"/scenarios/9/tables", ""), http.StatusNotFound, oapi.ErrorCodeNotFound)
}

// Flow 3, end to end: a re-enabled child rides along to its cluster's full table; GET /scenarios
// then shows the overfill with needsRecalculation, and nothing was regenerated.
func TestReEnabledGuestNeedsRecalculation(t *testing.T) {
	h := newAPI(t)
	seedGuests(t, h, 9)
	putLink(t, h, "1-2", 0)
	putLink(t, h, "1-3", 0) // cluster {1,2,3}
	expect(t, do(h, http.MethodPatch, api+"/guests", `{"guestIds":[3],"enabled":false}`), http.StatusOK, "")

	acc := acceptLayout(t, h, 8, []int64{1, 2, 4, 5, 6, 7, 8, 9}) // 8/8 enabled; child 3 rides along
	if acc.Plan.Summary.NeedsRecalculation || acc.Plan.Tables[0].Fill != 8 {
		t.Fatalf("precondition: %+v", acc.Plan.Summary)
	}

	expect(t, do(h, http.MethodPatch, api+"/guests", `{"guestIds":[3],"enabled":true}`), http.StatusOK, "")
	got := scenarioOf(t, listScenarios(t, h), 8)
	if *got.Version != *acc.Version {
		t.Errorf("plan version %d -> %d: re-enabling must not touch plans", *acc.Version, *got.Version)
	}
	if tb, _, ok := tableOfGuest(got, 3); !ok || tb != 1 {
		t.Errorf("guest 3 at table %d (seated %v), want table 1", tb, ok)
	}
	if got.Plan.Tables[0].Fill != 9 || !got.Plan.Summary.NeedsRecalculation || !slices.Contains(violationCodes(got), oapi.OverCapacity) {
		t.Errorf("fill %d summary %+v codes %v", got.Plan.Tables[0].Fill, got.Plan.Summary, violationCodes(got))
	}
	// the other plans have no tables: they need recalculation too, because everyone is unseated
	if o := scenarioOf(t, listScenarios(t, h), 10); !o.Plan.Summary.NeedsRecalculation {
		t.Error("plan 10 should need recalculation")
	}

	// regenerate: 9 guests fit one 12-seat table (for 8 seats no table count satisfies the floor
	// of 6, so that proposal is best-effort with violations; the UI shows them)
	prop := calculate(t, h).Data[2]
	if prop.Capacity != 12 || prop.Plan.Summary.NeedsRecalculation || prop.Plan.Summary.SeatedCount != 9 {
		t.Errorf("proposal summary = %+v", prop.Plan.Summary)
	}
}
