# 015 — Avoid strangers at the table + missing-links report + mixed plan by bilans (floor 9, free table count)

## Requirement (user, 2026-10-03)
"Zróbmy tak, że osoba nie może siedzieć z ludźmi spoza grupy 1 i 2 (de facto będzie musiało być tak, że każdy ma przynajmniej tych 11 ludzi w grupie 0, 1, 2"
Clarification (user answer to my feasibility analysis): **"Maksymalnie unikać obcych"** — not a hard infeasible-by-violation rule; the optimiser minimises strangers first, goes to zero automatically when the data allows, and the user completes the links over time.

## Findings that shaped the choice (orchestrator, live data 2026-10-03, 105 enabled guests in 45 families)
- A strict "every table = everyone knows everyone" rule is **infeasible today**: 21 guests (11 families, named only in the chat with the user) have no mutually-acquainted group (group 0 ∪ group 1/2 cliques) of 8, the table floor; 47 guests cannot sit at a 10/11-person all-known table, 65 not at a 12-person one. 41 guests know fewer than 11 people in groups 0/1/2 (own family included).
- So: soft-lexicographic, with a diagnostic that tells the user which links are missing.

## The rule (orchestrator's reading; Architect formalises, flags problems)
- **Stranger pair** = two enabled **adults** (children are not scored, task 014; they follow their family) from **different** clusters sitting at the same table with **no** group-1/2 affinity between their clusters (group-0 mates are never strangers; either level 1 or 2 makes them acquaintances — equal weight for "not stranger").
- **Objective order** for the optimiser, after the hard rules (cluster integrity, capacity, floor, fewest tables k, pins): (1) fewest **isolated adults** (task 011), then (2) fewest **stranger pairs**, then (3) highest satisfaction score (task 011/014 weights unchanged: 1.0/0.5). Replace the pair (iso, score) by the triple everywhere (repair, restarts, best-seen, `improve`, `anneal`, mixed-plan comparisons), with exact incremental deltas. Stranger pairs at a table: `cross-cluster adult pairs − known pairs` where cross pairs = `(A_t² − Σ adults_a²)/2` and known pairs = Σ over partner cluster pairs at the table of `adults_a·adults_b` (level 1 or 2 equally) — Architect to state the delta rules and keep determinism and Generate ≲ 5 s (re-measure; the objective got one more term).
- **Mixed plan (decided by the user 2026-10-03, replaces the k0/k0+1 rule and the 'z 1 stołem więcej' diagnostic):** "Nie upychamy na siłę do 12, 11 czy 10 osób, tylko patrzymy jaki układ da najlepszy wynik. W ogóle nie obchodzi nas liczba stołów, tylko żeby było min 9 osób przy każdym." → 9–12 guests per table (floor 9), any k in [⌈N/12⌉, ⌊N/9⌋], maximise the **bilans** = score − 2λ·stranger pairs (λ = 1), ties → fewer tables. The four uniform plans keep fewest tables + the triple.
- **Display (prefer no contract change):** a plan-level "Pary obcych: N" = Σ adults' `strangersAtTable` / 2 derived client-side from `GuestScore` (task 014 already counts adult strangers); per-table "Obcy: N par" and the guest-level "Obcych dorosłych przy stole: N" already exist. Add a table-level cue if cheap.
- **Missing-links report (frontend-only, derived from `GET /clusters` + `GET /guests`):** a small screen/section (e.g. "Braki powiązań", linked from the guests page) listing families by how well they can be seated with acquaintances only: people known in groups 0/1/2 (own family incl.), the **largest mutually-acquainted group** containing them (max clique over the cluster graph, weights = enabled seated sizes), and whether it reaches the table floor 8 / the sizes 9–12; sorted worst first; each family clickable to open its relations panel. Explain in Polish what to add ("dopisz powiązania z grup 1/2 z rodzinami, które znają też ich znajomi"). Keep it modest (YAGNI): no suggestions engine, no new endpoints. Computation must be fast for ~50 families (exact max clique on the small graph is fine).
- Docs: glossary (*Stranger pair*), `03-seating-model.md` (Scoring/Isolation/algorithm legend, examples incl. a table of two acquaintance cliques, the data findings as the motivating example without names), backend/frontend design, and the point that the PIN-protected live data is NOT copied into docs (families named only in chat).

## Phases
### Phase A / A2 — Architect (done)
Docs + contract descriptions + bundle; worked examples; delta rules; test lists; mixed plan by bilans. No code. Commits: phase A, phase A2.
### Phase B1 — Backend-Go
(1) Uniform plans: triple objective with exact deltas (§11). (2) Mixed plan: `FloorOf`/`MixedFloor = 9`, `StrangerPenalty = 1`, `order` field (lex/net), `proposeMixed` over k ∈ [⌈N/12⌉, ⌊N/9⌋] with pins raising the lower bound (§12). Tests §11.6 + §12.6 (incl. brute-force oracles, determinism), existing expectations changed only with a justified before/after in the commit message (M1–M8 rewritten as X-tests). Time re-measured: Generate ≲ 8–10 s (expected ≈ 6.5–7.5 s). `go vet`, `go test -p 2 ./...` green.
### Phase B2 — Frontend-web
"Pary obcych" (plan, detail, table), "Bilans" (all five plans), the missing-links report (§15), the mixed plan's floor 9 / removed `EXTRA_TABLE_NOTE` / new subline (§16) + tests; typecheck/lint/test/build green.
### Phase C — Orchestrator
Backup (`infra/backup.sh`), redeploy, `POST /scenarios/calculate` on the live data: per plan k, fills, isolated adults, stranger pairs, score, bilans (before/after), the mixed plan's chosen k and "potrzebne stoły", Generate time; stored mixed plan shows `under_floor` for tables of 8 until regenerated; report the missing-links report numbers (counts only; families only in chat); move this file to `done/`.

## Phase A output (Architect, 2026-10-03, updated A2) — what to read

Decisions: rule 6 "avoid strangers" between isolation (5) and satisfaction (7) in the four uniform plans; triple (isolated adults, stranger pairs, score) with exact O(1) stranger deltas (`adultsAt`, `knowTo`); anneal skip → "some movable item has an adult"; walk-only `annealStrangerWeight = 2`. Mixed plan: floor 9, free k, scalar bilans = score − 2·stranger pairs (λ = 1), ties fewer tables, pins raise the lower bound of k; displayed score unchanged everywhere, "Pary obcych" and "Bilans" derived on the client for all five plans. No contract shape change (descriptions + example, bundled + linted). Missing-links report: collapsible section on `/goscie`, exact max-weight clique. Diagnostic "z 1 stołem więcej" dropped.

**Backend-Go must read:**
- `docs/architecture/03-seating-model.md` lines 21–33 (rules), 91–148 (§ Stranger pairs, examples I–K; § Missing-links report for context), 229–274 (algorithm + legend + "Expected after task 015"), 276–337 (§ The mixed plan, examples L–O, time budget)
- `docs/architecture/diagrams/003-backend-design.md` §11 (lines 1044–1190) and §12 (lines 1191–end) in full; §8.3 (line 674) and §10.4 (line 978) for the iso deltas; §9.7 note (M1–M8 replaced)
- `docs/architecture/01-domain-glossary.md` lines 39–44 (Mixed plan, Table size, Floor), 55–59 (Known, Stranger pair, Acquainted group, Bilans, Missing-links report), 155–158 (A-21, A-23–A-25)
- `docs/openapi.yaml`: `Capacity`, `Violation.message`, `PlanSummary` descriptions, `POST /scenarios/calculate` description, example `ScenarioMixed`

**Frontend-web must read:**
- `docs/architecture/diagrams/003-frontend-design.md` §15 (lines 576–672) and §16 (lines 673–end) in full; §12 (459–485) for the isolated-line pattern; §13.2 rows marked "Removed in task 015"
- `docs/architecture/03-seating-model.md` lines 91–148 (§ Stranger pairs, § Missing-links report), 276–337 (§ The mixed plan: what is displayed, table size, floor 9)
- `docs/architecture/01-domain-glossary.md` lines 39–44, 55–59, 156
- `docs/architecture/diagrams/001-state-machine.md` §6 (mixed table size)
- `docs/openapi.yaml` descriptions above (regenerate `schema.d.ts`)
