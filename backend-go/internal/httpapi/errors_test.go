package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
)

// Every row of the "Domain errors -> error envelope" table in docs/architecture/04-data-model.md
// (import_invalid is deferred with B-12).
func TestErrorResponse(t *testing.T) {
	str := func(s string) *string { return &s }
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   oapi.ErrorCode
		wantField  *string
	}{
		{"not found", apperr.ErrNotFound, http.StatusNotFound, oapi.ErrorCodeNotFound, nil},
		{"wrapped not found", fmt.Errorf("guest 7: %w", apperr.ErrNotFound), http.StatusNotFound, oapi.ErrorCodeNotFound, nil},
		{"version conflict", apperr.ErrVersionConflict, http.StatusConflict, oapi.ErrorCodeVersionConflict, str("version")},
		{"duplicate name", apperr.ErrDuplicateName, http.StatusUnprocessableEntity, oapi.ErrorCodeDuplicateName, str("firstName")},
		{"validation", apperr.Validation{Field: "firstName", Message: "must not be empty"}, http.StatusUnprocessableEntity, oapi.ErrorCodeValidationFailed, str("firstName")},
		{"wrapped validation", fmt.Errorf("create: %w", apperr.Validation{Field: "notes", Message: "too long"}), http.StatusUnprocessableEntity, oapi.ErrorCodeValidationFailed, str("notes")},
		{"bad request", badRequest("guestId", "must be an integer"), http.StatusBadRequest, oapi.ErrorCodeBadRequest, str("guestId")},
		{"bad request without field", badRequest("", "Request body is not valid JSON."), http.StatusBadRequest, oapi.ErrorCodeBadRequest, nil},
		{"body too large", &http.MaxBytesError{Limit: 1 << 20}, http.StatusRequestEntityTooLarge, oapi.ErrorCodePayloadTooLarge, nil},
		{"wrapped body too large", fmt.Errorf("decode: %w", &http.MaxBytesError{Limit: 1}), http.StatusRequestEntityTooLarge, oapi.ErrorCodePayloadTooLarge, nil},
		{"method not allowed", errMethodNotAllowed, http.StatusMethodNotAllowed, oapi.ErrorCodeBadRequest, nil},
		{"not implemented", errNotImplemented, http.StatusNotImplemented, oapi.ErrorCodeInternalError, nil},
		{"anything else", errors.New("pq: connection refused to 10.0.0.1"), http.StatusInternalServerError, oapi.ErrorCodeInternalError, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			status, body := errorResponse(tc.err)
			if status != tc.wantStatus {
				t.Errorf("status = %d, want %d", status, tc.wantStatus)
			}
			if len(body.Errors) != 1 {
				t.Fatalf("errors = %d, want 1", len(body.Errors))
			}
			item := body.Errors[0]
			if item.Code != tc.wantCode {
				t.Errorf("code = %q, want %q", item.Code, tc.wantCode)
			}
			got := fieldOf(item)
			switch {
			case tc.wantField == nil && got != nil:
				t.Errorf("field = %q, want null", *got)
			case tc.wantField != nil && (got == nil || *got != *tc.wantField):
				t.Errorf("field = %v, want %q", got, *tc.wantField)
			}
			if item.Message == "" {
				t.Error("message is empty")
			}
		})
	}

	t.Run("internal errors never leak the cause", func(t *testing.T) {
		_, body := errorResponse(errors.New("password=hunter2"))
		if m := body.Errors[0].Message; m == "" || strings.Contains(m, "hunter2") {
			t.Errorf("message = %q", m)
		}
	})
}

// fieldOf reads ErrorItem.Field: nil when it is JSON null.
func fieldOf(item oapi.ErrorItem) *string {
	if item.Field.IsNull() || !item.Field.IsSpecified() {
		return nil
	}
	v := item.Field.MustGet()
	return &v
}
