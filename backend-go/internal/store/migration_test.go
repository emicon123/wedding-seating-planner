package store

import (
	"context"
	"io/fs"
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"

	"github.com/wojtekrpi/stoliki/backend-go/db"
)

// TestMigration00002KeepsEveryRow migrates a real SQLite file to schema v1, fills it like the
// live database (guests, links, tables, assignments and pins in the old 8/10/12 plans), applies
// the rest of the migrations through the app's Migrate (foreign_keys=ON, as in production) and
// checks that nothing was lost: the 8-seat plan became the 9-seat plan (same id, version + 1),
// plans 10 and 12 are untouched, an empty plan 11 exists and no foreign key is dangling.
func TestMigration00002KeepsEveryRow(t *testing.T) {
	ctx := context.Background()
	conn, err := Open(filepath.Join(t.TempDir(), "stoliki.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })

	migrations, err := fs.Sub(db.Migrations, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, conn, migrations)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.UpTo(ctx, 1); err != nil {
		t.Fatalf("migrate to v1: %v", err)
	}

	mustExec := func(q string, args ...any) {
		t.Helper()
		if _, err := conn.ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	for _, g := range [][2]string{{"A", "a"}, {"B", "b"}, {"C", "c"}, {"D", "d"}, {"E", "e"}} {
		mustExec(`INSERT INTO guest (first_name, name_key) VALUES (?, ?)`, g[0], g[1])
	}
	mustExec(`INSERT INTO guest_link (guest_a_id, guest_b_id, level) VALUES (1, 2, 0), (2, 3, 1), (4, 5, 2)`)
	// plan 8: bump the version like real edits do, two tables, three seats, one pin
	mustExec(`UPDATE scenario SET version = 7 WHERE capacity = 8`)
	mustExec(`INSERT INTO dining_table (scenario_id, number) SELECT id, n FROM scenario, (SELECT 1 AS n UNION SELECT 2) WHERE capacity = 8`)
	mustExec(`INSERT INTO assignment (scenario_id, guest_id, table_id, pinned)
		SELECT s.id, g.guest, t.id, g.pinned FROM scenario s
		JOIN (SELECT 1 AS guest, 1 AS tn, 1 AS pinned UNION SELECT 2, 1, 1 UNION SELECT 3, 2, 0) g
		JOIN dining_table t ON t.scenario_id = s.id AND t.number = g.tn
		WHERE s.capacity = 8`)
	// plan 10: one table, two seats; plan 12: one table, one pinned seat
	mustExec(`INSERT INTO dining_table (scenario_id, number) SELECT id, 1 FROM scenario WHERE capacity IN (10, 12)`)
	mustExec(`INSERT INTO assignment (scenario_id, guest_id, table_id, pinned)
		SELECT scenario_id, 4, id, 0 FROM dining_table WHERE scenario_id = (SELECT id FROM scenario WHERE capacity = 10)`)
	mustExec(`INSERT INTO assignment (scenario_id, guest_id, table_id, pinned)
		SELECT scenario_id, 5, id, 0 FROM dining_table WHERE scenario_id = (SELECT id FROM scenario WHERE capacity = 10)`)
	mustExec(`INSERT INTO assignment (scenario_id, guest_id, table_id, pinned)
		SELECT scenario_id, 1, id, 1 FROM dining_table WHERE scenario_id = (SELECT id FROM scenario WHERE capacity = 12)`)

	type snapshot struct {
		guests, links, tables, assignments, pins int
		ids                                      string // every table / assignment id with its placement
	}
	take := func() snapshot {
		t.Helper()
		var s snapshot
		for q, dst := range map[string]*int{
			`SELECT COUNT(*) FROM guest`:                       &s.guests,
			`SELECT COUNT(*) FROM guest_link`:                  &s.links,
			`SELECT COUNT(*) FROM dining_table`:                &s.tables,
			`SELECT COUNT(*) FROM assignment`:                  &s.assignments,
			`SELECT COUNT(*) FROM assignment WHERE pinned = 1`: &s.pins,
		} {
			if err := conn.QueryRowContext(ctx, q).Scan(dst); err != nil {
				t.Fatal(err)
			}
		}
		if err := conn.QueryRowContext(ctx, `SELECT
			(SELECT group_concat(id || ':' || scenario_id || ':' || number, ',') FROM (SELECT * FROM dining_table ORDER BY id)) || '|' ||
			(SELECT group_concat(id || ':' || scenario_id || ':' || guest_id || ':' || table_id || ':' || pinned, ',') FROM (SELECT * FROM assignment ORDER BY id))`).Scan(&s.ids); err != nil {
			t.Fatal(err)
		}
		return s
	}
	scenarioIDs := func() map[int]int64 {
		t.Helper()
		out := map[int]int64{}
		rows, err := conn.QueryContext(ctx, `SELECT capacity, id FROM scenario`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		for rows.Next() {
			var c int
			var id int64
			if err := rows.Scan(&c, &id); err != nil {
				t.Fatal(err)
			}
			out[c] = id
		}
		return out
	}
	versionOf := func(capacity int) (v int64) {
		t.Helper()
		if err := conn.QueryRowContext(ctx, `SELECT version FROM scenario WHERE capacity = ?`, capacity).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	oldIDs := scenarioIDs()
	v10, v12 := versionOf(10), versionOf(12)
	before := take()
	if before.tables != 4 || before.assignments != 6 || before.pins != 3 {
		t.Fatalf("test fixture = %+v", before)
	}

	if err := Migrate(ctx, conn); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	if after := take(); after != before {
		t.Errorf("rows changed by the migration:\n before %+v\n after  %+v", before, after)
	}
	newIDs := scenarioIDs()
	if len(newIDs) != 4 {
		t.Fatalf("scenarios = %v, want capacities 9, 10, 11, 12", newIDs)
	}
	if newIDs[9] != oldIDs[8] || newIDs[10] != oldIDs[10] || newIDs[12] != oldIDs[12] {
		t.Errorf("scenario ids changed: %v -> %v", oldIDs, newIDs)
	}
	if _, ok := newIDs[8]; ok {
		t.Error("capacity 8 still exists")
	}
	if v := versionOf(9); v != 8 {
		t.Errorf("plan 9 version = %d, want 8 (7 + 1)", v)
	}
	if versionOf(10) != v10 || versionOf(12) != v12 {
		t.Errorf("plans 10/12 versions changed")
	}
	var n int
	count := func(q string, args ...any) int {
		t.Helper()
		if err := conn.QueryRowContext(ctx, q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if got := count(`SELECT COUNT(*) FROM dining_table WHERE scenario_id = ?`, newIDs[9]); got != 2 {
		t.Errorf("plan 9 tables = %d, want 2", got)
	}
	if got := count(`SELECT COUNT(*) FROM assignment WHERE scenario_id = ?`, newIDs[9]); got != 3 {
		t.Errorf("plan 9 assignments = %d, want 3", got)
	}
	if got := count(`SELECT COUNT(*) FROM dining_table WHERE scenario_id = ?`, newIDs[11]) +
		count(`SELECT COUNT(*) FROM assignment WHERE scenario_id = ?`, newIDs[11]); got != 0 || versionOf(11) != 1 {
		t.Errorf("plan 11 is not empty at version 1")
	}

	rows, err := conn.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	if rows.Next() {
		t.Error("PRAGMA foreign_key_check reports a dangling foreign key")
	}
	var integrity string
	if err := conn.QueryRowContext(ctx, `PRAGMA integrity_check`).Scan(&integrity); err != nil || integrity != "ok" {
		t.Errorf("integrity_check = %q, %v", integrity, err)
	}

	// the rebuilt schema still enforces what it enforced before
	if _, err := conn.ExecContext(ctx, `INSERT INTO scenario (capacity) VALUES (8)`); err == nil {
		t.Error("capacity 8 was accepted after the migration")
	}
	var fk int
	if err := conn.QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&fk); err != nil || fk != 1 {
		t.Fatalf("foreign_keys = %d, %v", fk, err)
	}
	// cascades survive the rebuild: deleting a guest removes its seat, deleting a table its seats
	if _, err := conn.ExecContext(ctx, `DELETE FROM guest WHERE id = 3`); err != nil {
		t.Fatal(err)
	}
	if got := count(`SELECT COUNT(*) FROM assignment`); got != before.assignments-1 {
		t.Errorf("assignments after deleting a guest = %d, want %d", got, before.assignments-1)
	}
	if _, err := conn.ExecContext(ctx, `DELETE FROM dining_table WHERE scenario_id = ? AND number = 1`, newIDs[9]); err != nil {
		t.Fatal(err)
	}
	if got := count(`SELECT COUNT(*) FROM assignment WHERE scenario_id = ?`, newIDs[9]); got != 0 {
		t.Errorf("plan 9 assignments after deleting its tables = %d, want 0", got)
	}
}
