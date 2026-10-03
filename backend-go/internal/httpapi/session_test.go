package httpapi

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/wojtekrpi/stoliki/backend-go/internal/accessgate"
	"github.com/wojtekrpi/stoliki/backend-go/internal/guests"
	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
	"github.com/wojtekrpi/stoliki/backend-go/internal/scenarios"
	"github.com/wojtekrpi/stoliki/backend-go/internal/store"
)

// Obviously fake values; the real PIN never appears in tests.
const (
	gatePIN  = "test-pin-7391"
	wrongPIN = "wrong-pin-5150"
	otherPIN = "test-pin-other-2468"
)

// testClock is a settable clock shared by the gate under test.
type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *testClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *testClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// gatedEnv is the real router (real migrated SQLite file, real session key file) with the gate on.
type gatedEnv struct {
	dir   string // holds stoliki.db and session.key, like /data
	clock *testClock
	h     http.Handler
	web   string
}

func newGatedEnv(t *testing.T) *gatedEnv {
	t.Helper()
	e := &gatedEnv{dir: t.TempDir(), web: newWebRoot(t), clock: &testClock{t: time.Now()}}
	e.h = e.start(t, gatePIN)
	return e
}

// start builds a router over the same dir (a "restart"), with the given PIN ("" = gate off).
func (e *gatedEnv) start(t *testing.T, pin string) http.Handler {
	t.Helper()
	db, err := store.Open(filepath.Join(e.dir, "stoliki.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := store.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	var gate *accessgate.Gate
	if pin != "" {
		secret, err := accessgate.LoadOrCreateSecret(filepath.Join(e.dir, "session.key"))
		if err != nil {
			t.Fatal(err)
		}
		gate = accessgate.New(pin, secret, "/wesele", e.clock.now)
	}
	gs := store.NewGuests(db)
	return NewRouter("/wesele", e.web, NewServer(db, guests.NewService(gs), scenarios.NewService(store.NewScenarios(db), gs), gate), gate)
}

type reqOpt func(*http.Request)

func withHeader(k, v string) reqOpt    { return func(r *http.Request) { r.Header.Set(k, v) } }
func withCookie(c *http.Cookie) reqOpt { return func(r *http.Request) { r.AddCookie(c) } }
func withCSRF() reqOpt                 { return withHeader(accessgate.CSRFHeader, "1") }
func fromAddr(addr string) reqOpt      { return func(r *http.Request) { r.RemoteAddr = addr } }
func withTLSProxy() reqOpt             { return withHeader("X-Forwarded-Proto", "https") }
func login(pin string, opts ...reqOpt) func(h http.Handler) *httptest.ResponseRecorder {
	return func(h http.Handler) *httptest.ResponseRecorder {
		return doWith(h, http.MethodPost, api+"/session", `{"pin":`+strconv.Quote(pin)+`}`, append([]reqOpt{withCSRF()}, opts...)...)
	}
}

func doWith(h http.Handler, method, target, body string, opts ...reqOpt) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, o := range opts {
		o(req)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func sessionCookie(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Name == accessgate.CookieName {
			return c
		}
	}
	t.Fatalf("no %s cookie in %v", accessgate.CookieName, rec.Header()["Set-Cookie"])
	return nil
}

func loginOK(t *testing.T, h http.Handler, opts ...reqOpt) *http.Cookie {
	t.Helper()
	rec := login(gatePIN, opts...)(h)
	if rec.Code != http.StatusOK {
		t.Fatalf("login = %d: %s", rec.Code, rec.Body)
	}
	return sessionCookie(t, rec)
}

var pathParam = regexp.MustCompile(`\{[^}]+\}`)

// apiRoutes lists every generated operation (method, concrete path) by walking the real router.
func apiRoutes(t *testing.T, h http.Handler) [][2]string {
	t.Helper()
	var routes [][2]string
	err := chi.Walk(h.(chi.Routes), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if strings.HasPrefix(route, api+"/") && !strings.HasSuffix(route, "/*") {
			routes = append(routes, [2]string{method, pathParam.ReplaceAllString(route, "1")})
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(routes) < 20 {
		t.Fatalf("walked only %d API routes: %v", len(routes), routes)
	}
	return routes
}

func isPublicOp(method, path string) bool {
	switch strings.TrimPrefix(path, api) {
	case "/health":
		return method == http.MethodGet
	case "/session":
		return method == http.MethodPost || method == http.MethodDelete
	}
	return false
}

func TestGateEveryProtectedRouteNeedsTheCookie(t *testing.T) {
	e := newGatedEnv(t)
	cookie := loginOK(t, e.h)
	public := 0
	for _, r := range apiRoutes(t, e.h) {
		method, path := r[0], r[1]
		t.Run(method+" "+path, func(t *testing.T) {
			// mutating requests carry the CSRF header so only the session check can fail
			rec := doWith(e.h, method, path, "", withCSRF())
			if isPublicOp(method, path) {
				public++
				if rec.Code == http.StatusUnauthorized && method != http.MethodPost {
					t.Fatalf("public op answered 401")
				}
				return
			}
			expect(t, rec, http.StatusUnauthorized, oapi.ErrorCodeUnauthenticated)
			if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
				t.Errorf("Cache-Control = %q", cc)
			}
			// with the cookie the gate lets it through (any status but 401/403)
			rec = doWith(e.h, method, path, "", withCSRF(), withCookie(cookie))
			if rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden {
				t.Fatalf("with a valid cookie: %d %s", rec.Code, rec.Body)
			}
		})
	}
	if public != 3 {
		t.Errorf("public operations seen = %d, want 3 (health, login, logout)", public)
	}
	// paths the contract does not define are gated too (no existence leak)
	expect(t, doWith(e.h, http.MethodGet, api+"/nope", ""), http.StatusUnauthorized, oapi.ErrorCodeUnauthenticated)
}

func TestGateHealthAndStaticStayOpen(t *testing.T) {
	e := newGatedEnv(t)
	rec := doWith(e.h, http.MethodGet, api+"/health", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("health = %d", rec.Code)
	}
	for _, p := range []string{"/wesele/", "/wesele/goscie", "/wesele/druk/10", "/wesele/assets/x.js"} {
		if rec := doWith(e.h, http.MethodGet, p, ""); rec.Code != http.StatusOK {
			t.Errorf("GET %s = %d, want 200 without a cookie", p, rec.Code)
		}
	}
}

func TestGateLogin(t *testing.T) {
	e := newGatedEnv(t)

	t.Run("correct PIN over plain HTTP: cookie without Secure", func(t *testing.T) {
		rec := login(gatePIN)(e.h)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", rec.Code, rec.Body)
		}
		c := sessionCookie(t, rec)
		if !c.HttpOnly || c.SameSite != http.SameSiteLaxMode || c.Path != "/wesele" || c.MaxAge != 2592000 || c.Secure {
			t.Errorf("cookie = %+v", c)
		}
		if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
			t.Errorf("Cache-Control = %q", cc)
		}
		got := decode[oapi.SessionResponse](t, rec)
		if got.Data.PinRequired == nil || !*got.Data.PinRequired || got.Data.ExpiresAt.IsNull() {
			t.Errorf("body = %+v", got.Data)
		}
		if exp := got.Data.ExpiresAt.MustGet(); exp.Sub(e.clock.now().Add(30*24*time.Hour)).Abs() > time.Second {
			t.Errorf("expiresAt = %v", exp)
		}
		if got.Meta.RequestId == nil || *got.Meta.RequestId == "" {
			t.Error("meta.requestId missing")
		}
	})

	t.Run("Secure over HTTPS (X-Forwarded-Proto)", func(t *testing.T) {
		if c := sessionCookie(t, login(gatePIN, withTLSProxy())(e.h)); !c.Secure {
			t.Errorf("cookie = %+v, want Secure", c)
		}
	})

	t.Run("the cookie opens the API and GET /session", func(t *testing.T) {
		c := loginOK(t, e.h)
		if rec := doWith(e.h, http.MethodGet, api+"/guests", "", withCookie(c)); rec.Code != http.StatusOK {
			t.Fatalf("guests = %d: %s", rec.Code, rec.Body)
		}
		rec := doWith(e.h, http.MethodGet, api+"/session", "", withCookie(c))
		if rec.Code != http.StatusOK {
			t.Fatalf("session = %d", rec.Code)
		}
		if s := decode[oapi.SessionResponse](t, rec).Data; s.PinRequired == nil || !*s.PinRequired || s.ExpiresAt.IsNull() {
			t.Errorf("session = %+v", s)
		}
	})

	t.Run("wrong PIN: 401 invalid_pin, no cookie", func(t *testing.T) {
		rec := login(wrongPIN, fromAddr("192.0.2.10:1"))(e.h)
		expect(t, rec, http.StatusUnauthorized, oapi.ErrorCodeInvalidPin)
		if rec.Header().Get("Set-Cookie") != "" {
			t.Error("Set-Cookie on a failed login")
		}
		if strings.Contains(rec.Body.String(), wrongPIN) {
			t.Error("body echoes the attempted PIN")
		}
	})

	t.Run("invalid input is 422 or 400 and not counted", func(t *testing.T) {
		for _, body := range []string{`{"pin":""}`, `{}`, `{"pin":"` + strings.Repeat("x", 129) + `"}`} {
			expect(t, doWith(e.h, http.MethodPost, api+"/session", body, withCSRF(), fromAddr("192.0.2.11:1")), http.StatusUnprocessableEntity, oapi.ErrorCodeValidationFailed)
		}
		expect(t, doWith(e.h, http.MethodPost, api+"/session", `{"pin":"a","extra":1}`, withCSRF()), http.StatusBadRequest, oapi.ErrorCodeBadRequest)
		expect(t, doWith(e.h, http.MethodPost, api+"/session", `not json`, withCSRF()), http.StatusBadRequest, oapi.ErrorCodeBadRequest)
		// none of that counted: this client still has all its free attempts
		for range 3 {
			expect(t, login(wrongPIN, fromAddr("192.0.2.11:1"))(e.h), http.StatusUnauthorized, oapi.ErrorCodeInvalidPin)
		}
	})

	t.Run("login without the CSRF header is 403", func(t *testing.T) {
		rec := doWith(e.h, http.MethodPost, api+"/session", `{"pin":"`+gatePIN+`"}`)
		expect(t, rec, http.StatusForbidden, oapi.ErrorCodeCsrfHeaderMissing)
	})

	t.Run("logout clears the cookie, with or without a session", func(t *testing.T) {
		rec := doWith(e.h, http.MethodDelete, api+"/session", "", withCSRF(), withTLSProxy())
		if rec.Code != http.StatusNoContent {
			t.Fatalf("status = %d", rec.Code)
		}
		c := sessionCookie(t, rec)
		if c.MaxAge != -1 || c.Value != "" || c.Path != "/wesele" || !c.HttpOnly || !c.Secure {
			t.Errorf("logout cookie = %+v", c)
		}
		if !strings.Contains(rec.Header().Get("Set-Cookie"), "Max-Age=0") {
			t.Errorf("Set-Cookie = %q", rec.Header().Get("Set-Cookie"))
		}
		expect(t, doWith(e.h, http.MethodDelete, api+"/session", ""), http.StatusForbidden, oapi.ErrorCodeCsrfHeaderMissing)
	})
}

func TestGateThrottle(t *testing.T) {
	e := newGatedEnv(t)
	me := fromAddr("192.0.2.20:5000")

	for i := 1; i <= 4; i++ { // the 4th failure still answers 401 and locks
		expect(t, login(wrongPIN, me)(e.h), http.StatusUnauthorized, oapi.ErrorCodeInvalidPin)
	}
	var bodies []string
	for _, pin := range []string{wrongPIN, gatePIN, otherPIN} { // locked: identical for right and wrong
		rec := login(pin, me)(e.h)
		expect(t, rec, http.StatusTooManyRequests, oapi.ErrorCodeTooManyAttempts)
		if ra := rec.Header().Get("Retry-After"); ra != "30" {
			t.Errorf("Retry-After = %q, want 30", ra)
		}
		if rec.Header().Get("Set-Cookie") != "" {
			t.Error("cookie set while locked")
		}
		var body oapi.ErrorResponse = decodeError(t, rec)
		bodies = append(bodies, body.Errors[0].Message)
	}
	if bodies[0] != bodies[1] || bodies[1] != bodies[2] {
		t.Errorf("lock answers differ: %v", bodies)
	}

	// another client is not affected by this client's lock
	if rec := login(gatePIN, fromAddr("192.0.2.21:5000"))(e.h); rec.Code != http.StatusOK {
		t.Errorf("other client = %d", rec.Code)
	}
	// ...but a proxy header names the client: same peer, other X-Forwarded-For -> separate budget
	if rec := login(gatePIN, me, withHeader("X-Forwarded-For", "198.51.100.7"))(e.h); rec.Code != http.StatusOK {
		t.Errorf("xff client = %d", rec.Code)
	}

	// after the lock the PIN is evaluated again
	e.clock.advance(31 * time.Second)
	if rec := login(gatePIN, me)(e.h); rec.Code != http.StatusOK {
		t.Errorf("after the lock: %d %s", rec.Code, rec.Body)
	}

	// existing cookies are unaffected by the throttle
	c := loginOK(t, e.h, fromAddr("192.0.2.30:1"))
	for range 25 {
		login(wrongPIN, fromAddr("192.0.2.31:1"), withHeader("X-Forwarded-For", "203.0.113."+strconv.Itoa(len(c.Value)%200)))(e.h)
	}
	if rec := doWith(e.h, http.MethodGet, api+"/guests", "", withCookie(c)); rec.Code != http.StatusOK {
		t.Errorf("cookie after a global lock: %d", rec.Code)
	}
}

func TestGateGlobalBudget(t *testing.T) {
	e := newGatedEnv(t)
	for i := range 20 {
		expect(t, login(wrongPIN, fromAddr("192.0.2."+strconv.Itoa(i+1)+":1"))(e.h), http.StatusUnauthorized, oapi.ErrorCodeInvalidPin)
	}
	rec := login(gatePIN, fromAddr("198.51.100.99:1"))(e.h)
	expect(t, rec, http.StatusTooManyRequests, oapi.ErrorCodeTooManyAttempts)
	if ra, err := strconv.Atoi(rec.Header().Get("Retry-After")); err != nil || ra < 1 {
		t.Errorf("Retry-After = %q", rec.Header().Get("Retry-After"))
	}
}

func TestGateCookieValidity(t *testing.T) {
	e := newGatedEnv(t)
	c := loginOK(t, e.h)
	get := func(h http.Handler, ck *http.Cookie) int {
		return doWith(h, http.MethodGet, api+"/guests", "", withCookie(ck)).Code
	}

	t.Run("tampered", func(t *testing.T) {
		for _, v := range []string{c.Value + "A", "x" + c.Value, strings.Replace(c.Value, ".", ".AAAA", 1), "garbage"} {
			if got := get(e.h, &http.Cookie{Name: c.Name, Value: v}); got != http.StatusUnauthorized {
				t.Errorf("tampered cookie %q -> %d", v, got)
			}
		}
	})

	t.Run("survives a restart (same key file), dies with a PIN change", func(t *testing.T) {
		if got := get(e.start(t, gatePIN), c); got != http.StatusOK {
			t.Errorf("after restart = %d", got)
		}
		if got := get(e.start(t, otherPIN), c); got != http.StatusUnauthorized {
			t.Errorf("after PIN change = %d, want 401", got)
		}
	})

	t.Run("sliding re-issue after 24 h, expiry after 30 d", func(t *testing.T) {
		if rec := doWith(e.h, http.MethodGet, api+"/guests", "", withCookie(c)); rec.Header().Get("Set-Cookie") != "" {
			t.Error("re-issued within 24 h")
		}
		e.clock.advance(25 * time.Hour)
		rec := doWith(e.h, http.MethodGet, api+"/guests", "", withCookie(c))
		fresh := sessionCookie(t, rec)
		if fresh.MaxAge != 2592000 || fresh.Value == c.Value {
			t.Errorf("re-issued cookie = %+v", fresh)
		}
		e.clock.advance(29 * 24 * time.Hour) // the original is now past 30 d, the fresh one is not
		if got := get(e.h, c); got != http.StatusUnauthorized {
			t.Errorf("expired cookie = %d, want 401", got)
		}
		if got := get(e.h, fresh); got != http.StatusOK {
			t.Errorf("slid cookie = %d, want 200", got)
		}
	})
}

func TestGateCSRFHeader(t *testing.T) {
	e := newGatedEnv(t)
	c := loginOK(t, e.h)

	// no cookie: 401 wins over 403
	expect(t, doWith(e.h, http.MethodPost, api+"/guests", `{"firstName":"Ala"}`), http.StatusUnauthorized, oapi.ErrorCodeUnauthenticated)
	// cookie but no header: 403 on every mutating method
	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		expect(t, doWith(e.h, m, api+"/guests/1", "{}", withCookie(c)), http.StatusForbidden, oapi.ErrorCodeCsrfHeaderMissing)
	}
	// a wrong header value is no header
	expect(t, doWith(e.h, http.MethodPost, api+"/guests", `{"firstName":"Ala"}`, withCookie(c), withHeader(accessgate.CSRFHeader, "0")), http.StatusForbidden, oapi.ErrorCodeCsrfHeaderMissing)
	// reads need no header; with the header the write goes through
	if rec := doWith(e.h, http.MethodGet, api+"/guests", "", withCookie(c)); rec.Code != http.StatusOK {
		t.Errorf("GET = %d", rec.Code)
	}
	if rec := doWith(e.h, http.MethodPost, api+"/guests", `{"firstName":"Ala"}`, withCookie(c), withCSRF()); rec.Code != http.StatusCreated {
		t.Errorf("POST = %d: %s", rec.Code, rec.Body)
	}
}

func TestGateOffIsToday(t *testing.T) {
	e := newGatedEnv(t)
	h := e.start(t, "")

	if rec := doWith(h, http.MethodGet, api+"/guests", ""); rec.Code != http.StatusOK {
		t.Errorf("guests = %d", rec.Code)
	}
	if rec := doWith(h, http.MethodPost, api+"/guests", `{"firstName":"Ala"}`); rec.Code != http.StatusCreated { // no CSRF header needed
		t.Errorf("create = %d: %s", rec.Code, rec.Body)
	}
	if rec := doWith(h, http.MethodGet, api+"/guests", ""); rec.Header().Get("Cache-Control") == "no-store" {
		t.Error("no-store set with the gate off")
	}
	rec := doWith(h, http.MethodGet, api+"/session", "")
	s := decode[oapi.SessionResponse](t, rec).Data
	if rec.Code != http.StatusOK || s.PinRequired == nil || *s.PinRequired || !s.ExpiresAt.IsNull() {
		t.Errorf("GET /session = %d %s", rec.Code, rec.Body)
	}
	rec = doWith(h, http.MethodPost, api+"/session", `{"pin":"anything"}`)
	if rec.Code != http.StatusOK || rec.Header().Get("Set-Cookie") != "" {
		t.Errorf("POST /session = %d, Set-Cookie %q", rec.Code, rec.Header().Get("Set-Cookie"))
	}
	if rec := doWith(h, http.MethodDelete, api+"/session", ""); rec.Code != http.StatusNoContent || rec.Header().Get("Set-Cookie") != "" {
		t.Errorf("DELETE /session = %d", rec.Code)
	}
}

func TestGateSecretsStayOutOfLogsAndBodies(t *testing.T) {
	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	e := newGatedEnv(t)
	me := fromAddr("192.0.2.77:4321")
	var responses strings.Builder
	for _, pin := range []string{wrongPIN, wrongPIN, wrongPIN, wrongPIN, wrongPIN, gatePIN} { // fail x4 (lock), locked x2
		rec := login(pin, me, withHeader("X-Forwarded-For", "198.51.100.5"))(e.h)
		responses.WriteString(rec.Body.String())
		responses.WriteString(rec.Header().Get("Set-Cookie"))
	}
	loginOK(t, e.h, fromAddr("192.0.2.78:1"))
	doWith(e.h, http.MethodGet, api+"/guests", "")

	if logs.Len() == 0 {
		t.Fatal("no log output captured")
	}
	for _, secret := range []string{gatePIN, wrongPIN, "192.0.2.77", "198.51.100.5", "192.0.2.78"} {
		if strings.Contains(logs.String(), secret) {
			t.Errorf("log output contains %q:\n%s", secret, logs.String())
		}
		if secret != "192.0.2.77" && strings.Contains(responses.String(), secret) {
			t.Errorf("response contains %q", secret)
		}
	}
	for _, want := range []string{"login failed", "login lock", "login ok"} {
		if !strings.Contains(logs.String(), want) {
			t.Errorf("log lacks %q", want)
		}
	}
}
