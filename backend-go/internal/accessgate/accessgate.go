// Package accessgate is the shared-PIN gate of the API (docs/architecture/05-access-gate.md):
// a signed, stateless session cookie, an in-memory login throttle and a CSRF header check,
// packaged as one http middleware plus Login/Logout for the session endpoints. It depends on
// nothing in the project (like internal/seating), so httpapi and main import it, never the reverse.
//
// The PIN, attempted values and client addresses are never logged and never put in errors.
package accessgate

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

const (
	// CookieName is the session cookie.
	CookieName = "stoliki_session"
	// CSRFHeader must be "1" on every state-changing request while the gate is on.
	CSRFHeader = "X-Stoliki-Request"

	sessionLifetime = 30 * 24 * time.Hour
	slideAfter      = 24 * time.Hour // re-issue the cookie when the token is older than this

	tokenVersion = "v1"
	keyLabel     = "stoliki-session-v1"
)

// Sentinels the HTTP layer maps to the error envelope (httpapi.errorResponse).
var (
	ErrUnauthenticated = errors.New("unauthenticated")
	ErrInvalidPIN      = errors.New("invalid pin")
	ErrCSRF            = errors.New("csrf header missing")
)

// ThrottledError: login refused because the client or the global budget is locked. The PIN
// was not evaluated.
type ThrottledError struct{ RetryAfter time.Duration }

func (e *ThrottledError) Error() string { return "too many attempts" }

// Gate verifies sessions and logins. Create it with New; a nil *Gate means "gate off" to callers.
type Gate struct {
	pinDigest  [32]byte
	key        []byte
	cookiePath string // BASE_PATH, e.g. "/wesele"
	throttle   *throttle
	now        func() time.Time
}

// New derives pinDigest = SHA-256(pin) and key = HMAC-SHA256(secret, "stoliki-session-v1" || pinDigest),
// so a changed PIN invalidates every cookie. The pin string itself is not kept. now is time.Now
// in production and a fixed clock in tests. cookiePath is the cookie's Path (BASE_PATH; "" = "/").
func New(pin string, secret []byte, cookiePath string, now func() time.Time) *Gate {
	g := &Gate{
		pinDigest:  sha256.Sum256([]byte(pin)),
		cookiePath: cookiePath,
		throttle:   newThrottle(),
		now:        now,
	}
	if g.cookiePath == "" {
		g.cookiePath = "/"
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(keyLabel))
	mac.Write(g.pinDigest[:])
	g.key = mac.Sum(nil)
	return g
}

// Login checks the throttle (locked -> *ThrottledError, PIN NOT evaluated, so a lock never
// confirms a guess), then compares the digests in constant time: ErrInvalidPIN (failure recorded)
// or a fresh session cookie and its expiry (the client's failures are forgotten). clientKey is only a map key.
func (g *Gate) Login(clientKey, pin string, secure bool) (*http.Cookie, time.Time, error) {
	now := g.now()
	g.throttle.mu.Lock()
	defer g.throttle.mu.Unlock() // held across the compare: concurrent guesses cannot beat the lock

	if retry, locked := g.throttle.check(clientKey, now); locked {
		return nil, time.Time{}, &ThrottledError{RetryAfter: retry}
	}
	digest := sha256.Sum256([]byte(pin))
	if subtle.ConstantTimeCompare(digest[:], g.pinDigest[:]) != 1 {
		res := g.throttle.fail(clientKey, now)
		slog.Info("login failed", "clientFailures", res.failures)
		if res.clientLock > 0 {
			slog.Warn("login lock", "clientLockSeconds", int(res.clientLock/time.Second))
		}
		if res.globalClosed {
			slog.Warn("login lock global", "failuresInWindow", globalMaxFailures)
		}
		return nil, time.Time{}, ErrInvalidPIN
	}
	g.throttle.succeed(clientKey)
	slog.Info("login ok")
	t := token{issuedAt: now, expiresAt: now.Add(sessionLifetime)}
	return g.cookie(t, secure), t.expiresAt, nil
}

// Logout returns the cookie that clears the session cookie (Max-Age=0). Stateless: it only
// logs out the browser that receives it.
func (g *Gate) Logout(secure bool) *http.Cookie {
	c := g.cookie(token{}, secure)
	c.Value, c.MaxAge = "", -1
	return c
}

func (g *Gate) cookie(t token, secure bool) *http.Cookie {
	return &http.Cookie{
		Name:     CookieName,
		Value:    g.sign(t),
		Path:     g.cookiePath,
		MaxAge:   int(t.expiresAt.Sub(t.issuedAt) / time.Second),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	}
}

type ctxKey struct{}

// Session returns when the authenticated request's cookie expires (set by Middleware).
func Session(ctx context.Context) (expiresAt time.Time, ok bool) {
	t, ok := ctx.Value(ctxKey{}).(time.Time)
	return t, ok
}

// ClientKey identifies the caller for the throttle: the rightmost X-Forwarded-For entry (the one
// the nearest proxy, tailscale serve/funnel, appended), else the TCP peer's host.
func ClientKey(r *http.Request) string {
	if xff := strings.Join(r.Header.Values("X-Forwarded-For"), ","); xff != "" {
		if i := strings.LastIndexByte(xff, ','); i >= 0 {
			xff = xff[i+1:]
		}
		if k := strings.TrimSpace(xff); k != "" {
			return k
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// IsSecure reports whether the request came over HTTPS (directly or via a proxy that says so).
func IsSecure(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

// Middleware is mounted on the API sub-router only. Public operations (GET /health,
// POST /session, DELETE /session; paths relative to the API mount) skip the session check;
// everything else needs a valid cookie (401), and every state-changing request needs the CSRF
// header (403, evaluated after the session check so a logged-out SPA always sees 401).
// writeErr renders the error in the API's envelope.
func (g *Gate) Middleware(writeErr func(http.ResponseWriter, *http.Request, error)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store") // no cache keeps guest data or session answers

			public := isPublic(r.Method, relativePath(r))
			var expiresAt time.Time
			if !public {
				t, ok := g.fromRequest(r)
				if !ok {
					writeErr(w, r, ErrUnauthenticated)
					return
				}
				expiresAt = t.expiresAt
				if now := g.now(); now.Sub(t.issuedAt) > slideAfter {
					fresh := token{issuedAt: now, expiresAt: now.Add(sessionLifetime)}
					http.SetCookie(w, g.cookie(fresh, IsSecure(r)))
					expiresAt = fresh.expiresAt
				}
			}
			if mutating(r.Method) && r.Header.Get(CSRFHeader) != "1" {
				writeErr(w, r, ErrCSRF)
				return
			}
			if !public {
				r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, expiresAt))
			}
			next.ServeHTTP(w, r)
		})
	}
}

// relativePath is the request path relative to the API mount point: chi keeps it in the route
// context while a mounted sub-router runs; outside chi the URL path is used as is.
func relativePath(r *http.Request) string {
	if rc := chi.RouteContext(r.Context()); rc != nil && rc.RoutePath != "" {
		return rc.RoutePath
	}
	return r.URL.Path
}

func isPublic(method, path string) bool {
	switch path {
	case "/health":
		return method == http.MethodGet
	case "/session":
		return method == http.MethodPost || method == http.MethodDelete
	}
	return false
}

func mutating(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	return false
}

// fromRequest returns the token of the first valid session cookie.
func (g *Gate) fromRequest(r *http.Request) (token, bool) {
	for _, c := range r.Cookies() {
		if c.Name != CookieName {
			continue
		}
		if t, ok := g.verify(c.Value); ok {
			return t, true
		}
	}
	return token{}, false
}

// token is the signed payload "v1|<issuedAt unix>|<expiresAt unix>".
type token struct{ issuedAt, expiresAt time.Time }

var b64 = base64.RawURLEncoding

// sign returns base64url(payload) "." base64url(HMAC-SHA256(key, payload)).
func (g *Gate) sign(t token) string {
	payload := fmt.Sprintf("%s|%d|%d", tokenVersion, t.issuedAt.Unix(), t.expiresAt.Unix())
	return b64.EncodeToString([]byte(payload)) + "." + b64.EncodeToString(g.mac([]byte(payload)))
}

// verify accepts a token only if its MAC matches (constant time) and it has not expired.
// Any malformed input is simply "not valid".
func (g *Gate) verify(v string) (token, bool) {
	encPayload, encMAC, ok := strings.Cut(v, ".")
	if !ok {
		return token{}, false
	}
	payload, err := b64.DecodeString(encPayload)
	if err != nil {
		return token{}, false
	}
	mac, err := b64.DecodeString(encMAC)
	if err != nil || !hmac.Equal(mac, g.mac(payload)) {
		return token{}, false
	}
	parts := strings.Split(string(payload), "|")
	if len(parts) != 3 || parts[0] != tokenVersion {
		return token{}, false
	}
	issued, err1 := strconv.ParseInt(parts[1], 10, 64)
	expires, err2 := strconv.ParseInt(parts[2], 10, 64)
	if err1 != nil || err2 != nil {
		return token{}, false
	}
	t := token{issuedAt: time.Unix(issued, 0), expiresAt: time.Unix(expires, 0)}
	if !g.now().Before(t.expiresAt) {
		return token{}, false
	}
	return t, true
}

func (g *Gate) mac(payload []byte) []byte {
	m := hmac.New(sha256.New, g.key)
	m.Write(payload)
	return m.Sum(nil)
}
