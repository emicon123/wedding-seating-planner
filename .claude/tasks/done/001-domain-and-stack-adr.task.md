# Task: Domain model + ADR-001 (stack decisions still open)

## Orchestrator Routing

**Assigned Phase:** Phase 1 (Requirements & Domain) + Phase 2 (Macro-Architecture)

**Agents to spawn (in order):**
1. Architect — this task only. No Backend-Go / Frontend-web / DevOps yet (Step 2 gate).

---

## What We're Building

Foundations for Stoliki, a quick web app for planning wedding table seating (Go API + React SPA, Docker on the Raspberry Pi, exposed via Tailscale under `/wesele`). Before any code: a shared domain language, the use cases, and ADR-001 settling the open decisions.

### Business Context
- Users: the couple (planner), possibly a helper editing the same plan.
- Problem: assign ~N guests to tables respecting capacity and social constraints (couples/families together, some people apart), quickly and visually.
- Constraint: quick app — keep the design proportionate; YAGNI.

### Requirements from the user (2026-10-01, preliminary)

1. **Guest list lives in the app and is edited continuously** (e.g. someone declines → remove/mark them, plan must adapt). Initial import probably from a Google Sheet — mechanism (CSV export vs Sheets API) decided later; design the import as a replaceable edge, not a core dependency.
2. **UI is a first-class requirement:** very well thought-out, readable, very convenient, as *visual* as possible (think: tables drawn on a canvas/floor-plan, guests as chips/cards, groups colour-coded, instant visual feedback on violations). The Architect's state/interaction diagrams must cover this; Frontend-web loads the `frontend-design` skill.
3. **Table sizes: 8, 10 or 12 seats — as separate scenarios, with all 3 options handled at once** (i.e. the user can see/compare plans for each table size side by side). *Interpretation to confirm:* three independent plans, one per table size (all tables 8-seat / all 10-seat / all 12-seat), vs. a single plan mixing sizes.
4. **Guest groups drive the seating rules:**
   - **Group 0 — hard constraint, defined per guest as a list of other guests.** Example from the user: guest *Rafał* has group-0 = {Ewa, Maria (wife, mother-in-law), Tadek, Iza} → these people simply MUST sit at the same table. So groups 0/1/2 are **per-guest lists of other guests** (not shared labels). The seating unit is the connected cluster of group-0 links, not the individual — assign units to tables (a unit larger than a table is infeasible → surface as an error).
     - Architect must decide/confirm: a group-0 link is treated as **symmetric** (if Rafał lists Ewa, both sit together even if Ewa's own row doesn't list Rafał) and **transitive** (clusters = connected components); and the UI must warn when a chain of links accidentally creates an oversized or surprising cluster (e.g. > 12 people, or two families merged by one stray link).
     - Import implication: lists reference guests by name → need a stable guest identity (unique id / disambiguation for duplicate first names) and an import report of unmatched or ambiguous names.
   - **Group 1 — preferred.** Guests the given guest can / should sit with (soft constraint, positive weight). Example from the user: *Maciek* (group 0 = {Karolina}) has group 1 = {Michał, Bartek, Patryk, Mateusz, Sebastian, Tomek, Bartłomiej, Grześ, Pietruch} — 9 people, most of whom have their own group-0 partners.
     - **UX rule (explicit requirement):** when the user adds a guest to someone's group 1 (or 2), that guest's **whole group-0 cluster comes along automatically** — no clicking partners one by one. The UI must show the expansion transparently (e.g. partners appear as "added via Michał's group 0") so it's clear why they are there.
     - **Modelling consequence (Architect to confirm, recommended):** *derive* the expansion instead of storing a copy — store only the explicit link (Maciek → Michał) and compute effective preferences at the cluster level. Then later changes to group 0 (a partner declines, a new partner is added) stay consistent automatically, and group 1/2 effectively become relations *between clusters* (Maciek+Karolina ↔ Michał+partner…), which keeps the seating algorithm small.
     - **Scale note:** Maciek's group 1 expands to ~20 people with their partners — more than any single table (max 12). So group 1 is a *preference to maximise* (as many preferred companions as possible at the same table), never an all-or-nothing rule; the algorithm needs a scoring function, and the UI should show "how satisfied" each guest/table is.
   - **Group 2 — fallback.** Guests the given guest may sit with only if it can't be avoided otherwise (soft constraint, lower weight than group 1).
   - **Satisfaction model (user, 2026-10-01):** a guest is equally happy with *every* group-1 person at their table, and somewhat less happy with group-2 people. Ideal world: every guest at a table has around them only group-0 and group-1 people.
   - **Preferences are symmetric:** if Maciek has Michał as group 1, Michał automatically has Maciek as group 1 (store one undirected link; adding it from either side shows on both). Since group-1/2 links are expanded through group-0 clusters, the result is a symmetric relation between clusters.
   - **Ordering confirmed (user, 2026-10-02):** group 1 > group 2 > unrelated guest. Sitting with a group-2 person is always better than sitting with someone with no link.

5. **Optimisation objective (user, 2026-10-01):**
   - **Minimise the number of tables** (per scenario: 8 / 10 / 12-seat).
   - Underfilled tables are allowed, **but not absurdly empty**: e.g. with 10-seat tables you must not end up with a table of 2 — rebalance instead (e.g. 6 + 6, or **8 + 8 + 8** rather than 10 + 10 + 4). So the intended behaviour is **balanced fill**: use the minimum number of tables k (≈ ⌈guests / capacity⌉, more only if group-0 clusters can't be packed into k), then spread guests *evenly* across those k tables instead of filling tables to the brim and leaving a small remainder. **Minimum occupancy confirmed (user, 2026-10-02): 6 guests per table** (hard floor; assumed for all table sizes 8/10/12). **Rebalancing is applied only as much as needed** to respect that floor — i.e. not a general preference for perfectly even tables: if full tables + a remainder of ≥ 6 is fine, keep it; if the remainder would be < 6, rebalance minimally (e.g. 10 + 10 + 4 → 10 + 8 + 6, or 8 + 8 + 8 when that is what it takes).
   - Suggested priority order for the Architect to evaluate (confirm with user): hard constraints (group-0 clusters intact, capacity) → fewest tables → balanced fill (no near-empty table) → maximise satisfaction (group 1 > group 2). Because rebalancing is minimal, group-1 satisfaction wins over cosmetic evenness; only the floor of 6 and the fewest-tables rule override it. Each scenario shown in the UI with its table count and satisfaction score so 8/10/12 can be compared.

**Open questions for the user (Architect must resolve in Phase 1 — ask, don't guess):**
- Table sizes: separate scenarios (3 plans) or mixed sizes in one plan? How many tables / guests in total?
- ~~Groups 1 & 2 symmetric?~~ Answered: symmetric (see above). Still to confirm: group 2 is symmetric too (assumed yes); neither group 1 nor 2 is transitive (assumed).
- Weights: group 1 = full satisfaction per person, group 2 = somewhat less (exact ratio TBD, configurable); stranger < group 2 (confirmed). How do preferences from different members of the same cluster combine (sum / max)?
- ~~Balanced fill / floor~~ Answered: floor = 6, rebalancing minimal (interpretation of the user's "minimalna możliwa" — confirm if the Architect's examples look wrong). Still open: does the floor of 6 apply to the *last* table only or to every table (assumed: every table); does "fewest tables" always beat group-1 satisfaction (assumed yes); is the floor also 6 for 12-seat tables?
- Is there a "must NOT sit together" relation, or only "prefer / avoid-if-possible"?
- Seating inside a table (neighbours, head table / couple's table) — or only table assignment?
- Guest status model (confirmed / pending / declined), plus-ones, children, dietary needs — which fields are needed?
- Auto-seat suggestion + manual drag-and-drop adjustments with locking ("pin this guest to this table")? Undo/redo?
- Printing / export of the final plan?
- Who edits, from which devices (phone at the venue?)

---

## Scope: Architect Phase X Deliverables

**Phase 1 (Requirements & Domain)? YES**
- [x] Skill 1: Requirements Elicitation
- [x] Skill 2: Ubiquitous Language → `docs/architecture/01-domain-glossary.md`
- [x] Skill 3: Entity vs Value Object
- [x] Skill 4: Use Case Mapping

**Phase 2 (Macro-Architecture)? YES**
- [x] Skill 5: Architecture Style Selection (incl. where the seating/auto-assign algorithm lives — Go backend vs. frontend — and how it is evaluated for 3 table-size scenarios) → `docs/adr/ADR-001-stack-and-shape.md` (open items listed in `architect.md` § "First decision: ADR-001": persistence, auth/access control, `/wesele` prefix handling, repo layout, library picks, concurrency)
- [x] Skill 6: C4 Boundary Definition → `docs/architecture/diagrams/001-c4-context.md`
- [x] Skill 7: Application State Modeling → `docs/architecture/diagrams/001-state-machine.md`

**Phases 3–6? NO** (separate tasks after this one is committed)

---

## Deliverables

**(Filled in by Architect, 2026-10-02)** — files written (not committed: the directory is not a git repo yet).

| Skill | Artifact |
|---|---|
| 1 Requirements | `docs/architecture/01-domain-glossary.md` §1 (goal, actors, constraints) |
| 2 Ubiquitous language | `docs/architecture/01-domain-glossary.md` §2 (EN code term ↔ PL UI term) |
| 3 Entity vs value object | `docs/architecture/01-domain-glossary.md` §3 |
| 4 Use cases | `docs/architecture/01-domain-glossary.md` §4 (UC-01…UC-16 → indicative endpoints + use-case diagram) and "Assumptions" table (A-1…A-12) |
| 5 Architecture style / ADR-001 | `docs/adr/ADR-001-stack-and-shape.md` (reasoning); consequences as current fact in `docs/architecture/02-system-context.md` (layout, `/wesele` prefix, access control, persistence, concurrency, stack, system-level pattern evaluation) and `docs/architecture/03-seating-model.md` (rules priority, scoring, feasibility, auto-seating flowchart) |
| 6 C4 | `docs/architecture/diagrams/001-c4-context.md` (context, containers, policy-vs-detail) |
| 7 State | `docs/architecture/diagrams/001-state-machine.md` (guest lifecycle, scenario lifecycle + preview, cluster drag & drop, app shell/screens) |

Also updated: `AGENTS.md` (Stack + Project structure), `.claude/agents/backend-go.md` (stack table, layout), `.claude/agents/devops.md` (single container, no Nginx/DB container, prefix + exposure rules), `.claude/agents/frontend-web.md` (dnd-kit, openapi-typescript).

**Key decisions (revised after the user's answers, 2026-10-02):** SQLite + goose; **tailnet-only, no app auth** (passphrase design dropped as YAGNI — re-add before any public exposure); `/wesele` kept end-to-end (`BASE_PATH`), dedicated non-funnelled `tailscale serve` port; one container (Go serves SPA + API); optimistic locking (`version`) on Guest and Scenario; seating in pure Go `internal/seating`; three fixed scenarios (8/10/12), always generated together; `enabled` flag replaces attending/declined status; `isChild` flag for filter + bulk toggle; clusters over all guests (disabled included), affinity cluster↔cluster; derived data never stored.

**User answers applied** (see section at the bottom) to: glossary, ADR-001, 02-system-context, 03-seating-model, both diagrams, AGENTS.md, backend-go.md, devops.md. Remaining open assumptions: glossary "Assumptions" A-13…A-18.

**Next:** task `002-contract-and-persistence.task.md` (Phases 3–4).

**Must read before implementing (once Phases 3–5 land):**
- Backend-Go: see task 002 Deliverables (supersedes this list). Phase-1/2 docs: `docs/architecture/01-domain-glossary.md` §2–§3; `docs/architecture/02-system-context.md` (all); `docs/architecture/03-seating-model.md` (all); `docs/architecture/diagrams/001-c4-context.md` "Policy vs detail"; `docs/architecture/diagrams/001-state-machine.md` §1–§2.
- Frontend-web: `docs/architecture/01-domain-glossary.md` §2 + §4; `docs/architecture/02-system-context.md` "The `/wesele` prefix", "Concurrency", "Where logic lives"; `docs/architecture/diagrams/001-state-machine.md` §2–§4; `docs/architecture/03-seating-model.md` "Scoring".
- DevOps: `docs/architecture/02-system-context.md` "Shape at a glance", "The `/wesele` prefix", "Access control", "Persistence" (backup), "Technology stack" (env vars).

---

## Verification Checklist

- [x] Glossary, use cases, ADR-001, C4 and state diagrams committed under `docs/`
- [x] ADR-001 consequences folded into `docs/architecture/` (system described as it now is)
- [x] Diagrams have legends; pattern-evaluation table present
- [x] User confirmed the ADR-001 choices that have real UX/cost impact (auth, public vs tailnet-only)
- [x] `AGENTS.md` "Project structure" + `backend-go.md` / `devops.md` stack tables updated to match ADR-001
- [ ] Task file moved to `.claude/tasks/done/`

---

## User answers to the Architect's questions (2026-10-02) — apply to glossary / ADR-001 / seating model

1. **Exposure:** no need for public access → **tailnet-only** (no Funnel). Note: Funnel on :443 is device-wide, so tailnet-only needs a separate port/mapping — DevOps verifies. With tailnet-only, ask whether the shared passphrase is still wanted (user: "whoever has access can edit — everyone").
2. **Scenarios:** three separate plans (8 / 10 / 12-seat), **always all three generated every time**.
3. **No hard "must NOT sit together"** relation (A-11 confirmed).
4. **Couple sits alone**, not on the guest list → no head table / seat order needed (A-5 confirmed: table assignment only).
5. **Floor of 6 applies to every table (incl. 12-seat); fewest tables always beats satisfaction** (A-4 confirmed).
6. **Manual edits:** moving whole groups, pins, preview before accepting auto-seat, no undo/redo is enough (A-7 confirmed).
7. **Editors:** everyone who has access can edit, equal rights (A-8 confirmed).
8. **Import:** CSV exported from the Google Sheet, replace-all after dry-run report, no live sync (A-10 confirmed).
9. **Link combination (A-3):** user asked for a worked example — pending confirmation (see conversation).
10. **Scale:** ~85–100 guests (not 250) — size the design accordingly (YAGNI).
11. **Guest fields:** first name, *optional* surname, notes; **children count as guests and sit at tables**. NEW REQUIREMENT: a **quick enable/disable toggle per guest** — a disabled guest stays on the list but is ignored by all three plans (use cases: someone declines, a child can't come, or the user wants to test a variant without children/certain guests). Expect bulk toggling (e.g. "disable all children") → needs a way to mark/filter children (tag or flag). Disabling must be instant and reversible; group-0/1/2 links of a disabled guest are kept but inactive (a disabled partner must not force the cluster to still count them).
12. **Print:** browser print is enough.
13. **Weights fixed in code:** group 1 = 1.0, group 2 = 0.5.
