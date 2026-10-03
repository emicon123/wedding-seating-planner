# 03 — Seating model: rules, scoring, auto-seating

The rules the seating code (`backend-go/internal/seating`, pure Go, no I/O) implements. Terms: [01-domain-glossary.md](01-domain-glossary.md).

## Inputs and outputs

- **Input:** all guests, each with an `enabled` flag; links (pair, level); and, per scenario, its capacity ∈ {9, 10, 11, 12}, current tables, assignments and pins.
- **Outputs:**
  - `Clusters(guests, links)` → clusters (all members, plus the enabled subset) + cluster affinities + data warnings.
  - `Evaluate(scenario state)` → per guest/table/scenario satisfaction, fill, violations, and **`needsRecalculation` = (at least one violation)**. Called on every scenario read and after every mutation.
  - `Propose(scenario state)` → a Proposal (tables + assignments + its evaluation). Writes nothing.
- **Generate** ("Generuj plany") = `Propose` for all four scenarios (one request, `POST /scenarios/calculate`; the four runs are independent and differ only in capacity), **then the four results are stored at once**, atomically, replacing the four plans (`PUT /scenarios`, see § Storing a Generate below). There is no preview and no per-plan accept: the new tables and assignments are visible straight away in the normal plan views. The previous plans can be restored once with **Cofnij** (§ Undoing a Generate).

## Who counts

- **Clusters** are connected components of the group-0 graph over **all** guests, disabled ones included. Disabling the guest who wrote a family's group-0 list does not split the family.
- Only **enabled** members take seats, count towards fill and are scored. A cluster's *seated size* is its number of enabled members. A cluster with seated size 0 is ignored by Propose and Evaluate.
- **Affinity** is a relation between whole clusters. It is computed from the links of all members, disabled ones included: if any member of A has a level-1 (or level-2) link to any member of B, then A↔B has that level. If the data contains both levels between the same two clusters (should not happen), level 1 wins and a `conflicting_link_levels` data warning lists the guests involved. No other combining logic exists.

## Rules, in strict priority order

1. **Hard — cluster integrity:** all enabled members of a cluster sit at exactly one table.
2. **Hard — capacity:** fill (enabled guests) ≤ capacity.
3. **Fewest tables:** use the smallest feasible table count *k*.
4. **Hard — floor:** every table has ≥ 8 enabled guests (all four capacities; was 6 until 2026-10-03), unless the scenario has a single table. Fewest tables always beats satisfaction.
5. **Exclude isolation** (task 011, "wykluczanie izolacji"): among the layouts allowed by rules 1–4 and 7, use one with the **fewest isolated guests** (§ Isolation below). Soft only in the sense that rules 1–4 and pins beat it: it never adds a table, never breaks the floor or capacity, never moves a pin. Within those rules it is **lexicographically above** satisfaction: no amount of group-1/2 satisfaction buys one more isolated guest.
6. **Maximise satisfaction** (group 1 > group 2 > stranger) among the layouts with that fewest number of isolated guests. Evenness beyond the floor is *not* rewarded — "rebalance only as much as needed" falls out of rules 3–6: with 28 guests at capacity 12, 12 + 12 + 4 is infeasible (floor), so the optimiser picks among feasible splits (e.g. 12 + 8 + 8, 11 + 9 + 8, 10 + 10 + 8, 10 + 9 + 9) the best one.
7. **Pins:** pinned clusters keep their table; the optimiser only moves unpinned clusters.

## Scoring

```
affinity(A, B) = the level of the links between members of A and members of B
                 (1 or 2; none if no link; strongest + data warning if inconsistent)
w(1) = 1.0, w(2) = 0.5, w(none) = 0

IsolationPenalty = 1

satisfaction(g) = Σ over ENABLED table-mates h with cluster(h) ≠ cluster(g) of w(affinity(cluster(g), cluster(h)))
                  − (IsolationPenalty if isolated(g))
table score     = Σ satisfaction(g) for g at the table
scenario score  = Σ table scores
```

Also reported per enabled guest for the UI: `preferredTotal` (enabled effective group-1 companions), `preferredAtTable`, `fallbackAtTable` (group-2 people at the table), `strangersAtTable`. The weights and the penalty are fixed in code.

The table and scenario scores are always whole numbers (a group-2 pair of clusters of sizes a and b adds 0.5·b to each of a's members and 0.5·a to each of b's, a·b in total; the penalty is a whole number per guest). Only a single guest's satisfaction can end in ,5. Scores can now be negative.

### Isolation ("bez znajomych przy stole")

```
partners(A)   = clusters B ≠ A with a group-1 or group-2 affinity to A and at least one ENABLED member
                (seated or not, anywhere; group-0 mates never count — they are A itself)
isolated(g)   = g is enabled AND seated
                AND partners(cluster(g)) ≠ ∅
                AND no enabled guest of any cluster in partners(cluster(g)) sits at g's table
              ⇔ g is seated, has partners, and preferredAtTable(g) + fallbackAtTable(g) = 0
```

- **Per guest, the whole cluster at once:** isolation is a property of the cluster at its table, so every enabled member of an isolated cluster is isolated (Michał, Martyna, Zuzia and Zosia: four isolated guests, −4 on the score).
- **No partners at all → never isolated** (satisfaction 0, as before): nothing can be done for them. Same when every partner cluster is fully disabled.
- **Partner exists but cannot be at the table** (unseated, an oversized cluster, or capacity/floor make it impossible) → isolated. Shown, not hidden.
- **Unseated guests** are not isolated (they have no table; `unseated_guests` already covers them).
- **Not a violation.** `needsRecalculation` and the violation list are unchanged: "Przelicz" cannot help when isolation is unavoidable at the fewest tables, and a plan with an avoidable isolation made by hand is a quality issue, like low satisfaction. The UI marks isolated guests and counts them per plan ([diagrams/003-frontend-design.md](diagrams/003-frontend-design.md) §12).
- **Two numbers, two roles.** The displayed satisfaction takes −1 per isolated guest (what the user sees in the scores). The optimiser does **not** trade that −1 against satisfaction: it compares layouts by the pair (isolated guests ↑, scenario score ↓), lexicographically (rule 5 before rule 6). Within an equal isolated count, "higher score" is the same as "higher group-1/2 satisfaction", since the penalty part is then equal.

**Worked examples** (capacity 12; sizes in brackets; gains are scenario points: a group-1 pair of clusters of sizes a and b adds 2·a·b, group 2 adds a·b).

*A. The Michał case (a shared partner).* M[4] —1— P[2] —1— Q[6] —1— R[2]; strangers S1[4], S2[4], S3[2]; 24 guests, k = 2, both tables exactly 12 (floor and capacity).

| Layout | Group-1/2 points | Isolated guests | Displayed score | Old objective (satisfaction only) | New objective (isolated, score) |
|---|---|---|---|---|---|
| a: {P, Q, R, S3} + {M, S1, S2} | P–Q 24 + Q–R 24 = 48 | M: 4 | 48 − 4 = **44** | **chosen** (48) | (4, 44) |
| b: {M, P, Q} + {R, S1, S2, S3} | M–P 16 + P–Q 24 = 40 | R: 2 | 38 | 40 | (2, 38) |
| d: {M, P, S1, S3} + {Q, R, S2} | M–P 16 + Q–R 24 = 40 | 0 | **40** | 40 | **(0, 40) chosen** |

M can never sit with Q and P together (4 + 2 + 6 = 12 leaves R alone, which is layout b). Without the rule, M sits with strangers only. A soft penalty of −1 per guest would not change that (44 > 40); it takes 3 per guest to flip it, and other data needs more: hence the lexicographic rule rather than a weight. The price is visible: the displayed score drops from 48 (old) to 40, because P now sits with M instead of with the bigger Q.

*B. Unavoidable at the fewest tables.* M[4] whose only partner is X[10]: 14 > 12, so they never share a table. M (4) and X (10) are isolated in every plan; the plan is valid, has no violation, and the 14 guests carry the "bez znajomych przy stole" marker. Nothing the optimiser does changes it; the user can only change links.

*C. Avoidable only with one more table.* M[3] —1— P[5]; strangers [6], [2], [5], [3]; 24 guests. k = 2 (two tables of 12): M + P = 8 would need exactly 4 more seats and no cluster or pair of clusters makes 4, so M and P sit apart, both isolated (8 isolated guests). With k = 3 (three tables of exactly 8): {M, P}, {6, 2}, {5, 3}, nobody isolated. Fewest tables wins (rule 3 before rule 5), so the plan has 2 tables and 8 isolated guests. Whether an extra table is worth it is the user's call; Propose never adds one on its own. The diagnostic in [diagrams/003-backend-design.md](diagrams/003-backend-design.md) §8.6 reports these k vs k + 1 numbers on the real data.

## Feasibility of table count k

With N enabled guests, capacity C, floor F = 8 (F = 0 when k = 1):

- necessary: `k·F ≤ N ≤ k·C` and every seated cluster size ≤ C;
- sufficient: the packing step below finds an assignment of clusters to k tables with every fill in [F, C].

k starts at `⌈N / C⌉` and increases until packing succeeds or `k·F > N`. If no k works (e.g. oversized cluster, or cluster sizes that cannot be split to satisfy the floor), Propose returns the best plan with the fewest violations, and the violations are listed — the UI shows them instead of failing.

**When the floor cannot be met (floor 8).** By head count alone, k tables hold between 8k and C·k guests (k ≥ 2), or 1–C guests at k = 1. With the small capacities this leaves gaps:

| Capacity | Enabled guests N with **no** feasible k | Feasible for every N ≥ |
|---|---|---|
| 9 | 10–15, 19–23, 28–31, 37–39, 46–47, 55 | 56 |
| 10 | 11–15, 21–23, 31 | 32 |
| 11 | 12–15, 23 | 24 |
| 12 | 13–15 | 16 |

At the expected ~85–100 guests every capacity is feasible by head count; infeasibility can still come from cluster sizes (e.g. big families that cannot be combined into fills of 8–C). Expected behaviour (as implemented by `Propose` / `Evaluate`, unchanged by the floor value):
- `Propose` tries k = ⌈N / C⌉, ⌈N / C⌉ + 1, … while (k + 1)·8 ≤ N; when no k packs, it returns the best-effort layout with the **fewest violations** among the tried ones, never an error. Example: 12 guests at capacity 9 → k = 2 is tried (3·8 > 12 stops the loop) → two tables from the greedy tries, whichever has fewer violations (e.g. 9 + 3 with one `under_floor`, rather than 6 + 6 with two). Backend tests pin the exact result.
- `Evaluate` reports `under_floor` for every table below 8 when the plan has more than one table; `needsRecalculation` is true. Generate stores such a plan anyway (violations never block saving); the UI shows the violations.
- Plans stored before the floor change keep their tables; tables of 6–7 guests now show `under_floor`, so those plans show **Needs recalculation** until they are regenerated.

## Auto-seating algorithm (heuristic, deterministic)

Greedy packing decides the table count; simulated annealing and a final local search then maximise satisfaction within the hard rules (task 008).

```mermaid
flowchart TD
    A[All guests + links + capacity + pins] --> B["Build clusters: union-find over group-0 links of ALL guests, keep enabled members"]
    B --> C{"Any seated cluster larger than capacity?"}
    C -- yes --> C1["Flag oversized-cluster violation, leave it unseated"]
    C -- no --> D
    C1 --> D["k = ⌈N / capacity⌉"]
    D --> E["Pack: place pinned clusters, then the rest largest-first, each to the table with the highest affinity gain that keeps fill ≤ capacity"]
    E --> F{"All clusters placed and every table ≥ floor?"}
    F -- no --> G["Repair: move / swap clusters between tables to lift under-floor tables (greedy pack with and without affinity), else a bounded exact search over cluster sizes"]
    G --> H{Feasible now?}
    H -->|"no, and (k+1)·8 ≤ N"| I[k = k + 1] --> E
    H -->|"no, no larger k possible"| R[Return best-effort plan + violations]
    H -- yes --> J
    F -- yes --> J["Anneal: simulated annealing from the feasible layout — random move of one cluster or swap of two clusters, only steps that keep every hard rule; steps that are not worse in (isolated guests, score) always accepted, worse ones with probability exp(Δ/T), T cooling; keep the best layout seen (fewest isolated, then highest score). Fixed iteration budget, constant-seed PRNG"]
    J --> J2["Improve: local search on the best layout — move one cluster or swap two if it strictly improves (isolated guests, score) and keeps all hard rules (first-improvement, fixed pass cap)"]
    J2 --> K["Proposal: tables 1..k + assignments + Evaluate"]
    R --> K
```

*Legend:*
- **Objective of the optimiser (task 011).** A layout is better when it has **fewer isolated guests**, or the same number and a **higher scenario score** (lexicographic pair, never a weighted sum, so no "big M" and no overflow question). The repair step, anneal, the restart winner and improve all compare by this pair. Pack is unchanged (it only builds a starting layout).
- **Two stages.** Everything up to the "yes" into **J** decides **feasibility and the table count k**; the anneal and improve stages only improve (isolated guests, score) of a layout that is already feasible. They never change k, never break a hard rule (capacity, floor 8 — waived for k = 1, clusters atomic, pinned clusters never move; oversized clusters are not items at all), so every intermediate layout is feasible. The result is never worse than the layout the anneal started from in (isolated guests, score): the best-seen layout includes the start, and improve only accepts strict improvements. Isolation never increases k (rule 3 before rule 5).
- **Isolation is a heuristic target, too.** Like the score, "fewest isolated guests" is what the search finds, not a proven minimum; improve tries every single move and every swap, so a layout where one such step would remove an isolation without breaking a hard rule is never returned.
- **Why annealing.** Greedy packing fills tables to capacity; on nearly full tables almost every single move or swap breaks capacity or the floor, so a strict-improvement local search stops early (task 008 audit on the real list: capacity 12 scored 172 against ≈ 308 reachable). Accepting some worse steps lets the search leave those local optima. It is still a **heuristic, not a proven optimum**; it reaches the best known score on the ~100-guest test fixture.
- **Determinism (hard requirement).** Same input → same proposal. Clusters and tables are processed in a stable order (by smallest guest id); the anneal draws from a **small PRNG implemented in the package (e.g. splitmix64 / xorshift) with a constant seed**, never `math/rand`'s global source or the clock; the run length is a **fixed iteration budget** (a constant, or a pure function of the input size), never a wall-clock cut-off. Several restarts are allowed, each with its own constant seed, best result wins. The randomness is therefore *pseudo*-randomness fully fixed by the input — the package stays a pure function.
- **Time budget (a target, not a cut-off; task 012).** Search effort is a fixed budget, not a clock: `annealRestarts = 32` independent walks of `min(1 500 000, 700 × m²)` steps each, `m` = movable items (the swap neighbourhood grows with m²: 46 items on a real ~107-guest list get ~1.48M, 20 items 280k), skipped when no item has any affinity. The restarts of one `Propose` run in parallel goroutines (each on its own layout clone and PRNG; the winner is chosen after all finished, by objective, earliest index on ties, so the result does not depend on scheduling) and the `scenarios` service proposes the four capacities in parallel goroutines (pure functions over a read-only `Graph`, results kept in capacity order 9-12). Target on the Pi (4 cores): Generate (four capacities) ≲ 3-5 s for ~107 guests in ~46 clusters, memory flat (peak RSS of the benchmark process 11 MB before and after; each walk copies only a ~46 x 12 table of ints). Checked by `BenchmarkProposeTight` (`go test -bench ProposeTight ./internal/seating`; with `STOLIKI_TUNE_INPUT` pointing at a JSON of ids/links it runs on a real-shaped file instead); the measured numbers are recorded below.
- **Patterns:** functional core — every box is a pure function over in-memory data; no Strategy/Template pattern (one algorithm, capacity is a parameter; annealing is a stage of that algorithm, not an alternative to it).

*Measured before task 011 (task 008 Phase B, on the Pi, ARM64, 4 cores; `go test -bench ProposeFixture ./internal/seating`, synthetic fixture of 106 guests in 25 clusters):* 4 restarts × up to 400 000 steps per capacity (`min(400 000, 16 000 × movable items)`; 25 items hit the cap), temperature 6 → 0.8 geometric, constant seeds. `Propose` ≈ 57-64 ms per capacity (9: 63 ms, 10: 64 ms, 11: 57 ms, 12: 57 ms); `Generate` (four capacities, sequential, no goroutines needed) ≈ 240 ms. Capacity-12 score on the fixture: 306 (pack + repair + improve alone: 253), equal to the best of 12 independent 3M-step runs; a single restart reaches it in ~90% of seeds, so four restarts make a miss very unlikely.

*Measured after task 011 (isolation objective; same Pi, benchmark and fixture; `annealIsoWeight = 1`, scrambled restart seeds, same 4 × up to 400 000 steps):* `Propose` ≈ 68-81 ms per capacity (9: 76 ms, 10: 81 ms, 11: 71 ms, 12: 68 ms); `Generate` (four capacities, sequential) ≈ 296 ms (live `POST /scenarios/calculate` on the real list: 0.43 s including HTTP). Still a heuristic: on the live list (2026-10-03, 107 enabled guests) a 3M-step × 24-run search finds the same objective at capacities 9, 10 and 11 but a 12% higher score at capacity 12 (558 vs 498, both with 0 isolated guests); at capacity 9 the 9 isolated guests (4 families) at k = 12 are structural (the long run does not remove them; k = 13 leaves 2).

*Measured after task 012 (larger budget; same Pi, 4 cores, live list of 2026-10-03: 107 enabled guests, 46 clusters, 100 affinity pairs; the live ids file is never committed):* 32 restarts × 1.48M steps (the old 4 × 400k was well below what capacity 12 needs), temperature 6 → 3 (a warmer end finds the deep basins of nearly full tables more often than the former 0.8; the final `improve` settles the layout). Objective (isolated guests, score) over 24 seed offsets: capacities 9, 10, 11 give (9, 357), (0, 558), (0, 590) in 24/24; capacity 12 gives (0, 568) in 9/24, (0, 566) in 7, (0, 560) in 7, (0, 562) in 1, never below the earlier 3M × 24 reference (558); a 128 restarts × 4M run reaches 568 in 3/3, which is taken as the optimum, so 568 is a ~40% chance per seed offset and the deployed constants return it for this list. Former budget at capacity 12: (0, 498). `Propose` ≈ 0.77-0.85 s per capacity on the live list (was ≈ 0.1 s); `Generate` (four capacities in parallel goroutines) ≈ 3.2 s (was ≈ 0.4 s sequential). Synthetic tight fixture (`tightFixture(4)`, 46 clusters at capacity 12, one free seat): former pipeline 392, now 408 = best of three 128 × 3M runs. A smaller budget misses capacity 12 more often (objective range over 8-24 seed offsets; the first two at the former end temperature 0.8): 8 × 400k gives 522-556, 16 × 1M 532-568; at 6 → 3: 32 × 1M 558-568, 32 × 1.5M 560-568. Capacities 9-11 already match at 8 × 400k.

## Manual edits and violations

- A move or pin addressed to any guest applies to that guest's **whole cluster, disabled members included**. A split can only arise from link changes (e.g. a new group-0 link between guests at different tables) and then shows as a `cluster_split` violation; the next move of that cluster reunites it.
- Saving is never blocked by violations; they are returned in the evaluation and shown in the UI.
- **Toggle off:** nothing in the plans is written. The guest stops counting in fill and score but keeps the assignment. **Toggle on:** the guest **must** sit with their cluster, so they reappear at the cluster's table even when it is full. The resulting `over_capacity` violation sets `needsRecalculation`, and the UI shows "Przelicz / Generuj". If the guest had no assignment, they appear in the tray (`unseated_guests` → also `needsRecalculation`). **New guest:** unseated in all scenarios. None of these regenerates plans automatically.
- **Deleting a plan** (UC-17, `DELETE /scenarios/{capacity}/tables`) removes all its tables, assignments and pins in one transaction and bumps the version; nothing else is touched (guests, links, the other three plans). Evaluating the empty plan follows the normal rules: every enabled guest is unseated, so with at least one enabled guest it has one `unseated_guests` violation and `needsRecalculation = true` (with no enabled guest it has no violation). Generate then starts from scratch (no pins). It bumps the version, so a pending **Cofnij** of an earlier Generate is no longer possible (409).

## Storing a Generate

`PUT /scenarios` replaces **all four plans in one transaction, or none** (a half-applied Generate is worse than none). The same call stores a Generate and undoes it. For each plan:

- `basedOnVersion` must equal the stored version, else 409 `version_conflict` and **nothing** is written (any of the four stale → all four untouched). Validation errors (unknown guest, guest twice, table numbers not 1..k, pinned guest not at that table, a capacity missing or repeated) → 422, nothing written.
- Its tables and assignments are replaced by the given tables (empty tables and `tables: []` are allowed). Each listed guest is seated as given; then each cluster's **disabled members ride along**: every unlisted disabled member of a cluster is seated at the table of the cluster's lowest-id listed enabled member (`seating.ExpandDisabled`, unchanged). A cluster with no enabled member gets no assignment.
- **Pins are explicit:** a cluster is pinned when any of its listed members is in `pinnedGuestIds`, and the pin is stored on all its seats. Generate keeps pins because `Propose` keeps pinned clusters at their table and marks them `pinned`; the client copies those flags into `pinnedGuestIds`. (Before task 007 the server copied pins from the stored plan; now it stores what it is given, which is what makes an exact undo possible.)
- Violations never block saving; each plan's version is bumped by 1, and the response is the four evaluated plans.

**Generate, end to end** (client-orchestrated, sequence [diagrams/003-sequences.md](diagrams/003-sequences.md) §1): (1) read the current four plans fresh (`GET /scenarios`) and keep them as the **undo snapshot**; (2) `POST /scenarios/calculate`; (3) `PUT /scenarios` with the four proposals' tables and `basedOnVersion` = the **snapshot's** versions. Using the snapshot's versions guarantees that what was overwritten is exactly the snapshot; if anything changed in between (milliseconds, another device) the PUT is a 409, nothing changes, and the user clicks again. **No confirmation dialog** before overwriting, even when plans have hand edits: Cofnij covers it (fewer clicks).

## Undoing a Generate ("Cofnij")

- Scope: only the **last Generate made in this browser tab**, until the page is reloaded. The snapshot lives in client memory (the query cache), never on the server: no snapshot table, no migration.
- Cofnij = `PUT /scenarios` with the snapshot's four plans (tables, guests, pins mapped from `PlanTable.clusters`) and `basedOnVersion` = the versions the Generate's PUT returned. It restores tables, assignments and pins as they were.
- **If a plan was edited after the Generate** (move, pin, add/remove table, delete plan, another Generate, from this or another device), its version moved on: the server answers **409 and changes nothing**. The UI says "Nie można cofnąć — plany zmieniono po wygenerowaniu" and drops the Cofnij offer. The client hides Cofnij as soon as it sees such a change (any current version ≠ the version Generate produced), so the 409 is only hit in a race. A guest deleted in between → 422 (unknown guest), same message and same outcome.
- Guest toggles and link edits do not bump plan versions, so they do not block Cofnij; the restored plans are re-evaluated with today's guests and links (violations show as usual).
- Known, accepted approximations (the undo restores what the plan views show): disabled guests of a cluster with no enabled member had an invisible assignment, which is not restored (they are unseated if re-enabled later); a disabled guest who sat apart from their cluster is restored at the cluster's table.
