package httpapi

import (
	"net/http"
	"testing"

	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
)

// The strict server decodes bodies leniently: a missing required field becomes its zero value
// (level 0 = "must sit together"!) and unknown fields are ignored although the contract says
// additionalProperties: false. strictBody closes both gaps for every operation with a JSON body.
func TestStrictBodyRejectsMissingRequiredAndUnknownFields(t *testing.T) {
	h := newAPI(t)
	seed(t, h, "A", "B") // ids 1, 2

	cases := []struct {
		name, method, path, body string
		wantStatus               int
		wantField                string // "" = any / none
	}{
		{"link: missing level", http.MethodPut, "/guest-links/1-2", `{}`, 400, "level"},
		{"link: null level", http.MethodPut, "/guest-links/1-2", `{"level":null}`, 400, "level"},
		{"link: unknown field", http.MethodPut, "/guest-links/1-2", `{"level":1,"lvl":2}`, 400, "lvl"},
		{"link: level 0 stays valid", http.MethodPut, "/guest-links/1-2", `{"level":0}`, 200, ""},
		{"create: unknown field", http.MethodPost, "/guests", `{"firstName":"X","surname":"Y"}`, 400, "surname"},
		{"create: missing firstName", http.MethodPost, "/guests", `{}`, 400, "firstName"},
		{"create: lastName null is allowed", http.MethodPost, "/guests", `{"firstName":"Q","lastName":null}`, 201, ""},
		{"update: unknown field", http.MethodPatch, "/guests/1", `{"version":1,"id":5}`, 400, "id"},
		{"update: missing version", http.MethodPatch, "/guests/1", `{"notes":"x"}`, 400, "version"},
		{"toggle: unknown field", http.MethodPatch, "/guests", `{"guestIds":[1],"enabled":true,"x":1}`, 400, "x"},
		{"toggle: missing enabled", http.MethodPatch, "/guests", `{"guestIds":[1]}`, 400, "enabled"},
		{"accept: unknown field", http.MethodPut, "/scenarios/10/assignments", `{"basedOnVersion":1,"tables":[],"extra":1}`, 400, "extra"},
		{"accept: missing tables", http.MethodPut, "/scenarios/10/assignments", `{"basedOnVersion":1}`, 400, "tables"},
		{"accept: missing basedOnVersion", http.MethodPut, "/scenarios/10/assignments", `{"tables":[]}`, 400, "basedOnVersion"},
		{"seat: unknown field", http.MethodPut, "/scenarios/10/assignments/1", `{"tableNumber":1,"pinned":false,"x":1}`, 400, "x"},
		{"seat: missing pinned", http.MethodPut, "/scenarios/10/assignments/1", `{"tableNumber":1}`, 400, "pinned"},
		{"seat: missing tableNumber", http.MethodPut, "/scenarios/10/assignments/1", `{"pinned":true}`, 400, "tableNumber"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := do(h, tc.method, api+tc.path, tc.body)
			if tc.wantStatus != 400 {
				if rec.Code != tc.wantStatus {
					t.Fatalf("status = %d, want %d: %s", rec.Code, tc.wantStatus, rec.Body)
				}
				return
			}
			expect(t, rec, http.StatusBadRequest, oapi.ErrorCodeBadRequest)
			if f := fieldOf(decodeError(t, rec).Errors[0]); f == nil || *f != tc.wantField {
				t.Errorf("field = %v, want %q: %s", f, tc.wantField, rec.Body)
			}
		})
	}

	t.Run("nested objects of a body stay lenient (TableLayout has no additionalProperties:false)", func(t *testing.T) {
		// A PlanTable-shaped table (extra fill/score/clusters) must be accepted by the decoder; the
		// request then fails later (stale/unknown version is irrelevant here), never as bad_request.
		rec := do(h, http.MethodPut, api+"/scenarios/10/assignments",
			`{"basedOnVersion":1,"tables":[{"number":1,"guestIds":[1,2],"fill":2,"score":0,"clusters":[]}]}`)
		if rec.Code == http.StatusBadRequest {
			t.Fatalf("nested extra fields must not be rejected: %s", rec.Body)
		}
	})

	t.Run("an empty body is still a 400 from the decoder", func(t *testing.T) {
		expect(t, do(h, http.MethodPut, api+"/guest-links/1-2", ``), http.StatusBadRequest, oapi.ErrorCodeBadRequest)
	})
}
