-- name: ListCapacities :many
-- Capacities of the seeded scenarios (B-02 bootstrap). Feature queries arrive with their tickets.
SELECT capacity FROM scenario ORDER BY capacity;
