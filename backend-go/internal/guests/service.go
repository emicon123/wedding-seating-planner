package guests

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/seating"
)

// Field limits mirror the CHECK constraints of the guest table and the OpenAPI schema.
const (
	maxNameLen  = 100
	maxNotesLen = 2000
)

// Store is the persistence the Service needs; *store.Guests implements it. Declared here
// (consumer side) so that store can import this package without a cycle.
type Store interface {
	List(ctx context.Context) ([]Guest, []Link, error)
	Get(ctx context.Context, id int64) (Guest, error)
	Create(ctx context.Context, g NewGuest) (Guest, error)
	Update(ctx context.Context, g Guest, expectedVersion int64) (Guest, error)
	SetEnabled(ctx context.Context, ids []int64, enabled bool) ([]Guest, error)
	Delete(ctx context.Context, id int64) error
	UpsertLink(ctx context.Context, l Link) (Link, error)
	DeleteLink(ctx context.Context, a, b int64) error
}

// Service validates guest input and orchestrates the store. It holds no state.
type Service struct{ store Store }

func NewService(s Store) *Service { return &Service{store: s} }

// List returns every guest (ordered by name key) and every link.
func (s *Service) List(ctx context.Context) ([]Guest, []Link, error) {
	return s.store.List(ctx)
}

// Create trims and validates the input, then stores the guest (a new guest has no links).
func (s *Service) Create(ctx context.Context, in NewGuest) (Guest, error) {
	first, err := validFirstName(in.FirstName)
	if err != nil {
		return Guest{}, err
	}
	last, err := validLastName(in.LastName)
	if err != nil {
		return Guest{}, err
	}
	if err := validNotes(in.Notes); err != nil {
		return Guest{}, err
	}
	in.FirstName, in.LastName = first, last
	return s.store.Create(ctx, in)
}

// Update applies p to the guest, guarded by the client's version (optimistic lock), and
// returns the guest with the links touching it.
func (s *Service) Update(ctx context.Context, id int64, p Patch, version int64) (Guest, []Link, error) {
	g, err := s.store.Get(ctx, id)
	if err != nil {
		return Guest{}, nil, err
	}
	if p.FirstName != nil {
		if g.FirstName, err = validFirstName(*p.FirstName); err != nil {
			return Guest{}, nil, err
		}
	}
	switch {
	case p.ClearLastName:
		g.LastName = nil
	case p.LastName != nil:
		if g.LastName, err = validLastName(p.LastName); err != nil {
			return Guest{}, nil, err
		}
	}
	if p.Notes != nil {
		if err := validNotes(*p.Notes); err != nil {
			return Guest{}, nil, err
		}
		g.Notes = *p.Notes
	}
	if p.IsChild != nil {
		g.IsChild = *p.IsChild
	}
	if p.Enabled != nil {
		g.Enabled = *p.Enabled
	}
	updated, err := s.store.Update(ctx, g, version)
	if err != nil {
		return Guest{}, nil, err
	}
	links, err := s.linksTouching(ctx, updated.ID)
	if err != nil {
		return Guest{}, nil, err
	}
	return updated, links, nil
}

// Toggle enables or disables the listed guests (duplicates collapsed, no version check: last
// write wins) and returns them with the links touching them. Any unknown id changes nothing.
func (s *Service) Toggle(ctx context.Context, ids []int64, enabled bool) ([]Guest, []Link, error) {
	ids = unique(ids)
	if len(ids) == 0 {
		return nil, nil, apperr.Validation{Field: "guestIds", Message: "At least one guest id is required."}
	}
	gs, err := s.store.SetEnabled(ctx, ids, enabled)
	if err != nil {
		return nil, nil, err
	}
	links, err := s.linksTouching(ctx, ids...)
	if err != nil {
		return nil, nil, err
	}
	return gs, links, nil
}

// Delete removes the guest with its links and assignments.
func (s *Service) Delete(ctx context.Context, id int64) error {
	return s.store.Delete(ctx, id)
}

// SetLink creates or replaces the single link of the pair (given in either order).
func (s *Service) SetLink(ctx context.Context, a, b int64, level seating.LinkLevel) (Link, error) {
	l, err := NewLink(a, b, level)
	if err != nil {
		return Link{}, err
	}
	return s.store.UpsertLink(ctx, l)
}

// DeleteLink removes the link of the pair (given in either order).
func (s *Service) DeleteLink(ctx context.Context, a, b int64) error {
	l, err := NewLink(a, b, seating.Must) // normalises and rejects a self link
	if err != nil {
		return err
	}
	return s.store.DeleteLink(ctx, l.A, l.B)
}

// Graph builds the cluster graph over all guests (GET /clusters). Built by the one function
// seating.BuildGraph via ToSeating, never duplicated.
func (s *Service) Graph(ctx context.Context) (seating.Graph, error) {
	gs, ls, err := s.store.List(ctx)
	if err != nil {
		return seating.Graph{}, err
	}
	sg, sl := ToSeating(gs, ls)
	return seating.BuildGraph(sg, sl), nil
}

// linksTouching returns the links with at least one end among ids.
func (s *Service) linksTouching(ctx context.Context, ids ...int64) ([]Link, error) {
	_, all, err := s.store.List(ctx)
	if err != nil {
		return nil, err
	}
	want := make(map[int64]bool, len(ids))
	for _, id := range ids {
		want[id] = true
	}
	var out []Link
	for _, l := range all {
		if want[l.A] || want[l.B] {
			out = append(out, l)
		}
	}
	return out, nil
}

func validFirstName(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", apperr.Validation{Field: "firstName", Message: "First name must not be empty."}
	}
	if utf8.RuneCountInString(s) > maxNameLen {
		return "", apperr.Validation{Field: "firstName", Message: "First name must be at most 100 characters."}
	}
	return s, nil
}

// validLastName trims a present surname; an empty one is an error (use null to clear it).
func validLastName(s *string) (*string, error) {
	if s == nil {
		return nil, nil
	}
	v := strings.TrimSpace(*s)
	if v == "" {
		return nil, apperr.Validation{Field: "lastName", Message: "Last name must not be empty; send null to clear it."}
	}
	if utf8.RuneCountInString(v) > maxNameLen {
		return nil, apperr.Validation{Field: "lastName", Message: "Last name must be at most 100 characters."}
	}
	return &v, nil
}

func validNotes(s string) error {
	if utf8.RuneCountInString(s) > maxNotesLen {
		return apperr.Validation{Field: "notes", Message: "Notes must be at most 2000 characters."}
	}
	return nil
}

func unique(ids []int64) []int64 {
	seen := make(map[int64]bool, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}
