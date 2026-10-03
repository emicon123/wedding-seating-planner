package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"maps"
	"net/http"
	"reflect"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
)

// The generated strict server decodes request bodies with a plain json.Decoder, which is too
// lenient for this contract: a missing required field silently becomes its zero value (a link
// body `{}` would mean level 0 = "must sit together") and unknown fields are ignored although
// every request schema says `additionalProperties: false`. strictBody is a per-operation
// middleware that checks the TOP-LEVEL keys of a JSON body against the generated request type
// before the strict handler decodes it:
//
//   - a key the schema does not define -> 400 bad_request naming it;
//   - a required key (json tag without omitempty) that is missing, or null on a non-nullable
//     property -> 400 bad_request naming it.
//
// Nested objects are not checked: the contract only forbids extra properties at the top level
// (TableLayout, for instance, tolerates extra fields so a PlanTable can be sent back as is).
// Malformed JSON and empty bodies are left to the strict handler's own decoder.

// bodyShape describes the top-level keys of one request schema.
type bodyShape struct {
	required map[string]bool // key -> null is acceptable (nullable.Nullable)
	known    map[string]bool
}

func shapeOf(t reflect.Type) bodyShape {
	s := bodyShape{required: map[string]bool{}, known: map[string]bool{}}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		name, opts, _ := strings.Cut(f.Tag.Get("json"), ",")
		if name == "" || name == "-" {
			continue
		}
		s.known[name] = true
		if !strings.Contains(opts, "omitempty") {
			s.required[name] = strings.HasPrefix(f.Type.Name(), "Nullable[")
		}
	}
	return s
}

// bodyOps are the operations of docs/openapi.yaml that take a JSON object body, keyed by
// "METHOD route-suffix" (the route pattern is matched by suffix because the API is mounted
// under the configurable base path). The CSV import body is not JSON and is not listed.
var bodyOps = map[string]bodyShape{
	"POST /guests":               shapeOf(reflect.TypeFor[oapi.GuestCreate]()),
	"PATCH /guests":              shapeOf(reflect.TypeFor[oapi.GuestBulkToggle]()),
	"PATCH /guests/{guestId}":    shapeOf(reflect.TypeFor[oapi.GuestUpdate]()),
	"PUT /guest-links/{linkKey}": shapeOf(reflect.TypeFor[oapi.GuestLinkUpsert]()),
	"PUT /scenarios":             shapeOf(reflect.TypeFor[oapi.ScenariosReplace]()),
	"PUT /scenarios/{capacity}/assignments/{guestId}": shapeOf(reflect.TypeFor[oapi.AssignmentSet]()),
}

// shapeFor finds the body shape of the matched route, if the operation has one.
func shapeFor(r *http.Request) (bodyShape, bool) {
	rc := chi.RouteContext(r.Context())
	if rc == nil {
		return bodyShape{}, false
	}
	pattern := rc.RoutePattern()
	for key, shape := range bodyOps {
		method, suffix, _ := strings.Cut(key, " ")
		if method == r.Method && strings.HasSuffix(pattern, suffix) {
			return shape, true
		}
	}
	return bodyShape{}, false
}

// strictBody is an oapi.MiddlewareFunc (runs after routing, once per operation).
func strictBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		shape, ok := shapeFor(r)
		if !ok || r.Body == nil || r.Body == http.NoBody {
			next.ServeHTTP(w, r)
			return
		}
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			requestErrorHandler(w, r, err) // over-limit body -> 413
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(raw)) // the strict handler decodes it next

		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
			next.ServeHTTP(w, r) // not a JSON object: the strict decoder reports it
			return
		}
		if err := shape.check(fields); err != nil {
			writeError(w, r, err)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// check returns a bad_request error for the first (alphabetically) offending key.
func (s bodyShape) check(fields map[string]json.RawMessage) error {
	for _, name := range slices.Sorted(maps.Keys(fields)) {
		if !s.known[name] {
			return badRequest(name, "Unknown field "+name+".")
		}
	}
	for _, name := range slices.Sorted(maps.Keys(s.required)) {
		v, present := fields[name]
		if !present {
			return badRequest(name, "Field "+name+" is required.")
		}
		if !s.required[name] && bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
			return badRequest(name, "Field "+name+" must not be null.")
		}
	}
	return nil
}
