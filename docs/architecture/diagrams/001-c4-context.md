# 001 — C4: system context and containers

Task 001, Phase 2 (Skill 6). Policy vs detail boundaries for Stoliki. Prose and rules: [../02-system-context.md](../02-system-context.md).

## Level 1 — System context

```mermaid
C4Context
    title Stoliki — system context

    Person(planner, "Editor", "The couple and trusted helpers on tailnet devices; equal rights; desktop browser")
    Person(viewer, "Viewer at the venue", "Same people on a phone: find a guest, check a table")

    System_Boundary(pi, "Raspberry Pi home server (ARM64, Docker)") {
        System(stoliki, "Stoliki", "Wedding seating planner: guest list, group 0/1/2 links, four scenarios (9/10/11/12 seats), auto-seating")
        System_Ext(otherapps, "Other apps on the Pi", "investing-app edge Nginx (/ , /sibling-a, /sibling-b) — must stay untouched")
    }

    System_Ext(tailscale, "Tailscale serve (tailnet-only)", "HTTPS on <pi-host>.<tailnet>.ts.net, dedicated non-funnelled port; maps /wesele to Stoliki")
    System_Ext(gsheet, "Google Sheet", "Initial guest list, exported manually as CSV")

    Rel(planner, tailscale, "Uses", "HTTPS /wesele/")
    Rel(viewer, tailscale, "Uses", "HTTPS /wesele/")
    Rel(tailscale, stoliki, "Proxies /wesele/*", "HTTP, prefix kept")
    Rel(tailscale, otherapps, "Proxies / and other paths (:443, funnelled)", "HTTP")
    Rel(planner, gsheet, "Downloads CSV from")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

*Legend:* `System` is what we build; `System_Ext` is existing or external and not changed by Stoliki. The CSV travels through the Editor's browser as an upload. There is **no** server-to-Google connection (cost-free, no OAuth). The Tailscale config is shared with other apps; only a `/wesele` serve mapping on Stoliki's own non-funnelled port is added. Tailnet membership is the only access control.

**Task 009 (designed 2026-10-03, not live until phase C1/C2):** a shared-PIN access gate inside the Go container protects the whole API on every network (tailnet, home LAN and, after the user confirms, the public internet through Tailscale Funnel). Context changes then: the Editor may be anywhere on the internet with the PIN, and an anonymous internet visitor can reach only the SPA shell, the PIN screen, `GET /health` and the throttled login. Design: [../05-access-gate.md](../05-access-gate.md).

## Level 2 — Containers

```mermaid
C4Container
    title Stoliki — containers (one Docker container + one volume)

    Person(planner, "Editor / Viewer", "Browser on a tailnet device, desktop or phone")
    System_Ext(tailscale, "Tailscale serve", "TLS termination, tailnet-only, /wesele mapping")

    Container_Boundary(stolikiBox, "Docker container: stoliki (distroless, linux/arm64)") {
        Container(spa, "SPA", "React 19, TypeScript, Vite, dnd-kit, TanStack Query", "Floor-plan UI, drag and drop of clusters, guest toggles, plan comparison, print view. Runs in the browser; files served from /wesele/")
        Container(api, "API server", "Go, chi, oapi-codegen strict server", "BASE_PATH=/wesele. REST under /wesele/api, static SPA files + index.html fallback; no app auth")
        Container(seating, "seating package", "Go, pure functions", "Clusters, affinity, feasibility, scoring, Propose / Evaluate — no I/O")
        Container(importer, "CSV import adapter", "Go, encoding/csv", "CSV → guests + links + import report; replaceable edge")
    }
    ContainerDb(db, "SQLite database", "modernc.org/sqlite, file on named volume stoliki-data", "guest, guest_link, scenario, dining_table, assignment; goose migrations applied at startup")

    Rel(planner, tailscale, "HTTPS", "/wesele/...")
    Rel(tailscale, api, "HTTP", "127.0.0.1:port, full /wesele path")
    Rel(api, spa, "Serves static build of")
    Rel(spa, api, "JSON over fetch", "/wesele/api")
    Rel(api, seating, "Calls")
    Rel(api, importer, "Calls")
    Rel(api, db, "SQL via sqlc", "single writer, WAL")

    UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")
```

*Legend:* boxes inside the container boundary are logical parts of **one** process/image (the SPA executes in the browser but ships inside the same image). Arrows show the only allowed dependency directions.

## Policy vs detail

```mermaid
flowchart LR
    subgraph Detail_UI[Detail: UI]
        SPA[React SPA]
    end
    subgraph Detail_IO[Detail: delivery and I/O]
        HTTP[HTTP handlers / oapi-codegen DTOs]
        SQL[sqlc queries + SQLite]
        CSV[CSV import adapter]
    end
    subgraph App[Application services]
        SVC[guests / scenarios services: transactions, version checks, row-to-domain mapping]
    end
    subgraph Policy[Policy: domain core]
        SEAT[internal/seating: clusters, affinity, rules, scoring, Propose, Evaluate]
    end
    SPA -->|OpenAPI contract| HTTP
    HTTP --> SVC
    SVC --> SEAT
    SVC --> SQL
    SVC --> CSV
```

*Legend — principles applied:*
- **Dependency rule / functional core, imperative shell:** dependencies point inward to `internal/seating`, which imports nothing from HTTP, SQL or CSV and works on plain Go values. Services do the I/O around it.
- **Layered (handler → service → sqlc):** chosen over full hexagonal — YAGNI; no interfaces for single implementations.
- **Adapter** only at the import edge (CSV now; a Sheets API source could replace it).
- **DTO + mapper boundary:** sqlc rows never cross into handlers; OpenAPI DTOs never enter `seating`.
- **Rejected:** a separate Nginx container (one Go binary serves SPA + API), a separate DB container (SQLite), auth middleware (tailnet-only today; task 009 adds the PIN gate before any public exposure, see 05-access-gate.md), Strategy for algorithms (only one), Observer/live push (few editors).
