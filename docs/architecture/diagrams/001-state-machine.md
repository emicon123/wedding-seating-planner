# 001 — State machines (domain lifecycles + UI interaction)

Task 001, Phase 2 (Skill 7); updated 2026-10-02 with the user's answers (enabled toggle, generate-all-three, no login); updated 2026-10-03 for four table sizes 9/10/11/12 (task 006). Terms: [../01-domain-glossary.md](../01-domain-glossary.md). Rules: [../03-seating-model.md](../03-seating-model.md).

Contents:
1. [Guest lifecycle](#1-guest-lifecycle) (domain)
2. [Plans: generate, preview, accept](#2-plans-generate-preview-accept) (domain + UI)
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
        Unseated --> Seated: cluster moved to a table / proposal accepted
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

*Legend:* Guest is the aggregate root of the guest list. The seating sub-state is the guest's Assignment in one scenario. One `enabled` flag replaces an attending/declined status (one switch, no extra state). Store-only-input rule: toggling writes one column and re-derives everything else. No undo stack (Command/Memento rejected): every transition has an inverse.

## 2. Plans: generate, preview, accept

```mermaid
stateDiagram-v2
    [*] --> Showing: open plans (GET /scenarios)
    Showing --> Generating: click Generate
    Generating --> Previewing: 4 proposals returned (9, 10, 11, 12)
    Generating --> Showing: error (toast)
    Previewing --> Accepting: accept one / several / all
    Previewing --> Showing: discard
    Accepting --> Showing: all PUT .../assignments succeeded
    Accepting --> Conflict: a scenario returned 409 version_conflict
    Conflict --> Generating: regenerate
    Conflict --> Showing: give up (others stay accepted)
    Showing --> Showing: move / pin / add or remove table / delete plan / toggle / link edit (refetch)

    state Showing {
        [*] --> UpToDate
        UpToDate --> NeedsRecalculation: a violation appears (re-enabled guest overfills table, new guest unseated, under floor, split)
        NeedsRecalculation --> UpToDate: violations fixed by hand (move, add table)
        NeedsRecalculation --> UpToDate: proposal accepted
        UpToDate --> Empty: delete plan (confirmed)
        NeedsRecalculation --> Empty: delete plan (confirmed)
        Empty --> UpToDate: proposal accepted
        Empty --> NeedsRecalculation: proposal accepted with violations / table added by hand
        note right of Empty
            No tables, assignments or pins
            (DELETE .../tables). With enabled guests
            it has unseated_guests: empty state
            plus Przelicz / Generuj.
        end note
    }

    note right of Previewing
        Proposals live in client memory only.
        Each shows table count, fills, score and
        violations, side by side with the current plan.
        Nothing is written until accept.
    end note
    note left of Showing
        Each scenario: version bumps on every plan
        mutation. Evaluation is recomputed by the
        server on every read. Violations never block
        saving; they are displayed.
    end note
```

*Legend:* the four Scenarios are aggregate roots with an **Optimistic Offline Lock** (`version`). `UpToDate` / `NeedsRecalculation` is tracked per plan and derived by the server (`summary.needsRecalculation` = any violation). In `NeedsRecalculation` the plan card and the floor plan show a "Przelicz / Generuj" call to action. There is never an automatic regeneration. Each proposal carries `basedOnVersion`, and each accept is an independent PUT, so "accept all" is four calls and a conflict affects only that scenario. Generate always produces all three plans (user requirement). `Previewing` replaces an undo stack for accepting. **Delete plan** (UC-17) has no undo either; a confirmation dialog stands in for it. `Empty` is a display state, not a stored one: the server still derives `needsRecalculation` (true when any enabled guest exists), the UI additionally recognises `tableCount = 0` to show the empty state and disable "Usuń plan". Discarding a preview ("Odrzuć", `Previewing → Showing`) is a different thing: it never touches a stored plan.

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

*Legend:* there is no login state (tailnet-only access).
- `Compare` shows the four plans side by side (2×2 on medium screens, 4 across on wide ones): table count, fill bars, satisfaction and violation count, plus the **Generate** button.
- `PlanDetail` is the floor plan of one plan, with the unseated tray, guest search and a details panel showing where a guest's preferred companions sit, with "via group 0 of X" provenance.
- `Guests` is the editable list. It has per-row enable switches, a child marker, the relationships panel with per-group link checklists, and data warnings ([003-frontend-design.md](003-frontend-design.md) §5).

On a phone, `Compare`, `PlanDetail` (read-mostly, search) and `PrintView` must be usable.
