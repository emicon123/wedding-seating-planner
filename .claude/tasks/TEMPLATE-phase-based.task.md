# Task: [Feature Name]

## Orchestrator Routing

**Assigned Phase:** Phase X (e.g., "Phase 5: Software Design")

**Agents to spawn (in order):**
1. Architect (if Phase 1-6 design needed)
2. Backend-Go (if backend changes)
3. Frontend-web (if frontend changes)
4. DevOps (if infra changes)

---

## What We're Building

Brief summary (3-4 sentences) of the feature/fix and why it matters.

### Business Context
- Who needs this? (planner, guest, helper)
- What problem does it solve?
- Any constraints or deadlines? (e.g. wedding date)

---

## Scope: Architect Phase X Deliverables

List which Skills (from the 17-skill roadmap) apply to this task:

**Phase 1 (Requirements & Domain)? YES / NO**
- [ ] Skill 1: Requirements Elicitation
- [ ] Skill 2: Ubiquitous Language
- [ ] Skill 3: Entity vs Value Object
- [ ] Skill 4: Use Case Mapping

**Phase 2 (Macro-Architecture)? YES / NO**
- [ ] Skill 5: Architecture Style Selection
- [ ] Skill 6: C4 Boundary Definition
- [ ] Skill 7: Application State Modeling

**Phase 3 (Integration & Contract)? YES / NO**
- [ ] Skill 8: Integration Protocol Selection
- [ ] Skill 9: Command/Query Contract Design (OpenAPI)

**Phase 4 (Persistence & Enterprise)? YES / NO**
- [ ] Skill 10: Persistence Modeling (ERD)
- [ ] Skill 11: DTO & Mapper Definition
- [ ] Skill 12: Repository Abstraction

**Phase 5 (Software Design)? YES / NO**
- [ ] Skill 13: Core Interface Design
- [ ] Skill 14: GoF Pattern Application
- [ ] Skill 15: Structural Modeling (Class Diagram)
- [ ] Skill 16: Clean Architecture Audit

**Phase 6 (Handoff)? YES / NO**
- [ ] Skill 17: TDD Task Decomposition

---

## Deliverables: What Backend-Go / Frontend-web Will Read

**(Filled in by Architect after the last assigned phase is committed)**

### For Backend-Go:
- Class Diagram: `docs/architecture/diagrams/<name>.md` — lines X-Y (+ pattern legend lines X-Y)
- Sequence Diagram: `docs/architecture/diagrams/<name>.md` — lines X-Y
- OpenAPI: `docs/openapi.yaml` — endpoint(s) …
- ERD: `docs/architecture/diagrams/<name>-erd.md` — lines X-Y

### For Frontend-web:
- Sequence / State Machine diagrams: `docs/architecture/diagrams/<name>.md` — lines X-Y
- OpenAPI endpoint(s): …

---

## Implementation Tasks (Filled in by Architect — Skill 17)

**(Atomic, test-first tickets after Phase 5)**

### Backend-Go Task List:
1. **<Unit>** — class/function, signature, test-first note, diagram ref (file + lines)

### Frontend-web Task List:
1. **<Component/module>** — path, props/state, test-first note, diagram ref (file + lines)

---

## Context & Decisions

- **ADR-XXX:** [Decision title]
- Pattern choices: [Justify why these patterns were chosen]
- Trade-offs: [What was considered and rejected]

---

## Verification Checklist (Post-Implementation)

**(Before marking task DONE — orchestrator runs this)**

- [ ] Architect phase X diagrams are committed to `docs/architecture/diagrams/`
- [ ] All diagrams have legends explaining pattern/principle choices
- [ ] OpenAPI bundled + linted
- [ ] Migration exists (if DB schema changed)
- [ ] `go test ./...`, `go vet ./...` pass (integration tests on the real DB engine — no DB mocks)
- [ ] Linters / formatters / type-check clean
- [ ] `npm run build` clean (frontend, `base: /wesele/`)
- [ ] Verified through the real `/wesele` URL (if user-visible)
- [ ] Orchestrator spot-checked diagram↔code consistency
- [ ] Task file moved to `.claude/tasks/done/`
