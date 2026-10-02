-- Stoliki initial schema (task 002). Owned by the Architect.
-- Conventions (docs/architecture/02-system-context.md "Persistence"):
--   STRICT tables, surrogate INTEGER PRIMARY KEY, timestamps = RFC 3339 UTC TEXT,
--   booleans = INTEGER 0/1 with CHECK. Derived data (clusters, scores) is never stored.

-- +goose Up

-- A person who may attend. name_key = lower(trim(first_name || ' ' || last_name)),
-- computed in Go (SQLite lower() does not fold Polish letters) and unique.
CREATE TABLE guest (
    id          INTEGER PRIMARY KEY,
    first_name  TEXT    NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 100),
    last_name   TEXT             CHECK (last_name IS NULL OR length(trim(last_name)) BETWEEN 1 AND 100),
    name_key    TEXT    NOT NULL UNIQUE CHECK (length(name_key) > 0),
    notes       TEXT    NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
    is_child    INTEGER NOT NULL DEFAULT 0 CHECK (is_child IN (0, 1)),
    enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- Undirected link between two guests; stored once per pair with guest_a_id < guest_b_id.
-- level: 0 = must sit together, 1 = preferred, 2 = acceptable if unavoidable.
CREATE TABLE guest_link (
    id          INTEGER PRIMARY KEY,
    guest_a_id  INTEGER NOT NULL REFERENCES guest (id) ON DELETE CASCADE,
    guest_b_id  INTEGER NOT NULL REFERENCES guest (id) ON DELETE CASCADE,
    level       INTEGER NOT NULL CHECK (level IN (0, 1, 2)),
    CHECK (guest_a_id < guest_b_id),
    UNIQUE (guest_a_id, guest_b_id)
) STRICT;

CREATE INDEX guest_link_b_idx ON guest_link (guest_b_id);

-- Exactly three plans, keyed by table capacity; seeded below, never created/deleted by the app.
CREATE TABLE scenario (
    id          INTEGER PRIMARY KEY,
    capacity    INTEGER NOT NULL UNIQUE CHECK (capacity IN (8, 10, 12)),
    version     INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- A table in one plan, numbered 1..k without gaps (renumbering is done by the store).
CREATE TABLE dining_table (
    id           INTEGER PRIMARY KEY,
    scenario_id  INTEGER NOT NULL REFERENCES scenario (id) ON DELETE CASCADE,
    number       INTEGER NOT NULL CHECK (number >= 1),
    UNIQUE (scenario_id, number),
    UNIQUE (id, scenario_id)            -- target of the composite FK below
) STRICT;

-- Guest g sits at table t in scenario s. The composite FK guarantees t belongs to s.
-- Deleting a table or a guest deletes the assignment (guest becomes unseated / is gone).
CREATE TABLE assignment (
    id           INTEGER PRIMARY KEY,
    scenario_id  INTEGER NOT NULL REFERENCES scenario (id) ON DELETE CASCADE,
    guest_id     INTEGER NOT NULL REFERENCES guest (id) ON DELETE CASCADE,
    table_id     INTEGER NOT NULL,
    pinned       INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    UNIQUE (scenario_id, guest_id),
    FOREIGN KEY (table_id, scenario_id) REFERENCES dining_table (id, scenario_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX assignment_table_idx ON assignment (table_id);
CREATE INDEX assignment_guest_idx ON assignment (guest_id);

INSERT INTO scenario (capacity) VALUES (8), (10), (12);

-- +goose Down
DROP TABLE assignment;
DROP TABLE dining_table;
DROP TABLE scenario;
DROP TABLE guest_link;
DROP TABLE guest;
