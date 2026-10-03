// Package apperr holds the domain error values shared by services, stores and the HTTP layer.
// The HTTP layer maps them to the error envelope in exactly one place (httpapi.errorResponse).
package apperr

import (
	"errors"
	"fmt"
)

var (
	// ErrNotFound: the referenced resource does not exist.
	ErrNotFound = errors.New("not found")
	// ErrVersionConflict: the optimistic-lock version sent by the client is stale.
	ErrVersionConflict = errors.New("version conflict")
	// ErrDuplicateName: a guest with the same normalised name (name_key) already exists.
	ErrDuplicateName = errors.New("duplicate name")
)

// Validation is a business-rule violation tied to one input field.
type Validation struct {
	Field   string
	Message string
}

func (v Validation) Error() string {
	return fmt.Sprintf("validation failed: %s: %s", v.Field, v.Message)
}

// StaleVersion is a version conflict on one plan of a bulk replace: the client's basedOnVersion
// no longer matches the stored one. It matches ErrVersionConflict under errors.Is and carries
// what the error envelope needs to name the plan.
type StaleVersion struct {
	Plan    string // plan key as in the API: "9".."12" or "mixed"
	Current int64
}

func (e StaleVersion) Error() string {
	return fmt.Sprintf("version conflict: plan %s is at version %d", e.Plan, e.Current)
}

func (e StaleVersion) Is(target error) bool { return target == ErrVersionConflict }
