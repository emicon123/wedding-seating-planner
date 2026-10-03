package httpapi

import (
	"context"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/oapi-codegen/nullable"

	"github.com/wojtekrpi/stoliki/backend-go/internal/accessgate"
	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
)

// maxPINLen is SessionCreate.pin maxLength in docs/openapi.yaml.
const maxPINLen = 128

// client is what the session handlers need from the request: the throttle key and whether the
// request came over HTTPS (Secure cookie). The key is never logged (client addresses are personal data).
type client struct {
	key    string
	secure bool
}

type clientCtxKey struct{}

// withClient stores the caller's client info in the request context for the strict handlers,
// which only receive a context.
func withClient(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c := client{key: accessgate.ClientKey(r), secure: accessgate.IsSecure(r)}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), clientCtxKey{}, c)))
	})
}

func clientOf(ctx context.Context) client {
	c, _ := ctx.Value(clientCtxKey{}).(client)
	return c
}

func sessionBody(ctx context.Context, pinRequired bool, expiresAt *time.Time) oapi.SessionResponse {
	id := middleware.GetReqID(ctx)
	s := oapi.Session{PinRequired: &pinRequired, ExpiresAt: nullable.NewNullNullable[time.Time]()}
	if expiresAt != nil {
		s.ExpiresAt = nullable.NewNullableWithValue(expiresAt.UTC())
	}
	return oapi.SessionResponse{Data: s, Meta: oapi.Meta{RequestId: &id}}
}

// GetSession implements getSession. With the gate on, the middleware has already rejected
// callers without a valid cookie, so reaching here means logged in.
func (s *Server) GetSession(ctx context.Context, _ oapi.GetSessionRequestObject) (oapi.GetSessionResponseObject, error) {
	if s.gate == nil {
		return oapi.GetSession200JSONResponse(sessionBody(ctx, false, nil)), nil
	}
	exp, ok := accessgate.Session(ctx)
	if !ok {
		return nil, accessgate.ErrUnauthenticated // not mounted behind the middleware; fail closed
	}
	return oapi.GetSession200JSONResponse(sessionBody(ctx, true, &exp)), nil
}

// CreateSession implements createSession (login). Gate off: 200 pinRequired=false, no cookie.
func (s *Server) CreateSession(ctx context.Context, req oapi.CreateSessionRequestObject) (oapi.CreateSessionResponseObject, error) {
	if s.gate == nil {
		return oapi.CreateSession200JSONResponse{Body: sessionBody(ctx, false, nil)}, nil
	}
	pin := ""
	if req.Body != nil && req.Body.Pin != nil {
		pin = *req.Body.Pin
	}
	// Invalid input is rejected before the throttle: not evaluated, not counted. The message
	// never echoes the value.
	if pin == "" || utf8.RuneCountInString(pin) > maxPINLen {
		return nil, apperr.Validation{Field: "pin", Message: "PIN must be 1 to 128 characters."}
	}
	c := clientOf(ctx)
	cookie, exp, err := s.gate.Login(c.key, pin, c.secure)
	if err != nil {
		return nil, err
	}
	cs := cookie.String()
	return oapi.CreateSession200JSONResponse{
		Body:    sessionBody(ctx, true, &exp),
		Headers: oapi.CreateSession200ResponseHeaders{SetCookie: &cs},
	}, nil
}

// DeleteSession implements deleteSession (logout): idempotent, clears this browser's cookie.
func (s *Server) DeleteSession(ctx context.Context, _ oapi.DeleteSessionRequestObject) (oapi.DeleteSessionResponseObject, error) {
	if s.gate == nil {
		return oapi.DeleteSession204Response{}, nil
	}
	cs := s.gate.Logout(clientOf(ctx).secure).String()
	return oapi.DeleteSession204Response{Headers: oapi.DeleteSession204ResponseHeaders{SetCookie: &cs}}, nil
}
