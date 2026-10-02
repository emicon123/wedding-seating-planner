# Task 005-F: Delete a plan — frontend (React)

## Orchestrator Routing

**Assigned Phase:** Phase 6 handoff (Architect phases done 2026-10-02). **Agent:** Frontend-web (load the `frontend-design` skill).
**Parallel:** yes — Backend-Go (`005-delete-plan-backend.task.md`) runs at the same time; work against the bundled contract `docs/openapi.yaml` with MSW. No infra change.

## What we're building

"Usuń plan" on each plan and "Usuń wszystkie plany": after a confirmation, the plan becomes **empty** (no tables, everyone in "Bez stołu", pins gone). Irreversible. Discarding a preview ("Odrzuć") already exists and is unrelated.

**Contract:** `DELETE /wesele/api/scenarios/{capacity}/tables` (operationId `resetPlan`), no body → `200 ScenarioResponse` (the empty plan, evaluated: with enabled guests it has `unseated_guests` and `needsRecalculation: true`); `404 not_found`; `400`; `500`.

## Frontend-web must read

- `docs/architecture/diagrams/003-frontend-design.md` § 7 "Delete a plan" (line 273 to end) — placement, dialog copy, calls, cache updates
- `docs/architecture/diagrams/003-frontend-design.md` § 2 (`useResetPlan`, lines 46-101), § 3 class diagram (`DeletePlanDialog`), § 4 state ownership (lines 229-242)
- `docs/architecture/diagrams/003-sequences.md` § 5 "Delete a plan" (line 195+)
- `docs/architecture/diagrams/001-state-machine.md` § 2 (lines 54-101: `Empty` sub-state + legend)
- `docs/architecture/03-seating-model.md` line 80 ("Deleting a plan")
- `docs/openapi/paths/scenarios_{capacity}_tables.yaml` lines 23-51; example `ScenarioEmpty` in `docs/openapi/components/examples.yaml`

## Tickets (test first, in order)

### F-50 regenerate types
`npm run gen:api` → `src/api/schema.d.ts` gains `delete` on `/scenarios/{capacity}/tables`. `npm run typecheck` green.

### F-51 hook `useResetPlan()` — `src/api/scenarios.ts`
Test first in `src/api/scenarios.test.tsx`, `describe('useResetPlan')` (MSW via `mockApi('delete', '/scenarios/10/tables', ...)`):
- "DELETEs without a body and replaces only that scenario with the server copy" — the recorded call body is `null`; `keys.scenarios` has the empty plan 10, plans 8/12 untouched.
- "drops that capacity's proposal from the preview and keeps the others" — seed `keys.proposals` with `threeProposals()`; after success only 8 and 12 remain (use `withoutProposal`).
- "rejects with the ApiError on 404 and leaves the caches alone".
Implement like `useDeleteTable`: `client.DELETE('/scenarios/{capacity}/tables', { params: { path: { capacity } } })`; `onSuccess`: `replaceScenario` + drop proposal.

### F-52 `DeletePlanDialog` — `src/features/plans/DeletePlanDialog.tsx`
`AlertDialog` like `DeleteTableDialog`. Props: `scenarios: Scenario[]` (one = single plan, three = all), `onConfirm`, `onClose`, `pending`.
Copy (§7): single — "Usunąć plan na {capacity} miejsc?", body with `tableCountLabel(tableCount)` and `peopleLabel(seatedCount)` at tables, "Wszyscy trafią do pola „Bez stołu”. Pinezki znikną. Tego nie da się cofnąć."; all — "Usunąć wszystkie trzy plany?", one line per plan, checkbox "Rozumiem, że tego nie da się cofnąć" that must be ticked before "Usuń wszystkie plany" is enabled. "Anuluj" gets default focus. Add new strings to `domain/labels.ts` if they take numbers.

### F-53 PlansPage + PlanCard — `src/features/plans/PlansPage.tsx`, `PlanCard.tsx`
Test first in `PlansPage.test.tsx`, `describe('PlansPage: delete plans')`:
- "Usuń plan on a card asks first, says how many tables and guests are cleared, and Anuluj sends nothing".
- "confirming deletes only that plan and the card shows the empty state" — after the DELETE, card 10 shows "Brak stołów w tym planie." and the recalculation call to action (from the server's `unseated_guests`).
- "Usuń plan is disabled on a plan with no tables".
- "Usuń wszystkie plany needs the acknowledgement checkbox, then sends three DELETEs (8, 10, 12)".
- "when one of the three fails, the toast names that plan and the others stay deleted" (MSW: 500 for 10).
- "Usuń wszystkie plany is disabled when all three plans are empty".
PlanCard gets an `onDelete(capacity)` prop (the page owns the dialog and the hook — container/presentational split). "Usuń wszystkie plany" sits in the "Aktualne plany" section header; calls via `Promise.allSettled`.

### F-54 PlanDetailPage header — `src/features/plans/PlanDetailPage.tsx`
Test first in `PlanDetailPage.test.tsx`: "Usuń plan in the header empties the floor plan and moves every cluster to the tray, staying on the page" (MSW DELETE returns an empty plan whose `unseated` lists the clusters). Button next to "Dodaj stół", disabled when `tableCount === 0`.

## Rules
No optimistic update for this one (destructive, rare: wait for the server, show `pending` on the button). Toasts: "Usunięto plan na {capacity} miejsc." / "Usunięto wszystkie plany.". Icon + text, never colour alone. `npm run test`, `typecheck`, `lint`, `format:check` green.
