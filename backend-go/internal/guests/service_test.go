package guests_test

import (
	"context"
	"errors"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/guests"
	"github.com/wojtekrpi/stoliki/backend-go/internal/store"
)

func ptr[T any](v T) *T { return &v }

// newService wires the real Service over a real migrated SQLite file (no DB mocks).
func newService(t *testing.T) *guests.Service {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "stoliki.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := store.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	return guests.NewService(store.NewGuests(db))
}

func create(t *testing.T, s *guests.Service, first string, last *string) guests.Guest {
	t.Helper()
	g, err := s.Create(context.Background(), guests.NewGuest{FirstName: first, LastName: last, Enabled: true})
	if err != nil {
		t.Fatalf("Create %q: %v", first, err)
	}
	return g
}

func wantValidation(t *testing.T, err error, field string) {
	t.Helper()
	var v apperr.Validation
	if !errors.As(err, &v) || v.Field != field {
		t.Fatalf("err = %v, want Validation on %q", err, field)
	}
}

func TestServiceCreateValidatesAndTrims(t *testing.T) {
	ctx := context.Background()
	tests := []struct {
		name      string
		in        guests.NewGuest
		wantField string // "" = success
		wantFirst string
		wantLast  *string
	}{
		{name: "trims names", in: guests.NewGuest{FirstName: "  Ania ", LastName: ptr(" Nowak  "), Enabled: true}, wantFirst: "Ania", wantLast: ptr("Nowak")},
		{name: "no surname", in: guests.NewGuest{FirstName: "Maciek", Enabled: true}, wantFirst: "Maciek"},
		{name: "empty first name", in: guests.NewGuest{FirstName: ""}, wantField: "firstName"},
		{name: "blank first name", in: guests.NewGuest{FirstName: "   "}, wantField: "firstName"},
		{name: "first name too long", in: guests.NewGuest{FirstName: strings.Repeat("a", 101)}, wantField: "firstName"},
		{name: "first name at the limit counts characters", in: guests.NewGuest{FirstName: strings.Repeat("ż", 100)}, wantFirst: strings.Repeat("ż", 100)},
		{name: "empty-string last name", in: guests.NewGuest{FirstName: "A", LastName: ptr("")}, wantField: "lastName"},
		{name: "blank last name", in: guests.NewGuest{FirstName: "A", LastName: ptr("  ")}, wantField: "lastName"},
		{name: "last name too long", in: guests.NewGuest{FirstName: "A", LastName: ptr(strings.Repeat("a", 101))}, wantField: "lastName"},
		{name: "notes too long", in: guests.NewGuest{FirstName: "A", Notes: strings.Repeat("a", 2001)}, wantField: "notes"},
		{name: "notes at the limit", in: guests.NewGuest{FirstName: "A", Notes: strings.Repeat("a", 2000)}, wantFirst: "A"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := newService(t)
			got, err := s.Create(ctx, tc.in)
			if tc.wantField != "" {
				wantValidation(t, err, tc.wantField)
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.FirstName != tc.wantFirst || (got.LastName == nil) != (tc.wantLast == nil) ||
				(tc.wantLast != nil && *got.LastName != *tc.wantLast) {
				t.Errorf("got %q %v, want %q %v", got.FirstName, got.LastName, tc.wantFirst, tc.wantLast)
			}
		})
	}
}

func TestServiceCreateDuplicateNameIgnoresCaseAndSpace(t *testing.T) {
	s := newService(t)
	create(t, s, "Łukasz", ptr("Żak"))
	_, err := s.Create(context.Background(), guests.NewGuest{FirstName: " ŁUKASZ ", LastName: ptr("żak"), Enabled: true})
	if !errors.Is(err, apperr.ErrDuplicateName) {
		t.Fatalf("err = %v, want ErrDuplicateName", err)
	}
}

func TestServiceUpdate(t *testing.T) {
	ctx := context.Background()
	s := newService(t)
	g := create(t, s, "Ania", ptr("Nowak"))
	create(t, s, "Ewa", nil)

	t.Run("partial update applies only given fields and bumps the version", func(t *testing.T) {
		got, _, err := s.Update(ctx, g.ID, guests.Patch{Notes: ptr("wegetarianka"), IsChild: ptr(true)}, g.Version)
		if err != nil {
			t.Fatal(err)
		}
		if got.Notes != "wegetarianka" || !got.IsChild || got.FirstName != "Ania" || got.LastName == nil || *got.LastName != "Nowak" || !got.Enabled || got.Version != g.Version+1 {
			t.Errorf("got = %+v", got)
		}
		g = got
	})

	t.Run("a stale version is a conflict", func(t *testing.T) {
		_, _, err := s.Update(ctx, g.ID, guests.Patch{Notes: ptr("x")}, g.Version-1)
		if !errors.Is(err, apperr.ErrVersionConflict) {
			t.Errorf("err = %v, want ErrVersionConflict", err)
		}
	})

	t.Run("ClearLastName removes the surname", func(t *testing.T) {
		got, _, err := s.Update(ctx, g.ID, guests.Patch{ClearLastName: true}, g.Version)
		if err != nil || got.LastName != nil {
			t.Fatalf("got = %+v, %v", got, err)
		}
		g = got
	})

	t.Run("empty-string last name is a validation error", func(t *testing.T) {
		_, _, err := s.Update(ctx, g.ID, guests.Patch{LastName: ptr("")}, g.Version)
		wantValidation(t, err, "lastName")
	})

	t.Run("blank first name is a validation error", func(t *testing.T) {
		_, _, err := s.Update(ctx, g.ID, guests.Patch{FirstName: ptr(" ")}, g.Version)
		wantValidation(t, err, "firstName")
	})

	t.Run("renaming onto an existing name is a duplicate", func(t *testing.T) {
		_, _, err := s.Update(ctx, g.ID, guests.Patch{FirstName: ptr("EWA")}, g.Version)
		if !errors.Is(err, apperr.ErrDuplicateName) {
			t.Errorf("err = %v, want ErrDuplicateName", err)
		}
	})

	t.Run("missing guest", func(t *testing.T) {
		_, _, err := s.Update(ctx, 9999, guests.Patch{Notes: ptr("x")}, 1)
		if !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("enabled can be changed here too", func(t *testing.T) {
		got, _, err := s.Update(ctx, g.ID, guests.Patch{Enabled: ptr(false)}, g.Version)
		if err != nil || got.Enabled {
			t.Fatalf("got = %+v, %v", got, err)
		}
	})
}

func TestServiceUpdateReturnsTheGuestsLinks(t *testing.T) {
	ctx := context.Background()
	s := newService(t)
	a, b, c := create(t, s, "A", nil), create(t, s, "B", nil), create(t, s, "C", nil)
	if _, err := s.SetLink(ctx, a.ID, b.ID, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetLink(ctx, b.ID, c.ID, 0); err != nil {
		t.Fatal(err)
	}
	_, links, err := s.Update(ctx, a.ID, guests.Patch{Notes: ptr("x")}, a.Version)
	if err != nil {
		t.Fatal(err)
	}
	if len(links) != 1 || links[0] != (guests.Link{A: a.ID, B: b.ID, Level: 1}) {
		t.Errorf("links = %+v, want only the A-B link", links)
	}
}

func TestServiceToggle(t *testing.T) {
	ctx := context.Background()
	s := newService(t)
	a, b, c := create(t, s, "A", nil), create(t, s, "B", nil), create(t, s, "C", nil)

	t.Run("a single id", func(t *testing.T) {
		got, _, err := s.Toggle(ctx, []int64{a.ID}, false)
		if err != nil || len(got) != 1 || got[0].ID != a.ID || got[0].Enabled || got[0].Version != 2 {
			t.Fatalf("got = %+v, %v", got, err)
		}
	})
	t.Run("bulk without a version check", func(t *testing.T) {
		got, _, err := s.Toggle(ctx, []int64{a.ID, b.ID, c.ID}, false)
		if err != nil || len(got) != 3 {
			t.Fatalf("got = %+v, %v", got, err)
		}
		for _, g := range got {
			if g.Enabled {
				t.Errorf("guest %d still enabled", g.ID)
			}
		}
	})
	t.Run("duplicate ids are collapsed", func(t *testing.T) {
		got, _, err := s.Toggle(ctx, []int64{b.ID, b.ID}, true)
		if err != nil || len(got) != 1 || !got[0].Enabled {
			t.Fatalf("got = %+v, %v", got, err)
		}
	})
	t.Run("a missing id is not found and changes nothing", func(t *testing.T) {
		_, _, err := s.Toggle(ctx, []int64{c.ID, 9999}, true)
		if !errors.Is(err, apperr.ErrNotFound) {
			t.Fatalf("err = %v, want ErrNotFound", err)
		}
		_, _, err = s.Toggle(ctx, nil, true)
		wantValidation(t, err, "guestIds")
		gs, _, _ := s.List(ctx)
		for _, g := range gs {
			if g.ID == c.ID && g.Enabled {
				t.Error("c was enabled despite the failed toggle")
			}
		}
	})
}

func TestServiceDeleteAndLinks(t *testing.T) {
	ctx := context.Background()
	s := newService(t)
	a, b := create(t, s, "A", nil), create(t, s, "B", nil)

	t.Run("SetLink normalises and is symmetric", func(t *testing.T) {
		l, err := s.SetLink(ctx, b.ID, a.ID, 1)
		if err != nil || l != (guests.Link{A: a.ID, B: b.ID, Level: 1}) {
			t.Fatalf("link = %+v, %v", l, err)
		}
		l, err = s.SetLink(ctx, a.ID, b.ID, 2) // replaces, still one link
		if err != nil || l.Level != 2 {
			t.Fatalf("link = %+v, %v", l, err)
		}
		_, ls, _ := s.List(ctx)
		if len(ls) != 1 {
			t.Errorf("links = %+v, want 1", ls)
		}
	})
	t.Run("SetLink rejects self link, bad level and unknown guest", func(t *testing.T) {
		_, err := s.SetLink(ctx, a.ID, a.ID, 1)
		wantValidation(t, err, "linkKey")
		_, err = s.SetLink(ctx, a.ID, b.ID, 5)
		wantValidation(t, err, "level")
		if _, err = s.SetLink(ctx, a.ID, 9999, 1); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("unknown guest: %v, want ErrNotFound", err)
		}
	})
	t.Run("DeleteLink works from either order, then is not found", func(t *testing.T) {
		if err := s.DeleteLink(ctx, b.ID, a.ID); err != nil {
			t.Fatal(err)
		}
		if err := s.DeleteLink(ctx, a.ID, b.ID); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
		if err := s.DeleteLink(ctx, a.ID, a.ID); err == nil {
			t.Error("self link delete should fail")
		}
	})
	t.Run("Delete", func(t *testing.T) {
		if err := s.Delete(ctx, a.ID); err != nil {
			t.Fatal(err)
		}
		if err := s.Delete(ctx, a.ID); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
		gs, _, _ := s.List(ctx)
		if !slices.EqualFunc(gs, []guests.Guest{b}, func(x, y guests.Guest) bool { return x.ID == y.ID }) {
			t.Errorf("remaining = %+v", gs)
		}
	})
}

func TestServiceGraph(t *testing.T) {
	ctx := context.Background()
	s := newService(t)
	a, b, c := create(t, s, "A", nil), create(t, s, "B", nil), create(t, s, "C", nil)
	if _, err := s.SetLink(ctx, b.ID, a.ID, 0); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Toggle(ctx, []int64{b.ID}, false); err != nil {
		t.Fatal(err)
	}
	g, err := s.Graph(ctx)
	if err != nil {
		t.Fatal(err)
	}
	cl, ok := g.ClusterOf(b.ID)
	if !ok || cl.Key != a.ID || len(cl.Members) != 2 || cl.SeatedSize() != 1 {
		t.Errorf("cluster of B = %+v (%v), want {A,B} with 1 seat", cl, ok)
	}
	if cc, _ := g.ClusterOf(c.ID); len(cc.Members) != 1 {
		t.Errorf("C = %+v, want a cluster of one", cc)
	}
}
