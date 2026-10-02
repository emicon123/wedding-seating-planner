# Task: Backend-Go implementation (MVP) — test-first tickets

## Orchestrator Routing

**Assigned Phase:** Implementation of the Phase 1–5 design (tickets produced by the Architect in Phase 6, Skill 17).
**Agent:** Backend-Go (one ticket or one slice per spawn is fine). Load `software-design-excellence` (§3 Implement, §4 Verify) and read the references in each ticket **before** coding.

**Ground rules (all tickets)**
- **Test first.** Write the failing test named in the ticket, then the code. Business logic gets table-driven unit tests. DB code gets integration tests on a **real SQLite file** in `t.TempDir()`, migrated with the embedded goose migrations. Never mock the DB.
- Contract: `docs/openapi.yaml`. Use the **operationId as the stable anchor**; line ranges below are valid for the bundle as of 2026-10-02 and shift after `make openapi`. Regenerate with `go generate ./...`; never hand-edit `internal/httpapi/oapi` or `internal/store/sqlcgen`.
- The schema is `backend-go/db/migrations/00001_init.sql` (Architect-owned). Do not change it; ask the Architect.
- Never log guest names, notes or bodies. Run `go build ./... && go test ./... && go vet ./... && gofmt -l .` and check that sqlc/go generate produce no diff before declaring a ticket done.
- Package layout and signatures: `docs/architecture/diagrams/003-backend-design.md` §1–§2 (lines 5–208). Deviations are a review finding.

**Common reading (once):** `docs/architecture/01-domain-glossary.md` lines 21–67 (§2–§3); `docs/architecture/02-system-context.md` lines 33–110; `docs/architecture/03-seating-model.md` lines 1–80; `docs/architecture/04-data-model.md` lines 1–194; `docs/architecture/diagrams/003-backend-design.md` lines 1–386.

---

## Slice order, dependencies, parallelism

```
Slice 1 (skeleton)   B-01 → B-02                                  ‖ Frontend F-01..F-03, DevOps D-01 can start
Slice 2 (guests)     B-06 → B-07 → B-08                           ‖ Frontend F-04..F-06 against the bundled contract
Slice 3 (core)       B-03 → B-04 → B-05   (can start right after B-01, in parallel with slice 2)
Slice 4 (plans)      B-09 → B-10 → B-11   (needs B-05 + B-06)       ‖ Frontend F-07..F-09
Slice 5 (deferred)   B-12 import — LAST, post-MVP
```

Ticket IDs are stable; the order above is the suggested execution order. B-03…B-05 touch only `internal/seating`, so they can run in parallel with B-06…B-08 (different packages).

---

## Slice 1 — skeleton

### B-01 Module skeleton: router, health, SPA under `/wesele`, healthcheck subcommand
- **Where:** `backend-go/go.mod`; `cmd/server/main.go` (`run(ctx, args, getenv, stdout)`, `config`); `internal/httpapi/router.go` (`NewRouter(basePath, webRoot, api)`); `internal/httpapi/server.go` (`Server` with `GetHealth` only, other methods return 501 until their ticket); `internal/httpapi/errors.go` (`errorResponse`); `internal/apperr`; oapi-codegen config (`internal/httpapi/oapi/cfg.yaml`, strict-server + chi, `//go:generate`).
- **Test first:** `router_test.go` (httptest):
  - `GET /wesele/api/health` → 200 `{data:{status:"ok"},meta:{requestId}}`.
  - `GET /wesele` → 301 `/wesele/`.
  - `GET /wesele/plany/10` → `index.html` from a temp `webRoot`.
  - `GET /wesele/assets/x.js` → the file.
  - `GET /wesele/api/nope` → 404 error envelope.
  - `errorResponse` table test for every row of the error table.
  - `main_test.go`: `run(["healthcheck"])` against a test server returns nil, or an error when it is down.
- **Refs:** 02-system-context lines 33–63 (prefix) + 64–71 (headers, limits); 003-backend-design lines 177–208 (§2.4); 04-data-model lines 123–137 (error table); openapi `getHealth` (bundle lines 618–639), `ErrorResponse` (800–812), `Meta` (733–743).
- **Done when:** the binary serves an empty SPA dir plus health under `BASE_PATH`.

### B-02 Store bootstrap: Open, Migrate, Backup
- **Where:** `backend-go/db/migrations.go` (package `db`, `//go:embed migrations/*.sql` → `Migrations`); `internal/store/db.go` (`Open`, `Migrate`, `Backup`, `withTx`, `mapErr`); `sqlc.yaml` (engine sqlite, schema `db/migrations`, queries `db/queries`, out `internal/store/sqlcgen`); `cmd/server` wiring + `backup <dest>` subcommand.
- **Test first:** `store/db_test.go`: Open a temp file → Migrate → 3 scenarios (8, 10, 12) exist; `PRAGMA foreign_keys` = 1; a second Migrate is a no-op; Backup writes a file that opens and contains 3 scenarios; `mapErr` turns a UNIQUE(name_key) violation into `apperr.ErrDuplicateName`.
- **Refs:** 02-system-context lines 72–80; 002-erd lines 1–71; migration `00001_init.sql` (all); 003-backend-design lines 177–190.
- **Depends on:** B-01.

## Slice 3 — seating core (pure, `internal/seating`)

### B-03 `BuildGraph`: clusters, affinity, data warnings
- **Where:** `internal/seating/graph.go` (`GuestID`, `LinkLevel`, `Guest`, `Link`, `Cluster`, `Graph`, `BuildGraph`, `Weight`, `DataWarning`).
- **Test first:** `graph_test.go`, table-driven:
  - Rafał–{Ewa, Maria, Tadek, Iza} gives one cluster of 5. Disabling Rafał keeps one cluster with Enabled = 4 (user-confirmed rule).
  - Maciek–Karolina (0) + Maciek–Michał (1) + Michał–Ola (0) gives affinity {Maciek,Karolina} ↔ {Michał,Ola} = Preferred, and symmetric.
  - Links 1 and 2 between the same two clusters give Preferred + a `conflicting_link_levels` warning.
  - Clusters of seated size 9 and 13 give the `cluster_exceeds_8` and `cluster_exceeds_12` warnings.
  - A cluster whose members are all disabled has SeatedSize 0.
  - Determinism: same input in any order gives an identical Graph.
- **Refs:** 03-seating-model lines 14–19 (who counts) + 29–42 (scoring); glossary lines 21–52; 003-backend-design lines 52–105 (§2.1).
- **Depends on:** B-01 (module only). **Parallel with:** slice 2.

### B-04 `Evaluate`: fill, satisfaction, violations, `NeedsRecalculation`
- **Where:** `internal/seating/evaluate.go`.
- **Test first:** `evaluate_test.go`, table-driven:
  - Satisfaction counts only enabled table-mates outside the guest's own cluster: w1 = 1.0, w2 = 0.5.
  - `preferredTotal` / `preferredAtTable` / `fallbackAtTable` / `strangersAtTable`.
  - Violations:
    - `over_capacity`: a re-enabled child at a full table gives 11/10 and `NeedsRecalculation` true.
    - `under_floor`: 5 guests with k > 1. With k = 1, 5 guests is no violation.
    - `cluster_split` (members at two tables).
    - `unseated_guests`.
    - `oversized_cluster`.
  - A disabled guest's seat is ignored.
  - `NeedsRecalculation == (len(Violations) > 0)`.
- **Refs:** 03-seating-model lines 20–42, 75–80; openapi schemas `PlanSummary` (1157–1189), `GuestScore` (1238–1275), `Violation` (1276–1306), `SeatingPlan` (1307–1336); 003-sequences lines 108–142 (flow 3).
- **Depends on:** B-03.

### B-05 `Propose` + `ExpandDisabled`
- **Where:** `internal/seating/propose.go` (`Propose`, unexported `minTables`, `pack`, `repairFloor`, `improve`), `expand.go` (`ExpandDisabled`).
- **Test first:** `propose_test.go`:
  - **Invariant test over generated inputs:** 30–110 guests, random clusters of 1–6, random 1/2 links, fixed seeds. Every proposal satisfies the hard rules (no split, fill ≤ capacity, fill ≥ 6 when k > 1) when that is feasible, and uses k = the minimum feasible.
  - Examples: 24 singles at capacity 10 → 3 tables, each ≥ 6 (no 10+10+4). 92 singles at capacity 8/10/12 → 12/10/8 tables.
  - Pinned clusters stay at their table.
  - An oversized cluster stays unseated with a violation.
  - Determinism: same input gives the same plan.
  - The improve step never lowers the score.
  - Runtime < 1 s for 110 guests on the Pi (benchmark `BenchmarkPropose100`).
  - `ExpandDisabled` adds disabled members to their cluster's table.
- **Refs:** 03-seating-model lines 43–74 (feasibility + algorithm flowchart); 003-backend-design lines 52–105 + audit item (3) at lines 375–386 (pass cap, no clock).
- **Depends on:** B-04.

## Slice 2 — guests (MVP data entry)

### B-06 `store.Guests` (sqlc queries + row mapping)
- **Where:** `db/queries/guests.sql`, `internal/store/guests.go` (implements `guests.Store` + `scenarios.GuestSource`), `internal/guests/guest.go` (domain types: `Guest`, `NewGuest`, `Patch`, `Link`, `NewLink`, `ParseLinkKey`, `NameKey`, `ToSeating`).
- **Test first:**
  - `guests/guest_test.go`: `NameKey("Łukasz ", ptr("Żak"))` = `"łukasz żak"`. `NewLink(6,4,1)` normalises to A=4. `NewLink(4,4,…)` is an error. `ParseLinkKey`.
  - `store/guests_test.go` (real DB):
    - Create, then Get.
    - A duplicate name → `ErrDuplicateName`.
    - Update with a stale version → `ErrVersionConflict`; a missing id → `ErrNotFound`.
    - SetEnabled bumps versions and errors if any id is missing (nothing changed).
    - UpsertLink twice changes the level.
    - DeleteLink of a missing pair → `ErrNotFound`.
    - Delete cascades links and assignments.
    - List orders by name_key.
- **Refs:** 04-data-model lines 30–69 (§1) + 70–96 (Guest/Link mapping) + 138–180 (§3 stores); 002-erd lines 52–71; 003-backend-design lines 106–145 (§2.2).
- **Depends on:** B-02.

### B-07 `guests.Service` + guest endpoints
- **Where:** `internal/guests/service.go`; `internal/httpapi/guests.go` + `mapping.go` (`toGuest`, `toGuestList`).
- **Operations:** `listGuests`, `createGuest`, `updateGuest`, `toggleGuests`, `deleteGuest`.
- **Test first:**
  - Service tests (real DB): validation (empty first name; empty-string lastName → `Validation`; trimming); `Toggle` of a single id.
  - HTTP tests through `NewRouter` with a real temp DB:
    - Every status code in the contract (201/200/204/400/404/409/422), including `duplicate_name`.
    - `links` embedded on both guests.
    - `lastName: null` clears the surname.
- **Refs:** openapi `/guests` (36–124), `/guests/{guestId}` (125–175), schemas `Guest` (664–732), `GuestCreate` (813–838), `GuestUpdate` (866–893), `GuestBulkToggle` (849–865); 04-data-model lines 72–87, 110–137; 003-sequences lines 108–187 (flows 3–4).
- **Depends on:** B-06.

### B-08 Links + clusters endpoints
- **Where:** `guests.Service.SetLink / DeleteLink / Graph`; `internal/httpapi/links.go`, `clusters.go`, `mapping.go` (`toLink`, `toClusterOverview`).
- **Operations:** `upsertGuestLink`, `deleteGuestLink`, `getClusterOverview`.
- **Test first:** HTTP tests:
  - `PUT /guest-links/6-4` normalises the key to `4-6`.
  - A self link gives 422; an unknown guest gives 404.
  - `GET /clusters` returns the clusters, symmetric affinities and warnings for the Maciek/Michał fixture.
- **Refs:** openapi `/guest-links/{linkKey}` (176–230), `/clusters` (231–280), schemas `GuestLink` (902–926), `Cluster` (954–999), `DataWarning` (1000–1031), `ClusterOverview` (1032–1045); 003-sequences lines 143–187.
- **Depends on:** B-07, B-03.

## Slice 4 — plans

### B-09 `store.Scenarios`
- **Where:** `db/queries/scenarios.sql`, `internal/store/scenarios.go` (implements `scenarios.Store`), `internal/scenarios/plan.go` (`PlanState`).
- **Test first:** real DB:
  - `List` returns 3, ordered.
  - `ReplacePlan`: a stale version gives `ErrVersionConflict`; a success bumps the version and replaces tables + seats + pins.
  - `SeatCluster` upserts every member, and an unknown table gives `ErrNotFound`.
  - `UnseatCluster`.
  - `AddTable` appends max+1.
  - `RemoveTable(2 of 4)` unseats its guests and renumbers 3,4 → 2,3, using the two-step update. That step is necessary because SQLite checks UNIQUE row by row.
  - Every mutation bumps the version.
- **Refs:** 04-data-model lines 97–109 + 138–180 (incl. the renumbering note); 002-erd lines 52–71; 003-backend-design lines 146–176.
- **Depends on:** B-02. **Parallel with:** B-03…B-05.

### B-10 `scenarios.Service` List / Calculate / Accept + endpoints
- **Where:** `internal/scenarios/service.go`; `internal/httpapi/scenarios.go`, `mapping.go` (`toScenario`, `toProposal`, `toSeatingPlan`, `fromAcceptPlan`).
- **Operations:** `listScenarios`, `calculateProposals`, `acceptProposal`.
- **Test first:**
  - Service:
    - Calculate returns 3 proposals with `basedOnVersion` and builds one graph.
    - Accept validates table numbers 1..k (a gap gives 422) and rejects a duplicate guest (422).
    - Accept keeps the pins of previously pinned clusters, expands disabled members, and gives 409 on a stale version.
  - HTTP: the full flow 1 (calculate → accept all three); `needsRecalculation` shows up in the summary.
- **Refs:** openapi `/scenarios` (345–392), `/scenarios/calculate` (393–448), `/scenarios/{capacity}/assignments` (449–506), schemas `Scenario` (1337–1352), `Proposal` (1368–1384), `AcceptPlan` (1416–1433), `TableLayout` (1401–1415); 003-sequences lines 10–68 (flow 1); 001-state-machine lines 54–92 (§2).
- **Depends on:** B-05, B-06, B-09.

### B-11 Moves, pins, tables
- **Where:** `scenarios.Service.Seat / Unseat / AddTable / RemoveTable`; `internal/httpapi/scenarios.go`.
- **Operations:** `setAssignment`, `deleteAssignment`, `addTable`, `deleteTable`.
- **Test first:**
  - Moving any member moves the whole cluster, including disabled members.
  - Pin and unpin apply to the whole cluster.
  - Overfilling is allowed: the response is 200 with an `over_capacity` violation and `needsRecalculation` true.
  - An unknown table gives 422 on `tableNumber`.
  - Delete-table renumbers and unseats.
  - The re-enable flow 3 end to end: toggle a disabled child on, then `GET /scenarios` gives an overfilled table with `needsRecalculation` true.
- **Refs:** openapi `/scenarios/{capacity}/assignments/{guestId}` (507–567), `/tables` (568–591), `/tables/{tableNumber}` (592–617), `AssignmentSet` (1444–1456); 003-sequences lines 69–142 (flows 2–3).
- **Depends on:** B-10.

## Slice 5 — DEFERRED (post-MVP, lowest priority, last)

### B-12 CSV import (`importcsv.Parse`, `guests.Service.Import`, `ReplaceAll`, `importGuests`)
- **Where:** `internal/importcsv/parse.go` (no dependency on `guests`); `guests.Service.Import`; `store.Guests.ReplaceAll`; `internal/httpapi/import.go`.
- **Test first:**
  - Parser table tests covering every `ImportProblem.code`, plus the matching rules (full name, or a unique first name).
  - The dry run writes nothing.
  - A commit with errors gives 422 and nothing changes.
  - A commit replaces everything and bumps all three scenario versions.
  - A 2 MB limit gives 413.
- **Refs:** openapi `importGuests` (281–344, `x-status: deferred`), schemas `ImportReport` / `ImportProblem` (1056–1148); glossary "Guest import", "Import report" and A-15 (lines 125–139); 04-data-model lines 110–122.
- **Confirm the CSV format (A-15) with the user before starting.**

---

## Verification
- [ ] All tickets B-01…B-11 done with their listed tests; B-12 only once it is scheduled
- [ ] `docs/openapi.yaml` ↔ handlers: every operationId implemented (B-12 may return 501 until scheduled)
- [ ] Diagram ↔ code: packages and signatures match `003-backend-design.md` §1–§2
