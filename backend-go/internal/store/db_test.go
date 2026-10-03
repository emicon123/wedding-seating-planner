package store

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/wojtekrpi/stoliki/backend-go/internal/apperr"
	"github.com/wojtekrpi/stoliki/backend-go/internal/store/sqlcgen"
)

// openMigrated opens a fresh SQLite file in t.TempDir() and applies the embedded goose migrations.
func openMigrated(t *testing.T) *sql.DB {
	t.Helper()
	db, err := Open(filepath.Join(t.TempDir(), "stoliki.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	if err := Migrate(context.Background(), db); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	return db
}

func capacities(t *testing.T, db *sql.DB) []int {
	t.Helper()
	rows, err := db.Query(`SELECT capacity FROM scenario ORDER BY mixed, capacity`)
	if err != nil {
		t.Fatalf("query scenarios: %v", err)
	}
	defer rows.Close()
	var out []int
	for rows.Next() {
		var c int
		if err := rows.Scan(&c); err != nil {
			t.Fatal(err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestOpenMigrateSeedsFiveScenarios(t *testing.T) {
	db := openMigrated(t)
	if got := capacities(t, db); !slices.Equal(got, []int{9, 10, 11, 12, 12}) {
		t.Fatalf("scenarios = %v, want [9 10 11 12 12] (the last one is the mixed plan)", got)
	}
}

func TestOpenSetsPragmas(t *testing.T) {
	db := openMigrated(t)
	for pragma, want := range map[string]string{
		"foreign_keys": "1",
		"busy_timeout": "5000",
		"journal_mode": "wal",
	} {
		var got string
		if err := db.QueryRow("PRAGMA " + pragma).Scan(&got); err != nil {
			t.Fatalf("PRAGMA %s: %v", pragma, err)
		}
		if got != want {
			t.Errorf("PRAGMA %s = %q, want %q", pragma, got, want)
		}
	}
}

func TestForeignKeysAreEnforced(t *testing.T) {
	db := openMigrated(t)
	_, err := db.Exec(`INSERT INTO guest_link (guest_a_id, guest_b_id, level) VALUES (1, 2, 1)`)
	if err == nil {
		t.Fatal("link to nonexistent guests was accepted; foreign keys are off")
	}
}

func TestMigrateTwiceIsANoOp(t *testing.T) {
	db := openMigrated(t)
	if err := Migrate(context.Background(), db); err != nil {
		t.Fatalf("second Migrate: %v", err)
	}
	if got := capacities(t, db); !slices.Equal(got, []int{9, 10, 11, 12, 12}) {
		t.Fatalf("scenarios after second Migrate = %v, want [9 10 11 12 12] (the last one is the mixed plan)", got)
	}
}

func TestBackupWritesAnOpenableCopy(t *testing.T) {
	db := openMigrated(t)
	if _, err := db.Exec(`INSERT INTO guest (first_name, name_key) VALUES ('Ania', 'ania')`); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(t.TempDir(), "sub", "copy.db")

	if err := Backup(context.Background(), db, dest); err != nil {
		t.Fatalf("Backup: %v", err)
	}

	copyDB, err := Open(dest)
	if err != nil {
		t.Fatalf("open backup: %v", err)
	}
	defer copyDB.Close()
	if got := capacities(t, copyDB); !slices.Equal(got, []int{9, 10, 11, 12, 12}) {
		t.Errorf("backup scenarios = %v, want [9 10 11 12 12] (the last one is the mixed plan)", got)
	}
	var guests int
	if err := copyDB.QueryRow(`SELECT count(*) FROM guest`).Scan(&guests); err != nil || guests != 1 {
		t.Errorf("backup guests = %d, err = %v, want 1", guests, err)
	}

	if err := Backup(context.Background(), db, dest); err == nil {
		t.Error("Backup over an existing file succeeded; it must refuse to overwrite")
	}
}

func TestMapErr(t *testing.T) {
	db := openMigrated(t)
	exec := func(q string) error { _, err := db.Exec(q); return err }

	if err := exec(`INSERT INTO guest (first_name, name_key) VALUES ('Ania', 'ania kowalska')`); err != nil {
		t.Fatal(err)
	}
	dupName := exec(`INSERT INTO guest (first_name, last_name, name_key) VALUES ('Ania', 'Kowalska', 'ania kowalska')`)
	dupCapacity := exec(`INSERT INTO scenario (capacity) VALUES (9)`)
	badFK := exec(`INSERT INTO guest_link (guest_a_id, guest_b_id, level) VALUES (100, 200, 1)`)
	if dupName == nil || dupCapacity == nil || badFK == nil {
		t.Fatalf("expected three constraint errors, got %v / %v / %v", dupName, dupCapacity, badFK)
	}

	boom := errors.New("boom")
	tests := []struct {
		name string
		in   error
		want error // matched with errors.Is; nil means "returned unchanged"
	}{
		{"UNIQUE(name_key) becomes ErrDuplicateName", dupName, apperr.ErrDuplicateName},
		{"foreign key violation becomes ErrNotFound", badFK, apperr.ErrNotFound},
		{"no rows becomes ErrNotFound", sql.ErrNoRows, apperr.ErrNotFound},
		{"other UNIQUE violation is not a duplicate name", dupCapacity, nil},
		{"unknown errors pass through", boom, nil},
		{"nil stays nil", nil, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := mapErr(tc.in)
			if tc.want != nil {
				if !errors.Is(got, tc.want) {
					t.Fatalf("mapErr(%v) = %v, want %v", tc.in, got, tc.want)
				}
				return
			}
			if errors.Is(got, apperr.ErrDuplicateName) || errors.Is(got, apperr.ErrNotFound) {
				t.Fatalf("mapErr(%v) = %v, must not be mapped", tc.in, got)
			}
			if tc.in == nil && got != nil {
				t.Fatalf("mapErr(nil) = %v", got)
			}
			if tc.in != nil && got == nil {
				t.Fatal("mapErr dropped the error")
			}
		})
	}
}

func TestWithTx(t *testing.T) {
	db := openMigrated(t)
	ctx := context.Background()

	t.Run("gives the callback working queries", func(t *testing.T) {
		var got []sqlcgen.ListPlanKeysRow
		err := withTx(ctx, db, func(q *sqlcgen.Queries) error {
			var err error
			got, err = q.ListPlanKeys(ctx)
			return err
		})
		if err != nil {
			t.Fatalf("withTx: %v", err)
		}
		want := []sqlcgen.ListPlanKeysRow{{Capacity: 9}, {Capacity: 10}, {Capacity: 11}, {Capacity: 12}, {Capacity: 12, Mixed: 1}}
		if !slices.Equal(got, want) {
			t.Errorf("plan keys = %v, want %v", got, want)
		}
	})

	t.Run("returns the mapped callback error", func(t *testing.T) {
		err := withTx(ctx, db, func(*sqlcgen.Queries) error { return sql.ErrNoRows })
		if !errors.Is(err, apperr.ErrNotFound) {
			t.Errorf("err = %v, want ErrNotFound", err)
		}
	})

	t.Run("releases the single connection after an error", func(t *testing.T) {
		_ = withTx(ctx, db, func(*sqlcgen.Queries) error { return errors.New("boom") })
		pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		if err := db.PingContext(pingCtx); err != nil {
			t.Fatalf("db unusable after failed tx (connection leaked?): %v", err)
		}
	})
}
