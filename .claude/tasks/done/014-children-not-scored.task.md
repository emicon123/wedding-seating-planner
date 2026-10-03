# 014 — Children do not count towards satisfaction (they still take seats)

## Requirement (user, 2026-10-03)
"Czy dzieci i ich zadowolenie wlicza się do wyniku?? (Nie powinno)"

## Findings (orchestrator, live data 2026-10-03)
- `isChild` has **no effect** in the seating code today (glossary: "marker used for filtering and bulk toggling … no effect on seating rules"; `seating.Guest{ID, Enabled}` has no child flag). Children are scored like adults.
- Plan 12: score 594, of which **112 (19%) is children's own satisfaction** (16 enabled children). Children have no group-1/2 links of their own and always sit in a family (group-0 cluster); their satisfaction comes through the family's affinities.
- Second effect: a cluster's weight in the pairwise gain (`2·size_a·size_b·w`) and in the isolation count uses `SeatedSize()` which **includes children**, so families with many children are over-weighted when seating friends.

## The rule (orchestrator's reading — Architect formalises, flags problems)
- **Children still take seats.** They count in table fill, capacity (≤ 9/10/11/12 / ≤ 12 for mixed), the floor of 8, cluster integrity (a child always sits with the family's table) and in "Potrzebne stoły". `Evaluate`'s fill and violations are unchanged. (Open: the floor counts guests incl. children — keep as is unless the user says otherwise.)
- **Children are not scored**: they neither **receive** satisfaction (their `GuestScore.Satisfaction` is 0 and excluded from table/plan scores, `Summary.Score`, and the isolation penalty — a child is never "isolated" and never contributes to `Summary.Isolated`) nor **give** it (a friend's child sitting at the table adds nothing to an adult's satisfaction). So in the optimiser the weight of a cluster in gains and in the isolation count is its **number of enabled adults** (`SeatedSize() − children`), not its seated size. A cluster with 0 enabled adults carries no weight (it still sits somewhere because it takes seats; where it sits is decided by the hard rules and ties; prefer deterministic placement with its adults' ... n/a).
- Affinity itself (cluster ↔ cluster by group 1/2) is unchanged: an adult's partner cluster still counts as acquaintance **if it has at least one enabled adult**; a partner cluster consisting only of children does not make an adult "not isolated" and is not a partner for `hasPartner`.
- `isChild` must reach the `seating` package: extend `seating.Guest` with `Child bool` (or equivalent) fed from the guests table in `scenarios.Service`; the `Cluster` type gets `Adults []GuestID`/`AdultSize()` or the optimiser computes it. Keep determinism, the annealing/isolation objective (lexicographic (isolated adults, score)), the mixed-plan rule (k0 vs k0+1 uses isolated **adults**), and the Generate time (≲ 5 s; re-measure).
- Contract: prefer **no API shape change** (children's `GuestScore.satisfaction = 0`; the client already knows `isChild` from `GET /guests` and hides hearts / the "Bez znajomych" badge for children). If a field is truly needed, decide it. Update `schemas.yaml` descriptions (satisfaction of a child is 0 and not counted).
- UI: children show no satisfaction mark or isolation badge (but their seat and name stay); plan/table scores shown are the adults-only scores; "Łącznie bez znajomych: N os." counts adults only. No new controls.
- Docs: glossary (`isChild` row no longer "no effect on seating rules"), `03-seating-model.md` (Who counts, Scoring, Isolation, examples, the algorithm legend), backend/frontend design, ADR note if architectural.
- Known side effect to state in the docs and tell the user: displayed plan scores drop (the 19% children share disappears) and numbers are not comparable with earlier ones.

## Phases
### Phase A — Architect
Docs + contract descriptions (+ bundle, `make openapi-bundle openapi-lint`), with worked examples (a family with children; a partner cluster of only children; a cluster of only children; floor/fill unchanged) and the test list. No code. Commit.
### Phase B1 — Backend-Go
`seating.Guest` child flag, adults-based weights in `newItems` (gain, `hasPartner`, isolation size), `Evaluate` (children's `Satisfaction` 0, excluded from sums/isolation; fill unchanged), pass the flag from the guests service/store into `BuildGraph` everywhere (`scenarios.Service` list/calculate/replace/evaluate paths), tests incl. incremental-vs-recomputed objective property tests with children, never-weaken updates of expectations (justify each in the commit message), time re-measured. `go vet`, `go test -p 2 ./...` green.
### Phase B2 — Frontend-web
No satisfaction mark / isolation badge for children, adults-only counters, fixtures/tests; typecheck/lint/test/build green.
### Phase C — Orchestrator
`infra/backup.sh`, redeploy, `POST /scenarios/calculate` on the live data: scores before/after (adults-only), isolated adults, k and floor unchanged; move this file to `done/`.

## Phase A output (Architect, 2026-10-03) — read before implementing

Decisions: seats count every enabled guest (fill, capacity, floor of 8 **incl. children**, k, integrity, Potrzebne stoły — unchanged); scores count enabled adults only. `seating.Guest.Child` → `Cluster.Adults` / `AdultSize()`; optimiser weight = adult weight (`items.adults[]`, gain `2·w·A_a·A_b`, ΔI weighted by adults, `hasPartner` needs a partner with ≥ 1 adult and is false for a children-only item); `size[]` stays the seats. Child `GuestScore` = all zeros (Table kept), `PreferredTotal/AtTable/FallbackAtTable/StrangersAtTable` count adults only. No API shape change (descriptions only, bundled + linted). No migration, no ADR (decision lives in 03-seating-model § Children).

**Backend-Go must read:**
- `docs/architecture/03-seating-model.md` lines 14–87 (Who counts, Scoring, Isolation) and lines 88–143 (§ Children: table of what changes, edge cases, worked examples D–H = test fixtures)
- `docs/architecture/03-seating-model.md` lines 168–210 (algorithm legend; add the measured "Task 014" numbers at the placeholder) and 211–245 (mixed plan: iso = isolated adults)
- `docs/architecture/diagrams/003-backend-design.md` lines 52–70 (§2.1 signatures: `Guest.Child`, `Cluster.Adults`, `AdultSize`) and lines 927–1038 (§10: data flow, graph/evaluate/propose changes, tests C1–C8, D10–D13, property, Propose, scenarios/httpapi, diagnostic JSON `child`, time)
- `docs/architecture/diagrams/003-backend-design.md` lines 674–720 (§8.3 delta rules: replace `size` by `adults` in ΔI)
- `docs/architecture/01-domain-glossary.md` lines 27–28, 53–54, 151 (isChild, Adult weight, Satisfaction, Isolated guest, A-22)
- `docs/openapi.yaml` → `GuestScore`, `PlanTable.score`, `PlanSummary.score`, `SeatingPlan.guestScores`, `Guest.isChild` (descriptions)

**Frontend-web must read:**
- `docs/architecture/diagrams/003-frontend-design.md` lines 554–574 (§14: what follows without code, the three changes, copy, tests)
- `docs/architecture/03-seating-model.md` lines 88–143 (§ Children)
- `docs/openapi.yaml` → `GuestScore` descriptions (regenerate `schema.d.ts`, comments only)
