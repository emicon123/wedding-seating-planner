# Task: Software design + TDD ticket decomposition (Phases 5–6)

## Orchestrator Routing

**Assigned Phase:** Phase 5 (Software Design) + Phase 6 (Handoff)

**Agents to spawn (in order):**
1. Architect — this task (done).
2. Then, using the ticket files below: Backend-Go and Frontend-web in parallel (slice by slice), and DevOps once B-01 + F-01 exist.

---

## What We're Building

Class-level design (Go packages, interfaces, React modules), sequence diagrams for the UI-driven flows, a pattern evaluation, a Clean-Architecture/SOLID/YAGNI audit, and test-first implementation tickets for the MVP. The MVP uses **manual guest entry**; CSV import is deferred to the end.

### Business Context
- Editors on tailnet devices; ~85–100 guests; three plans (8/10/12) always generated together.
- User answers round 2 (2026-10-02):
  - Clusters are computed over all guests, disabled included.
  - Import is deferred.
  - A re-enabled guest sits with their cluster, so the plan flags **needs recalculation**, with no automatic regeneration.

---

## Scope: Architect Phase X Deliverables

**Phase 1–4? NO** (done in tasks 001–002; only the user's answers were applied)

**Phase 5 (Software Design)? YES**
- [x] Skill 13: Core Interface Design
- [x] Skill 14: GoF Pattern Application
- [x] Skill 15: Structural Modeling (Class Diagram)
- [x] Skill 16: Clean Architecture Audit

**Phase 6 (Handoff)? YES**
- [x] Skill 17: TDD Task Decomposition

---

## Deliverables: What Backend-Go / Frontend-web Will Read

**(Filled in by Architect, 2026-10-02.)**

### Design artifacts
| Skill | Artifact |
|---|---|
| 13 Interfaces | `docs/architecture/diagrams/003-backend-design.md` §2 (lines 50–208); `docs/architecture/diagrams/003-frontend-design.md` §2 (lines 44–83) |
| 14 Patterns | backend §4 (lines 357–374); frontend §6 (lines 214–232) |
| 15 Class diagrams | backend §1 package map (lines 5–49) + §3 class diagram with legend (lines 209–356); frontend §1 modules (lines 5–43) + §3 component diagram with legend (lines 84–195) |
| 16 Audit | backend §5 (lines 375–386); frontend §6 (lines 214–232) |
| Sequences | `docs/architecture/diagrams/003-sequences.md`: flow 1 generate → preview → accept (lines 10–68), flow 2 move cluster (69–107), flow 3 re-enable → needs recalculation → regenerate (108–142), flow 4 quick-add + link with expansion (143–187) |
| 17 Tickets | `.claude/tasks/003-backend-go-implementation.task.md` (B-01…B-12), `.claude/tasks/003-frontend-web-implementation.task.md` (F-01…F-11), `.claude/tasks/003-devops-implementation.task.md` (D-01…D-03) |

### Changes from the user's answers (round 2)
- Contract: `PlanSummary.needsRecalculation` (derived = any violation) added. `importGuests` is marked `x-status: deferred`. Rebundled, lint clean.
- Docs: glossary (A-13/A-14 confirmed, import deferred, the new term "Needs recalculation", quick-add/add-by-search UCs, new A-19/A-20); 03-seating-model; 001-state-machine §1–§2 (UpToDate/NeedsRecalculation); 04-data-model (PlanState embeds `seating.Plan`; store interfaces declared consumer-side); task 002.
- No new endpoint was needed for manual entry. Quick-add is one `POST /guests` per Enter (A-20); add-by-search uses `PUT /guest-links/{a-b}`; the bulk toggle uses `PATCH /guests`.

### For Backend-Go
`.claude/tasks/003-backend-go-implementation.task.md`. Every ticket lists exact file and line references. Start with B-01 → B-02; B-03…B-05 can run in parallel with B-06…B-08.

### For Frontend-web
`.claude/tasks/003-frontend-web-implementation.task.md`. Start with F-01 → F-02 ‖ F-03 immediately, against MSW + the bundled contract; no backend needed until integration.

### For DevOps
`.claude/tasks/003-devops-implementation.task.md` (D-01 once B-01 and F-01 exist).

### Suggested MVP vertical slices (cross-stream)
1. **Skeleton:** B-01, B-02 ‖ F-01, F-02, F-03 → D-01, D-02 (health + empty SPA reachable at `/wesele` on the tailnet)
2. **Manual guest entry (first usable value):** B-06, B-07, B-08 ‖ F-04, F-05, F-06
3. **Seating core:** B-03, B-04, B-05 (can start right after B-01)
4. **Plans:** B-09, B-10, B-11 ‖ F-07, F-08, F-09
5. **Polish:** F-10, D-03
6. **Deferred, last:** B-12 ‖ F-11 (CSV import; confirm the format first)

---

## Verification Checklist (software-design-excellence §4, Architect gate)

- [x] Pattern evaluation committed (backend §4, frontend §6, system level in 02-system-context, Phases 3–4 in 04-data-model)
- [x] All diagrams carry legends explaining pattern and principle choices (003-backend-design §1/§3, 003-frontend-design §1/§3, 003-sequences per flow)
- [x] Contracts updated: `needsRecalculation` + deferred marker; `make openapi` lint clean; migration unchanged (no schema change needed)
- [x] Diagram ↔ contract consistency: every operationId appears in a ticket. Sequence messages use existing operations only. `PlanSummary.needsRecalculation` is used by state machine §2, sequence flow 3, B-04, B-11 and F-07. The class-diagram signatures match the store definitions in 04-data-model §3.
- [x] YAGNI gate: no Strategy, no undo, no global client store, no batch create, no auth, no clock abstraction. Import is deferred but kept in the contract.
- [x] Ticket files list exact diagram and contract sections (file + line ranges; operationId as the stable anchor)
- [ ] Task file moved to `.claude/tasks/done/` (orchestrator)
