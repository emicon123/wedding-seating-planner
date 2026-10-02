# 003 — Sequence diagrams for the UI-driven flows

Task 003, Phase 5. The participants are the components and packages from [003-frontend-design.md](003-frontend-design.md) and [003-backend-design.md](003-backend-design.md). All HTTP paths are relative to `/wesele/api` ([`docs/openapi.yaml`](../../openapi.yaml)).

1. [Generate all three plans → preview → accept](#1-generate-all-three-plans--preview--accept)
2. [Move a cluster (drag & drop, optimistic)](#2-move-a-cluster-drag--drop-optimistic)
3. [Re-enable a guest → plan needs recalculation → regenerate](#3-re-enable-a-guest--plan-needs-recalculation--regenerate)
4. [Quick-add a guest and link them through the group checklist](#4-quick-add-a-guest-and-link-them-through-the-group-checklist)
5. [Delete a plan](#5-delete-a-plan-task-005-uc-17)

## 1. Generate all three plans → preview → accept

```mermaid
sequenceDiagram
    autonumber
    actor E as Editor
    participant UI as PlansPage / ProposalPreview
    participant Q as api hooks (TanStack Query)
    participant H as httpapi.Server
    participant S as scenarios.Service
    participant G as store.Guests (GuestSource)
    participant P as store.Scenarios
    participant C as seating

    E->>UI: click "Generuj plany"
    UI->>Q: useCalculateProposals().mutate()
    Q->>H: POST /scenarios/calculate
    H->>S: Calculate(ctx)
    S->>G: List(ctx)
    G-->>S: guests, links
    S->>P: List(ctx)
    P-->>S: 3 PlanState (versions, pins)
    S->>C: BuildGraph(guests, links)
    loop capacity 8, 10, 12
        S->>C: Propose(graph, current plan)
        C-->>S: proposed Plan
        S->>C: Evaluate(graph, proposed)
        C-->>S: Evaluation
    end
    S-->>H: 3 Proposals (basedOnVersion)
    H-->>Q: 200 ProposalListResponse
    Q->>Q: setQueryData(keys.proposals)
    UI-->>E: 3 proposals side by side vs current plans
    E->>UI: "Akceptuj wszystkie"
    loop each accepted capacity
        UI->>Q: useAcceptProposal().mutate(capacity, basedOnVersion, tables)
        Q->>H: PUT /scenarios/{capacity}/assignments
        H->>S: Accept(ctx, capacity, basedOn, tables)
        S->>G: List(ctx)
        S->>P: Get(ctx, capacity)
        S->>C: ExpandDisabled(graph, plan with prior pins)
        S->>P: ReplacePlan(ctx, capacity, basedOn, plan)
        alt version matches
            P-->>S: PlanState (version+1)
            S->>C: Evaluate(graph, plan)
            H-->>Q: 200 ScenarioResponse
            Q->>Q: replace scenario in keys.scenarios
        else stale version
            P-->>S: apperr.ErrVersionConflict
            H-->>Q: 409 version_conflict
            Q->>Q: refetch scenarios, keep other accepts
            UI-->>E: toast "Plan 10 zmienił się — wygeneruj ponownie"
        end
    end
    UI->>Q: clear keys.proposals
```

*Legend:* Generate is a pure **query** (CQS) that stores nothing. Each accept is an independent **command** guarded by the **Optimistic Offline Lock**. All three proposals come from one `Graph` built once (DRY, consistent input).

## 2. Move a cluster (drag & drop, optimistic)

```mermaid
sequenceDiagram
    autonumber
    actor E as Editor
    participant F as FloorPlan / TableCard / ClusterChip
    participant D as domain (dropPreview, applyMove)
    participant Q as useSetAssignment (TanStack)
    participant H as httpapi.Server
    participant S as scenarios.Service
    participant P as store.Scenarios
    participant C as seating

    E->>F: drag cluster chip (pointer or Space key)
    F->>D: dropPreview(plan, cluster, hovered table)
    D-->>F: fillAfter 9/10, overCapacity false, preferredHere 3
    E->>F: drop on table 4
    F->>Q: mutate({capacity, guestId: cluster.clusterKey, tableNumber: 4, pinned})
    Q->>Q: onMutate: snapshot + applyMove() into keys.scenarios
    F-->>E: chip already at table 4 (fills updated)
    Q->>H: PUT /scenarios/{capacity}/assignments/{guestId}
    H->>S: Seat(ctx, capacity, guestId, 4, pinned)
    S->>C: BuildGraph(...).ClusterOf(guestId)
    C-->>S: Cluster.Members (incl. disabled)
    S->>P: SeatCluster(ctx, capacity, members, 4, pinned)
    P-->>S: PlanState (version+1)
    S->>C: Evaluate(graph, plan)
    H-->>Q: 200 ScenarioResponse (scores, violations, needsRecalculation)
    alt success
        Q->>Q: replace scenario with the server copy
    else error
        Q->>Q: onError: restore snapshot
        F-->>E: toast with the Polish reason (labels.errorLabel)
    end
```

*Legend:* the client shows **optimistic fills only**. Scores and violations arrive in the response (single source of truth). The whole cluster moves on the server even though the client sends a single guest id.

## 3. Re-enable a guest → plan needs recalculation → regenerate

```mermaid
sequenceDiagram
    autonumber
    actor E as Editor
    participant GP as GuestsPage (row switch)
    participant Q as api hooks
    participant H as httpapi.Server
    participant GS as guests.Service
    participant SS as scenarios.Service
    participant C as seating
    participant PP as PlansPage / PlanCard

    Note over E,PP: Zosia (child, disabled) belongs to Ewa's cluster, which sits at full table 3 (10/10) in plan 10
    E->>GP: switch Zosia on
    GP->>Q: useToggleGuests().mutate({guestIds:[8], enabled:true})
    Q->>H: PATCH /guests
    H->>GS: Toggle(ctx, [8], true)
    GS-->>H: updated guests (assignment untouched: still table 3)
    H-->>Q: 200 GuestListResponse
    Q->>Q: invalidate guests, clusters, scenarios
    Q->>H: GET /scenarios
    H->>SS: List(ctx)
    SS->>C: Evaluate(graph, plan 10)
    C-->>SS: table 3 fill 11 > 10 → over_capacity, needsRecalculation = true
    H-->>Q: 200 (plan 10 summary.needsRecalculation = true)
    PP-->>E: plan 10 card flagged "Wymaga przeliczenia" + button "Przelicz / Generuj"
    Note over SS: no automatic regeneration (A-17)
    E->>PP: click "Przelicz / Generuj"
    PP->>Q: useCalculateProposals() (continues as flow 1)
```

*Legend:* `needsRecalculation` is **derived** (any violation) and never stored, so nothing can go stale. Zosia **must** sit with her cluster (user rule), which is why the overfill is reported instead of moving her to the tray.

## 4. Quick-add a guest and link them through the group checklist

```mermaid
sequenceDiagram
    autonumber
    actor E as Editor
    participant QA as QuickAddBar
    participant LE as LinkEditor (relationships panel)
    participant LP as LinkPicker (checklist of one group)
    participant D as domain (linkSelection, relations)
    participant Q as api hooks
    participant H as httpapi.Server
    participant GS as guests.Service

    E->>QA: type "Karolina Nowak" + Enter (Dziecko checkbox off)
    QA->>Q: useCreateGuest().mutate({firstName:"Karolina", lastName:"Nowak", isChild:false})
    Q->>H: POST /guests
    H->>GS: Create(ctx, NewGuest)
    alt name is free
        H-->>Q: 201 GuestResponse (id 5)
        Q->>Q: invalidate guests, clusters, scenarios
        QA-->>E: "Dodano: Karolina Nowak", input cleared and still focused
    else duplicate name
        H-->>Q: 422 duplicate_name
        QA-->>E: inline error, text kept
    end
    E->>LE: open "Powiązania: Maciek"
    LE->>D: relationsOf(4, guests, clusters overview)
    D-->>LE: blocks 0/1/2 grouped by family, reason per person
    E->>LP: Grupa 0 "Edytuj", search "karo", tick Karolina
    LP->>D: diffSelection + clusterAfter (preview, size warning)
    E->>LP: Grupa 0 "Zapisz"
    LP->>D: linkChangesOf(0, diff)
    D-->>LP: removals first, then moves and adds
    LP->>Q: useApplyLinkChanges().mutate({guestId:4, changes})
    loop each change, in order
        Q->>H: PUT /guest-links/4-5 (level 0) or DELETE for a removal
        H->>GS: SetLink(ctx, 4, 5, Must) or DeleteLink
        H-->>Q: 200 GuestLinkResponse / 204
    end
    Q->>Q: onSettled: invalidate guests, clusters, scenarios
    LP-->>E: toast "Zapisano powiązania: Grupa 0." (or a list of failed pairs)
    E->>LP: Grupa 1: tick "Michał", Zapisz (PUT /guest-links/4-6 level 1)
    Q->>H: GET /clusters (refetch)
    H-->>Q: clusters: {4,5} affinity 1 with {6,7}
    LE->>D: relationsOf(4, ...)
    D-->>LE: Grupa 1: Michał "wpisany bezpośrednio", Ola "przez grupę 0: Michał"
```

*Legend:* there is no batch endpoint. Each Enter is one `POST /guests`, which is fast enough for ~100 guests typed by hand (A-20). A checklist Save is one mutation that sends one request per changed pair (removals first, so a moved pair never collides). "Dodaj «X» jako nowego gościa" in the picker is only the `POST /guests` + tick; the link goes with Zapisz. Group 0 and the "przez …" reasons come from the server's clusters and affinities; the client only derives labels (display logic, not scoring).

## 5. Delete a plan (task 005, UC-17)

```mermaid
sequenceDiagram
    autonumber
    actor E as Editor
    participant UI as PlanCard or PlanDetailPage
    participant DLG as DeletePlanDialog
    participant Q as useResetPlan (TanStack)
    participant H as httpapi.Server
    participant S as scenarios.Service
    participant P as store.Scenarios
    participant C as seating

    E->>UI: "Usuń plan" (plan 10)
    UI->>DLG: open with plan 10 counts (tables, seated)
    DLG-->>E: "Usunąć plan na 10 miejsc? ... Tego nie da się cofnąć."
    alt Anuluj
        E->>DLG: Anuluj / Esc
        DLG-->>UI: closed, nothing sent
    else confirm
        E->>DLG: "Usuń plan"
        DLG->>Q: mutate({capacity: 10})
        Q->>H: DELETE /scenarios/10/tables
        H->>S: Reset(ctx, 10)
        S->>P: ClearPlan(ctx, 10)
        Note over P: one transaction - DeleteScenarioTables (assignments and pins cascade), version+1
        P-->>S: PlanState (no tables, version+1)
        S->>C: Evaluate(graph, empty plan)
        C-->>S: unseated_guests, needsRecalculation true
        H-->>Q: 200 ScenarioResponse
        Q->>Q: replace scenario 10, drop proposal 10 from keys.proposals
        UI-->>E: "Brak stołów w tym planie." + "Przelicz / Generuj"
    end
    Note over E,UI: "Usuń wszystkie plany" = same dialog with a must-tick checkbox, then three DELETE calls (8, 10, 12) via Promise.allSettled
```

*Legend:* a **command** with no body and no version check (like the other manual plan edits); it bumps the version, so older proposals become stale. Unknown capacity → 404 `not_found`. No undo (Command/Memento rejected); the confirmation dialog stands in for it. "Delete all" is three independent commands, not a batch endpoint (independent aggregates, idempotent calls, same reasoning as "accept all").
