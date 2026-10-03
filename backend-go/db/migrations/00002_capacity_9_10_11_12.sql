-- Task 006: table capacities 8/10/12 -> 9/10/11/12 (four permanent plans). Owned by the Architect.
--
-- Keeps ALL data: guests and links are not touched; plans 10 and 12 keep their rows, tables,
-- assignments and pins; the 8-seat plan becomes the 9-seat plan (same id, tables, assignments
-- and pins; version bumped, so stale proposals for it are rejected); an empty plan 11 is added.
--
-- Why the plan tables are rebuilt: SQLite cannot alter a CHECK in place, and the app opens
-- the DB with foreign_keys=ON. With FKs on, DROP TABLE scenario does an implicit DELETE that
-- cascades to dining_table/assignment, and PRAGMA foreign_keys cannot be switched off inside
-- goose's transaction. So the three plan tables are rebuilt TOGETHER, inside the transaction:
--   1. create scenario_new / dining_table_new / assignment_new (FKs point at the *_new tables);
--   2. copy every row, ids unchanged (8 -> 9 conversion happens on the copy);
--   3. drop the old tables child-first (assignment, dining_table, scenario): each implicit
--      DELETE finds no remaining children, so nothing cascades into the new tables;
--   4. rename *_new -> final names; SQLite (legacy_alter_table=OFF) rewrites the FK
--      references of the other new tables to the final names;
--   5. recreate the indexes; seed capacity 11.
-- Works the same with foreign_keys ON or OFF; atomic (goose runs it in one transaction).

-- +goose Up

CREATE TABLE scenario_new (
    id          INTEGER PRIMARY KEY,
    capacity    INTEGER NOT NULL UNIQUE CHECK (capacity IN (9, 10, 11, 12)),
    version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE dining_table_new (
    id           INTEGER PRIMARY KEY,
    scenario_id  INTEGER NOT NULL REFERENCES scenario_new (id) ON DELETE CASCADE,
    number       INTEGER NOT NULL CHECK (number >= 1),
    UNIQUE (scenario_id, number),
    UNIQUE (id, scenario_id)
) STRICT;

CREATE TABLE assignment_new (
    id           INTEGER PRIMARY KEY,
    scenario_id  INTEGER NOT NULL REFERENCES scenario_new (id) ON DELETE CASCADE,
    guest_id     INTEGER NOT NULL REFERENCES guest (id) ON DELETE CASCADE,
    table_id     INTEGER NOT NULL,
    pinned       INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    UNIQUE (scenario_id, guest_id),
    FOREIGN KEY (table_id, scenario_id) REFERENCES dining_table_new (id, scenario_id) ON DELETE CASCADE
) STRICT;

-- The 8-seat plan becomes the 9-seat plan: every table of <= 8 guests is valid at 9.
INSERT INTO scenario_new (id, capacity, version, updated_at)
SELECT id,
       CASE capacity WHEN 8 THEN 9 ELSE capacity END,
       CASE capacity WHEN 8 THEN version + 1 ELSE version END,
       CASE capacity WHEN 8 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE updated_at END
FROM scenario;

INSERT INTO dining_table_new (id, scenario_id, number)
SELECT id, scenario_id, number FROM dining_table;

INSERT INTO assignment_new (id, scenario_id, guest_id, table_id, pinned)
SELECT id, scenario_id, guest_id, table_id, pinned FROM assignment;

DROP TABLE assignment;
DROP TABLE dining_table;
DROP TABLE scenario;

ALTER TABLE scenario_new RENAME TO scenario;
ALTER TABLE dining_table_new RENAME TO dining_table;
ALTER TABLE assignment_new RENAME TO assignment;

CREATE INDEX assignment_table_idx ON assignment (table_id);
CREATE INDEX assignment_guest_idx ON assignment (guest_id);

INSERT INTO scenario (capacity) VALUES (11);

-- +goose Down
-- Best-effort mirror: plan 11 and its tables are deleted; plan 9 becomes plan 8 again
-- (version bumped). A 9-seat plan's table that holds 9 guests is kept as-is and simply shows
-- up as an over-capacity violation in the 8-seat plan until it is regenerated or edited.

CREATE TABLE scenario_old (
    id          INTEGER PRIMARY KEY,
    capacity    INTEGER NOT NULL UNIQUE CHECK (capacity IN (8, 10, 12)),
    version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE dining_table_old (
    id           INTEGER PRIMARY KEY,
    scenario_id  INTEGER NOT NULL REFERENCES scenario_old (id) ON DELETE CASCADE,
    number       INTEGER NOT NULL CHECK (number >= 1),
    UNIQUE (scenario_id, number),
    UNIQUE (id, scenario_id)
) STRICT;

CREATE TABLE assignment_old (
    id           INTEGER PRIMARY KEY,
    scenario_id  INTEGER NOT NULL REFERENCES scenario_old (id) ON DELETE CASCADE,
    guest_id     INTEGER NOT NULL REFERENCES guest (id) ON DELETE CASCADE,
    table_id     INTEGER NOT NULL,
    pinned       INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    UNIQUE (scenario_id, guest_id),
    FOREIGN KEY (table_id, scenario_id) REFERENCES dining_table_old (id, scenario_id) ON DELETE CASCADE
) STRICT;

INSERT INTO scenario_old (id, capacity, version, updated_at)
SELECT id,
       CASE capacity WHEN 9 THEN 8 ELSE capacity END,
       CASE capacity WHEN 9 THEN version + 1 ELSE version END,
       CASE capacity WHEN 9 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE updated_at END
FROM scenario
WHERE capacity <> 11;

INSERT INTO dining_table_old (id, scenario_id, number)
SELECT t.id, t.scenario_id, t.number
FROM dining_table t JOIN scenario s ON s.id = t.scenario_id
WHERE s.capacity <> 11;

INSERT INTO assignment_old (id, scenario_id, guest_id, table_id, pinned)
SELECT a.id, a.scenario_id, a.guest_id, a.table_id, a.pinned
FROM assignment a JOIN scenario s ON s.id = a.scenario_id
WHERE s.capacity <> 11;

DROP TABLE assignment;
DROP TABLE dining_table;
DROP TABLE scenario;

ALTER TABLE scenario_old RENAME TO scenario;
ALTER TABLE dining_table_old RENAME TO dining_table;
ALTER TABLE assignment_old RENAME TO assignment;

CREATE INDEX assignment_table_idx ON assignment (table_id);
CREATE INDEX assignment_guest_idx ON assignment (guest_id);
