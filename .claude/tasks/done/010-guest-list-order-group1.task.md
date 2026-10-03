# 010 — Guest list order: group 0 first, group 1 second

## Requirement (user, 2026-10-03)
"Co do grupowania/sortowania gości - musi być najpierw po grupie 0, a w drugiej kolejności po grupie 1"

## Today
`GuestsPage` (plain list, no search, no "related to" filter) uses `sortByCluster` (`frontend-web/src/domain/companions.ts`): whole group-0 clusters stay together, clusters ordered by their first member's name. There is no second criterion, so people/families who "want to sit together" (group 1) are scattered across the list.

## Interpretation (orchestrator; Architect may refine, flag if something is off)
- Group-1 affinity is a relation **between whole clusters** (03-seating-model: "Affinity is a relation between whole clusters", server-computed `Cluster.affinities`, levels 1 and 2). So inside one cluster all members share the same group 1; "second by group 1" can only order **clusters**.
- **Primary key: group 0** — a cluster's members always stay together (unchanged).
- **Secondary key: group 1** — clusters with a **level-1** affinity are placed next to each other: connected components of the level-1 cluster graph stay contiguous; inside a component clusters follow a traversal from the alphabetically first cluster, always continuing with its alphabetically first not-yet-placed level-1 neighbour (so direct partners end up adjacent as often as the graph allows); components and unconnected clusters are ordered by their first member's name (Polish collation, ties by id), as today. Level 2 is **not** used for ordering.
- Applies to the **default list only** (no search query, no "powiązani z" filter): search keeps its ranking and "related to" keeps relation order, as today. Filters (e.g. disabled/children) still apply first, and the order is computed over the guests that remain visible (an affinity to an invisible cluster does not drag anyone).
- Pure display logic, deterministic, no API/contract/DB change. Optional small visual cue (e.g. a subtle divider or a "grupa 1" hint between blocks) only if it is cheap; do not add controls.

## Phases
### Phase A — Architect (small)
Specify the ordering rule precisely in `docs/architecture/diagrams/003-frontend-design.md` (where `sortByCluster` / the guest list is described) including the traversal and tie-breaks, the scope (default list only) and the test cases. No contract change. Commit.

### Phase B — Frontend-web
Implement in `domain/companions.ts` (extend `sortByCluster` or add a function it uses; keep it pure), wire in `GuestsPage` if needed, tests (fixtures: chain A–B–C of level-1 clusters, a star, a cycle, level-2-only link not used, invisible neighbour, unconnected clusters, determinism, input not mutated, unchanged behaviour with no affinities). `npm run typecheck`, lint, test, build green. Commit only `frontend-web/`.

### Phase C — Orchestrator
Redeploy (backup first: `infra/backup.sh`; compose needs `infra/.env`), check the list on the real data (via the logged-in UI or API `GET /clusters` + order logic), move this file to `done/`.

## Phase A output (Architect, 2026-10-03) — commit 6932206
**Frontend-web must read:**
- `docs/architecture/diagrams/003-frontend-design.md` lines 392-453 (§11: scope, definitions, ordering rule, flowchart, test table #1-14, flagged problems)
- same file line 83 (`sortByCluster` entry in §2 module interfaces)
- `docs/architecture/03-seating-model.md` lines 14-18 (§ "Who counts": affinity is cluster-level)
Note: §11 problem 1 is a latent bug in today's `sortByCluster` (hidden member named `''` jumps the cluster to the top), fixed by the new rule; test #9.
