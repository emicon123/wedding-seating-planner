# 008 — Better auto-seating: simulated-annealing polish after the greedy + local search

## Requirement (user, 2026-10-03)
"zobacz czy algorytm generowania stolików pod kątem maksymalnego zadowolenia jest poprawny i optymalny. plan na stoliki 12 osób wydaje się nie być taki" → audit found it correct but not optimal; user approved fixing it ("Tak").

## Audit findings (orchestrator, on the live guest list: 106 enabled guests, 25 clusters)
`Propose` score vs best found by simulated annealing over the same model and the same hard rules (same k, capacity, floor 8, clusters intact):

| capacity | tables | Propose | best found | gap |
|---|---|---|---|---|
| 9 | 10 | 212 | 228 | +8% |
| 10 | 10 | 258 | 286 | +11% |
| 11 | 9 | 260 | 316 | +22% |
| 12 | 9 | 172 | 308 | +79% |

At capacity 12, SA reached 308 in 10 of 10 runs at 2M iterations (8 of 10 at 400k) — likely the true optimum. Cause: `pack` fills tables greedily to capacity; `improve` (`backend-go/internal/seating/propose.go`) only does strict-improvement single moves and pair swaps, which are blocked when tables are nearly full → local optimum. Rules, k selection, floor handling, cluster integrity are correct (oversized clusters at 9/10/11 are reported as `oversized_cluster` + unseated, as specified).

## Decisions (orchestrator defaults — Architect may flag problems)
- Keep everything before `improve` as is (k selection, pack, repairFloor, packExact) — they decide **feasibility and the table count**, which must not change. Only the score optimisation after a feasible layout exists is replaced/extended.
- Add simulated annealing (moves + swaps, same hard constraints as `improve`: capacity, floor 8 (waived for k = 1), pinned clusters never move, clusters are atomic items) starting from the feasible layout, keep the **best layout seen**, and finish with the existing `improve` pass. Never return anything worse than the layout it started from.
- **Determinism is a hard requirement** (same input → same plan; tests rely on it): a tiny self-contained PRNG with a constant seed (e.g. splitmix/xorshift in the package — no `math/rand` global, no clock), a fixed iteration budget (no time-based cut-off), stable iteration order. Update the "no clock, no randomness" package doc and `03-seating-model.md` ("deterministic heuristic ... not a proven optimum") accordingly.
- Budget: at ~100 guests, ≥ 400k iterations per capacity (the prototype: 20 runs × 400k × 4 capacities ≈ 4.6 s total ⇒ ~60 ms per run); prefer several restarts/seeds or ~2M iterations if it stays well under 1 s per capacity on the Pi (ARM64) and Generate (four capacities) under ~2–3 s. Measure with a benchmark on a ~100-guest fixture; document the numbers. Consider running the four capacities in parallel goroutines (pure functions, results ordered 9–12) if needed.
- Objective unchanged: Σ over table-mates of w(affinity) (group 1 = 1.0, group 2 = 0.5), see `03-seating-model.md` § Scoring. Do not change weights or rules here.
- Quality gate (tests): on a fixture that mirrors the live data's shape (25 clusters of sizes 2×7, 3×8, 4×4, 6, 8×3, 10, 12 with group-1/2 affinities; build a synthetic one — do NOT commit the real guest list, it is personal data) assert that for capacity 12 the annealed score ≥ the old local-search score on the same input and reaches the known optimum found by a long independent run, plus property tests: all hard rules hold, pins kept, deterministic (two calls equal), never worse than the pre-anneal layout, minimum table count unchanged vs the oracle in `oracle_test.go`. Existing tests that pin exact plans may need their expected plans updated where the new plan is strictly better — justify each such change in the commit message.

## Phases

### Phase A — Architect (small)
Update `docs/architecture/03-seating-model.md` (algorithm flowchart box J + legend, determinism wording, time budget), the `003-backend-design.md` § for `internal/seating` if it names `improve`, and add a short note on the budget/PRNG decision (ADR-001 amendment only if you judge it architectural). No contract/schema change expected. NOTE: task 007's Architect phase also edits `03-seating-model.md` — start only after 007 Phase A is committed.

**Phase A done (2026-10-03).** No contract, schema or migration change; no new ADR (an internal algorithm stage, not architectural); ADR-001 §7 timing note corrected inline.

**Backend-Go must read:**
- `docs/architecture/03-seating-model.md` lines 66–97 (§ Auto-seating algorithm: flowchart with boxes J = anneal, J2 = improve; legend: two stages, determinism, time budget, *Measured* placeholder that Phase B fills in)
- `docs/architecture/03-seating-model.md` lines 20–41 (§ Rules + § Scoring — unchanged objective and hard rules)
- `docs/architecture/diagrams/003-backend-design.md` lines 102–132 (§2.1 internal functions + "Score optimisation stage (task 008)": `rng`, `anneal`, `optimise` sketch, postcondition, determinism note, parallel-Calculate fallback, `graph.go` package-doc rewording)
- `docs/architecture/diagrams/003-backend-design.md` line 399 (§4 pattern evaluation: no Strategy / no RNG interface)

### Phase B — Backend-Go
Implement in `backend-go/internal/seating` (new file e.g. `anneal.go`; wire into `Propose` after the feasible layout and before returning), tests as above, benchmark, `go vet`, `go test ./...` green. Remove the temporary-audit approach: no test reads the live DB or `guests.json`.

### Phase C — Orchestrator
Redeploy (backup first), run Generate on the real list and confirm the capacity-12 score rose to ≈308 (via `GET /scenarios` summaries) and that Generate stays fast, then move this file to `done/`.

## Deliverables
Docs updated (A); annealing + tests + benchmark (B); deployed, capacity-12 plan clearly better on the real guest list (C).
