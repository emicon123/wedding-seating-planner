# ADR-001: Stack details and system shape

**Date:** 2026-10-02 (revised the same day after the user's answers: tailnet-only, no app auth)
**Status:** Accepted

**Context:**
The user fixed the stack: Go + React SPA + Docker on a Raspberry Pi (ARM64) + Tailscale under `/wesele`, all cost-free. Seven things were still open: persistence, access control, `/wesele` prefix handling, repo layout, the non-obvious libraries, concurrency, and where the seating algorithm runs. The forces:
- One wedding, ~85–100 guests, a few editors with equal rights.
- A Pi with limited RAM.
- Guest names are personal data.
- The Pi's Tailscale HTTPS listener `:443` is already **Funnel-enabled** (public) for other apps.
- It is a quick app, so YAGNI wins ties.

This ADR keeps the *reasoning*. The resulting system is described as current fact in [`02-system-context.md`](../architecture/02-system-context.md) and [`03-seating-model.md`](../architecture/03-seating-model.md).

**Decision:**

### 1. Persistence: SQLite

| Option | For | Against |
|---|---|---|
| **SQLite file on a named volume** (chosen) | No extra container or RAM. Pure-Go `modernc.org/sqlite` keeps `CGO_ENABLED=0`. Backup is one file. Tests use the real engine via a temp file. | Single writer (irrelevant here). No `TIMESTAMPTZ`/`NUMERIC` types. |
| PostgreSQL 17 container | Richer types | An extra container plus ~50–100 MB RAM, Testcontainers, more ops, all for a few hundred rows |
| investing-app's shared Postgres | No new container | Cross-repo coupling — rejected |

- Migrations: **goose v3**. Embedded SQL files are applied by the server at startup, and sqlc reads the same directory. Rejected alternatives: golang-migrate (split up/down files, no gain) and Atlas (heavier, partly non-free).
- SQLite conventions replace the generic Postgres rules: `STRICT` tables; timestamps as RFC 3339 UTC `TEXT`; booleans as `INTEGER` 0/1 with `CHECK`.

### 2. Access control: tailnet-only, no application auth (deliberate simplification)

| Option | For | Against |
|---|---|---|
| **Tailnet-only (`tailscale serve`, never Funnel), no app login** (chosen) | Tailnet membership is the access control. WireGuard-authenticated devices only, so guest data never reaches the public internet. Zero auth code, no secrets, no login screen. Matches the user's "everyone with access can edit". | No per-person identity or audit. Anyone on the tailnet (including shared devices) can edit. |
| Shared passphrase → signed session cookie (designed in the first draft of this ADR) | Would protect a public Funnel exposure | Pointless behind the tailnet; adds a login flow, secrets and rate limiting — dropped as YAGNI |
| Per-person accounts | Audit | User management for a handful of trusted people — rejected |

The user decided on 2026-10-02 that no public access is needed. **If the app is ever exposed publicly (Funnel or any other route), auth must be re-added before the exposure**: the minimum is the shared passphrase → HMAC-signed `HttpOnly; Secure; SameSite=Strict; Path=/wesele` cookie, a login rate limit, and public `POST /sessions` + `GET /health` with everything else returning 401. It would be one middleware in front of the existing API; nothing else in the design depends on that choice. Tailscale identity headers (`Tailscale-User-Login`) are the cheapest upgrade if per-person attribution is ever wanted on the tailnet.

**Amendment (2026-10-02, user decision):** the app is also reachable from the **home LAN** (`http://<pi-lan-ip>:8094/wesele/`, plain HTTP, no login); the host port is no longer loopback-only. Access control is therefore "tailnet or home LAN". Still never Funnel and never a router port-forward; any public route still requires auth first.

### 3. `/wesele` prefix and routing

- **Prefix kept end-to-end inside Stoliki.** The Go server runs with `BASE_PATH=/wesele` and serves the SPA under `/wesele/` and the API under `/wesele/api/`. Vite `base: '/wesele/'`, React Router `basename: '/wesele'`. Whatever routes traffic to Stoliki must deliver the full path. If Tailscale's `--set-path` strips the mount path, the mapping target re-adds it (`http://127.0.0.1:<port>/wesele`). DevOps verifies this empirically.
- **Routing: a dedicated Tailscale serve mapping**, not investing-app's edge Nginx (which would be a cross-repo change). Funnel is configured **per listener port**, and `:443` is funnelled for other apps, so a `/wesele` handler on `:443` would be public. Stoliki therefore uses a **separate, non-funnelled HTTPS port** on the same tailnet hostname (e.g. `:8444`; `:8443` is taken). DevOps picks and verifies the port, confirms with `tailscale funnel status` that it is not funnelled, and never resets the shared config.

### 4. Repo layout and deployment shape: one container

`backend-go/`, `frontend-web/`, `infra/`, `docs/`, root `Makefile`. One multi-stage image: a node stage builds the SPA, a Go stage builds the static binary, and the runtime is distroless. The Go binary serves the API **and** the SPA files (from `WEB_ROOT`, with an `index.html` fallback).

| Option | For | Against |
|---|---|---|
| **Single container** (chosen) | One image, one process, least RAM; prefix rules live in one place | Frontend and backend release together (fine for one app) |
| Nginx (SPA + proxy) + Go API containers | Nginx features | Two images and duplicated prefix rules — not needed without public exposure |

### 5. Library picks (only the non-obvious ones)

| Concern | Pick | Why / rejected |
|---|---|---|
| Go router | `go-chi/chi/v5` | stdlib-compatible; Compress middleware |
| Go API codegen | `oapi-codegen/v2`, chi **strict-server** | Contract-first, typed. Rejected: hand-written handlers (drift) |
| Go data access | `sqlc` (engine `sqlite`) | Typed queries, no ORM |
| OpenAPI tooling | `@redocly/cli@2.57.0` via `npx` from the Makefile (`openapi-bundle`, `openapi-lint`) | One free tool does both 3.1 bundling and linting. Rejected: Spectral + a separate bundler |
| Frontend API types | `openapi-typescript` + `openapi-fetch` | Types come from the same bundle. Rejected: hand-written Zod mirrors of every DTO (DRY). Zod is used for forms only |
| Drag & drop | `@dnd-kit/core` | Accessible keyboard sensor, 2D drop targets. Rejected: react-dnd (no keyboard support), list-oriented libraries |
| Floor plan | Plain DOM/SVG on a CSS grid, no canvas library | Keeps a11y and DnD working. Stored table coordinates are YAGNI |
| Client state | TanStack Query; local state; Zustand only if a shared client store is actually needed | YAGNI |

### 6. Concurrency: last write wins, version-checked where staleness hurts

**Guest** and **Scenario** carry an integer `version`:
- Editing a single guest and accepting a proposal are version-checked. A stale version returns 409.
- Cluster moves, pins, table add/remove, toggles and link edits are idempotent "set" operations with last-write-wins semantics. Moves, pins and table changes bump the scenario version.
- There is no live push; the SPA refetches when the window regains focus. Rejected: SSE/WebSocket/CRDT (too much for a handful of editors).

### 7. Seating algorithm: Go backend, pure package

`internal/seating` holds pure functions (clusters, affinity, feasibility, scoring, Propose, Evaluate).
- One implementation, table-driven tests.
- The evaluation returned on every read is the same code the generator optimises.
- Rejected: running it in the browser (scores would have to be duplicated or trusted).
- Generating runs the same function three times, with capacity 8, 10 and 12. At ~100 guests, that takes well under a second on the Pi.

**Consequences:**
- + Minimal ops: one container, one SQLite file, **no secrets at all** (the `.env` holds only non-secret config).
- + Contract-first (OpenAPI → oapi-codegen / openapi-typescript) keeps Go and TS in sync.
- − Access depends entirely on the tailnet and on the mapping never being funnelled. Re-exposing publicly requires adding auth first (see §2).
- − SQLite type conventions differ from the generic "TIMESTAMPTZ/NUMERIC" rule.
- − No per-person audit trail.
