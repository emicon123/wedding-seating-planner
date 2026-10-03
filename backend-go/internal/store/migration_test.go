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
// the next migration (v2, foreign_keys=ON, as in production) and checks that nothing was lost: the 8-seat plan became the 9-seat plan (same id, version + 1),
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
		if err := rows.Err(); err != nil {
			t.Fatal(err)
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

	if _, err := provider.UpTo(ctx, 2); err != nil { // this test is about v2; v3 has its own test
		t.Fatalf("migrate to v2: %v", err)
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
	if err := rows.Err(); err != nil {
		t.Fatal(err)
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

// TestMigration00003KeepsEveryRow migrates a real SQLite file to schema v2, fills the four plans
// with data and non-default versions, applies the rest through the app's Migrate and checks that
// every row of the four plans is byte-identical (ids, versions, timestamps, tables, seats, pins),
// that a fifth, empty plan (12, mixed) at version 1 exists, that no foreign key dangles and that
// the new constraints hold (task 013).
func TestMigration00003KeepsEveryRow(t *testing.T) {
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
	if _, err := provider.UpTo(ctx, 2); err != nil {
		t.Fatalf("migrate to v2: %v", err)
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
	// every plan gets a distinct version, two tables, and seats (one pinned) of different guests
	for i, c := range []int{9, 10, 11, 12} {
		mustExec(`UPDATE scenario SET version = ? WHERE capacity = ?`, 3+i*2, c)
		mustExec(`INSERT INTO dining_table (scenario_id, number) SELECT id, 1 FROM scenario WHERE capacity = ?`, c)
		mustExec(`INSERT INTO dining_table (scenario_id, number) SELECT id, 2 FROM scenario WHERE capacity = ?`, c)
		mustExec(`INSERT INTO assignment (scenario_id, guest_id, table_id, pinned)
			SELECT s.id, ?, t.id, ? FROM scenario s JOIN dining_table t ON t.scenario_id = s.id AND t.number = 1 WHERE s.capacity = ?`, 1+i, i%2, c)
		mustExec(`INSERT INTO assignment (scenario_id, guest_id, table_id, pinned)
			SELECT s.id, 5, t.id, 1 FROM scenario s JOIN dining_table t ON t.scenario_id = s.id AND t.number = 2 WHERE s.capacity = ?`, c)
	}

	dump := func() string {
		t.Helper()
		var out string
		if err := conn.QueryRowContext(ctx, `SELECT
			(SELECT group_concat(id || ':' || capacity || ':' || version || ':' || updated_at, ',') FROM (SELECT * FROM scenario ORDER BY id)) || '|' ||
			(SELECT group_concat(id || ':' || scenario_id || ':' || number, ',') FROM (SELECT * FROM dining_table ORDER BY id)) || '|' ||
			(SELECT group_concat(id || ':' || scenario_id || ':' || guest_id || ':' || table_id || ':' || pinned, ',') FROM (SELECT * FROM assignment ORDER BY id)) || '|' ||
			(SELECT group_concat(guest_a_id || ':' || guest_b_id || ':' || level, ',') FROM guest_link) || '|' ||
			(SELECT COUNT(*) FROM guest)`).Scan(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	before := dump()

	if err := Migrate(ctx, conn); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	// the four plans (and everything under them) are unchanged; the fifth is the only new row
	var mixedID int64
	var mixedVersion int64
	var mixedCapacity, mixedFlag int
	if err := conn.QueryRowContext(ctx, `SELECT id, capacity, mixed, version FROM scenario WHERE mixed = 1`).Scan(&mixedID, &mixedCapacity, &mixedFlag, &mixedVersion); err != nil {
		t.Fatalf("no mixed plan after the migration: %v", err)
	}
	if mixedCapacity != 12 || mixedFlag != 1 || mixedVersion != 1 {
		t.Errorf("mixed plan = (%d, %d) version %d, want (12, 1) version 1", mixedCapacity, mixedFlag, mixedVersion)
	}
	if _, err := conn.ExecContext(ctx, `DELETE FROM scenario WHERE mixed = 1`); err != nil { // remove the new row, compare the rest
		t.Fatal(err)
	}
	if after := dump(); after != before {
		t.Errorf("rows changed by the migration:\n before %s\n after  %s", before, after)
	}
	// the mixed plan has no tables or seats yet (checked by the dump above: nothing referenced it)
	mustExec(`INSERT INTO scenario (capacity, mixed) VALUES (12, 1)`) // and the constraints let it back in

	var n int
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM scenario`).Scan(&n); err != nil || n != 5 {
		t.Errorf("scenarios = %d, %v; want 5", n, err)
	}
	rows, err := conn.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	if rows.Next() {
		t.Error("PRAGMA foreign_key_check reports a dangling foreign key")
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	var integrity string
	if err := conn.QueryRowContext(ctx, `PRAGMA integrity_check`).Scan(&integrity); err != nil || integrity != "ok" {
		t.Errorf("integrity_check = %q, %v", integrity, err)
	}

	for name, q := range map[string]string{
		"a mixed plan of another capacity": `INSERT INTO scenario (capacity, mixed) VALUES (11, 1)`,
		"a second mixed plan":              `INSERT INTO scenario (capacity, mixed) VALUES (12, 1)`,
		"a second uniform plan 12":         `INSERT INTO scenario (capacity, mixed) VALUES (12, 0)`,
		"a second uniform plan 9":          `INSERT INTO scenario (capacity) VALUES (9)`,
		"capacity 8":                       `INSERT INTO scenario (capacity) VALUES (8)`,
		"a mixed flag other than 0 and 1":  `INSERT INTO scenario (capacity, mixed) VALUES (12, 2)`,
	} {
		if _, err := conn.ExecContext(ctx, q); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	// cascades survive the rebuild
	if _, err := conn.ExecContext(ctx, `DELETE FROM guest WHERE id = 5`); err != nil {
		t.Fatal(err)
	}
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM assignment WHERE guest_id = 5`).Scan(&n); err != nil || n != 0 {
		t.Errorf("seats of the deleted guest = %d, %v", n, err)
	}
	if _, err := conn.ExecContext(ctx, `DELETE FROM scenario WHERE capacity = 10 AND mixed = 0`); err != nil {
		t.Fatal(err)
	}
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM dining_table WHERE scenario_id NOT IN (SELECT id FROM scenario)`).Scan(&n); err != nil || n != 0 {
		t.Errorf("tables orphaned by deleting a scenario = %d, %v", n, err)
	}
}
