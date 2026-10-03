# 011 — Wykluczanie izolacji (no guest seated with strangers only)

## Requirement (user, 2026-10-03)
"Spróbujmy jeszcze jedną zasadę. Osoby, które siedzą przy stole z osobami spoza grupy 1 i 2 muszą mieć np. -1 do zadowolenia. Aktualny przypadek: 12 osobowe stoliki -> Michał Szczyrba, poza jego grupą 0 (która nie powinna generować żadnego zadowolenia) są same osoby spoza grupy 1 i 2 -> Michał byłby skrajnie niezadowolony z takiego stolika. Trzeba unikać takich sytuacji"
Clarifications (user answers, 2026-10-03): form = **−1 when the guest has no acquaintances at the table** (not per stranger). In the current case "traci Michał, Martyna, Zuzia i Zosia. Wszyscy po prostu są niezadowoleni" → the penalty is **per guest**: every member of the isolated cluster gets it (a cluster of 4 isolated = −4).

## Requirement change (user, 2026-10-03, latest — supersedes the soft "−1" reading)
"Ostatecznie chodzi o to żeby bardzo unikać (wykluczyć) takich sytuacji, że ktoś siedzi przy stole tylko ze swoją rodziną bez jakichkolwiek znajomych."

## The rule (as designed in Phase A; authoritative text: `docs/architecture/03-seating-model.md` § Rules + § Isolation)
- **Isolated guest** ("bez znajomych przy stole"): a seated enabled guest whose cluster has at least one partner cluster (group-1/2 affinity, ≥ 1 enabled member, seated or not; group-0 mates never count) and **no** enabled partner guest at the table. Always the whole cluster at once. A guest with no partners at all is never isolated.
- **Display:** satisfaction −1 per isolated guest (`IsolationPenalty = 1`); `GuestScore.satisfaction` can be negative and is negative **iff** the guest is isolated. Table/scenario scores include it (whole numbers, can be negative).
- **Optimiser: lexicographic.** Among layouts allowed by the hard rules (clusters, capacity, fewest tables k, floor 8) and pins: first the **fewest isolated guests**, then the highest score. Explicit pair `(iso, score)`, never a weighted sum (no big-M, no overflow). Isolation never adds a table and never moves a pin.
- **Unavoidable isolation** (e.g. the only partner cannot fit, or only k + 1 tables would fix it): the plan stays valid; **not a violation**, `needsRecalculation` unchanged; the UI shows the marker per guest and a count per plan (derived client-side, no contract field).
- **Phase C diagnostic:** a test-only report (`TestDiagnoseIsolation`, env `STOLIKI_DIAG_INPUT`) shows per capacity the isolated guests at k and whether k + 1 tables would remove them, so the user can decide; that trade-off is **not** implemented.
- Unchanged: weights 1.0 / 0.5, floor, determinism (constant-seed PRNG, fixed budgets), time budget (re-measure), violations.

## Phase A result (Architect, done) — what to read

**Backend-Go must read:**
- `docs/architecture/03-seating-model.md` lines 20–105 (§ Rules, § Scoring, § Isolation with worked examples A/B/C) and lines 106–140 (algorithm flowchart + legend: objective, anneal/improve wording)
- `docs/architecture/diagrams/003-backend-design.md` lines 52–92 (§2.1 signatures: `IsolationPenalty`, `Summary.Isolated`, `GuestScore.Isolated`) and lines 582–795 (§8 entire: Evaluate, items/layout/objective, exact delta rules §8.3, where the objective is used §8.4, `feasibleAt` §8.5, diagnostic §8.6, tests §8.7, audit §8.8)
- `docs/openapi/components/schemas.yaml` `GuestScore` (line 461+) — description only; `httpapi` does NOT map the Go-only `Isolated` fields

**Frontend-web must read:**
- `docs/architecture/03-seating-model.md` lines 49–70 (§ Isolation: definition, not a violation)
- `docs/architecture/diagrams/003-frontend-design.md` lines 455–481 (§12: derivation `satisfaction < 0`, `domain/isolation.ts`, `GuestScoreMark` / `GuestDetailsPanel` / `PlanFigures` changes, tests)
- `docs/architecture/01-domain-glossary.md` line 49 (*Isolated guest*)
- Regenerate `api/schema.d.ts` from `docs/openapi.yaml` (descriptions/examples changed only; no type change)

## Phases
### Phase A — Architect (DONE 2026-10-03, see "Phase A result" above)
Update `docs/architecture/03-seating-model.md` (Scoring section: the new term; rule list; examples incl. Michał-type case; algorithm legend), `diagrams/003-backend-design.md` (evaluate/layout/anneal changes, delta rules, tests), glossary if a term is needed (e.g. *Isolated guest* / "samotny przy stole"), and `diagrams/003-frontend-design.md` for how satisfaction is shown: negative values, a visible "bez znajomych przy stole" marker on the guest in the table/guest views (what is the cheapest meaningful cue; `GuestScore` already has `preferredAtTable`, `fallbackAtTable`, `strangersAtTable` — decide whether the contract needs a new field, e.g. `isolated: boolean`, or the client derives it from `preferredTotal`/`preferredAtTable`/`fallbackAtTable`; prefer derivation, no contract change if it works; if the contract changes bump `docs/openapi/**` + bundle). No code. Commit.

### Phase B1 — Backend-Go
Implement exactly `diagrams/003-backend-design.md` §8 (lexicographic objective, delta rules §8.3, `feasibleAt`, diagnostic test §8.6, test list §8.7, which supersedes the list below where they differ) in `internal/seating` (`evaluate.go`, `propose.go`, `anneal.go` and wherever scoring/deltas live); tests: unit tests of the penalty in `Evaluate` (isolated vs not, unseated, disabled partner, partner sits elsewhere, guest with no partners), objective/delta consistency (incremental score == recomputed score after random moves — property test), a synthetic fixture reproducing the Michał case at capacity 12 (a 4-person cluster whose only partners could sit elsewhere) asserting `Propose` avoids isolation when a layout without it exists, existing tests updated only where the new objective makes a different plan strictly better (justify in the commit message), determinism, benchmark. `go vet ./...`, `go test ./...` green. Commit `backend-go/` (+ contract/docs only if the Architect changed them).

### Phase B2 — Frontend-web (only if the Architect's design needs UI changes)
Needed: implement `diagrams/003-frontend-design.md` §12 (derive isolation from `satisfaction < 0`, badge in `GuestScoreMark`, line in `GuestDetailsPanel`, count in `PlanFigures`); tests; typecheck/lint/test/build green.

### Phase C — Orchestrator
Backup (`infra/backup.sh`), redeploy, run `POST /wesele/api/scenarios/calculate` on the real data (login with the cookie flow from AGENTS.md; do not print guest names in the report beyond what is needed) and confirm: no cluster with partners is isolated when avoidable, in particular the Michał cluster at capacity 12; k and floor unchanged; compare scores before/after (the displayed score may drop: it now includes −1 per isolated guest, and fewer isolated guests beats a higher score); run the k + 1 diagnostic (`diagrams/003-backend-design.md` §8.6) and report to the user, per capacity, any remaining isolation and whether one more table would remove it (user decides; do not implement); then move this file to `done/`.
