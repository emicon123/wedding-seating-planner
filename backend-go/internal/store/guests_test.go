package store

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strconv"
	"testing"

	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/guests"
)

func ptr[T any](v T) *T { return &v }

func newGuests(t *testing.T) (*Guests, *sql.DB) {
	t.Helper()
	db := openMigrated(t)
	return NewGuests(db), db
}

func mustCreate(t *testing.T, s *Guests, first string, last *string) guests.Guest {
	t.Helper()
	g, err := s.Create(context.Background(), guests.NewGuest{FirstName: first, LastName: last, Enabled: true})
	if err != nil {
		t.Fatalf("Create %q: %v", first, err)
	}
	return g
}

func ids(gs []guests.Guest) []int64 {
	out := make([]int64, len(gs))
	for i, g := range gs {
		out[i] = g.ID
	}
	return out
}

func TestGuestsCreateThenGet(t *testing.T) {
	ctx := context.Background()
	s, _ := newGuests(t)

	created, err := s.Create(ctx, guests.NewGuest{
		FirstName: "Łukasz", LastName: ptr("Żak"), Notes: "wegetarianin", IsChild: true, Enabled: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.Version != 1 || created.CreatedAt.IsZero() || created.UpdatedAt.IsZero() {
		t.Errorf("created = %+v", created)
	}
	got, err := s.Get(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.FirstName != "Łukasz" || got.LastName == nil || *got.LastName != "Żak" ||
		got.Notes != "wegetarianin" || !got.IsChild || got.Enabled || got.Version != 1 {
		t.Errorf("got = %+v", got)
	}

	noSurname := mustCreate(t, s, "Maciek", nil)
	if noSurname.LastName != nil {
		t.Errorf("LastName = %v, want nil", *noSurname.LastName)
	}

	if _, err := s.Get(ctx, 9999); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("Get missing = %v, want ErrNotFound", err)
	}
}

func TestGuestsCreateDuplicateName(t *testing.T) {
	ctx := context.Background()
	s, _ := newGuests(t)
	mustCreate(t, s, "Łukasz", ptr("Żak"))

	for _, tc := range []struct {
		first string
		last  *string
	}{
		{"łukasz", ptr("żak")},
		{"ŁUKASZ ", ptr(" ŻAK")},
	} {
		_, err := s.Create(ctx, guests.NewGuest{FirstName: tc.first, LastName: tc.last, Enabled: true})
		if !errors.Is(err, apperr.ErrDuplicateName) {
			t.Errorf("Create(%q, %v) = %v, want ErrDuplicateName", tc.first, tc.last, err)
		}
	}
	// Same first name with no surname is a different name.
	mustCreate(t, s, "Łukasz", nil)
}

func TestGuestsUpdate(t *testing.T) {
	ctx := context.Background()
	s, _ := newGuests(t)
	a := mustCreate(t, s, "Ania", ptr("Nowak"))
	mustCreate(t, s, "Ania", ptr("Kowalska"))

	t.Run("applies fields, bumps version, recomputes name key", func(t *testing.T) {
		g := a
		g.FirstName, g.LastName, g.Notes, g.IsChild = "Anna", nil, "n", true
		got, err := s.Update(ctx, g, a.Version)
		if err != nil {
			t.Fatal(err)
		}
		if got.Version != a.Version+1 || got.FirstName != "Anna" || got.LastName != nil || got.Notes != "n" || !got.IsChild {
			t.Errorf("got = %+v", got)
		}
		// The old name is free again, the new one is taken.
		if _, err := s.Create(ctx, guests.NewGuest{FirstName: "Ania", LastName: ptr("Nowak"), Enabled: true}); err != nil {
			t.Errorf("old name should be free: %v", err)
		}
		if _, err := s.Create(ctx, guests.NewGuest{FirstName: "anna", Enabled: true}); !errors.Is(err, apperr.ErrDuplicateName) {
			t.Errorf("new name should be taken: %v", err)
		}
	})

	t.Run("stale version", func(t *testing.T) {
		g := a
		g.Notes = "stale"
		if _, err := s.Update(ctx, g, a.Version); !errors.Is(err, apperr.ErrVersionConflict) {
			t.Errorf("err = %v, want ErrVersionConflict", err)
		}
		cur, _ := s.Get(ctx, a.ID)
		if cur.Notes == "stale" {
			t.Error("stale update was applied")
		}
	})

	t.Run("missing id", func(t *testing.T) {
		g := a
		g.ID = 9999
		if _, err := s.Update(ctx, g, 1); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("duplicate name", func(t *testing.T) {
		cur, _ := s.Get(ctx, a.ID)
		cur.FirstName, cur.LastName = "Ania", ptr("Kowalska")
		if _, err := s.Update(ctx, cur, cur.Version); !errors.Is(err, apperr.ErrDuplicateName) {
			t.Errorf("err = %v, want ErrDuplicateName", err)
		}
	})
}

func TestGuestsSetEnabled(t *testing.T) {
	ctx := context.Background()
	s, _ := newGuests(t)
	a := mustCreate(t, s, "A", nil)
	b := mustCreate(t, s, "B", nil)
	c := mustCreate(t, s, "C", nil)

	got, err := s.SetEnabled(ctx, []int64{c.ID, a.ID}, false)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(ids(got), []int64{c.ID, a.ID}) {
		t.Errorf("returned ids = %v, want request order", ids(got))
	}
	for _, g := range got {
		if g.Enabled || g.Version != 2 {
			t.Errorf("guest %d = %+v, want disabled with version 2", g.ID, g)
		}
	}
	if gb, _ := s.Get(ctx, b.ID); !gb.Enabled || gb.Version != 1 {
		t.Errorf("untouched guest changed: %+v", gb)
	}

	t.Run("an already-matching guest keeps its version", func(t *testing.T) {
		got, err := s.SetEnabled(ctx, []int64{a.ID, b.ID}, false)
		if err != nil {
			t.Fatal(err)
		}
		byID := map[int64]guests.Guest{}
		for _, g := range got {
			byID[g.ID] = g
		}
		if byID[a.ID].Version != 2 || byID[b.ID].Version != 2 || byID[b.ID].Enabled {
			t.Errorf("got = %+v", got)
		}
	})

	t.Run("a missing id changes nothing", func(t *testing.T) {
		before, _ := s.Get(ctx, b.ID)
		before2, _ := s.Get(ctx, a.ID)
		_, err := s.SetEnabled(ctx, []int64{b.ID, 9999, a.ID}, true)
		if !errors.Is(err, apperr.ErrNotFound) {
			t.Fatalf("err = %v, want ErrNotFound", err)
		}
		after, _ := s.Get(ctx, b.ID)
		after2, _ := s.Get(ctx, a.ID)
		if after != before || after2 != before2 {
			t.Errorf("state changed despite error: %+v -> %+v, %+v -> %+v", before, after, before2, after2)
		}
	})
}

func TestGuestsListOrdersByNameKey(t *testing.T) {
	ctx := context.Background()
	s, _ := newGuests(t)
	mustCreate(t, s, "Zofia", nil)
	mustCreate(t, s, "ania", ptr("Nowak"))
	mustCreate(t, s, "Ania", ptr("Kowalska"))

	gs, ls, err := s.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, g := range gs {
		names = append(names, g.DisplayName())
	}
	if !slices.Equal(names, []string{"Ania Kowalska", "ania Nowak", "Zofia"}) {
		t.Errorf("order = %v", names)
	}
	if len(ls) != 0 {
		t.Errorf("links = %v, want none", ls)
	}

	empty, _ := newGuests(t)
	gs, ls, err = empty.List(ctx)
	if err != nil || len(gs) != 0 || len(ls) != 0 {
		t.Errorf("empty list = %v %v %v", gs, ls, err)
	}
}

func TestGuestsLinks(t *testing.T) {
	ctx := context.Background()
	s, _ := newGuests(t)
	a := mustCreate(t, s, "A", nil)
	b := mustCreate(t, s, "B", nil)
	c := mustCreate(t, s, "C", nil)

	t.Run("upsert twice changes the level of the single stored link", func(t *testing.T) {
		l, err := s.UpsertLink(ctx, guests.Link{A: a.ID, B: b.ID, Level: 1})
		if err != nil || l.Level != 1 || l.A != a.ID || l.B != b.ID {
			t.Fatalf("first upsert = %+v, %v", l, err)
		}
		l, err = s.UpsertLink(ctx, guests.Link{A: a.ID, B: b.ID, Level: 0})
		if err != nil || l.Level != 0 {
			t.Fatalf("second upsert = %+v, %v", l, err)
		}
		_, ls, err := s.List(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if len(ls) != 1 || ls[0] != (guests.Link{A: a.ID, B: b.ID, Level: 0}) {
			t.Errorf("links = %+v", ls)
		}
	})

	t.Run("unknown guest", func(t *testing.T) {
		if _, err := s.UpsertLink(ctx, guests.Link{A: a.ID, B: 9999, Level: 1}); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("delete", func(t *testing.T) {
		if err := s.DeleteLink(ctx, a.ID, b.ID); err != nil {
			t.Fatal(err)
		}
		if err := s.DeleteLink(ctx, a.ID, b.ID); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("second delete = %v, want ErrNotFound", err)
		}
		if err := s.DeleteLink(ctx, a.ID, c.ID); !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("never-existing pair = %v, want ErrNotFound", err)
		}
	})
}

func TestGuestsDeleteCascades(t *testing.T) {
	ctx := context.Background()
	s, db := newGuests(t)
	a := mustCreate(t, s, "A", nil)
	b := mustCreate(t, s, "B", nil)
	if _, err := s.UpsertLink(ctx, guests.Link{A: a.ID, B: b.ID, Level: 0}); err != nil {
		t.Fatal(err)
	}
	// A seat in the 9-seat plan (assignments are written by B-09; raw SQL here only to prove the cascade).
	for _, q := range []string{
		`INSERT INTO dining_table (scenario_id, number) SELECT id, 1 FROM scenario WHERE capacity = 9`,
		`INSERT INTO assignment (scenario_id, guest_id, table_id) SELECT scenario_id, ` + strconv.FormatInt(a.ID, 10) + `, id FROM dining_table`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}

	if err := s.Delete(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	var links, seats int
	_ = db.QueryRow(`SELECT count(*) FROM guest_link`).Scan(&links)
	_ = db.QueryRow(`SELECT count(*) FROM assignment`).Scan(&seats)
	if links != 0 || seats != 0 {
		t.Errorf("after delete: links = %d, assignments = %d, want 0, 0", links, seats)
	}
	if _, err := s.Get(ctx, a.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("Get after delete = %v", err)
	}
	if err := s.Delete(ctx, a.ID); !errors.Is(err, apperr.ErrNotFound) {
		t.Errorf("second delete = %v, want ErrNotFound", err)
	}
	if _, err := s.Get(ctx, b.ID); err != nil {
		t.Errorf("other guest vanished: %v", err)
	}
}
