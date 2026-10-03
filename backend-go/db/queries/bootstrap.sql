-- name: ListPlanKeys :many
-- (capacity, mixed) of the seeded scenarios (B-02 bootstrap), ordered like ListScenarios.
SELECT capacity, mixed FROM scenario ORDER BY mixed, capacity;
