package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/oapi-codegen/nullable"

	"github.com/wojtekrpi/stoliki/backend-go/internal/accessgate"
	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
)

// errNotImplemented marks operations whose ticket has not landed yet (answered with 501).
var errNotImplemented = errors.New("not implemented")

// badRequestError is a malformed request (unparseable JSON, bad path parameter) -> 400 bad_request.
type badRequestError struct{ field, message string }

func (e badRequestError) Error() string { return "bad request: " + e.message }

// badRequest builds a badRequestError; field may be empty when the problem is not field-specific.
func badRequest(field, message string) error { return badRequestError{field: field, message: message} }

// errorResponse is THE error mapper (docs/architecture/04-data-model.md "Domain errors ->
// error envelope"): every handler error goes through it. It never exposes the cause of an
// unexpected error. meta.requestId is filled by writeError.
func errorResponse(err error) (status int, body oapi.ErrorResponse) {
	var (
		validation apperr.Validation
		stale      apperr.StaleVersion
		badReq     badRequestError
		tooLarge   *http.MaxBytesError
		throttled  *accessgate.ThrottledError
	)
	status, code, field, message := http.StatusInternalServerError, oapi.ErrorCodeInternalError, "", "Unexpected error; see server logs."
	switch {
	case errors.Is(err, apperr.ErrNotFound):
		status, code, message = http.StatusNotFound, oapi.ErrorCodeNotFound, "The requested resource does not exist."
	case errors.As(err, &stale): // before the generic conflict: it names the plan
		status, code, field, message = http.StatusConflict, oapi.ErrorCodeVersionConflict, "plans",
			fmt.Sprintf("Plan %d was changed by someone else (current version %d).", stale.Capacity, stale.Current)
	case errors.Is(err, apperr.ErrVersionConflict):
		status, code, field, message = http.StatusConflict, oapi.ErrorCodeVersionConflict, "version",
			"The resource was changed meanwhile; refetch and retry."
	case errors.Is(err, apperr.ErrDuplicateName):
		status, code, field, message = http.StatusUnprocessableEntity, oapi.ErrorCodeDuplicateName, "firstName",
			"A guest with this name already exists."
	case errors.As(err, &validation):
		status, code, field, message = http.StatusUnprocessableEntity, oapi.ErrorCodeValidationFailed, validation.Field, validation.Message
	case errors.As(err, &badReq):
		status, code, field, message = http.StatusBadRequest, oapi.ErrorCodeBadRequest, badReq.field, badReq.message
	case errors.As(err, &tooLarge):
		status, code, message = http.StatusRequestEntityTooLarge, oapi.ErrorCodePayloadTooLarge, "The request body is too large."
	case errors.Is(err, accessgate.ErrUnauthenticated):
		status, code, message = http.StatusUnauthorized, oapi.ErrorCodeUnauthenticated, "PIN required."
	case errors.Is(err, accessgate.ErrInvalidPIN):
		status, code, field, message = http.StatusUnauthorized, oapi.ErrorCodeInvalidPin, "pin", "Wrong PIN."
	case errors.As(err, &throttled):
		status, code, message = http.StatusTooManyRequests, oapi.ErrorCodeTooManyAttempts, "Too many attempts; try again later."
	case errors.Is(err, accessgate.ErrCSRF):
		status, code, message = http.StatusForbidden, oapi.ErrorCodeCsrfHeaderMissing, "Missing X-Stoliki-Request header."
	case errors.Is(err, errMethodNotAllowed):
		status, code, message = http.StatusMethodNotAllowed, oapi.ErrorCodeBadRequest, "Method not allowed for this path."
	case errors.Is(err, errNotImplemented):
		status, message = http.StatusNotImplemented, "This endpoint is not implemented yet."
	}

	item := oapi.ErrorItem{Code: code, Message: message, Field: nullable.NewNullNullable[string]()}
	if field != "" {
		item.Field = nullable.NewNullableWithValue(field)
	}
	return status, oapi.ErrorResponse{Errors: []oapi.ErrorItem{item}}
}

// writeError renders err as the error envelope with the request id in meta.
// Server-side failures are logged with the request id and the cause (never request bodies).
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, body := errorResponse(err)
	id := middleware.GetReqID(r.Context())
	body.Meta = oapi.Meta{RequestId: &id}
	if status >= http.StatusInternalServerError {
		slog.Error("request failed", "requestId", id, "status", status, "err", err)
	}
	var throttled *accessgate.ThrottledError
	if errors.As(err, &throttled) {
		w.Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds(throttled.RetryAfter)))
	}
	writeJSON(w, status, body)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// requestErrorHandler handles strict-server request decoding failures: an over-limit body is
// 413, anything else (unparseable JSON, wrong content type) is 400. The decoder's message is
// not echoed because it can quote request content.
func requestErrorHandler(w http.ResponseWriter, r *http.Request, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeError(w, r, err)
		return
	}
	writeError(w, r, badRequest("", "Request body is not valid JSON."))
}

// paramErrorHandler handles path/query parameter binding failures (always 400, field = parameter).
func paramErrorHandler(w http.ResponseWriter, r *http.Request, err error) {
	var (
		invalid  *oapi.InvalidParamFormatError
		required *oapi.RequiredParamError
		many     *oapi.TooManyValuesForParamError
	)
	field := ""
	switch {
	case errors.As(err, &invalid):
		field = invalid.ParamName
	case errors.As(err, &required):
		field = required.ParamName
	case errors.As(err, &many):
		field = many.ParamName
	}
	msg := "Invalid request parameter."
	if field != "" {
		msg = "Parameter " + field + " is missing or malformed."
	}
	writeError(w, r, badRequest(field, msg))
}

// errMethodNotAllowed: a known /api path called with the wrong method (405, bad_request).
var errMethodNotAllowed = errors.New("method not allowed")

// retryAfterSeconds rounds a lock duration up to whole seconds, at least 1 (Retry-After header).
func retryAfterSeconds(d time.Duration) int {
	return max(1, int((d+time.Second-1)/time.Second))
}
