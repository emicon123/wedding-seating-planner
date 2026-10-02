# Task 005 — Delete a plan: backend (Backend-Go)

## Orchestrator Routing

**Assigned Phase:** Phase 6 handoff (Architect phases 3–5 done for this feature).
**Agent:** Backend-Go. **Runs in parallel with** `005-delete-plan-frontend.task.md`: both work against the bundled contract `docs/openapi.yaml` (operation `resetPlan`), which is final.

## What we're building

User requirement: "I must be able to delete plans." The three scenarios (8/10/12) always exist, so **deleting a plan = resetting that scenario to an empty plan**: all its tables, assignments and pins are removed (disabled guests' assignments too), the scenario `version` is bumped, and the scenario row stays. "Usuń wszystkie plany" is three calls from the client; there is **no batch endpoint**.

Contract (already in `docs/openapi.yaml`, source `docs/openapi/paths/scenarios_{capacity}_tables.yaml`):

| | |
|---|---|
| Method / path | `DELETE /wesele/api/scenarios/{capacity}/tables` |
| operationId | `resetPlan` |
| Request | no body, no query; **no version check** (like the other manual plan edits; it bumps the version, so older proposals then 409 on accept) |
| 200 | `ScenarioResponse`: the empty plan, freshly evaluated (`tables: []`, all enabled clusters in `unseated`, `unseated_guests` violation when any enabled guest exists → `needsRecalculation: true`). Example `ScenarioEmpty`. |
| 400 | non-integer capacity (generated param binding, already handled) |
| 404 | capacity not 8/10/12 → `not_found` |
| 500 | internal_error |

**No migration and no new SQL:** `ClearPlan` reuses the existing `DeleteScenarioTables` query (`db/queries/scenarios.sql`); `dining_table → assignment` is `ON DELETE CASCADE`, so assignments and pins go with the tables.

## Must read before implementing

- `docs/architecture/diagrams/003-backend-design.md` §2.3 (`internal/scenarios`: `Store.ClearPlan`, `Service.Reset`), §3 class diagram (`ScenariosService`, `ScenariosStore`), §3 legend row "version checks", §4 last row (batch rejected)
- `docs/architecture/04-data-model.md` § "Requests → domain" (row `DELETE /scenarios/{capacity}/tables`) and § 3 "Stores" (`ClearPlan` + notes on bulk deletes)
- `docs/architecture/03-seating-model.md` § "Manual edits and violations" (bullet "Deleting a plan")
- `docs/architecture/diagrams/003-sequences.md` § 5 "Delete a plan"
- `docs/architecture/diagrams/002-erd.md` § Legend (cascade row, version-bump list)
- `docs/openapi.yaml` operation `resetPlan`

## Tickets (test first; real SQLite, never mock the DB)

### B-05.1 Regenerate the server stubs
- `cd backend-go && go generate ./internal/httpapi/oapi` (oapi-codegen from `docs/openapi.yaml`). `oapi.StrictServerInterface` gains `ResetPlan(ctx, oapi.ResetPlanRequestObject) (oapi.ResetPlanResponseObject, error)`; the build fails until B-05.4 exists, which is expected.
- No change to `internal/httpapi/unimplemented.go`: the new method is defined directly on `Server` (the "still unimplemented = only import" router test stays as is).

### B-05.2 Store: `(*store.Scenarios).ClearPlan(ctx, capacity int) (scenarios.PlanState, error)`
- Add `ClearPlan` to the `scenarios.Store` interface (`internal/scenarios/service.go`) and implement it in `internal/store/scenarios.go` via `s.tx(ctx, capacity, func(q, sc) error { q.DeleteScenarioTables(ctx, sc.ID); return bump(ctx, q, sc) })`.
- Test first, `internal/store/scenarios_test.go`:
  - `TestScenariosClearPlan`: seed 4 guests, `ReplacePlan(10, …)` with 2 tables and one pinned seat (also seat a guest in plan 8). `ClearPlan(10)` → returned state has `Plan.Tables` empty and `Version` = previous + 1; a fresh `Get(10)` agrees; **plan 8 is untouched** (tables, seats, version); querying `assignment`/`dining_table` for scenario 10 returns 0 rows (cascade proven); calling it again succeeds and bumps the version again (idempotent apart from the version).
  - `TestScenariosClearPlanUnknownCapacity`: `ClearPlan(9)` → `errors.Is(err, apperr.ErrNotFound)`.

### B-05.3 Service: `(*scenarios.Service).Reset(ctx, capacity int) (Evaluated, error)`
- `return s.edit(ctx, func() (PlanState, error) { return s.plans.ClearPlan(ctx, capacity) })` — no version argument, no cluster resolution.
- Test first, `internal/scenarios/service_test.go`:
  - `TestResetEmptiesThePlanAndNeedsRecalculation`: env with ~8 guests (one disabled, one group-0 link), accept a plan for 10 with a pinned cluster; `Reset(10)` → `State.Plan.Tables` empty, version bumped, `Eval` has one `unseated_guests` violation listing every enabled guest and `Summary.NeedsRecalculation == true`; a subsequent `Calculate` proposal for 10 has no pinned seats (pins are gone).
  - `TestResetWithNoEnabledGuestsHasNoViolation`: all guests disabled → `Reset` gives no violations, `NeedsRecalculation == false`.
  - `TestResetMakesOlderProposalsStale`: `Calculate` → `Reset(10)` → `Accept(10, proposal.BasedOnVersion, …)` is `apperr.ErrVersionConflict`.

### B-05.4 HTTP: `(*httpapi.Server).ResetPlan`
- In `internal/httpapi/scenarios.go`, same shape as `DeleteTable`: `ev, err := s.plans.Reset(ctx, int(req.Capacity))` → `oapi.ResetPlan200JSONResponse{Data: toScenario(ev), Meta: metaOf(ctx)}`.
- `strictbody.go` needs **no change**: `bodyOps` lists only operations with a JSON body, and this DELETE has none.
- Test first, `internal/httpapi/scenarios_test.go`, `TestResetPlan` (real temp SQLite through the router, like `TestAddAndDeleteTable`):
  - seed guests, calculate + accept all three plans; `DELETE /wesele/api/scenarios/10/tables` → **200**; body decodes as `oapi.ScenarioResponse` with `capacity 10`, `plan.tables` empty, `summary.tableCount 0`, `summary.needsRecalculation true`, a `unseated_guests` violation, `version` = old + 1; `GET /scenarios` still returns three scenarios and plans 8 and 12 are unchanged.
  - repeat the DELETE → 200 again (idempotent).
  - matrix: `/scenarios/9/tables` → **404** `not_found`; `/scenarios/abc/tables` → **400** `bad_request` on `capacity`.
  - accepting the old proposal for 10 afterwards → **409** `version_conflict`.

### B-05.5 Verify
- `go vet ./... && go test ./...` green; `golangci-lint` if configured. No migration file added; `sqlc generate` unchanged output.
- Log nothing but ids/counts (no guest data), as everywhere.

## Out of scope
- A batch "delete all plans" endpoint (rejected: three independent idempotent calls, see 003-backend-design §4).
- Undo (rejected, user-confirmed). Deleting the scenario row (never: always three plans).
