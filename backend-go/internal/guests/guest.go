// Package guests holds the guest-list domain: the Guest and Link types, the Service that
// validates and orchestrates, and the Store interface the SQLite store implements.
// It holds no sqlc rows and no OpenAPI DTOs (docs/architecture/04-data-model.md).
package guests

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/seating"
)

// Guest is a person who may attend. Links are not part of it: they are loaded once for the
// whole list and projected onto both guests by the HTTP mapper.
type Guest struct {
	ID        int64
	FirstName string
	LastName  *string // nil = no surname
	Notes     string
	IsChild   bool
	Enabled   bool
	Version   int64
	CreatedAt time.Time
	UpdatedAt time.Time
}

// DisplayName is FirstName plus, when present, " " + LastName.
func (g Guest) DisplayName() string {
	if g.LastName == nil {
		return g.FirstName
	}
	return g.FirstName + " " + *g.LastName
}

// NameKey is the uniqueness key of a guest: the lower-cased, trimmed display name. It is
// computed here and not in SQL because SQLite lower() does not fold Polish letters.
func NameKey(first string, last *string) string {
	display := strings.TrimSpace(first)
	if last != nil {
		display += " " + strings.TrimSpace(*last)
	}
	return strings.ToLower(strings.TrimSpace(display))
}

// NewGuest is the input of Create (already trimmed and validated by the Service).
type NewGuest struct {
	FirstName string
	LastName  *string
	Notes     string
	IsChild   bool
	Enabled   bool
}

// Patch is a partial update. A nil field is unchanged; ClearLastName removes the surname
// (a non-nil LastName replaces it).
type Patch struct {
	FirstName     *string
	LastName      *string
	ClearLastName bool
	Notes         *string
	IsChild       *bool
	Enabled       *bool
}

// Link is an undirected relation between two guests; NewLink guarantees A < B.
type Link struct {
	A, B  int64
	Level seating.LinkLevel
}

// NewLink normalises the pair so that A < B and rejects a self link and unknown levels.
func NewLink(a, b int64, level seating.LinkLevel) (Link, error) {
	if a == b {
		return Link{}, apperr.Validation{Field: "linkKey", Message: "A guest cannot be linked to themselves."}
	}
	if level < seating.Must || level > seating.Acceptable {
		return Link{}, apperr.Validation{Field: "level", Message: "Level must be 0, 1 or 2."}
	}
	if a > b {
		a, b = b, a
	}
	return Link{A: a, B: b, Level: level}, nil
}

// Key is the canonical "A-B" form used in the API path.
func (l Link) Key() string { return fmt.Sprintf("%d-%d", l.A, l.B) }

// ErrInvalidLinkKey: the link key is not "{id}-{id}" with positive integers (HTTP 400).
var ErrInvalidLinkKey = errors.New("invalid link key")

// ParseLinkKey splits "x-y" into its two ids without normalising or comparing them:
// ordering and the self-link rule belong to NewLink.
func ParseLinkKey(s string) (a, b int64, err error) {
	left, right, ok := strings.Cut(s, "-")
	if !ok {
		return 0, 0, ErrInvalidLinkKey
	}
	if a, err = parseID(left); err != nil {
		return 0, 0, err
	}
	if b, err = parseID(right); err != nil {
		return 0, 0, err
	}
	return a, b, nil
}

// parseID accepts only plain positive decimal digits (no sign, no spaces).
func parseID(s string) (int64, error) {
	if s == "" || strings.TrimLeft(s, "0123456789") != "" {
		return 0, ErrInvalidLinkKey
	}
	id, err := strconv.ParseInt(s, 10, 64)
	if err != nil || id < 1 {
		return 0, ErrInvalidLinkKey
	}
	return id, nil
}

// ToSeating projects guests and links onto the plain values the seating core takes.
// The one place where the guest list becomes seating input (used by clusters and plans).
func ToSeating(gs []Guest, ls []Link) ([]seating.Guest, []seating.Link) {
	sg := make([]seating.Guest, len(gs))
	for i, g := range gs {
		sg[i] = seating.Guest{ID: g.ID, Enabled: g.Enabled}
	}
	sl := make([]seating.Link, len(ls))
	for i, l := range ls {
		sl[i] = seating.Link{A: l.A, B: l.B, Level: l.Level}
	}
	return sg, sl
}
