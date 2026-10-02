package httpapi

import (
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
)

// seed creates guests named by the given first names (ids 1..n in order) and returns them.
func seed(t *testing.T, h http.Handler, names ...string) []oapi.Guest {
	t.Helper()
	out := make([]oapi.Guest, len(names))
	for i, n := range names {
		out[i] = createGuest(t, h, `{"firstName":"`+n+`"}`)
	}
	return out
}

func putLink(t *testing.T, h http.Handler, key string, level int) oapi.GuestLinkResponse {
	t.Helper()
	rec := do(h, http.MethodPut, api+"/guest-links/"+key, `{"level":`+strconv.Itoa(level)+`}`)
	expect(t, rec, http.StatusOK, "")
	return decode[oapi.GuestLinkResponse](t, rec)
}

func TestUpsertGuestLink(t *testing.T) {
	h := newAPI(t)
	seed(t, h, "A", "B", "C", "D", "E", "F") // ids 1..6

	t.Run("PUT 6-4 normalises the key to 4-6", func(t *testing.T) {
		got := putLink(t, h, "6-4", 1)
		if *got.Data.Key != "4-6" || !slices.Equal(*got.Data.GuestIds, []int64{4, 6}) || got.Data.Level != 1 {
			t.Errorf("link = %+v", got.Data)
		}
		if got.Meta.RequestId == nil || *got.Meta.RequestId == "" {
			t.Error("meta.requestId missing")
		}
	})

	t.Run("the pair has a single link whichever way it is set", func(t *testing.T) {
		putLink(t, h, "4-6", 2)
		putLink(t, h, "6-4", 0) // replaces, does not add
		list := decode[oapi.GuestListResponse](t, do(h, http.MethodGet, api+"/guests", ""))
		for _, g := range list.Data {
			switch *g.Id {
			case 4, 6:
				if len(*g.Links) != 1 || (*g.Links)[0].Level != 0 {
					t.Errorf("guest %d links = %+v, want one level-0 link", *g.Id, *g.Links)
				}
			default:
				if len(*g.Links) != 0 {
					t.Errorf("guest %d links = %+v, want none", *g.Id, *g.Links)
				}
			}
		}
	})

	t.Run("422 self link and bad level", func(t *testing.T) {
		expect(t, do(h, http.MethodPut, api+"/guest-links/4-4", `{"level":1}`), http.StatusUnprocessableEntity, oapi.ErrorCodeValidationFailed)
		expect(t, do(h, http.MethodPut, api+"/guest-links/1-2", `{"level":3}`), http.StatusUnprocessableEntity, oapi.ErrorCodeValidationFailed)
	})

	t.Run("404 unknown guest", func(t *testing.T) {
		expect(t, do(h, http.MethodPut, api+"/guest-links/4-9999", `{"level":1}`), http.StatusNotFound, oapi.ErrorCodeNotFound)
	})

	t.Run("400 malformed key and body", func(t *testing.T) {
		for _, key := range []string{"abc", "4", "4-", "0-4", "4-6-8"} {
			expect(t, do(h, http.MethodPut, api+"/guest-links/"+key, `{"level":1}`), http.StatusBadRequest, oapi.ErrorCodeBadRequest)
		}
		expect(t, do(h, http.MethodPut, api+"/guest-links/1-2", `{"level":`), http.StatusBadRequest, oapi.ErrorCodeBadRequest)
	})
}

func TestDeleteGuestLink(t *testing.T) {
	h := newAPI(t)
	seed(t, h, "A", "B", "C")
	putLink(t, h, "1-2", 1)

	rec := do(h, http.MethodDelete, api+"/guest-links/2-1", "") // either order
	expect(t, rec, http.StatusNoContent, "")
	expect(t, do(h, http.MethodDelete, api+"/guest-links/1-2", ""), http.StatusNotFound, oapi.ErrorCodeNotFound)
	expect(t, do(h, http.MethodDelete, api+"/guest-links/1-3", ""), http.StatusNotFound, oapi.ErrorCodeNotFound)
	expect(t, do(h, http.MethodDelete, api+"/guest-links/x-y", ""), http.StatusBadRequest, oapi.ErrorCodeBadRequest)
	expect(t, do(h, http.MethodDelete, api+"/guest-links/3-3", ""), http.StatusUnprocessableEntity, oapi.ErrorCodeValidationFailed)
}

func overview(t *testing.T, h http.Handler) oapi.ClusterOverview {
	t.Helper()
	rec := do(h, http.MethodGet, api+"/clusters", "")
	expect(t, rec, http.StatusOK, "")
	return decode[oapi.ClusterOverviewResponse](t, rec).Data
}

func affinitiesOf(c oapi.Cluster) map[int64]oapi.ClusterAffinityLevel {
	m := map[int64]oapi.ClusterAffinityLevel{}
	for _, a := range *c.Affinities {
		m[a.ClusterKey] = a.Level
	}
	return m
}

func TestGetClusterOverview(t *testing.T) {
	t.Run("empty list gives empty arrays", func(t *testing.T) {
		rec := do(newAPI(t), http.MethodGet, api+"/clusters", "")
		expect(t, rec, http.StatusOK, "")
		if got := rec.Body.String(); !strings.Contains(got, `"clusters":[]`) || !strings.Contains(got, `"warnings":[]`) {
			t.Errorf("body = %s", got)
		}
	})

	h := newAPI(t)
	// Maciek 1, Karolina 2, Michał 3, Ola 4 (the glossary fixture)
	seed(t, h, "Maciek", "Karolina", "Michał", "Ola")
	putLink(t, h, "1-2", 0) // Maciek - Karolina: together
	putLink(t, h, "1-3", 1) // Maciek - Michał: preferred
	putLink(t, h, "3-4", 0) // Michał - Ola: together

	t.Run("clusters with symmetric affinities", func(t *testing.T) {
		ov := overview(t, h)
		if len(ov.Clusters) != 2 || len(ov.Warnings) != 0 {
			t.Fatalf("overview = %+v", ov)
		}
		a, b := ov.Clusters[0], ov.Clusters[1]
		if *a.Key != 1 || !slices.Equal(*a.GuestIds, []int64{1, 2}) || !slices.Equal(*a.EnabledGuestIds, []int64{1, 2}) || *a.SeatedSize != 2 {
			t.Errorf("cluster a = %+v", a)
		}
		if *b.Key != 3 || !slices.Equal(*b.GuestIds, []int64{3, 4}) || *b.SeatedSize != 2 {
			t.Errorf("cluster b = %+v", b)
		}
		if got := affinitiesOf(a); len(got) != 1 || got[3] != 1 {
			t.Errorf("a affinities = %v", got)
		}
		if got := affinitiesOf(b); len(got) != 1 || got[1] != 1 {
			t.Errorf("b affinities = %v (must be symmetric)", got)
		}
	})

	t.Run("conflicting levels: group 1 wins and a warning appears", func(t *testing.T) {
		putLink(t, h, "2-4", 2) // Karolina - Ola: acceptable, between the same two clusters
		ov := overview(t, h)
		if got := affinitiesOf(ov.Clusters[0]); got[3] != 1 {
			t.Errorf("affinity = %v, want strongest (1)", got)
		}
		if len(ov.Warnings) != 1 || ov.Warnings[0].Code != oapi.ConflictingLinkLevels || ov.Warnings[0].Message == "" || len(ov.Warnings[0].GuestIds) == 0 {
			t.Errorf("warnings = %+v", ov.Warnings)
		}
	})

	t.Run("disabled members stay in the cluster but not in the seated size", func(t *testing.T) {
		rec := do(h, http.MethodPatch, api+"/guests", `{"enabled":false,"guestIds":[1]}`)
		expect(t, rec, http.StatusOK, "")
		a := overview(t, h).Clusters[0]
		if !slices.Equal(*a.GuestIds, []int64{1, 2}) || !slices.Equal(*a.EnabledGuestIds, []int64{2}) || *a.SeatedSize != 1 {
			t.Errorf("cluster = %+v", a)
		}
	})
}

func TestClusterOverviewFullyDisabledClusterHasEmptyArrays(t *testing.T) {
	h := newAPI(t)
	seed(t, h, "A", "B")
	expect(t, do(h, http.MethodPatch, api+"/guests", `{"enabled":false,"guestIds":[1,2]}`), http.StatusOK, "")
	body := do(h, http.MethodGet, api+"/clusters", "").Body.String()
	if !strings.Contains(body, `"enabledGuestIds":[]`) || strings.Contains(body, "null") {
		t.Errorf("body = %s", body)
	}
}

func TestClusterOverviewSizeWarnings(t *testing.T) {
	h := newAPI(t)
	for i := 0; i < 9; i++ {
		createGuest(t, h, `{"firstName":"G`+strconv.Itoa(i)+`"}`)
	}
	for i := 2; i <= 9; i++ { // chain 1-2, 1-3 ... one cluster of 9
		putLink(t, h, "1-"+strconv.Itoa(i), 0)
	}
	ov := overview(t, h)
	if len(ov.Clusters) != 1 || *ov.Clusters[0].SeatedSize != 9 {
		t.Fatalf("clusters = %+v", ov.Clusters)
	}
	if len(ov.Warnings) != 1 || ov.Warnings[0].Code != oapi.ClusterExceeds8 || len(ov.Warnings[0].GuestIds) != 9 {
		t.Errorf("warnings = %+v", ov.Warnings)
	}
}
