package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/wojtekrpi/stoliki/backend-go/internal/guests"
	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
	"github.com/wojtekrpi/stoliki/backend-go/internal/scenarios"
	"github.com/wojtekrpi/stoliki/backend-go/internal/store"
)

const api = "/wesele/api"

// newAPI serves the real router over a real, migrated SQLite file (no DB mocks).
func newAPI(t *testing.T) http.Handler {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "stoliki.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := store.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	gs := store.NewGuests(db)
	return NewRouter("/wesele", "", NewServer(db, guests.NewService(gs), scenarios.NewService(store.NewScenarios(db), gs)))
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %T: %v\n%s", v, err, rec.Body.String())
	}
	return v
}

func expect(t *testing.T, rec *httptest.ResponseRecorder, status int, code oapi.ErrorCode) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d: %s", rec.Code, status, rec.Body)
	}
	if code != "" {
		env := decodeError(t, rec)
		if env.Errors[0].Code != code {
			t.Fatalf("error code = %q, want %q: %s", env.Errors[0].Code, code, rec.Body)
		}
	}
}

// post creates a guest and returns it.
func createGuest(t *testing.T, h http.Handler, body string) oapi.Guest {
	t.Helper()
	rec := do(h, http.MethodPost, api+"/guests", body)
	expect(t, rec, http.StatusCreated, "")
	return decode[oapi.GuestResponse](t, rec).Data
}

func gid(g oapi.Guest) string { return strconv.FormatInt(*g.Id, 10) }

func lastNameOf(g oapi.Guest) *string {
	if g.LastName.IsNull() || !g.LastName.IsSpecified() {
		return nil
	}
	v := g.LastName.MustGet()
	return &v
}

func TestCreateGuest(t *testing.T) {
	h := newAPI(t)

	t.Run("201 with defaults and the full Guest shape", func(t *testing.T) {
		rec := do(h, http.MethodPost, api+"/guests", `{"firstName":"  Maciek "}`)
		expect(t, rec, http.StatusCreated, "")
		var raw map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &raw)
		data := raw["data"].(map[string]any)
		for _, k := range []string{"id", "firstName", "lastName", "displayName", "notes", "isChild", "enabled", "version", "links", "createdAt", "updatedAt"} {
			if _, ok := data[k]; !ok {
				t.Errorf("data.%s missing: %s", k, rec.Body)
			}
		}
		if data["firstName"] != "Maciek" || data["lastName"] != nil || data["displayName"] != "Maciek" ||
			data["enabled"] != true || data["isChild"] != false || data["version"] != float64(1) || data["notes"] != "" {
			t.Errorf("data = %v", data)
		}
		if links, ok := data["links"].([]any); !ok || len(links) != 0 {
			t.Errorf("links = %v, want []", data["links"])
		}
		if raw["meta"].(map[string]any)["requestId"] == "" {
			t.Error("meta.requestId missing")
		}
	})

	t.Run("flags are honoured", func(t *testing.T) {
		g := createGuest(t, h, `{"firstName":"Ola","lastName":"Nowak","notes":"n","isChild":true,"enabled":false}`)
		if g.Enabled || !g.IsChild || g.Notes != "n" || *g.DisplayName != "Ola Nowak" {
			t.Errorf("guest = %+v", g)
		}
	})

	t.Run("400 malformed JSON", func(t *testing.T) {
		expect(t, do(h, http.MethodPost, api+"/guests", `{"firstName":`), http.StatusBadRequest, oapi.ErrorCodeBadRequest)
	})

	t.Run("422 validation and duplicate_name", func(t *testing.T) {
		rec := do(h, http.MethodPost, api+"/guests", `{"firstName":"  "}`)
		expect(t, rec, http.StatusUnprocessableEntity, oapi.ErrorCodeValidationFailed)
		if f := fieldOf(decodeError(t, rec).Errors[0]); f == nil || *f != "firstName" {
			t.Errorf("field = %v", f)
		}
		expect(t, do(h, http.MethodPost, api+"/guests", `{"firstName":"A","lastName":""}`), http.StatusUnprocessableEntity, oapi.ErrorCodeValidationFailed)

		createGuest(t, h, `{"firstName":"Łukasz","lastName":"Żak"}`)
		expect(t, do(h, http.MethodPost, api+"/guests", `{"firstName":"ŁUKASZ","lastName":"żak"}`), http.StatusUnprocessableEntity, oapi.ErrorCodeDuplicateName)
	})

	t.Run("a null lastName is no surname", func(t *testing.T) {
		g := createGuest(t, h, `{"firstName":"Nul","lastName":null}`)
		if lastNameOf(g) != nil {
			t.Errorf("lastName = %v", lastNameOf(g))
		}
	})
}

func TestListGuests(t *testing.T) {
	h := newAPI(t)

	t.Run("empty list is [] with total 0", func(t *testing.T) {
		rec := do(h, http.MethodGet, api+"/guests", "")
		expect(t, rec, http.StatusOK, "")
		if !strings.Contains(rec.Body.String(), `"data":[]`) {
			t.Errorf("body = %s", rec.Body)
		}
		if got := decode[oapi.GuestListResponse](t, rec); *got.Page.Total != 0 {
			t.Errorf("total = %d", *got.Page.Total)
		}
	})

	zofia := createGuest(t, h, `{"firstName":"Zofia"}`)
	ania := createGuest(t, h, `{"firstName":"Ania"}`)
	ewa := createGuest(t, h, `{"firstName":"Ewa"}`)
	expect(t, do(h, http.MethodPut, api+"/guest-links/"+gid(zofia)+"-"+gid(ania), `{"level":1}`), http.StatusOK, "")
	expect(t, do(h, http.MethodPut, api+"/guest-links/"+gid(ania)+"-"+gid(ewa), `{"level":0}`), http.StatusOK, "")

	rec := do(h, http.MethodGet, api+"/guests", "")
	expect(t, rec, http.StatusOK, "")
	got := decode[oapi.GuestListResponse](t, rec)
	if *got.Page.Total != 3 || len(got.Data) != 3 {
		t.Fatalf("list = %+v", got)
	}
	var names []string
	byID := map[int64]oapi.Guest{}
	for _, g := range got.Data {
		names = append(names, g.FirstName)
		byID[*g.Id] = g
	}
	if strings.Join(names, ",") != "Ania,Ewa,Zofia" {
		t.Errorf("order = %v", names)
	}
	// Each link is embedded on both guests.
	links := func(g oapi.Guest) map[int64]oapi.LinkLevel {
		m := map[int64]oapi.LinkLevel{}
		for _, l := range *g.Links {
			m[l.GuestId] = l.Level
		}
		return m
	}
	if l := links(byID[*ania.Id]); len(l) != 2 || l[*zofia.Id] != 1 || l[*ewa.Id] != 0 {
		t.Errorf("ania links = %v", l)
	}
	if l := links(byID[*zofia.Id]); len(l) != 1 || l[*ania.Id] != 1 {
		t.Errorf("zofia links = %v", l)
	}
	if l := links(byID[*ewa.Id]); len(l) != 1 || l[*ania.Id] != 0 {
		t.Errorf("ewa links = %v", l)
	}
}

func TestUpdateGuest(t *testing.T) {
	h := newAPI(t)
	g := createGuest(t, h, `{"firstName":"Ania","lastName":"Nowak"}`)
	createGuest(t, h, `{"firstName":"Ewa"}`)
	url := api + "/guests/" + gid(g)

	t.Run("200 partial update keeps what is absent and bumps version", func(t *testing.T) {
		rec := do(h, http.MethodPatch, url, `{"version":1,"notes":"wegetarianka","isChild":true}`)
		expect(t, rec, http.StatusOK, "")
		got := decode[oapi.GuestResponse](t, rec).Data
		if got.Notes != "wegetarianka" || !got.IsChild || got.FirstName != "Ania" || lastNameOf(got) == nil || *lastNameOf(got) != "Nowak" || *got.Version != 2 {
			t.Errorf("got = %+v", got)
		}
	})

	t.Run("409 stale version", func(t *testing.T) {
		expect(t, do(h, http.MethodPatch, url, `{"version":1,"notes":"x"}`), http.StatusConflict, oapi.ErrorCodeVersionConflict)
	})

	t.Run("lastName null clears the surname; absent leaves it", func(t *testing.T) {
		rec := do(h, http.MethodPatch, url, `{"version":2,"lastName":null}`)
		expect(t, rec, http.StatusOK, "")
		if !strings.Contains(rec.Body.String(), `"lastName":null`) {
			t.Errorf("body = %s", rec.Body)
		}
		got := decode[oapi.GuestResponse](t, rec).Data
		if lastNameOf(got) != nil || *got.DisplayName != "Ania" {
			t.Errorf("got = %+v", got)
		}
		rec = do(h, http.MethodPatch, url, `{"version":3,"lastName":"Kowalska"}`)
		expect(t, rec, http.StatusOK, "")
		rec = do(h, http.MethodPatch, url, `{"version":4,"notes":"y"}`)
		expect(t, rec, http.StatusOK, "")
		if got := decode[oapi.GuestResponse](t, rec).Data; lastNameOf(got) == nil || *lastNameOf(got) != "Kowalska" {
			t.Errorf("absent lastName changed it: %+v", got)
		}
	})

	t.Run("422 validation and duplicate_name", func(t *testing.T) {
		expect(t, do(h, http.MethodPatch, url, `{"version":5,"lastName":""}`), http.StatusUnprocessableEntity, oapi.ErrorCodeValidationFailed)
		expect(t, do(h, http.MethodPatch, url, `{"version":5,"firstName":"ewa","lastName":null}`), http.StatusUnprocessableEntity, oapi.ErrorCodeDuplicateName)
	})

	t.Run("400 missing version, bad id, bad json", func(t *testing.T) {
		expect(t, do(h, http.MethodPatch, url, `{"notes":"x"}`), http.StatusBadRequest, oapi.ErrorCodeBadRequest)
		expect(t, do(h, http.MethodPatch, api+"/guests/abc", `{"version":1}`), http.StatusBadRequest, oapi.ErrorCodeBadRequest)
		expect(t, do(h, http.MethodPatch, url, `[`), http.StatusBadRequest, oapi.ErrorCodeBadRequest)
	})

	t.Run("404 unknown guest", func(t *testing.T) {
		expect(t, do(h, http.MethodPatch, api+"/guests/9999", `{"version":1,"notes":"x"}`), http.StatusNotFound, oapi.ErrorCodeNotFound)
	})

	t.Run("embeds the guest's links", func(t *testing.T) {
		other := createGuest(t, h, `{"firstName":"Iza"}`)
		expect(t, do(h, http.MethodPut, api+"/guest-links/"+gid(other)+"-"+gid(g), `{"level":2}`), http.StatusOK, "")
		cur := decode[oapi.GuestListResponse](t, do(h, http.MethodGet, api+"/guests", "")).Data
		var version int
		for _, c := range cur {
			if *c.Id == *g.Id {
				version = *c.Version
			}
		}
		rec := do(h, http.MethodPatch, api+"/guests/"+gid(g), `{"version":`+strconv.Itoa(version)+`,"notes":"z"}`)
		expect(t, rec, http.StatusOK, "")
		got := decode[oapi.GuestResponse](t, rec).Data
		if got.Links == nil || len(*got.Links) != 1 || (*got.Links)[0].GuestId != *other.Id || (*got.Links)[0].Level != 2 {
			t.Errorf("links = %+v", got.Links)
		}
	})
}

func TestToggleGuests(t *testing.T) {
	h := newAPI(t)
	a := createGuest(t, h, `{"firstName":"A","isChild":true}`)
	b := createGuest(t, h, `{"firstName":"B","isChild":true}`)
	c := createGuest(t, h, `{"firstName":"C"}`)
	body := func(enabled bool, ids ...oapi.Guest) string {
		var s []string
		for _, g := range ids {
			s = append(s, gid(g))
		}
		return `{"enabled":` + strconv.FormatBool(enabled) + `,"guestIds":[` + strings.Join(s, ",") + `]}`
	}

	t.Run("200 bulk toggle returns the updated guests with links", func(t *testing.T) {
		expect(t, do(h, http.MethodPut, api+"/guest-links/"+gid(a)+"-"+gid(c), `{"level":0}`), http.StatusOK, "")
		rec := do(h, http.MethodPatch, api+"/guests", body(false, a, b))
		expect(t, rec, http.StatusOK, "")
		got := decode[oapi.GuestListResponse](t, rec)
		if len(got.Data) != 2 || *got.Page.Total != 2 {
			t.Fatalf("got = %+v", got)
		}
		for _, g := range got.Data {
			if g.Enabled || *g.Version != 2 {
				t.Errorf("guest = %+v", g)
			}
		}
		if got.Data[0].Links == nil || len(*got.Data[0].Links) != 1 {
			t.Errorf("a's link missing: %+v", got.Data[0].Links)
		}
	})

	t.Run("single id", func(t *testing.T) {
		rec := do(h, http.MethodPatch, api+"/guests", body(false, c))
		expect(t, rec, http.StatusOK, "")
		if got := decode[oapi.GuestListResponse](t, rec); len(got.Data) != 1 || got.Data[0].Enabled {
			t.Errorf("got = %+v", got)
		}
	})

	t.Run("400 empty list and malformed body", func(t *testing.T) {
		expect(t, do(h, http.MethodPatch, api+"/guests", `{"enabled":true,"guestIds":[]}`), http.StatusBadRequest, oapi.ErrorCodeBadRequest)
		expect(t, do(h, http.MethodPatch, api+"/guests", `{"enabled":`), http.StatusBadRequest, oapi.ErrorCodeBadRequest)
	})

	t.Run("404 unknown id", func(t *testing.T) {
		expect(t, do(h, http.MethodPatch, api+"/guests", `{"enabled":true,"guestIds":[`+gid(a)+`,9999]}`), http.StatusNotFound, oapi.ErrorCodeNotFound)
	})
}

func TestDeleteGuest(t *testing.T) {
	h := newAPI(t)
	a := createGuest(t, h, `{"firstName":"A"}`)
	b := createGuest(t, h, `{"firstName":"B"}`)
	expect(t, do(h, http.MethodPut, api+"/guest-links/"+gid(a)+"-"+gid(b), `{"level":1}`), http.StatusOK, "")

	rec := do(h, http.MethodDelete, api+"/guests/"+gid(a), "")
	expect(t, rec, http.StatusNoContent, "")
	if rec.Body.Len() != 0 {
		t.Errorf("204 body = %q", rec.Body)
	}
	expect(t, do(h, http.MethodDelete, api+"/guests/"+gid(a), ""), http.StatusNotFound, oapi.ErrorCodeNotFound)

	got := decode[oapi.GuestListResponse](t, do(h, http.MethodGet, api+"/guests", ""))
	if len(got.Data) != 1 || len(*got.Data[0].Links) != 0 {
		t.Errorf("after delete = %+v", got.Data)
	}
}
