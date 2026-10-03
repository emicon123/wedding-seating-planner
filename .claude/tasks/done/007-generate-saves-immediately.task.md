# 007 — "Generuj plany" saves the plans immediately (no Akceptuj step)

## Requirement (user, 2026-10-03)
"Generalnie jest tak, że jak generują się plany, to już powinny być widoczne stoliki i przypisania. Teraz muszę je zatwierdzić żeby były widoczne."
Asked which behaviour: **"Zapisuj od razu"** — Generate computes all four plans and stores them as the current plans straight away (pins kept, as `Propose` already uses them). Tables and assignments are visible at once in the normal plan views; no preview card, no per-plan "Akceptuj".

## Today (to be changed)
- `POST /scenarios/calculate` is pure computation (UC-10); the SPA parks the four proposals in the query cache (`useCalculateProposals`, `ProposalPreview`, `ProposalCard`) and shows only figures + fill bars; the plan is stored only by `PUT /scenarios/{capacity}/assignments` (`acceptProposal`, version-checked via `basedOnVersion`, 409 on conflict).

## Decisions (orchestrator defaults — Architect may flag problems)
- **Saving must be atomic across the four plans** (all four replaced in one transaction, or none) — a half-applied Generate is worse than none. Prefer the simplest contract that gives this (e.g. `POST /scenarios/calculate` now persists and returns the four stored `Scenario`s, or a new endpoint); YAGNI — do not keep a preview/accept flow for Generate. Decide whether `acceptProposal` / `basedOnVersion` stays for anything else; remove what becomes dead (endpoint, `ProposalPreview`, `ProposalCard`, `useProposals`, `useAcceptProposal`, `useDropProposal`, `useDiscardProposals`, `withoutProposal`, related tests/copy/docs) rather than leave it unused.
- **Undo:** the previous plans are overwritten, so after Generate the UI offers **"Cofnij"** (restores the four plans as they were before this Generate: tables, assignments and pins). Architect picks the cheapest correct mechanism (e.g. client keeps the pre-Generate `Scenario[]` and restores through one atomic call, or a server-side snapshot) and specifies how it behaves if someone edited a plan in the meantime (version check → 409 → say so). Undo only needs to cover the last Generate in this browser session.
- Overwriting is expected, but the existing "plans differ" confirmation, if any, must still make sense: if any plan already has tables/assignments, the first Generate click should not silently destroy hand edits — Architect decides between relying on Cofnij only (preferred, fewer clicks) or a one-line confirm; flag the choice.
- Business rules in `docs/architecture/03-seating-model.md` are unchanged (pins kept, disabled members ride along with their cluster, plans with violations are still saved and show "Needs recalculation").
- Out of scope: the quality of the seating algorithm itself (separate task: simulated annealing polish — measured on the live guest list, capacity 12 scores 172 vs 308 achievable).

## Phases

### Phase A — Architect
Update `docs/openapi/**` + bundle `docs/openapi.yaml` (`make openapi-bundle openapi-lint`), use cases (UC-10 and the glossary terms *Proposal*/*Accept* → whatever remains), sequence/state diagrams (`003-sequences.md`, `001-state-machine.md`, `003-frontend-design.md`), `03-seating-model.md` ("Accepting a proposal", "Generate"), `docs/architecture/diagrams/003-backend-design.md`, and add a dated ADR-001 amendment if the contract shape changes. Do not touch `.claude/tasks/done/`. Commit the phase. Finish by listing for Backend-Go / Frontend-web exactly what to read.

### Phase B1 — Backend-Go
Implement the contract: atomic generate-and-store for all four plans in one transaction (real SQLite in tests, no DB mocks), version bumps, pins preserved, disabled members seated with their cluster (reuse the accept logic), the atomic restore used by Cofnij if it is server-side; remove dead code; `go vet`, `go test ./...` green.

### Phase B2 — Frontend-web (after the contract is in)
"Generuj plany" calls the new endpoint, updates the `scenarios` query cache from the response, and goes to / shows the plan views with tables and guests at once; "Cofnij" toast/button after Generate; remove the preview/accept UI and dead hooks; Polish copy; update tests; `npm run typecheck`/lint/test/build green. Both entry points of `GenerateButton` (overview and detail page) behave the same.

### Phase C — Orchestrator
Take `infra/backup.sh` BEFORE deploying, redeploy (`docker compose -f infra/compose.yml up -d --build`), check health through `/wesele`, click Generate on the real data and check Cofnij, then move this file to `done/`.

## Deliverables
Updated contract + docs (A); passing backend (B1) and frontend (B2) tests; deployed app where Generate shows tables and assignments immediately and Cofnij restores the previous plans (C).

## Phase A — result (Architect, 2026-10-03)

**Decisions (flagged for the orchestrator):**
1. **Contract shape:** `POST /scenarios/calculate` stays **pure** (unchanged). New command **`PUT /scenarios`** (`replaceScenarios`, body `ScenariosReplace` = exactly four `ScenarioLayout {capacity, basedOnVersion, tables[{number, guestIds, pinnedGuestIds}]}`, 200 `ScenarioListResponse`) replaces all four plans in **one transaction or not at all**. Generate = client-orchestrated GET (snapshot) → calculate → PUT with the **snapshot's** versions. `PUT /scenarios/{capacity}/assignments` (`acceptProposal`, `AcceptPlan`) is **removed**. Chosen over "calculate persists" because Cofnij needs the bulk replace endpoint anyway — one write endpoint serves both, CQS and the path rule stay intact, less backend work.
2. **Cofnij:** client-held one-slot snapshot (`keys.generateUndo` in the query cache, this tab until reload), re-sent through the same `PUT /scenarios` with the versions Generate returned. Any plan edited since → **409, nothing changed**, UI: "Nie można cofnąć — plany zmieniono po wygenerowaniu", offer dropped (422 for a deleted guest: same). The bar hides itself as soon as any plan version differs. No server snapshot, **no migration**.
3. **Confirm vs Cofnij-only:** **Cofnij-only**, no confirmation dialog (none exists today either).
4. Pins are now **explicit** in the body (`pinnedGuestIds`, whole cluster) instead of copied from the stored plan — required for an exact undo.

**Backend-Go must read:**
- `docs/openapi.yaml` `/scenarios` `put` (`replaceScenarios`, lines ~347–575) and schemas `TableLayout` / `ScenarioLayout` / `ScenariosReplace` (lines ~1530–1605); source: `docs/openapi/paths/scenarios.yaml`
- `docs/architecture/03-seating-model.md` lines 96–114 (§ Storing a Generate, § Undoing a Generate)
- `docs/architecture/diagrams/003-backend-design.md` §2.3 lines 146–182 (`PlanInput`, `PlanReplace`, `Service.Replace`, `Store.ReplacePlans`) and §6 lines 398–424 (flow, tests, **delete list**)
- `docs/architecture/04-data-model.md` line 119 (request mapping) and lines 163–176 (`ReplacePlans` contract)
- `docs/architecture/diagrams/003-sequences.md` §1 lines 11–77

**Frontend-web must read:**
- `docs/architecture/diagrams/003-frontend-design.md` §9 lines 303–332 (hooks, `UndoGenerateBar`, copy, **delete list**, tests), §2 lines 46–108 (hook/domain signatures), §4 lines 237–250
- `docs/architecture/diagrams/003-sequences.md` §1 lines 11–77
- `docs/architecture/diagrams/001-state-machine.md` §2 lines 54–104
- `docs/architecture/03-seating-model.md` lines 96–114
- `docs/openapi.yaml` `/scenarios` `put` + `ScenariosReplace` schemas (regenerate `src/api/schema.d.ts`)
