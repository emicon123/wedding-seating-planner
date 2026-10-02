package httpapi

import (
	"context"
	"errors"

	"github.com/wojtekrpi/stoliki/backend-go/internal/guests"
	"github.com/wojtekrpi/stoliki/backend-go/internal/httpapi/oapi"
)

// ListGuests implements listGuests: the whole list with embedded links.
func (s *Server) ListGuests(ctx context.Context, _ oapi.ListGuestsRequestObject) (oapi.ListGuestsResponseObject, error) {
	gs, ls, err := s.guests.List(ctx)
	if err != nil {
		return nil, err
	}
	return oapi.ListGuests200JSONResponse(guestList(ctx, gs, ls)), nil
}

// CreateGuest implements createGuest.
func (s *Server) CreateGuest(ctx context.Context, req oapi.CreateGuestRequestObject) (oapi.CreateGuestResponseObject, error) {
	if req.Body == nil {
		return nil, badRequest("", "Request body is required.")
	}
	in := guests.NewGuest{
		FirstName: req.Body.FirstName,
		Notes:     deref(req.Body.Notes, ""),
		IsChild:   deref(req.Body.IsChild, false),
		Enabled:   deref(req.Body.Enabled, true),
	}
	if req.Body.LastName.IsSpecified() && !req.Body.LastName.IsNull() {
		v := req.Body.LastName.MustGet()
		in.LastName = &v
	}
	g, err := s.guests.Create(ctx, in)
	if err != nil {
		return nil, err
	}
	return oapi.CreateGuest201JSONResponse{Data: toGuest(g, nil), Meta: metaOf(ctx)}, nil
}

// UpdateGuest implements updateGuest: partial, version-checked; lastName null clears it.
func (s *Server) UpdateGuest(ctx context.Context, req oapi.UpdateGuestRequestObject) (oapi.UpdateGuestResponseObject, error) {
	if req.Body == nil {
		return nil, badRequest("", "Request body is required.")
	}
	if req.Body.Version < 1 {
		return nil, badRequest("version", "version is required and must be at least 1.")
	}
	patch := guests.Patch{
		FirstName: req.Body.FirstName,
		Notes:     req.Body.Notes,
		IsChild:   req.Body.IsChild,
		Enabled:   req.Body.Enabled,
	}
	if req.Body.LastName.IsSpecified() {
		if req.Body.LastName.IsNull() {
			patch.ClearLastName = true
		} else {
			v := req.Body.LastName.MustGet()
			patch.LastName = &v
		}
	}
	g, links, err := s.guests.Update(ctx, req.GuestId, patch, int64(req.Body.Version))
	if err != nil {
		return nil, err
	}
	return oapi.UpdateGuest200JSONResponse{Data: toGuestList([]guests.Guest{g}, links)[0], Meta: metaOf(ctx)}, nil
}

// ToggleGuests implements toggleGuests: bulk enable/disable, no version check.
func (s *Server) ToggleGuests(ctx context.Context, req oapi.ToggleGuestsRequestObject) (oapi.ToggleGuestsResponseObject, error) {
	if req.Body == nil || len(req.Body.GuestIds) == 0 {
		return nil, badRequest("guestIds", "guestIds must contain at least one id.")
	}
	gs, links, err := s.guests.Toggle(ctx, req.Body.GuestIds, req.Body.Enabled)
	if err != nil {
		return nil, err
	}
	return oapi.ToggleGuests200JSONResponse(guestList(ctx, gs, links)), nil
}

// DeleteGuest implements deleteGuest.
func (s *Server) DeleteGuest(ctx context.Context, req oapi.DeleteGuestRequestObject) (oapi.DeleteGuestResponseObject, error) {
	if err := s.guests.Delete(ctx, req.GuestId); err != nil {
		return nil, err
	}
	return oapi.DeleteGuest204Response{}, nil
}

func guestList(ctx context.Context, gs []guests.Guest, ls []guests.Link) oapi.GuestListResponse {
	total := len(gs)
	return oapi.GuestListResponse{Data: toGuestList(gs, ls), Meta: metaOf(ctx), Page: oapi.Page{Total: &total}}
}

func deref[T any](p *T, def T) T {
	if p == nil {
		return def
	}
	return *p
}

// linkEnds parses the {idA}-{idB} path parameter; a malformed key is a 400 on linkKey.
func linkEnds(key oapi.LinkKey) (a, b int64, err error) {
	a, b, err = guests.ParseLinkKey(key)
	if errors.Is(err, guests.ErrInvalidLinkKey) {
		return 0, 0, badRequest("linkKey", "linkKey must look like {idA}-{idB}.")
	}
	return a, b, err
}
