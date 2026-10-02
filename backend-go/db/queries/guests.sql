-- Guest and link queries (B-06). name_key is computed in Go (guests.NameKey): SQLite lower()
-- does not fold Polish letters. Timestamps use the same RFC 3339 UTC format as the column defaults.

-- name: ListGuests :many
SELECT * FROM guest ORDER BY name_key, id;

-- name: ListGuestLinks :many
SELECT * FROM guest_link ORDER BY guest_a_id, guest_b_id;

-- name: GetGuest :one
SELECT * FROM guest WHERE id = ?;

-- name: CreateGuest :one
INSERT INTO guest (first_name, last_name, name_key, notes, is_child, enabled)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: UpdateGuest :one
-- Optimistic lock: no row means the id is missing or the version is stale (the caller tells them apart).
UPDATE guest
SET first_name = ?, last_name = ?, name_key = ?, notes = ?, is_child = ?, enabled = ?,
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ? AND version = ?
RETURNING *;

-- name: SetGuestEnabled :one
-- No row when the guest already has the requested state (nothing to change, version untouched).
UPDATE guest
SET enabled = ?1,
    version = version + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?2 AND enabled <> ?1
RETURNING *;

-- name: DeleteGuest :execrows
DELETE FROM guest WHERE id = ?;

-- name: UpsertGuestLink :one
INSERT INTO guest_link (guest_a_id, guest_b_id, level)
VALUES (?, ?, ?)
ON CONFLICT (guest_a_id, guest_b_id) DO UPDATE SET level = excluded.level
RETURNING *;

-- name: DeleteGuestLink :execrows
DELETE FROM guest_link WHERE guest_a_id = ? AND guest_b_id = ?;
