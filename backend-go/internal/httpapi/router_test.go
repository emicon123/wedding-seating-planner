package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
)

type pingFunc func(context.Context) error

func (f pingFunc) PingContext(ctx context.Context) error { return f(ctx) }

var healthyDB = pingFunc(func(context.Context) error { return nil })

const (
	indexHTML = "<!doctype html><title>stoliki</title>"
	assetJS   = "console.log('x');"
)

func newWebRoot(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{"index.html": indexHTML, "assets/x.js": assetJS} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func do(h http.Handler, method, target, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) oapi.ErrorResponse {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
	var env oapi.ErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("body is not an error envelope: %v\n%s", err, rec.Body.String())
	}
	if len(env.Errors) == 0 {
		t.Fatalf("envelope has no errors: %s", rec.Body.String())
	}
	if env.Meta.RequestId == nil || *env.Meta.RequestId == "" {
		t.Fatalf("envelope meta.requestId missing: %s", rec.Body.String())
	}
	return env
}

func TestRouterUnderBasePath(t *testing.T) {
	root := newWebRoot(t)
	h := NewRouter("/wesele", root, NewServer(healthyDB, nil, nil))

	t.Run("health returns the ok envelope", func(t *testing.T) {
		rec := do(h, http.MethodGet, "/wesele/api/health", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body)
		}
		var got oapi.HealthResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.Data.Status != "ok" {
			t.Errorf("data.status = %q, want ok", got.Data.Status)
		}
		if got.Meta.RequestId == nil || *got.Meta.RequestId == "" {
			t.Errorf("meta.requestId missing")
		}
		if v := rec.Header().Get("X-Robots-Tag"); v != "noindex" {
			t.Errorf("X-Robots-Tag = %q, want noindex", v)
		}
	})

	t.Run("health reports a failing database as 500 without leaking the cause", func(t *testing.T) {
		down := NewRouter("/wesele", root, NewServer(pingFunc(func(context.Context) error {
			return errors.New("secret dsn /data/stoliki.db")
		}), nil, nil))
		rec := do(down, http.MethodGet, "/wesele/api/health", "")
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
		env := decodeError(t, rec)
		if env.Errors[0].Code != oapi.ErrorCodeInternalError {
			t.Errorf("code = %q", env.Errors[0].Code)
		}
		if strings.Contains(rec.Body.String(), "secret") {
			t.Errorf("error body leaks the cause: %s", rec.Body)
		}
	})

	t.Run("base path without slash redirects", func(t *testing.T) {
		rec := do(h, http.MethodGet, "/wesele", "")
		if rec.Code != http.StatusMovedPermanently {
			t.Fatalf("status = %d, want 301", rec.Code)
		}
		if loc := rec.Header().Get("Location"); loc != "/wesele/" {
			t.Errorf("Location = %q, want /wesele/", loc)
		}
	})

	staticCases := []struct {
		name, target string
		wantStatus   int
		wantBody     string
	}{
		{"root serves index.html", "/wesele/", 200, indexHTML},
		{"client route falls back to index.html", "/wesele/plany/10", 200, indexHTML},
		{"asset is served as a file", "/wesele/assets/x.js", 200, assetJS},
		{"explicit index.html", "/wesele/index.html", 200, indexHTML},
		{"missing asset is a 404, not index.html", "/wesele/assets/missing.js", 404, ""},
		{"path traversal does not escape webRoot", "/wesele/../../etc/passwd", 200, indexHTML},
	}
	for _, tc := range staticCases {
		t.Run(tc.name, func(t *testing.T) {
			rec := do(h, http.MethodGet, tc.target, "")
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if tc.wantBody != "" && rec.Body.String() != tc.wantBody {
				t.Errorf("body = %q, want %q", rec.Body.String(), tc.wantBody)
			}
		})
	}

	t.Run("outside the base path nothing is served", func(t *testing.T) {
		for _, target := range []string{"/", "/api/health", "/other/"} {
			if rec := do(h, http.MethodGet, target, ""); rec.Code != http.StatusNotFound {
				t.Errorf("GET %s = %d, want 404", target, rec.Code)
			}
		}
	})

	t.Run("unknown api path is a 404 error envelope", func(t *testing.T) {
		rec := do(h, http.MethodGet, "/wesele/api/nope", "")
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404", rec.Code)
		}
		if got := decodeError(t, rec).Errors[0].Code; got != oapi.ErrorCodeNotFound {
			t.Errorf("code = %q, want not_found", got)
		}
	})

	t.Run("wrong method on a known api path is a 405 error envelope", func(t *testing.T) {
		rec := do(h, http.MethodDelete, "/wesele/api/health", "")
		if rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("status = %d, want 405", rec.Code)
		}
		decodeError(t, rec)
	})

	t.Run("endpoints of later tickets answer 501 in the envelope", func(t *testing.T) {
		// Only the CSV import (B-12, deferred) is still unimplemented.
		req := httptest.NewRequest(http.MethodPost, "/wesele/api/guest-imports", strings.NewReader("imie\nAnia\n"))
		req.Header.Set("Content-Type", "text/csv")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotImplemented {
			t.Fatalf("status = %d, want 501: %s", rec.Code, rec.Body)
		}
		decodeError(t, rec)
	})

	t.Run("malformed JSON body is 400 bad_request", func(t *testing.T) {
		rec := do(h, http.MethodPost, "/wesele/api/guests", "{not json")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body)
		}
		if got := decodeError(t, rec).Errors[0].Code; got != oapi.ErrorCodeBadRequest {
			t.Errorf("code = %q, want bad_request", got)
		}
	})

	t.Run("bad path parameter is 400 bad_request", func(t *testing.T) {
		rec := do(h, http.MethodDelete, "/wesele/api/guests/abc", "")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body)
		}
		env := decodeError(t, rec)
		if env.Errors[0].Code != oapi.ErrorCodeBadRequest || fieldOf(env.Errors[0]) == nil || *fieldOf(env.Errors[0]) != "guestId" {
			t.Errorf("error = %+v, want bad_request on guestId", env.Errors[0])
		}
	})

	t.Run("body over 1 MB is 413 payload_too_large", func(t *testing.T) {
		big := `{"firstName":"` + strings.Repeat("a", (1<<20)+10) + `"}`
		rec := do(h, http.MethodPost, "/wesele/api/guests", big)
		if rec.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d, want 413", rec.Code)
		}
		if got := decodeError(t, rec).Errors[0].Code; got != oapi.ErrorCodePayloadTooLarge {
			t.Errorf("code = %q, want payload_too_large", got)
		}
	})
}

func TestRouterWithoutBasePath(t *testing.T) {
	h := NewRouter("", newWebRoot(t), NewServer(healthyDB, nil, nil))
	if rec := do(h, http.MethodGet, "/api/health", ""); rec.Code != http.StatusOK {
		t.Errorf("health = %d, want 200", rec.Code)
	}
	if rec := do(h, http.MethodGet, "/plany/10", ""); rec.Code != http.StatusOK || rec.Body.String() != indexHTML {
		t.Errorf("spa fallback = %d %q", rec.Code, rec.Body)
	}
}

func TestRouterNormalisesBasePath(t *testing.T) {
	h := NewRouter("wesele/", newWebRoot(t), NewServer(healthyDB, nil, nil))
	if rec := do(h, http.MethodGet, "/wesele/api/health", ""); rec.Code != http.StatusOK {
		t.Errorf("health = %d, want 200", rec.Code)
	}
}

func TestRouterServesAPIWithEmptyWebRoot(t *testing.T) {
	h := NewRouter("/wesele", t.TempDir(), NewServer(healthyDB, nil, nil)) // "empty SPA dir"
	if rec := do(h, http.MethodGet, "/wesele/api/health", ""); rec.Code != http.StatusOK {
		t.Errorf("health = %d, want 200", rec.Code)
	}
	if rec := do(h, http.MethodGet, "/wesele/", ""); rec.Code != http.StatusNotFound {
		t.Errorf("spa root with no index.html = %d, want 404", rec.Code)
	}
}
