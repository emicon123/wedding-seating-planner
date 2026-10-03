-- Task 013: a fifth, permanent plan — the mixed plan ("Mieszany", tables of 9-12 seats whose size
-- is derived from their fill). Owned by the Architect.
--
-- A plan is now identified by (capacity, mixed):
--   (9, 0) (10, 0) (11, 0) (12, 0)  the four uniform plans (every table has `capacity` seats);
--   (12, 1)                         the mixed plan (at most 12 guests per table; API key "mixed").
-- `capacity` keeps its meaning "maximum guests per table", so evaluation is unchanged; `mixed`
-- only changes how auto-seating picks the table count (docs/architecture/03-seating-model.md).
--
-- Keeps ALL data: guests and links are not touched; the four existing plans keep their ids,
-- versions, timestamps, tables, assignments and pins (nothing about them changes, so their
-- versions are NOT bumped); one empty mixed plan is added (version 1).
--
-- Same cascade-safe rebuild as 00002 (see that file and 02-system-context.md § Persistence):
-- SQLite cannot change the UNIQUE(capacity) constraint in place, and with foreign_keys=ON a
-- DROP TABLE scenario would cascade-delete every table and assignment. So the three plan tables
-- are rebuilt together inside goose's transaction: create *_new → copy rows with their ids →
-- drop the old tables child-first → rename → recreate the indexes → seed the mixed plan.

-- +goose Up

CREATE TABLE scenario_new (
    id          INTEGER PRIMARY KEY,
    capacity    INTEGER NOT NULL CHECK (capacity IN (9, 10, 11, 12)),
    mixed       INTEGER NOT NULL DEFAULT 0 CHECK (mixed IN (0, 1)),
    version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (capacity, mixed),
    CHECK (mixed = 0 OR capacity = 12)      -- the mixed plan's tables hold at most 12 guests
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

INSERT INTO scenario_new (id, capacity, mixed, version, updated_at)
SELECT id, capacity, 0, version, updated_at FROM scenario;

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

INSERT INTO scenario (capacity, mixed) VALUES (12, 1);

-- +goose Down
-- Mirror: the mixed plan and its tables, assignments and pins are deleted; the four uniform
-- plans are kept exactly as they are (ids, versions, rows).

CREATE TABLE scenario_old (
    id          INTEGER PRIMARY KEY,
    capacity    INTEGER NOT NULL UNIQUE CHECK (capacity IN (9, 10, 11, 12)),
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
SELECT id, capacity, version, updated_at FROM scenario WHERE mixed = 0;

INSERT INTO dining_table_old (id, scenario_id, number)
SELECT t.id, t.scenario_id, t.number
FROM dining_table t JOIN scenario s ON s.id = t.scenario_id
WHERE s.mixed = 0;

INSERT INTO assignment_old (id, scenario_id, guest_id, table_id, pinned)
SELECT a.id, a.scenario_id, a.guest_id, a.table_id, a.pinned
FROM assignment a JOIN scenario s ON s.id = a.scenario_id
WHERE s.mixed = 0;

DROP TABLE assignment;
DROP TABLE dining_table;
DROP TABLE scenario;

ALTER TABLE scenario_old RENAME TO scenario;
ALTER TABLE dining_table_old RENAME TO dining_table;
ALTER TABLE assignment_old RENAME TO assignment;

CREATE INDEX assignment_table_idx ON assignment (table_id);
CREATE INDEX assignment_guest_idx ON assignment (guest_id);
