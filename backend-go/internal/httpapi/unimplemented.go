package httpapi

import (
	"context"

	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
)

// unimplemented answers every operation whose ticket has not landed yet with errNotImplemented
// (HTTP 501 in the error envelope). Delete a method here when its ticket defines it on Server.
type unimplemented struct{}

func (unimplemented) ImportGuests(context.Context, oapi.ImportGuestsRequestObject) (oapi.ImportGuestsResponseObject, error) {
	return nil, errNotImplemented
}
