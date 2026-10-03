# 001 — State machines (domain lifecycles + UI interaction)

Task 001, Phase 2 (Skill 7); updated 2026-10-02 with the user's answers (enabled toggle, generate-all-three, no login); updated 2026-10-03 for four table sizes 9/10/11/12 (task 006) and for Generate storing at once + Cofnij (task 007). Terms: [../01-domain-glossary.md](../01-domain-glossary.md). Rules: [../03-seating-model.md](../03-seating-model.md).

Contents:
1. [Guest lifecycle](#1-guest-lifecycle) (domain)
2. [Plans: generate (stored at once), Cofnij](#2-plans-generate-stored-at-once-cofnij) (domain + UI)
3. [Cluster drag & drop](#3-cluster-drag--drop-ui) (UI)
4. [App shell and screens](#4-app-shell-and-screens) (UI)

## 1. Guest lifecycle

```mermaid
stateDiagram-v2
    [*] --> Enabled: add guest / CSV import
    Enabled --> Disabled: toggle off (single or bulk)
    Disabled --> Enabled: toggle on (single or bulk)
    Enabled --> [*]: delete
    Disabled --> [*]: delete

    state Enabled {
        [*] --> Unseated
        Unseated --> Seated: cluster moved to a table / Generate stored / Cofnij
        Seated --> Seated: cluster moved to another table
        Seated --> Unseated: cluster moved to tray / table removed
        Seated --> Pinned: pin cluster
        Pinned --> Seated: unpin cluster
        Pinned --> Unseated: table removed
    }

    state Disabled {
        [*] --> Parked
        Parked --> Parked: cluster moved (rides along)
    }

    note right of Enabled
        Seated / Unseated / Pinned is tracked separately
        in EACH of the four plans (9 / 10 / 11 / 12).
        All members of a cluster share the same table.
    end note
    note right of Disabled
        Ignored by all four plans: no seat, no fill,
        no score. Links kept, and still define the
        cluster and its affinities. Any assignment is
        kept and follows the cluster, so toggling on
        returns the guest to the family's table, even
        if it is full: then the plan needs
        recalculation (see section 2).
    end note
```

*Legend:* Guest is the aggregate root of the guest list. The seating sub-state is the guest's Assignment in one scenario. One `enabled` flag replaces an attending/declined status (one switch, no extra state). Store-only-input rule: toggling writes one column and re-derives everything else. No undo stack (Command/Memento rejected as patterns): every transition has an inverse; the only undo is the one-step Cofnij of a Generate (§2).

## 2. Plans: generate (stored at once), Cofnij

```mermaid
stateDiagram-v2
    [*] --> Showing: open plans (GET /scenarios)
    Showing --> Generating: click Generate (no confirmation)
    Generating --> Undoable: GET snapshot, calculate, PUT /scenarios 200 (all four stored)
    Generating --> Showing: 409 (plans changed meanwhile) or error, nothing stored (toast)
    Undoable --> Restoring: Cofnij
    Restoring --> Showing: PUT /scenarios 200 (previous four plans back)
    Restoring --> Showing: 409 or 422, nothing changed, "Nie można cofnąć" (toast)
    Restoring --> Undoable: network or 500 (snapshot kept, retry)
    Undoable --> Showing: any plan version moves on (edit here or elsewhere) / dismiss x / page reload
    Undoable --> Generating: Generate again (new snapshot replaces the old one)
    Showing --> Showing: move / pin / add or remove table / delete plan / toggle / link edit (refetch)
    Undoable --> Undoable: toggle / link edit (plan versions unchanged)

    state Showing {
        [*] --> UpToDate
        UpToDate --> NeedsRecalculation: a violation appears (re-enabled guest overfills table, new guest unseated, under floor, split)
        NeedsRecalculation --> UpToDate: violations fixed by hand (move, add table)
        NeedsRecalculation --> UpToDate: Generate stored without violations
        UpToDate --> Empty: delete plan (confirmed)
        NeedsRecalculation --> Empty: delete plan (confirmed)
        Empty --> UpToDate: Generate stored
        Empty --> NeedsRecalculation: Generate stored with violations / table added by hand
        note right of Empty
            No tables, assignments or pins
            (DELETE .../tables). With enabled guests
            it has unseated_guests: empty state
            plus Przelicz / Generuj.
        end note
    }

    note right of Undoable
        The new plans are stored and shown in the
        normal views (cards, floor plan). The bar
        "Wygenerowano nowe plany. Cofnij" is shown
        while every plan version equals the version
        the Generate produced. Snapshot lives in the
        client only (this tab, until reload).
    end note
    note left of Showing
        Each scenario: version bumps on every plan
        mutation. Evaluation is recomputed by the
        server on every read. Violations never block
        saving; they are displayed.
    end note
```

*Legend:* the four Scenarios are aggregate roots with an **Optimistic Offline Lock** (`version`). `UpToDate` / `NeedsRecalculation` / `Empty` (inside `Showing`, and equally inside `Undoable`) are tracked per plan and derived by the server (`summary.needsRecalculation` = any violation); `Empty` is a display state (`tableCount = 0`). There is never an automatic regeneration. Generate always produces and stores all four plans, **atomically** (`PUT /scenarios`: all four or none), with no preview and no confirmation (user decision 2026-10-03, task 007). `Undoable` is a client-side state: it holds a one-slot snapshot of the four plans as they were before the Generate; **Cofnij** re-sends it through the same atomic, version-checked call, so it fails cleanly (409, nothing changed) if any plan was edited after the Generate. **Delete plan** (UC-17) has no undo; a confirmation dialog stands in for it.

## 3. Cluster drag & drop (UI)

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Dragging: pointer drag OR keyboard (Space on a focused chip)
    state Dragging {
        [*] --> OverNothing
        OverNothing --> OverTable: hover table
        OverTable --> OverTable: hover another table
        OverTable --> OverNothing: leave
        OverNothing --> OverTray: hover unseated tray
        OverTray --> OverNothing: leave
    }
    Dragging --> Idle: Esc / drop outside (no change)
    Dragging --> Saving: drop on table or tray
    Saving --> Idle: 2xx, server scenario replaces optimistic state
    Saving --> RolledBack: error (4xx / 5xx / network)
    RolledBack --> Idle: toast with reason, previous position restored
    note right of Dragging
        The dragged unit is the whole CLUSTER
        (its enabled members are shown, disabled
        ones ride along invisibly). Over a table the
        preview shows fill after drop (e.g. 9/10),
        an over-capacity or under-floor warning, and
        preferred companions already at that table.
    end note
    note right of Saving
        Optimistic: chips already at the target,
        fill counters updated locally; scores and
        violations come only from the server reply.
    end note
```

*Legend:* `@dnd-kit/core` with pointer and keyboard sensors and screen-reader announcements. Warnings use an icon plus text, never colour alone. A drop on a full table is allowed and shown as a violation: the plan is a draft, not a validator. A TanStack Query optimistic mutation with rollback implements `Saving/RolledBack`.

## 4. App shell and screens

```mermaid
stateDiagram-v2
    [*] --> Plans: open /wesele/
    Plans --> Guests: tab
    Guests --> Plans: tab
    Guests --> Import: import CSV
    state Import {
        [*] --> FileChosen
        FileChosen --> Report: dry run
        Report --> FileChosen: fix sheet, choose again
        Report --> Committed: commit (no errors)
    }
    Import --> Guests: committed / cancelled
    Plans --> PrintView: print
    PrintView --> Plans: back
    state Plans {
        [*] --> Compare
        Compare --> PlanDetail: open 9 / 10 / 11 / 12
        PlanDetail --> Compare: back
        PlanDetail --> PlanDetail: switch 9 / 10 / 11 / 12
    }
    state Guests {
        [*] --> List
        List --> Filtered: filter (children / disabled / search / Pokaż na liście = powiązani z X)
        Filtered --> List: clear filter
        Filtered --> Filtered: bulk enable or disable selection
    }
```

*Legend:* the access gate (task 009) wraps this whole machine — see §5; with the gate off there is no login state.
- `Compare` shows the four plans side by side (2×2 on medium screens, 4 across on wide ones): table count, fill bars, satisfaction and violation count, plus the **Generate** button.
- `PlanDetail` is the floor plan of one plan, with the unseated tray, guest search and a details panel showing where a guest's preferred companions sit, with "via group 0 of X" provenance.
- `Guests` is the editable list. It has per-row enable switches, a child marker, the relationships panel with per-group link checklists, and data warnings ([003-frontend-design.md](003-frontend-design.md) §5).

On a phone, `Compare`, `PlanDetail` (read-mostly, search) and `PrintView` must be usable.

## 5. Access gate: session (client view) and login throttle (server view) — task 009

Rules: [../05-access-gate.md](../05-access-gate.md). Flows: [003-sequences.md](003-sequences.md) §6.

```mermaid
stateDiagram-v2
    [*] --> Checking: app start (GET /session)
    Checking --> Open: 200 (gate off → pinRequired false, gate on → valid cookie)
    Checking --> PinRequired: 401 unauthenticated
    state PinRequired {
        [*] --> Idle
        Idle --> Submitting: "Wejdź" (POST /session)
        Submitting --> WrongPin: 401 invalid_pin
        WrongPin --> Submitting: "Wejdź"
        Submitting --> Throttled: 429 (Retry-After s)
        Throttled --> Idle: countdown reaches 0
        Submitting --> Idle: network / 500 (error copy)
    }
    PinRequired --> Open: 200 + cookie (data queries refetch, same URL)
    Open --> PinRequired: any 401 unauthenticated (expired / bad cookie, PIN changed)
    Open --> PinRequired: "Wyloguj" (DELETE /session, cache cleared)
    Open --> Open: authenticated request (cookie re-issued if older than 24 h)
```

*Legend:* client states of `AccessGate` (`keys.session`). `Open` contains the whole app shell of §4. Leaving `Open` always drops cached guest data. `Throttled` disables the button; it does not reveal whether the last PIN was right (the server did not check it).

```mermaid
stateDiagram-v2
    [*] --> Free: first failure of a client
    Free --> Free: failure n ≤ 3
    Free --> Locked: failure n ≥ 4 → lock 30 s × 2^(n−4), max 1 h
    Locked --> Locked: attempt while locked → 429, PIN not checked, not counted
    Locked --> Free: lock expires (next failure locks again, longer)
    Free --> [*]: success, or 24 h without failures (entry forgotten)
    state "Global window (all clients)" as G {
        [*] --> Accepting
        Accepting --> Closed: 20 failures within the last 24 h
        Closed --> Accepting: oldest failure leaves the 24 h window
    }
```

*Legend:* server-side, in memory, reset by a restart. A client is refused when **either** its own state is `Locked` **or** the global window is `Closed`; `Retry-After` is the longer of the two. A success clears only that client's entry, never the global window.
