package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/guests"
	"github.com/wojtekrpi/stoliki/backend-go/internal/scenarios"
	"github.com/wojtekrpi/stoliki/backend-go/internal/seating"
	"github.com/wojtekrpi/stoliki/backend-go/internal/store/sqlcgen"
)

// Guests is the Guest aggregate store (guest rows + their links). It implements guests.Store
// and scenarios.GuestSource. Every method is exactly one transaction.
type Guests struct{ db *sql.DB }

func NewGuests(db *sql.DB) *Guests { return &Guests{db: db} }

// List returns all guests ordered by name_key and all links.
func (s *Guests) List(ctx context.Context) ([]guests.Guest, []guests.Link, error) {
	var (
		gs []guests.Guest
		ls []guests.Link
	)
	err := withTx(ctx, s.db, func(q *sqlcgen.Queries) error {
		rows, err := q.ListGuests(ctx)
		if err != nil {
			return err
		}
		if gs, err = rowsToGuests(rows); err != nil {
			return err
		}
		linkRows, err := q.ListGuestLinks(ctx)
		if err != nil {
			return err
		}
		ls = make([]guests.Link, len(linkRows))
		for i, r := range linkRows {
			ls[i] = rowToLink(r)
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return gs, ls, nil
}

// Get returns one guest or apperr.ErrNotFound.
func (s *Guests) Get(ctx context.Context, id int64) (guests.Guest, error) {
	var g guests.Guest
	err := withTx(ctx, s.db, func(q *sqlcgen.Queries) (err error) {
		g, err = getGuest(ctx, q, id)
		return err
	})
	return g, err
}

// Create inserts a guest (version 1). A taken name gives apperr.ErrDuplicateName.
func (s *Guests) Create(ctx context.Context, in guests.NewGuest) (guests.Guest, error) {
	var g guests.Guest
	err := withTx(ctx, s.db, func(q *sqlcgen.Queries) error {
		row, err := q.CreateGuest(ctx, sqlcgen.CreateGuestParams{
			FirstName: in.FirstName,
			LastName:  nullString(in.LastName),
			NameKey:   guests.NameKey(in.FirstName, in.LastName),
			Notes:     in.Notes,
			IsChild:   boolInt(in.IsChild),
			Enabled:   boolInt(in.Enabled),
		})
		if err != nil {
			return err
		}
		g, err = rowToGuest(row)
		return err
	})
	return g, err
}

// Update writes g's editable fields when the stored version equals expectedVersion and bumps
// the version. A missing id gives ErrNotFound, a stale version ErrVersionConflict.
func (s *Guests) Update(ctx context.Context, g guests.Guest, expectedVersion int64) (guests.Guest, error) {
	var out guests.Guest
	err := withTx(ctx, s.db, func(q *sqlcgen.Queries) error {
		row, err := q.UpdateGuest(ctx, sqlcgen.UpdateGuestParams{
			FirstName: g.FirstName,
			LastName:  nullString(g.LastName),
			NameKey:   guests.NameKey(g.FirstName, g.LastName),
			Notes:     g.Notes,
			IsChild:   boolInt(g.IsChild),
			Enabled:   boolInt(g.Enabled),
			ID:        g.ID,
			Version:   expectedVersion,
		})
		if errors.Is(err, sql.ErrNoRows) {
			// Tell a missing guest from a stale version. Same transaction: only q, never s.db.
			if _, getErr := q.GetGuest(ctx, g.ID); getErr != nil {
				return getErr // sql.ErrNoRows -> ErrNotFound
			}
			return apperr.ErrVersionConflict
		}
		if err != nil {
			return err
		}
		out, err = rowToGuest(row)
		return err
	})
	return out, err
}

// SetEnabled sets the enabled flag of every listed guest and bumps the version of those that
// actually changed. It returns the guests in the order given. If any id does not exist
// nothing is changed and apperr.ErrNotFound is returned.
func (s *Guests) SetEnabled(ctx context.Context, ids []int64, enabled bool) ([]guests.Guest, error) {
	var out []guests.Guest
	err := withTx(ctx, s.db, func(q *sqlcgen.Queries) error {
		for _, id := range ids {
			if _, err := q.GetGuest(ctx, id); err != nil {
				return err // sql.ErrNoRows -> ErrNotFound; the transaction rolls back
			}
		}
		for _, id := range ids {
			if _, err := q.SetGuestEnabled(ctx, sqlcgen.SetGuestEnabledParams{Enabled: boolInt(enabled), ID: id}); err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err // sql.ErrNoRows here only means "already in that state"
			}
		}
		out = make([]guests.Guest, 0, len(ids))
		for _, id := range ids {
			g, err := getGuest(ctx, q, id)
			if err != nil {
				return err
			}
			out = append(out, g)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Delete removes the guest; links and assignments go with it (ON DELETE CASCADE).
func (s *Guests) Delete(ctx context.Context, id int64) error {
	return withTx(ctx, s.db, func(q *sqlcgen.Queries) error {
		n, err := q.DeleteGuest(ctx, id)
		if err != nil {
			return err
		}
		if n == 0 {
			return apperr.ErrNotFound
		}
		return nil
	})
}

// UpsertLink stores the single link of the pair l.A < l.B, replacing its level when it exists.
// An unknown guest gives apperr.ErrNotFound.
func (s *Guests) UpsertLink(ctx context.Context, l guests.Link) (guests.Link, error) {
	var out guests.Link
	err := withTx(ctx, s.db, func(q *sqlcgen.Queries) error {
		row, err := q.UpsertGuestLink(ctx, sqlcgen.UpsertGuestLinkParams{
			GuestAID: l.A, GuestBID: l.B, Level: int64(l.Level),
		})
		if err != nil {
			return err
		}
		out = rowToLink(row)
		return nil
	})
	return out, err
}

// DeleteLink removes the link of the pair; a pair without a link gives apperr.ErrNotFound.
func (s *Guests) DeleteLink(ctx context.Context, a, b int64) error {
	return withTx(ctx, s.db, func(q *sqlcgen.Queries) error {
		n, err := q.DeleteGuestLink(ctx, sqlcgen.DeleteGuestLinkParams{GuestAID: a, GuestBID: b})
		if err != nil {
			return err
		}
		if n == 0 {
			return apperr.ErrNotFound
		}
		return nil
	})
}

func getGuest(ctx context.Context, q *sqlcgen.Queries, id int64) (guests.Guest, error) {
	row, err := q.GetGuest(ctx, id)
	if err != nil {
		return guests.Guest{}, err
	}
	return rowToGuest(row)
}

func rowsToGuests(rows []sqlcgen.Guest) ([]guests.Guest, error) {
	out := make([]guests.Guest, len(rows))
	for i, r := range rows {
		g, err := rowToGuest(r)
		if err != nil {
			return nil, err
		}
		out[i] = g
	}
	return out, nil
}

func rowToGuest(r sqlcgen.Guest) (guests.Guest, error) {
	created, err := time.Parse(time.RFC3339Nano, r.CreatedAt)
	if err != nil {
		return guests.Guest{}, fmt.Errorf("guest %d created_at: %w", r.ID, err)
	}
	updated, err := time.Parse(time.RFC3339Nano, r.UpdatedAt)
	if err != nil {
		return guests.Guest{}, fmt.Errorf("guest %d updated_at: %w", r.ID, err)
	}
	g := guests.Guest{
		ID:        r.ID,
		FirstName: r.FirstName,
		Notes:     r.Notes,
		IsChild:   r.IsChild != 0,
		Enabled:   r.Enabled != 0,
		Version:   r.Version,
		CreatedAt: created,
		UpdatedAt: updated,
	}
	if r.LastName.Valid {
		g.LastName = &r.LastName.String
	}
	return g, nil
}

func rowToLink(r sqlcgen.GuestLink) guests.Link {
	return guests.Link{A: r.GuestAID, B: r.GuestBID, Level: seating.LinkLevel(r.Level)}
}

func nullString(s *string) sql.NullString {
	if s == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *s, Valid: true}
}

func boolInt(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

var (
	_ guests.Store          = (*Guests)(nil)
	_ scenarios.GuestSource = (*Guests)(nil)
)
