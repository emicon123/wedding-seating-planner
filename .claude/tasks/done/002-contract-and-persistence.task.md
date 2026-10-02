# Task: API contract + persistence model (Phases 3–4)

## Orchestrator Routing

**Assigned Phase:** Phase 3 (Integration & Contract) + Phase 4 (Persistence & Enterprise Patterns)

**Agents to spawn (in order):**
1. Architect — this task. Phases 5–6 (class diagram, TDD tickets) are a separate task; no Backend-Go / Frontend-web delegation from this task alone.

---

## What We're Building

The OpenAPI 3.1 contract covering every use case UC-01…UC-16 (`docs/architecture/01-domain-glossary.md` §4), the bundle/lint wiring, the first goose migration, the ERD, the DTO/mapper definitions and the repository (store) definitions. With these in place, Backend-Go and Frontend-web can work in parallel against a fixed contract once Phases 5–6 land.

### Business Context
- Editors: the couple and helpers on tailnet devices, all with equal rights, no login.
- ~85–100 guests; three plans (8/10/12) always generated together; an enabled toggle per guest + bulk toggle; CSV import with a dry run.
- Keep the surface small (YAGNI).

---

## Scope: Architect Phase X Deliverables

**Phase 3 (Integration & Contract)? YES**
- [x] Skill 8: Integration Protocol Selection
- [x] Skill 9: Command/Query Contract Design (OpenAPI)

**Phase 4 (Persistence & Enterprise)? YES**
- [x] Skill 10: Persistence Modeling (ERD)
- [x] Skill 11: DTO & Mapper Definition
- [x] Skill 12: Repository Abstraction

**Phase 5 / 6? NO** (next task)

---

## Deliverables: What Backend-Go / Frontend-web Will Read

**(Filled in by Architect, 2026-10-02.)** Phases 3–4 are done. Phases 5–6 (class diagram, TDD tickets) come next, before any delegation.

### Artifacts
| Skill | Artifact |
|---|---|
| 8 Protocol | REST/JSON, same origin, under `/wesele/api`; justification in `docs/architecture/04-data-model.md` § "Pattern evaluation (Phases 3–4)" (lines 181–194) |
| 9 Contract | Source `docs/openapi/` (`openapi.yaml`, `paths/*.yaml`, `components/{schemas,responses,parameters,examples}.yaml`, `redocly.yaml`) → bundle `docs/openapi.yaml` (17 operations, lint clean). Tooling: root `Makefile` (`make openapi`, `make openapi-lint`, `make openapi-bundle`; `@redocly/cli@2.57.0`) |
| 10 Persistence | `backend-go/db/migrations/00001_init.sql` (goose; verified on SQLite 3.46 and parsed by sqlc 1.31.1); ERD `docs/architecture/diagrams/002-erd.md` |
| 11 DTO & mapper | `docs/architecture/04-data-model.md` §1–§2 |
| 12 Repository | `docs/architecture/04-data-model.md` §3 (`GuestStore`, `ScenarioStore`) |

Part A of this round (the user's answers applied to task-001 docs): tailnet-only with no auth, an `enabled` flag replacing status, `isChild`, firstName/lastName, cluster↔cluster affinity, clusters computed over all guests, scale ~85–100. Updated: glossary, ADR-001, 02, 03, both 001 diagrams, AGENTS.md, backend-go.md, devops.md.

**Update (2026-10-02, user answers round 2):** CSV import is deferred, and manual entry is the MVP path. Added `SeatingPlan.summary.needsRecalculation` (derived, = any violation) so the UI can show the "Przelicz / Generuj" call to action. Rebundled and lint clean.

### Use case → operation coverage
UC-01 `importGuests` (**DEFERRED, post-MVP**: `x-status: deferred`; kept in the contract, implemented last) · UC-02 `createGuest` · UC-03 `updateGuest` · UC-04/05 `toggleGuests` · UC-06 `deleteGuest` · UC-07 `upsertGuestLink`/`deleteGuestLink` · UC-08 `getClusterOverview` · UC-09/14 `listScenarios` · UC-10 `calculateProposals` + `acceptProposal` · UC-11 `setAssignment`/`deleteAssignment` · UC-12 `setAssignment` (`pinned`) · UC-13 `addTable`/`deleteTable` · UC-15/16 client-only · liveness `getHealth`.

> Implementers: the per-ticket references in `.claude/tasks/003-*-implementation.task.md` supersede the lists below (same documents, narrower ranges).

### For Backend-Go:
- Domain rules: `docs/architecture/01-domain-glossary.md` lines 21–65 (§2 language, §3 entities); `docs/architecture/03-seating-model.md` lines 1–80 (all: who counts, rules, scoring, feasibility, algorithm, manual edits)
- System rules: `docs/architecture/02-system-context.md` lines 33–110 (prefix, access control, persistence, concurrency, where logic lives, stack)
- OpenAPI: `docs/openapi.yaml`, all paths (lines 36–639) + `components` (lines 640–end). Note: `importGuests` takes a `text/csv` body; check how oapi-codegen strict-server exposes it (an `io.Reader`)
- ERD + constraints: `docs/architecture/diagrams/002-erd.md` lines 1–71; migration `backend-go/db/migrations/00001_init.sql` (read-only for you; schema changes go to the Architect)
- DTO/mapper + stores: `docs/architecture/04-data-model.md` lines 1–180 (incl. the error mapping table at lines 123–137 and the table-renumbering note in §3)
- Boundaries: `docs/architecture/diagrams/001-c4-context.md` lines 63–93 (policy vs detail)
- Lifecycles: `docs/architecture/diagrams/001-state-machine.md` lines 11–92 (§1 guest, §2 plans)

### For Frontend-web:
- Use cases + vocabulary (Polish UI terms): `docs/architecture/01-domain-glossary.md` lines 21–122
- UI state machines: `docs/architecture/diagrams/001-state-machine.md` lines 54–165 (§2 generate/preview/accept, §3 drag & drop, §4 app shell and screens)
- OpenAPI: `docs/openapi.yaml` (generate types with `openapi-typescript`). Key shapes: `Guest`, `GuestBulkToggle`, `Cluster`/`ClusterOverview`, `SeatingPlan`/`Scenario`/`Proposal`, `AcceptPlan`, `AssignmentSet`, `ImportReport`, `ErrorResponse`
- Prefix and concurrency: `docs/architecture/02-system-context.md` lines 33–63 and 81–100
- Scoring semantics for display: `docs/architecture/03-seating-model.md` lines 14–42

### For DevOps:
- `docs/architecture/02-system-context.md` lines 5–80 (shape, layout, prefix, access control, persistence/backup) and lines 101–110 (env vars). No secrets; tailnet-only on a separate non-funnelled port.

---

## Verification Checklist

- [x] Every use case UC-01…UC-16 maps to an endpoint, or is explicitly client-only (UC-15, UC-16)
- [x] OpenAPI 3.1 source under `docs/openapi/`, bundled to `docs/openapi.yaml`, lint clean
- [x] Migration `backend-go/db/migrations/00001_init.sql` applies on a real SQLite engine and parses with sqlc
- [x] ERD with legend; DTO/mapper + store definitions in `docs/architecture/04-data-model.md`
- [x] Diagram ↔ contract ↔ schema consistency checked
- [ ] Task file moved to `.claude/tasks/done/` (orchestrator)
