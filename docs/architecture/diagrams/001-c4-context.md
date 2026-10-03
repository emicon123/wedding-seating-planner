# 001 — C4: system context and containers

Task 001, Phase 2 (Skill 6). Policy vs detail boundaries for Stoliki. Prose and rules: [../02-system-context.md](../02-system-context.md).

## Level 1 — System context

```mermaid
C4Context
    title Stoliki — system context

    Person(planner, "Editor", "The couple and trusted helpers who know the PIN; anywhere on the internet, tailnet or home LAN; equal rights; desktop browser")
    Person(viewer, "Viewer at the venue", "Same people on a phone (PIN): find a guest, check a table")
    Person_Ext(stranger, "Anonymous internet visitor", "Scanners, anyone with the URL; gets only the SPA shell, PIN screen, health and a throttled login")

    System_Boundary(pi, "Raspberry Pi home server (ARM64, Docker)") {
        System(stoliki, "Stoliki", "Wedding seating planner: guest list, group 0/1/2 links, four scenarios (9/10/11/12 seats), auto-seating; shared-PIN gate on the API")
        System_Ext(otherapps, "Other apps on the Pi", "investing-app edge Nginx (/ , /sibling-a, /sibling-b), :8443 app — must stay untouched")
    }

    System_Ext(tailscale, "Tailscale funnel + serve", "HTTPS on <pi-host>.<tailnet>.ts.net: public :443 /wesele (Funnel) and tailnet-only :8444 /wesele, both to Stoliki")
    System_Ext(gsheet, "Google Sheet", "Initial guest list, exported manually as CSV")

    Rel(planner, tailscale, "Uses", "HTTPS /wesele/")
    Rel(viewer, tailscale, "Uses", "HTTPS /wesele/")
    Rel(stranger, tailscale, "Reaches", "HTTPS /wesele/")
    Rel(planner, stoliki, "Uses on the home LAN", "HTTP <pi-lan-ip>:8094/wesele/")
    Rel(tailscale, stoliki, "Proxies /wesele/*", "HTTP, prefix kept")
    Rel(tailscale, otherapps, "Proxies / (:443) and :8443, funnelled", "HTTP")
    Rel(planner, gsheet, "Downloads CSV from")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

*Legend:* `System` is what we build; `System_Ext` is existing or external and not changed by Stoliki. The CSV travels through the Editor's browser as an upload. There is **no** server-to-Google connection (cost-free, no OAuth). The Tailscale config is shared with other apps; Stoliki owns only two `/wesele` handlers: one on the funnelled `:443` listener (public, `https://<pi-host>.<tailnet>.ts.net/wesele/`) and one on its own tailnet-only `:8444` listener. **Access control is the shared-PIN gate inside the Go container** (live since 2026-10-03, task 009), identical on all three routes (Funnel, tailnet, home LAN): without the PIN cookie a visitor reaches only the SPA shell, the PIN screen, `GET /health` and the throttled login. Design: [../05-access-gate.md](../05-access-gate.md).

## Level 2 — Containers

```mermaid
C4Container
    title Stoliki — containers (one Docker container + one volume)

    Person(planner, "Editor / Viewer", "Browser anywhere (internet, tailnet, home LAN), desktop or phone; knows the PIN")
    System_Ext(tailscale, "Tailscale funnel :443 / serve :8444", "TLS termination, /wesele handlers, sets X-Forwarded-Proto")

    Container_Boundary(stolikiBox, "Docker container: stoliki (distroless, linux/arm64)") {
        Container(spa, "SPA", "React 19, TypeScript, Vite, dnd-kit, TanStack Query", "Floor-plan UI, drag and drop of clusters, guest toggles, plan comparison, print view. Runs in the browser; files served from /wesele/")
        Container(api, "API server", "Go, chi, oapi-codegen strict server", "BASE_PATH=/wesele. REST under /wesele/api behind the shared-PIN gate middleware (signed session cookie, CSRF header, login throttle); static SPA files + index.html fallback (open)")
        Container(seating, "seating package", "Go, pure functions", "Clusters, affinity, feasibility, scoring, Propose / Evaluate — no I/O")
        Container(importer, "CSV import adapter", "Go, encoding/csv", "CSV → guests + links + import report; replaceable edge")
    }
    ContainerDb(db, "SQLite database", "modernc.org/sqlite, file on named volume stoliki-data", "guest, guest_link, scenario, dining_table, assignment; goose migrations applied at startup")

    Rel(planner, tailscale, "HTTPS", "/wesele/...")
    Rel(tailscale, api, "HTTP", "127.0.0.1:8094, full /wesele path")
    Rel(planner, api, "HTTP on the home LAN", "<pi-lan-ip>:8094/wesele")
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
- **Access gate as one middleware (Decorator)** on the API sub-router, in the HTTP detail layer; the core and services know nothing about sessions.
- **Adapter** only at the import edge (CSV now; a Sheets API source could replace it).
- **DTO + mapper boundary:** sqlc rows never cross into handlers; OpenAPI DTOs never enter `seating`.
- **Rejected:** a separate Nginx container (one Go binary serves SPA + API), a separate DB container (SQLite), Strategy for algorithms (only one), Observer/live push (few editors).
