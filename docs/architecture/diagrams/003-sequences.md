# 003 — Sequence diagrams for the UI-driven flows

Task 003, Phase 5. The participants are the components and packages from [003-frontend-design.md](003-frontend-design.md) and [003-backend-design.md](003-backend-design.md). All HTTP paths are relative to `/wesele/api` ([`docs/openapi.yaml`](../../openapi.yaml)).

1. [Generate all five plans → stored at once → Cofnij](#1-generate-all-five-plans--stored-at-once--cofnij) (tasks 007, 013)
2. [Move a cluster (drag & drop, optimistic)](#2-move-a-cluster-drag--drop-optimistic)
3. [Re-enable a guest → plan needs recalculation → regenerate](#3-re-enable-a-guest--plan-needs-recalculation--regenerate)
4. [Quick-add a guest and link them through the group checklist](#4-quick-add-a-guest-and-link-them-through-the-group-checklist)
5. [Delete a plan](#5-delete-a-plan-task-005-uc-17)
6. [Access gate: PIN login, throttling, expiry, logout](#6-access-gate-pin-login-throttling-expiry-logout) (task 009)

## 1. Generate all five plans → stored at once → Cofnij

Task 007 (user decision "Zapisuj od razu"): no preview, no accept, no confirmation. Rules: [../03-seating-model.md](../03-seating-model.md) § Storing a Generate / § Undoing a Generate.

```mermaid
sequenceDiagram
    autonumber
    actor E as Editor
    participant UI as GenerateButton / UndoGenerateBar (PlansPage or PlanDetailPage)
    participant Q as api hooks (TanStack Query)
    participant H as httpapi.Server
    participant S as scenarios.Service
    participant G as store.Guests (GuestSource)
    participant P as store.Scenarios
    participant C as seating

    E->>UI: click "Generuj plany" (or "Przelicz / Generuj")
    UI->>Q: useGeneratePlans().mutateAsync()
    Q->>H: GET /scenarios (fetchQuery, staleTime 0)
    H-->>Q: 5 Scenarios = undo snapshot (versions v9..v12, vMixed)
    Q->>H: POST /scenarios/calculate
    H->>S: Calculate(ctx)
    S->>G: List(ctx)
    S->>P: List(ctx)
    par plans 9, 10, 11, 12, mixed (goroutines, one read-only Graph)
        S->>C: Propose(graph, current plan) then Evaluate
        Note over C: mixed (task 015): for k = ceil(N/12) .. floor(N/9) solve with 9-12 guests per table; keep the highest bilans (score - 2 x stranger pairs), ties fewer tables
    end
    H-->>Q: 200 ProposalListResponse (5, ordered 9, 10, 11, 12, mixed)
    Q->>H: PUT /scenarios {plans: 5 x (key, basedOnVersion = snapshot version, tables + pinnedGuestIds)}
    H->>S: Replace(ctx, 5 PlanInput)
    S->>G: List(ctx)
    S->>C: validLayout, pins to whole cluster, ExpandDisabled (x5)
    S->>P: ReplacePlans(ctx, 5 PlanReplace)
    Note over P: ONE transaction - per plan version CAS, delete tables, insert tables + assignments
    alt all five versions match
        P-->>S: 5 PlanState (version+1 each)
        S->>C: Evaluate x5
        H-->>Q: 200 ScenarioListResponse
        Q->>Q: setQueryData keys.scenarios + keys.generateUndo (previous snapshot, generatedVersions)
        UI-->>E: new tables and guests on screen + bar "Wygenerowano nowe plany. [Cofnij] [x]"
    else any plan changed since the snapshot
        P-->>S: ErrVersionConflict (rolled back, nothing written)
        H-->>Q: 409 version_conflict
        Q->>Q: invalidate keys.scenarios
        UI-->>E: toast "Plany zmieniły się w międzyczasie — kliknij Generuj plany jeszcze raz."
    end

    opt Cofnij (bar visible only while every version == generatedVersions)
        E->>UI: "Cofnij"
        UI->>Q: useUndoGenerate().mutate()
        Q->>H: PUT /scenarios {plans: snapshot layouts, basedOnVersion = generatedVersions}
        H->>S: Replace(ctx, 5 PlanInput)
        S->>P: ReplacePlans(ctx, ...)
        alt no plan changed since the Generate
            H-->>Q: 200 ScenarioListResponse (previous plans, version+1 each)
            Q->>Q: setQueryData keys.scenarios + clear keys.generateUndo
            UI-->>E: previous plans back, toast "Przywrócono poprzednie plany."
        else a plan was edited meanwhile (409) or a guest was deleted (422)
            H-->>Q: 409 version_conflict / 422 validation_failed (nothing written)
            Q->>Q: clear keys.generateUndo + invalidate keys.scenarios
            UI-->>E: toast "Nie można cofnąć — plany zmieniono po wygenerowaniu."
        end
    end
```

*Legend:* Generate = one **query** (`calculate`, pure, CQS) + one **command** (`PUT /scenarios`). The command is atomic over the five scenarios (one store method = one transaction) and guarded by the **Optimistic Offline Lock** with the snapshot's versions, so the snapshot is exactly what was overwritten. Cofnij re-sends that snapshot through the same command (a one-slot Memento held in the client's query cache; no server-side snapshot, no migration). All five proposals come from one `Graph` (DRY, consistent input). The mixed plan is the same pipeline at capacity 12 with one extra, strictly isolation-driven decision (no Strategy); its table sizes are not in the payload — the client derives them from `fill` (03-seating-model § The mixed plan). Expected duration on the Pi ≈ 4–5 s (five or six solves on four saturated cores).

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
    PP->>Q: useGeneratePlans() (continues as flow 1: plans stored at once, Cofnij offered)
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
        Q->>Q: replace scenario 10 (version moved: a pending Cofnij bar disappears)
        UI-->>E: "Brak stołów w tym planie." + "Przelicz / Generuj"
    end
    Note over E,UI: "Usuń wszystkie plany" = same dialog with a must-tick checkbox, then five DELETE calls (9, 10, 11, 12, mixed) via Promise.allSettled
```

*Legend:* a **command** with no body and no version check (like the other manual plan edits); it bumps the version, so a pending Cofnij of a Generate becomes impossible. Unknown plan key → 404 `not_found`. The mixed plan is deleted the same way (`DELETE /scenarios/mixed/tables`). No undo for a delete; the confirmation dialog stands in for it. "Delete all" is five independent commands, not a batch endpoint: each delete is safe on its own and idempotent, unlike a Generate, which must replace all five plans atomically (`PUT /scenarios`).

## 6. Access gate: PIN login, throttling, expiry, logout (task 009)

Rules: [../05-access-gate.md](../05-access-gate.md). Components: [003-frontend-design.md](003-frontend-design.md) §10, [003-backend-design.md](003-backend-design.md) §7. Gate on (`STOLIKI_PIN` set). `<PIN>` stands for the real value, which is never written down.

### 6.1 First visit → PIN → the app

```mermaid
sequenceDiagram
    autonumber
    actor U as User (phone, any network)
    participant SPA as SPA (AccessGate, PinScreen)
    participant MW as Go: gate middleware
    participant H as Go: session / API handlers
    U->>SPA: open /wesele/plany/10
    Note over SPA: static shell is open (no data inside)
    SPA->>MW: GET /session (no cookie)
    MW-->>SPA: 401 unauthenticated
    SPA-->>U: PinScreen "Podaj PIN" (URL stays /wesele/plany/10)
    U->>SPA: types the PIN, taps "Wejdź"
    SPA->>MW: POST /session {pin} + X-Stoliki-Request: 1
    MW->>H: public op, CSRF header ok
    H->>H: throttle.check(client) — not locked
    H->>H: ConstantTimeCompare(SHA-256(pin), pinDigest) — match
    H->>H: throttle.succeed(client), sign token (issuedAt, expiresAt = +30 d)
    H-->>SPA: 200 {pinRequired: true, expiresAt} + Set-Cookie stoliki_session (HttpOnly, SameSite=Lax, Path=/wesele, Secure on HTTPS)
    SPA->>SPA: setQueryData(session, open), invalidate data queries
    SPA->>MW: GET /scenarios (cookie)
    MW->>MW: verify HMAC + expiry, issued < 24 h ago → no re-issue
    MW->>H: pass (Cache-Control: no-store)
    H-->>SPA: 200 five plans
    SPA-->>U: plan 10 with "Wyloguj" in the header
```

*Legend:* the only open calls are `GET /health`, `POST /session` and `DELETE /session`; everything else meets the middleware first. The URL never changes, so the user lands where the link pointed.

### 6.2 Wrong PINs and the throttle

```mermaid
sequenceDiagram
    autonumber
    participant C as Client (one IP)
    participant H as Go: CreateSession
    participant T as throttle (memory)
    loop failures 1..3
        C->>H: POST /session {wrong}
        H->>T: check → not locked
        H->>H: compare → mismatch
        H->>T: fail(client) — client n++, global += now
        H-->>C: 401 invalid_pin "Wrong PIN."
    end
    C->>H: POST /session {wrong} (4th)
    H->>T: check → not locked
    H->>T: fail → client locked 30 s
    H-->>C: 401 invalid_pin
    C->>H: POST /session {any value, even the right one}
    H->>T: check → locked (29 s)
    Note over H: PIN NOT evaluated — same answer for right and wrong
    H-->>C: 429 too_many_attempts, Retry-After: 29
    Note over T: next failures lock 1 min, 2 min, 4 min … max 1 h.<br/>20 failures from ALL clients within 24 h → every login refused<br/>(429) until the oldest failure is 24 h old. Existing cookies keep working.
```

*Legend:* the lock check happens **before** the comparison, so a 429 never confirms a guess. Wrong-PIN responses are identical (no "attempts left"). Logs carry counts only.

### 6.3 Cookie expired or invalid mid-use, then logout

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant SPA as SPA
    participant QC as QueryCache / MutationCache onError
    participant MW as Go: gate middleware
    U->>SPA: drag a cluster (optimistic move)
    SPA->>MW: PUT /scenarios/10/assignments/4 (expired cookie)
    MW-->>SPA: 401 unauthenticated
    SPA->>QC: mutation error (ApiError 401, code unauthenticated)
    QC->>SPA: lockApp(): remove all data queries, session = pinRequired
    SPA-->>U: PinScreen, URL unchanged
    Note over U,SPA: … PIN as in 6.1, then the route refetches and the user repeats the move
    U->>SPA: "Wyloguj"
    SPA->>MW: DELETE /session + X-Stoliki-Request: 1
    MW-->>SPA: 204 + Set-Cookie stoliki_session (empty, Max-Age=0)
    SPA->>SPA: queryClient.clear(), session = pinRequired
    SPA-->>U: PinScreen
```

*Legend:* one global error hook turns any `unauthenticated` 401 into the PIN screen and drops cached guest data. Logout is stateless: it clears this browser's cookie only (log out everywhere = change the PIN + restart).
