# Task: Frontend-web implementation (MVP) — test-first tickets

## Orchestrator Routing

**Assigned Phase:** Implementation of the Phase 1–5 design (tickets produced by the Architect in Phase 6, Skill 17).
**Agent:** Frontend-web. Load `frontend-design` (before the first screen) and `software-design-excellence` (§3 + §4). Read each ticket's references before coding.

**Ground rules (all tickets)**
- **Test first.**
  - `domain/` functions: Vitest unit tests.
  - Hooks and components: Vitest + Testing Library, with **MSW** handlers returning contract-shaped payloads typed from `src/api/schema.d.ts`.
  - DnD: test the keyboard path.
- The contract is `docs/openapi.yaml`. Regenerate the types with `npm run gen:api` (openapi-typescript) after any contract change; never hand-edit `schema.d.ts`. **operationId is the stable anchor**; bundle line ranges are as of 2026-10-02.
- The UI is in Polish. Accessibility: warnings use an icon + text, never colour alone. Keyboard paths are required for drag & drop and quick-add.
- No client-side scoring. Scores, violations and `needsRecalculation` come from the server (003-frontend-design §2 note).
- Base path: Vite `base: '/wesele/'`, router basename `/wesele`, `API_BASE='/wesele/api'`, Vite dev proxy to `http://localhost:8080`.

**Common reading (once):**
- `docs/architecture/01-domain-glossary.md` lines 21–124 (language with Polish terms + use cases).
- `docs/architecture/diagrams/003-frontend-design.md` lines 1–232 (all).
- `docs/architecture/diagrams/001-state-machine.md` lines 54–165 (§2–§4).
- `docs/architecture/diagrams/003-sequences.md` lines 1–187.
- `docs/architecture/02-system-context.md` lines 33–63 + 81–87.

---

## Slice order, dependencies, parallelism

```
Slice 1   F-01 → F-02 → F-03          (start immediately; parallel with backend B-01..B-05 — work against MSW + the bundled contract)
Slice 2   F-04 → F-05 → F-06          (MVP data entry; parallel with B-06..B-08; integrate once B-08 is deployed)
Slice 4   F-07 → F-08 → F-09          (parallel with B-09..B-11)
Slice 5   F-10 print
Deferred  F-11 import screen — LAST, post-MVP
```

F-03 (pure `domain/`) has no UI dependency and can run in parallel with F-02.

---

### F-01 Scaffold + app shell under `/wesele`
- **Where:** `frontend-web/` (Vite + React 19 + TS strict + Tailwind v4 + shadcn/ui init); `src/app/App.tsx` (routes `/` → Plany, `/goscie`, `/plany/:capacity`, `/druk/:capacity`), `Layout.tsx` (tabs Plany | Goście), `queryClient.ts`; `package.json` scripts `dev`, `build`, `test`, `gen:api` (`openapi-typescript ../docs/openapi.yaml -o src/api/schema.d.ts`). Record the visual direction (from `frontend-design`) as a short comment block in `src/app/theme.css`.
- **Test first:**
  - `App.test.tsx`: under `MemoryRouter basename="/wesele"`, `/wesele/goscie` renders the Guests tab; an unknown route redirects to Plany.
  - The build output references assets as `/wesele/assets/...`.
- **Refs:** 003-frontend-design lines 5–43 (§1); 001-state-machine lines 129–165 (§4 app shell); 02-system-context lines 33–44.

### F-02 API layer: client, errors, query keys, hooks
- **Where:** `src/api/client.ts`, `errors.ts`, `keys.ts`, `guests.ts`, `clusters.ts`, `scenarios.ts`.
- **Test first (MSW):**
  - Every non-2xx response becomes an `ApiError` carrying `errors[]`.
  - Each mutation invalidates or replaces exactly the keys listed in 003-frontend-design §2.
  - `useSetAssignment`: the optimistic update appears immediately, an error rolls it back, and a success replaces the scenario with the server copy.
  - `useCalculateProposals` writes `keys.proposals`.
  - `useAcceptProposal` refetches scenarios on a 409.
- **Refs:** 003-frontend-design lines 44–83 (§2) + 196–206 (§4 state ownership); openapi: all operations (bundle lines 36–639), `ErrorResponse` (800–812).
- **Depends on:** F-01.

### F-03 Pure domain modules
- **Where:** `src/domain/guestIndex.ts`, `companions.ts`, `optimistic.ts`, `dropPreview.ts`, `labels.ts`.
- **Test first (Vitest, table-driven):**
  - `search("michal")` finds "Michał" (diacritics- and case-insensitive).
  - `effectiveCompanions` on the Maciek/Michał/Ola fixture: Michał is direct, Ola is "via Michał".
  - `applyMove` moves a placement and recomputes fills without touching scores.
  - `dropPreview` sets `overCapacity` at 11/10 and flags the source table falling under 6; `preferredHere` counts preferred companions at the target.
  - `labels` has a Polish label for every `Violation.code`, `DataWarning.code` and `ErrorCode`.
- **Refs:** 003-frontend-design lines 44–83; openapi schemas `Cluster` (954–999), `ClusterPlacement` (1190–1212), `PlanTable` (1213–1237), `Violation` (1276–1306), `DataWarning` (1000–1031), `ErrorCode` (770–780).
- **Parallel with:** F-02.

## Slice 2 — MVP data entry (manual, first-class)

### F-04 Guests page: list, filters, per-row switch, bulk toggle
- **Where:** `features/guests/GuestsPage.tsx`, `GuestTable.tsx`, `GuestRow.tsx`, `GuestFilters.tsx`, `BulkToggleBar.tsx`.
- **Test first:**
  - Filters: Dzieci, Wyłączeni, and search. The filter state is mirrored to the URL.
  - "Zaznacz wszystkie widoczne" then "Wyłącz" sends one `PATCH /guests` with all the ids.
  - The row switch sends `PATCH /guests` with one id.
  - A disabled row is visibly muted, and the child marker is visible.
  - Counters show "92 gości, 85 uwzględnionych, 7 dzieci".
- **Refs:** openapi `toggleGuests` (bundle `/guests` lines 36–124), `GuestBulkToggle` (849–865); 003-frontend-design lines 207–213 (§5); 001-state-machine lines 11–53 (§1 guest lifecycle) + 129–165 (§4 Guests sub-states); 003-sequences lines 108–142 (flow 3).
- **Depends on:** F-02, F-03.

### F-05 Quick add + edit + delete
- **Where:** `features/guests/QuickAddBar.tsx`, `GuestEditDialog.tsx` (React Hook Form + Zod), delete with a confirmation.
- **Test first:**
  - Typing "Karolina Nowak" + Enter sends a `POST /guests` (first name "Karolina", last name "Nowak"), clears the input and keeps focus.
  - "Zosia" (one word) gives lastName null.
  - Ctrl+D toggles the child mark for the next add.
  - 422 `duplicate_name` keeps the text and shows the error inline.
  - Ten consecutive adds need no mouse.
  - Editing sends `version`. A 409 shows "Ktoś zmienił tego gościa" and reloads.
- **Refs:** openapi `createGuest`, `updateGuest`, `deleteGuest` (bundle lines 36–175), `GuestCreate` (813–838), `GuestUpdate` (866–893); 003-sequences lines 143–187 (flow 4); 003-frontend-design lines 207–213.
- **Depends on:** F-04.

### F-06 Link editor: add-by-search with cluster expansion, data warnings
- **Where:** `features/guests/LinkEditor.tsx`, `GuestSearchCombobox.tsx`, `ClusterWarnings.tsx`.
- **Test first:**
  - Picking "Michał" in Grupa 1 of Maciek sends `PUT /guest-links/4-6 {level:1}`.
  - After the clusters refetch, the column shows "Michał" and "Ola (przez grupę 0 Michała)".
  - "Dodaj «X» jako nowego gościa" sends POST then PUT.
  - Removing a link sends DELETE.
  - `cluster_exceeds_8` and `conflicting_link_levels` warnings render next to the involved guests.
  - Keyboard only: type, arrow, Enter.
- **Refs:** openapi `upsertGuestLink`, `deleteGuestLink` (176–230), `getClusterOverview` (231–280); glossary lines 21–52 (Cluster affinity, Data warning); 003-sequences lines 143–187; 003-frontend-design lines 207–213.
- **Depends on:** F-05.

## Slice 4 — plans

### F-07 Plans page: compare, Generate, preview, accept, needs-recalculation
- **Where:** `features/plans/PlansPage.tsx`, `PlanCard.tsx`, `GenerateButton.tsx`, `ProposalPreview.tsx`, `RecalculationBanner.tsx`.
- **Test first:**
  - Three cards (8/10/12) show table count, fill bars, score and violation count.
  - `needsRecalculation` shows "Wymaga przeliczenia" and a "Przelicz / Generuj" button.
  - Generate shows three proposals next to the current plans.
  - "Akceptuj wszystkie" sends three PUTs; one 409 shows a toast for that plan while the others stay accepted.
  - Discard clears the preview.
- **Refs:** openapi `listScenarios`, `calculateProposals`, `acceptProposal` (bundle lines 345–506), `PlanSummary` (1157–1189), `Proposal` (1368–1384), `AcceptPlan` (1416–1433); 001-state-machine lines 54–92 (§2 incl. UpToDate/NeedsRecalculation); 003-sequences lines 10–68 + 108–142.
- **Depends on:** F-02, F-03.

### F-08 Plan detail: floor plan (read), tray, guest panel, search
- **Where:** `features/plans/PlanDetailPage.tsx`, `FloorPlan.tsx` (CSS grid of tables), `TableCard.tsx`, `ClusterChip.tsx`, `UnseatedTray.tsx`, `GuestDetailsPanel.tsx`, `PlanSearch.tsx`.
- **Test first:**
  - Tables render "fill/capacity" and violations (icon + text).
  - Chips group cluster members.
  - The tray lists unseated clusters.
  - `?guest=8` highlights that guest's table and opens the panel, which shows satisfaction (`preferredAtTable / preferredTotal`) and where each preferred companion sits.
  - Search works by name, including on a phone viewport.
- **Refs:** openapi `SeatingPlan` (1307–1336), `PlanTable` (1213–1237), `GuestScore` (1238–1275); 003-frontend-design lines 84–206; glossary UC-14, UC-16 (lines 68–91).
- **Depends on:** F-07.

### F-09 Drag & drop moves, pins, add/remove table
- **Where:** `FloorPlan.tsx` (dnd-kit `DndContext`, pointer + keyboard sensors, announcements in Polish), `TableCard.tsx` (droppable + preview), `ClusterChip.tsx` (draggable + pin toggle), table add/remove controls.
- **Test first:**
  - Keyboard: Space, then arrows to a table, then Space. This sends `PUT .../assignments/{clusterKey}` and the chip moves optimistically.
  - A server error rolls the chip back with a toast.
  - While hovering, the drop preview shows fill after the drop and an over-capacity warning.
  - The pin toggle sends `pinned: true` with the current table.
  - Dropping on the tray sends DELETE.
  - "Dodaj stół" sends POST /tables. Deleting a table asks for confirmation, then shows its guests in the tray.
- **Refs:** openapi `setAssignment`, `deleteAssignment`, `addTable`, `deleteTable` (bundle lines 507–617), `AssignmentSet` (1444–1456); 001-state-machine lines 93–128 (§3 DnD); 003-sequences lines 69–107 (flow 2).
- **Depends on:** F-08.

## Slice 5

### F-10 Print view
- **Where:** `features/plans/PrintView.tsx` + print CSS.
- **Test first:** renders one block per table with names sorted. Disabled guests are excluded. No interactive controls in print media.
- **Refs:** glossary UC-15 (lines 68–91); 001-state-machine lines 129–165.
- **Depends on:** F-08.

## DEFERRED (post-MVP, lowest priority, last)

### F-11 Import screen
- **Where:** `features/import/ImportPage.tsx`, `src/api/import.ts`.
- **Test first:**
  - Choosing a file triggers a dry run, which shows counts and problems grouped by severity.
  - "Importuj" is disabled while there are errors, and requires typing a confirmation ("zastąp wszystko").
  - A commit invalidates all keys.
- **Refs:** openapi `importGuests` (281–344, `x-status: deferred`), `ImportReport` (1118–1138); 001-state-machine lines 129–165 (Import sub-state).
- **Confirm the CSV format with the user first (glossary A-15).**

---

## Verification
- [ ] F-01…F-10 done with listed tests; F-11 only when scheduled
- [ ] Every screen checked at desktop + phone width; keyboard paths work
- [ ] Diagram ↔ code: modules/components match `003-frontend-design.md` §1–§3; no client-side scoring
