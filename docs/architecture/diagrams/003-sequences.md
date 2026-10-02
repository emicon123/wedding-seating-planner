# 003 — Sequence diagrams for the UI-driven flows

Task 003, Phase 5. The participants are the components and packages from [003-frontend-design.md](003-frontend-design.md) and [003-backend-design.md](003-backend-design.md). All HTTP paths are relative to `/wesele/api` ([`docs/openapi.yaml`](../../openapi.yaml)).

1. [Generate all three plans → preview → accept](#1-generate-all-three-plans--preview--accept)
2. [Move a cluster (drag & drop, optimistic)](#2-move-a-cluster-drag--drop-optimistic)
3. [Re-enable a guest → plan needs recalculation → regenerate](#3-re-enable-a-guest--plan-needs-recalculation--regenerate)
4. [Quick-add a guest and link them, with cluster expansion](#4-quick-add-a-guest-and-link-them-with-cluster-expansion)

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

## 4. Quick-add a guest and link them, with cluster expansion

```mermaid
sequenceDiagram
    autonumber
    actor E as Editor
    participant QA as QuickAddBar
    participant LE as LinkEditor + GuestSearchCombobox
    participant D as domain (guestIndex, companions)
    participant Q as api hooks
    participant H as httpapi.Server
    participant GS as guests.Service

    E->>QA: type "Karolina Nowak" + Enter
    QA->>Q: useCreateGuest().mutate({firstName:"Karolina", lastName:"Nowak"})
    Q->>H: POST /guests
    H->>GS: Create(ctx, NewGuest)
    alt name is free
        GS-->>H: Guest (id 5)
        H-->>Q: 201 GuestResponse
        Q->>Q: invalidate guests, clusters, scenarios
        QA-->>E: input cleared, still focused (next guest)
    else duplicate name
        H-->>Q: 422 duplicate_name
        QA-->>E: inline error, text kept
    end
    E->>LE: on Maciek, Grupa 0: type "karo"
    LE->>D: guestIndex.search("karo")
    D-->>LE: Karolina Nowak
    E->>LE: pick Karolina
    LE->>Q: useUpsertLink().mutate("4-5", level 0)
    Q->>H: PUT /guest-links/4-5
    H->>GS: SetLink(ctx, 4, 5, Must)
    H-->>Q: 200 GuestLinkResponse
    Q->>Q: invalidate guests, clusters, scenarios
    E->>LE: on Maciek, Grupa 1: pick "Michał"
    LE->>Q: PUT /guest-links/4-6 level 1
    Q->>H: GET /clusters (refetch)
    H-->>Q: clusters: {4,5} ↔ {6,7} affinity 1
    LE->>D: effectiveCompanions(4, guests, overview)
    D-->>LE: Michał (direct), Ola (via Michał's group 0)
    LE-->>E: Grupa 1: "Michał" + "Ola (przez grupę 0 Michała)"
```

*Legend:* there is no batch endpoint. Each Enter is one `POST /guests`, which is fast enough for ~100 guests typed by hand (A-20). The expansion is computed from the server's cluster affinities; the client only derives the "via" label (display logic, not scoring).
