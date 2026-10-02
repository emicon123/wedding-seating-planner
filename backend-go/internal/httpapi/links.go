package httpapi

import (
	"context"

	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
	"github.com/wojtekrpi/stoliki/backend-go/internal/seating"
)

// UpsertGuestLink implements upsertGuestLink: one undirected link per pair, either key order.
func (s *Server) UpsertGuestLink(ctx context.Context, req oapi.UpsertGuestLinkRequestObject) (oapi.UpsertGuestLinkResponseObject, error) {
	a, b, err := linkEnds(req.LinkKey)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("", "Request body is required.")
	}
	l, err := s.guests.SetLink(ctx, a, b, seating.LinkLevel(req.Body.Level))
	if err != nil {
		return nil, err
	}
	return oapi.UpsertGuestLink200JSONResponse{Data: toLink(l), Meta: metaOf(ctx)}, nil
}

// DeleteGuestLink implements deleteGuestLink.
func (s *Server) DeleteGuestLink(ctx context.Context, req oapi.DeleteGuestLinkRequestObject) (oapi.DeleteGuestLinkResponseObject, error) {
	a, b, err := linkEnds(req.LinkKey)
	if err != nil {
		return nil, err
	}
	if err := s.guests.DeleteLink(ctx, a, b); err != nil {
		return nil, err
	}
	return oapi.DeleteGuestLink204Response{}, nil
}
