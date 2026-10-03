package accessgate

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Obviously fake values: the real PIN never appears in tests.
const (
	testPIN  = "test-pin-7391"
	wrongPIN = "wrong-pin-0000"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time          { return c.t }
func (c *clock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newClock() *clock { return &clock{t: time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)} }

var testSecret = []byte("0123456789abcdef0123456789abcdef")

func newGate(c *clock) *Gate { return New(testPIN, testSecret, "/wesele", c.now) }

func TestSignVerify(t *testing.T) {
	c := newClock()
	g := newGate(c)
	tok := token{issuedAt: c.t, expiresAt: c.t.Add(sessionLifetime)}
	v := g.sign(tok)

	t.Run("round trip", func(t *testing.T) {
		got, ok := g.verify(v)
		if !ok || !got.issuedAt.Equal(tok.issuedAt) || !got.expiresAt.Equal(tok.expiresAt) {
			t.Fatalf("verify = %+v, %v", got, ok)
		}
	})

	payload, mac, _ := strings.Cut(v, ".")
	other := New("another-fake-pin", testSecret, "/wesele", c.now)
	forged := b64.EncodeToString([]byte(fmt.Sprintf("v1|%d|%d", c.t.Unix(), c.t.Add(10*sessionLifetime).Unix()))) + "." + mac
	for name, bad := range map[string]string{
		"empty":            "",
		"no dot":           payload,
		"tampered payload": forged,
		"tampered mac":     payload + "." + mac[:len(mac)-2] + "AA",
		"garbage":          "!!!.???",
		"other pin":        other.sign(tok),
	} {
		t.Run("rejects "+name, func(t *testing.T) {
			if _, ok := g.verify(bad); ok {
				t.Fatal("accepted")
			}
		})
	}

	t.Run("rejects other secret", func(t *testing.T) {
		g2 := New(testPIN, []byte("ffffffffffffffffffffffffffffffff"), "/wesele", c.now)
		if _, ok := g.verify(g2.sign(tok)); ok {
			t.Fatal("accepted")
		}
	})
	t.Run("rejects expired", func(t *testing.T) {
		c.advance(sessionLifetime)
		defer c.advance(-sessionLifetime)
		if _, ok := g.verify(v); ok {
			t.Fatal("accepted an expired token")
		}
	})
}

func TestLoginThrottleSchedule(t *testing.T) {
	c := newClock()
	g := newGate(c)

	for i := 1; i <= freeFailures; i++ {
		if _, _, err := g.Login("a", wrongPIN, false); !errors.Is(err, ErrInvalidPIN) {
			t.Fatalf("failure %d: %v", i, err)
		}
	}
	// failure 4 still answers invalid pin, and locks 30 s; then 1 min, 2 min, ... capped at 1 h
	wantLocks := []time.Duration{30 * time.Second, time.Minute, 2 * time.Minute, 4 * time.Minute, 8 * time.Minute, 16 * time.Minute, 32 * time.Minute, time.Hour, time.Hour}
	for i, want := range wantLocks {
		if _, _, err := g.Login("a", wrongPIN, false); !errors.Is(err, ErrInvalidPIN) {
			t.Fatalf("lock step %d: %v", i, err)
		}
		// 1 s in: locked, the correct PIN is refused too, with the same remaining time
		c.advance(time.Second)
		for _, pin := range []string{testPIN, wrongPIN} {
			_, _, err := g.Login("a", pin, false)
			var te *ThrottledError
			if !errors.As(err, &te) {
				t.Fatalf("step %d pin %q: err = %v, want ThrottledError", i, pin, err)
			}
			if te.RetryAfter != want-time.Second {
				t.Fatalf("step %d: RetryAfter = %v, want %v", i, te.RetryAfter, want-time.Second)
			}
		}
		c.advance(want - time.Second) // lock over
	}

	t.Run("a refused attempt is not a failure", func(t *testing.T) {
		g := newGate(newClock())
		for range freeFailures + 1 {
			g.Login("a", wrongPIN, false)
		}
		before := g.throttle.clients["a"].failures
		for range 5 {
			g.Login("a", wrongPIN, false)
		}
		if after := g.throttle.clients["a"].failures; after != before {
			t.Fatalf("failures %d -> %d while locked", before, after)
		}
	})
}

func TestLoginSuccessClearsClientButNotGlobal(t *testing.T) {
	c := newClock()
	g := newGate(c)
	g.Login("a", wrongPIN, false)
	g.Login("a", wrongPIN, false)
	if _, _, err := g.Login("a", testPIN, false); err != nil {
		t.Fatal(err)
	}
	if _, ok := g.throttle.clients["a"]; ok {
		t.Error("client entry survived a successful login")
	}
	if len(g.throttle.global) != 2 {
		t.Errorf("global failures = %d, want 2 (a success never resets it)", len(g.throttle.global))
	}
}

func TestGlobalBudget(t *testing.T) {
	c := newClock()
	g := newGate(c)
	for i := range globalMaxFailures {
		if _, _, err := g.Login(fmt.Sprintf("c%d", i), wrongPIN, false); !errors.Is(err, ErrInvalidPIN) {
			t.Fatalf("failure %d: %v", i, err)
		}
		c.advance(time.Minute)
	}
	// 21st attempt, from a new client, right PIN: refused for everyone
	_, _, err := g.Login("fresh", testPIN, false)
	var te *ThrottledError
	if !errors.As(err, &te) {
		t.Fatalf("err = %v, want ThrottledError", err)
	}
	// the oldest failure was 20 min ago: it leaves the window 24 h - 20 min from now
	if want := 24*time.Hour - 20*time.Minute; te.RetryAfter != want {
		t.Errorf("RetryAfter = %v, want %v", te.RetryAfter, want)
	}
	// a success elsewhere cannot reset it: still locked after the window of the *newest* is open
	c.advance(te.RetryAfter)
	if _, _, err := g.Login("fresh", testPIN, false); err != nil {
		t.Fatalf("after the window slid: %v", err)
	}
}

func TestClientForgottenAfter24h(t *testing.T) {
	c := newClock()
	g := newGate(c)
	for range freeFailures + 1 {
		g.Login("a", wrongPIN, false)
	}
	c.advance(clientTTL)
	if _, _, err := g.Login("a", wrongPIN, false); !errors.Is(err, ErrInvalidPIN) {
		t.Fatalf("err = %v, want a fresh (unlocked) client", err)
	}
	if got := g.throttle.clients["a"].failures; got != 1 {
		t.Errorf("failures = %d, want 1 after being forgotten", got)
	}
}

func TestClientTableFull(t *testing.T) {
	c := newClock()
	g := newGate(c)
	g.throttle.mu.Lock()
	for i := range maxClients {
		g.throttle.clients[fmt.Sprintf("k%d", i)] = &clientState{failures: 1, lastFailure: c.t}
	}
	g.throttle.mu.Unlock()

	var te *ThrottledError
	if _, _, err := g.Login("unknown", testPIN, false); !errors.As(err, &te) {
		t.Fatalf("unknown client with a full table: %v, want fail closed", err)
	}
	if _, _, err := g.Login("k1", testPIN, false); err != nil {
		t.Fatalf("known client: %v", err)
	}
	c.advance(clientTTL) // everything expires: pruned, unknown clients are welcome again
	if _, _, err := g.Login("unknown", testPIN, false); err != nil {
		t.Fatalf("after pruning: %v", err)
	}
}

func TestLoginCookie(t *testing.T) {
	c := newClock()
	g := newGate(c)
	cookie, exp, err := g.Login("a", testPIN, true)
	if err != nil {
		t.Fatal(err)
	}
	if !exp.Equal(c.t.Add(sessionLifetime)) {
		t.Errorf("expiresAt = %v", exp)
	}
	if cookie.Name != CookieName || cookie.Path != "/wesele" || !cookie.HttpOnly || !cookie.Secure ||
		cookie.SameSite != http.SameSiteLaxMode || cookie.MaxAge != 2592000 {
		t.Errorf("cookie = %+v", cookie)
	}
	out := g.Logout(false)
	if s := out.String(); !strings.Contains(s, "Max-Age=0") || !strings.Contains(s, "Path=/wesele") || out.Value != "" {
		t.Errorf("logout cookie = %q", s)
	}
}

func TestMiddleware(t *testing.T) {
	c := newClock()
	g := newGate(c)
	writeErr := func(w http.ResponseWriter, _ *http.Request, err error) {
		switch {
		case errors.Is(err, ErrUnauthenticated):
			w.WriteHeader(http.StatusUnauthorized)
		case errors.Is(err, ErrCSRF):
			w.WriteHeader(http.StatusForbidden)
		default:
			w.WriteHeader(http.StatusInternalServerError)
		}
	}
	var gotExp time.Time
	h := g.Middleware(writeErr)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotExp, _ = Session(r.Context())
		w.WriteHeader(http.StatusOK)
	}))
	cookie, _, _ := g.Login("a", testPIN, false)

	call := func(method, path string, ck *http.Cookie, csrf bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		if ck != nil {
			req.AddCookie(ck)
		}
		if csrf {
			req.Header.Set(CSRFHeader, "1")
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	for _, tc := range []struct {
		name     string
		method   string
		path     string
		cookie   *http.Cookie
		csrf     bool
		wantCode int
	}{
		{"health open", "GET", "/health", nil, false, 200},
		{"login open, csrf required", "POST", "/session", nil, false, 403},
		{"login open", "POST", "/session", nil, true, 200},
		{"logout open", "DELETE", "/session", nil, true, 200},
		{"logout needs csrf", "DELETE", "/session", nil, false, 403},
		{"GET session gated", "GET", "/session", nil, false, 401},
		{"data gated", "GET", "/guests", nil, false, 401},
		{"unknown path gated", "GET", "/nope", nil, false, 401},
		{"POST health is not the public op", "POST", "/health", nil, true, 401},
		{"mutation without cookie: 401 before 403", "POST", "/guests", nil, false, 401},
		{"valid cookie", "GET", "/guests", cookie, false, 200},
		{"mutation with cookie, no csrf", "POST", "/guests", cookie, false, 403},
		{"mutation with cookie and csrf", "POST", "/guests", cookie, true, 200},
		{"tampered cookie", "GET", "/guests", &http.Cookie{Name: CookieName, Value: cookie.Value + "x"}, false, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := call(tc.method, tc.path, tc.cookie, tc.csrf)
			if rec.Code != tc.wantCode {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantCode)
			}
			if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
				t.Errorf("Cache-Control = %q", cc)
			}
		})
	}

	t.Run("sliding: re-issued only after 24 h", func(t *testing.T) {
		if rec := call("GET", "/guests", cookie, false); rec.Header().Get("Set-Cookie") != "" {
			t.Fatal("re-issued a fresh cookie")
		}
		c.advance(slideAfter + time.Minute)
		rec := call("GET", "/guests", cookie, false)
		set := rec.Result().Cookies()
		if len(set) != 1 || set[0].Name != CookieName || set[0].MaxAge != 2592000 {
			t.Fatalf("Set-Cookie = %v", rec.Header()["Set-Cookie"])
		}
		if want := c.t.Add(sessionLifetime); !gotExp.Equal(want) {
			t.Errorf("Session expiry = %v, want %v", gotExp, want)
		}
		// the re-issued cookie works
		if rec := call("GET", "/guests", set[0], false); rec.Code != 200 {
			t.Errorf("re-issued cookie rejected: %d", rec.Code)
		}
	})
}

func TestClientKeyAndIsSecure(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.0.0.5:4242"
	if got := ClientKey(req); got != "10.0.0.5" {
		t.Errorf("peer key = %q", got)
	}
	req.Header.Add("X-Forwarded-For", "1.1.1.1, 2.2.2.2")
	req.Header.Add("X-Forwarded-For", "3.3.3.3 ")
	if got := ClientKey(req); got != "3.3.3.3" {
		t.Errorf("xff key = %q, want the rightmost", got)
	}
	if IsSecure(req) {
		t.Error("plain http reported secure")
	}
	req.Header.Set("X-Forwarded-Proto", "HTTPS")
	if !IsSecure(req) {
		t.Error("X-Forwarded-Proto https not secure")
	}
}

func TestLoadOrCreateSecret(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session.key")
	a, err := LoadOrCreateSecret(path)
	if err != nil || len(a) != 32 {
		t.Fatalf("create: %v len=%d", err, len(a))
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v, err %v", info.Mode(), err)
	}
	b, err := LoadOrCreateSecret(path)
	if err != nil || string(a) != string(b) {
		t.Fatalf("second load differs: %v", err)
	}
	if err := os.WriteFile(path, []byte("short"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreateSecret(path); err == nil {
		t.Fatal("accepted a key of the wrong size")
	}
}
