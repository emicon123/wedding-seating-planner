-- Scenario, table and assignment queries (B-09). Scenarios are seeded by the migrations (5 rows: capacities
-- 9, 10, 11, 12 and the mixed plan = (12, mixed 1), task 013)
-- and never created or deleted. Every plan mutation bumps scenario.version.

-- name: ListScenarios :many
-- Order 9, 10, 11, 12, mixed.
SELECT * FROM scenario ORDER BY mixed, capacity;

-- name: GetScenario :one
-- A plan is identified by (capacity, mixed); capacity alone matches two rows for 12.
SELECT * FROM scenario WHERE capacity = ? AND mixed = ?;

-- name: ListDiningTables :many
SELECT * FROM dining_table ORDER BY scenario_id, number;

-- name: ListAssignmentSeats :many
-- Seats with their table number; the order makes the plan deterministic.
SELECT a.scenario_id, a.guest_id, a.pinned, t.number AS table_number
FROM assignment a
JOIN dining_table t ON t.id = a.table_id
ORDER BY a.scenario_id, t.number, a.guest_id;

-- name: BumpScenarioVersion :execrows
UPDATE scenario
SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?;

-- name: BumpScenarioVersionIf :execrows
-- Optimistic lock: no row means the version is stale.
UPDATE scenario
SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ? AND version = ?;

-- name: DeleteScenarioTables :exec
-- Cascades to the assignments of those tables.
DELETE FROM dining_table WHERE scenario_id = ?;

-- name: InsertDiningTable :one
INSERT INTO dining_table (scenario_id, number) VALUES (?, ?) RETURNING id;

-- name: GetDiningTableID :one
SELECT id FROM dining_table WHERE scenario_id = ? AND number = ?;

-- name: MaxTableNumber :one
SELECT CAST(COALESCE(MAX(number), 0) AS INTEGER) FROM dining_table WHERE scenario_id = ?;

-- name: UpsertAssignment :exec
INSERT INTO assignment (scenario_id, guest_id, table_id, pinned)
VALUES (?, ?, ?, ?)
ON CONFLICT (scenario_id, guest_id) DO UPDATE SET table_id = excluded.table_id, pinned = excluded.pinned;

-- name: DeleteAssignments :exec
DELETE FROM assignment WHERE scenario_id = sqlc.arg(scenario_id) AND guest_id IN (sqlc.slice('guest_ids'));

-- name: DeleteDiningTable :execrows
DELETE FROM dining_table WHERE scenario_id = ? AND number = ?;

-- name: ShiftTableNumbersUp :exec
-- Renumbering step 1: park every number above n out of the way (SQLite checks UNIQUE row by row).
UPDATE dining_table SET number = number + 1000 WHERE scenario_id = ? AND number > ?;

-- name: ShiftTableNumbersDown :exec
-- Renumbering step 2: bring the parked numbers back, one lower than before step 1.
UPDATE dining_table SET number = number - 1001 WHERE scenario_id = ? AND number > 1000;
