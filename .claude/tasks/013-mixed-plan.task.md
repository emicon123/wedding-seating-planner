# 013 — Mixed plan (fifth plan: tables of different sizes 9–12)

## Requirement (user, 2026-10-03)
"Jeszcze jedna rzecz. Można też wygenerować plan mieszany - czyli po prostu plan gdzie są różne stoły od 9 do 12 (minimum 8 jeśli konieczne)"
User answers to clarifying questions (2026-10-03):
- Table sizes: **"Algorytm sam dobiera rozmiary"** (no user-entered table inventory).
- Placement: **"Tak, piąty plan"** — a fifth plan next to 9, 10, 11, 12, generated with them by "Generuj plany", with its own view and comparison; needs a DB + contract change with a data-preserving migration.
- Difference from the 12-plan: **"Może dać o 1 stół więcej"** — the mixed plan may use **one table more than the minimum** when that removes guests who sit without any acquaintance (isolation, task 011). (It also answers the earlier question about a 13th table.)

## Rules (orchestrator's reading; Architect formalises, flags problems)
- **Capacity of a table in the mixed plan = 12 seats max; floor 8 guests per table** (waived for one table), exactly as the 12-plan rules; **the table's size label is derived from its fill**: the smallest of {9, 10, 11, 12} that is ≥ fill (fill 8 → 9-seat table). Nothing about table size is stored per table — manual moves change the label automatically; fill > 12 is `over_capacity`, fill < 8 is `under_floor`.
- **Number of tables k:** let k0 = the minimum feasible table count (as for capacity 12). `Propose(mixed)` solves at k0 and, if feasible ((k0+1)·8 ≤ N), at k0+1; it picks **k0+1 only if it strictly reduces the number of isolated guests** (primary), otherwise k0. Never more than k0+1. (Score alone never justifies an extra table.) Rules 1–2 and 4 (cluster integrity, capacity, floor), pins, group-1/2 scoring and the isolation objective of task 011 are unchanged.
- **Output extras:** per-table size label, and a summary "potrzebne stoły" = count of tables per size (e.g. 5×12, 3×11, 1×9). Shown in the plan view/cards; used in the comparison.
- Everything else behaves like the other plans: manual moves, pins, delete plan, print view, Generate/Cofnij (task 007 `PUT /scenarios` with exactly **five** plans now), evaluation, violations, `needsRecalculation`.

## Design questions the Architect must settle (decide, flag choices)
1. **Identity/key of the plan**: today the scenario key is `capacity ∈ {9,10,11,12}` (contract enum `Capacity`, `scenario.capacity CHECK`, URL `/scenarios/{capacity}/…`, ordered list of exactly four). Options: a fifth key value (e.g. capacity 0 or a string `mixed`) vs a separate kind column. Pick the simplest that keeps URLs/contract coherent; the SQLite CHECK on a cascade parent needs the safe rebuild pattern (see migration 00002 and 02-system-context § Persistence); existing data (guests, plans, pins) MUST survive — migration test with data; a new empty fifth scenario is inserted. Decide the ordering/labels ("Mieszany") and the `Capacity` type on the client.
2. **seating package**: how `Propose`/`Evaluate` express "mixed" (e.g. `Plan.Capacity = 12` plus `Plan.Mixed bool`, or a `Kind`), keeping determinism and the annealing/isolation objective; the k0 vs k0+1 selection rule; how it reuses `feasibleAt`; budget/time (five `Propose` calls, mixed does up to two solves; the parallel Generate from task 012).
3. **Contract**: "exactly five" scenarios/proposals/replace; `TableEval`/table size label and the "potrzebne stoły" summary — derive client-side from fill (preferred, no new field) or add a field; GuestScore/violations unchanged.
4. **Frontend**: five plan cards layout (e.g. 5 across on wide, wrapping on narrow), a mixed-plan card/detail with per-table size glyphs (`TableGlyph seats=…` per table) and the "potrzebne stoły" line, comparison, switcher, print view, delete-all (five DELETEs), Generate/Cofnij with five, copy ("Pięć planów…").
5. Docs to update: `01-domain-glossary`, `03-seating-model` (rules + algorithm), `04-data-model` + ERD, `02-system-context`, openapi, backend/frontend design, sequences, state machine, `AGENTS.md` ("What this is" bullet about four plans).

## Phases
### Phase A — Architect — **start only after task 012 is committed** (it edits `03-seating-model.md` and `anneal.go`).
Docs + contract + migration `00003_*.sql` (Architect-owned) + `make openapi-bundle openapi-lint`; sqlc generate has no diff or is updated; commit.
### Phase B1 — Backend-Go
Migration test with data, store/service/httpapi for five plans (list, calculate = five proposals, replace = five, per-plan endpoints for the new key), seating mixed mode with tests (k0 vs k0+1 selection incl. an isolation-removing case and a case where k0+1 does not help; labels; floor/capacity; determinism; pins), parallel Generate time re-measured. `go vet`, `go test -p 2 ./...` green.
### Phase B2 — Frontend-web (parallel with B1 after the contract is in)
Five-plan UI per the design; tests; typecheck/lint/test/build green.
### Phase C — Orchestrator
`infra/backup.sh` BEFORE deploying (the migration rebuilds scenario tables), redeploy, compare counts of guests/tables/assignments per plan before vs. after, run Generate on the live data (via the cookie flow in AGENTS.md; report numbers, not names), check the mixed plan's k, labels and isolation vs the 12 plan, then move this file to `done/`.
