# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For any task that leads to code changes, follow the Orchestrator Workflow below (architect → backend-go/frontend-web → devops).

## What this is

**Stoliki** — a quick web app for planning wedding table seating: guests, tables, who sits where, and the constraints between them (couples, families, people who should / shouldn't sit together).

Core idea (preliminary, details in `.claude/tasks/001-domain-and-stack-adr.task.md` until the Architect writes the glossary):
- Guest list lives in the app, edited continuously (declines, changes); initial import probably from a Google Sheet.
- Plans for **9-, 10-, 11- and 12-seat tables are handled at the same time** (all four options available together; capacity 8 was dropped in task 006, 2026-10-03).
- Guests have **groups**: group 0 = must sit together (hard — treat the whole group as one seating unit), group 1 = should sit with (preferred), group 2 = may sit with only if unavoidable (fallback).
- Goal of the auto-seating: **fewest tables**, every table with **at least 8 guests** (floor raised from 6 to 8 on 2026-10-03; rebalance minimally when a remainder would be smaller, e.g. 12 + 12 + 4 → 12 + 8 + 8), with group-0 clusters intact and as many group-1 (then group-2) companions together as possible. Group 1/2 links are symmetric and expand through group-0 clusters.
- **The UI is a first-class requirement:** very readable, very convenient, as visual as possible.

**Canonical spec:** design docs live in `docs/` (`docs/architecture/`, `docs/adr/`). If the prompt or some code is not what `docs/` says — tell me.

## Stack (decided)

- **Backend:** Go
- **Frontend:** React (SPA)
- **Packaging:** Docker (compose v2)
- **Exposure:** Tailscale, served under the **`/wesele`** path (see *Tailscale & the `/wesele` path* below)

Decided in ADR-001 (details in `docs/architecture/02-system-context.md`): SQLite (`modernc.org/sqlite`, goose migrations), **no app login; reachable only from the tailnet and the home LAN** (user decisions 2026-10-02), `/wesele` prefix kept end-to-end, single container (Go serves SPA + API), seating algorithm in Go (`internal/seating`). Contract: `docs/openapi.yaml`; schema: `backend-go/db/migrations/`.

## Hard constraints (these shape every decision)

- **Cost-free only** — every tool, library, service, and host must be free / open-source. No paid APIs or SaaS.
- **Runs on the Raspberry Pi (ARM64)** home server via Docker — every image needs a `linux/arm64` variant.
- **Served under `/wesele`**, not at the domain root: the SPA (router basename, asset base URL) and the API (`/wesele/api/...`) must both work behind that prefix.
- **Tailnet + home LAN only — never Funnel.** Guest names are personal data; the app has no login because only tailnet devices and the home LAN can reach it (user decision 2026-10-02: `http://<pi-lan-ip>:8094/wesele/` on the LAN; Stoliki uses its own non-funnelled HTTPS port on the tailnet, since `:443` is funnelled for other apps). Never forward the port on the router. **If public exposure is ever wanted, auth must be added first** (ADR-001 §2) — revisit with the Architect.

## Orchestrator Workflow (Main Claude Code Session)

This session is the orchestrator. Follow this sequence for every task:

### Step 1: Read `.claude/tasks/` — Find Next Task

- Check `.claude/tasks/` directory (files in alphabetical order)
- Read the first `.task.md` file — this is next item
- Task file lists: phase, scope, diagrams, deliverables
- Add new tasks by dropping a `<name>.task.md` file into `.claude/tasks/` (copy `TEMPLATE-phase-based.task.md`); big tasks get one or more task files there

### Step 2: Spawn Architect Agent

- Pass: `.task.md` + this AGENTS.md + `docs/architecture/` context
- Architect executes the 17-skill roadmap (the designated Phase X in the task)
- Architect commits all diagrams + contracts to `docs/architecture/diagrams/` and updates the OpenAPI contract + DB schema
- Return: Phase X deliverables (diagrams with legends, updated contracts, updated task.md listing exact sections Backend-Go/Frontend-web must read)
- **Gate:** No code delegation until Architect phase is committed

### Step 3: Spawn Backend-Go / Frontend-web Agents (parallel or sequential per task)

- Pass: updated `.task.md` + Architect phase output (diagrams + contracts) + agent's own `.md` file
- You choose model and effort for `backend-go` / `frontend-web` (preferred: Sonnet or Opus)
- Each agent reads Architect diagrams → implements per Phase X design
- Each agent runs software-design-excellence §3-4 (Implement + Verify checklist)
- Return: code changes + passing tests
- **Gate:** Orchestrator spot-checks diagram↔code consistency before merging

### Step 4: Test & Redeploy

- If infra changes: spawn DevOps agent
- Rebuild + restart services (see *Rebuilding and restarting* — to be filled in by DevOps once `infra/compose.yml` exists)
- Verify no regressions in the deployed app, reached through the `/wesele` path

### Step 5: Mark Task Complete

- Move `.claude/tasks/<name>.task.md` → `.claude/tasks/done/<name>.task.md` (or delete it if history isn't useful)
- Commit all changes (diagrams, code, schema migrations)
- Loop to Step 1

---

## Agent Orchestration (Specialist Roles)

The orchestrator spawns specialist agents (subagents can't spawn further subagents — one level only). Each starts with fresh context and receives this file plus a task summary.

| Work | Agent |
| --- | --- |
| OpenAPI contracts, DB schema, UML diagrams, ADRs, dependency decisions | **Architect** |
| Go API, DB migrations, data access | **Backend-Go** |
| React web UI | **Frontend-web** |
| Docker, compose, Nginx, Tailscale `/wesele` wiring, RPi deployment, `.env` | **DevOps** |

Architect contracts (OpenAPI + DB schema) must exist before Backend-Go/Frontend-web start (Step 2 gate).

## Quality gates (no agent skips these)

- All DB schema changes go through **versioned migration files** (tooling per ADR-001) — no manual DDL.
- Backend integration tests run against the **real database engine** (Testcontainers for PostgreSQL, or a real temp SQLite file) — **do not mock the database**.
- Keep DB rows out of the API layer: sqlc rows → domain types → OpenAPI DTOs.
- Secrets live in `.env`, never in code; `.env` is gitignored, `.env.example` is committed.
- YAGNI/KISS is the tie-breaker for every design decision (`software-design-excellence` skill). This is a quick app — don't over-engineer.

## Tailscale & the `/wesele` path

The Pi's Tailscale config is **shared device-level state**, already serving other apps (investing-app's edge Nginx owns `/` → `localhost:80`, and routes `/sibling-a`, `/sibling-b` as path prefixes). Rules for every agent:

- **Never run `tailscale serve reset` / `tailscale funnel reset`** or anything that replaces the whole config — it would take the other apps offline. Add only the `/wesele` mapping, and check `tailscale serve status` before and after.
- Do not edit the investing-app repo (`../investing-app`) without asking — if `/wesele` should be routed through its edge Nginx, that is a cross-repo change to raise with the user.
- Stoliki is **tailnet + home LAN only** (user decisions 2026-10-02): `tailscale serve` on a dedicated non-funnelled port, never `tailscale funnel`. Changing that requires adding auth first and asking the user.

DevOps owns the wiring; details in `.claude/agents/devops.md`.

## Git

- Work happens on `main` unless the task says otherwise.
- Use **Conventional Commits** (`feat:`, `fix:`, `chore:`, etc.). Confirm no other agent is active before creating/switching branches.

## Project structure

Decided in ADR-001; authoritative description in `docs/architecture/02-system-context.md`.

```
backend-go/      Go module — cmd/server (serve | healthcheck | backup), internal/<pkg> (internal/seating = pure algorithm),
                 db/migrations (goose, Architect-owned, embedded), db/queries (sqlc), sqlc.yaml
frontend-web/    Vite + React 19 + TS SPA (base /wesele/, router basename /wesele, API /wesele/api)
infra/           Dockerfile (multi-stage → one distroless image), compose.yml, .env.example
docs/            architecture/ (living docs + diagrams/), adr/, openapi/ (source), openapi.yaml (bundle)
Makefile         openapi-bundle / openapi-lint (+ cross-cutting targets)
```

Runtime: **one container** — the Go binary serves the API and the built SPA under `/wesele`; **SQLite** file on a named volume; no app login — access = tailnet membership (non-funnelled serve mapping on its own port) or being on the home LAN.

## Rebuilding and restarting the app

One container (`stoliki`, image `stoliki:local`), compose project `stoliki`, data in the named volume `stoliki-data` (real name `stoliki_stoliki-data`, mounted at `/data`). Host port **`8094` → 8080**, bound to `0.0.0.0` by default so the home LAN reaches it (`STOLIKI_BIND=127.0.0.1` in `infra/.env` restricts it to loopback; nothing else on the Pi may use 8094). Run everything from the repo root; use `docker compose` v2, and only ever touch the `stoliki` project (the Pi is shared with other apps: no `docker system prune`).

```bash
# optional config (all values have defaults): cp infra/.env.example infra/.env
docker compose -f infra/compose.yml up -d --build      # build image (node -> go -> distroless) and start
docker compose -f infra/compose.yml ps                  # STATUS must say (healthy)
docker compose -f infra/compose.yml logs -f stoliki     # JSON logs (ids/counts only, never guest data)
docker compose -f infra/compose.yml restart stoliki     # restart, data stays
docker compose -f infra/compose.yml down                # stop + remove container; the volume (data) is kept
docker stats --no-stream stoliki-stoliki-1              # memory (limit 192m)
```

Never run `docker compose down -v` or `docker volume rm stoliki_stoliki-data`: that deletes the database.

**Redeploy after code changes:** re-run `docker compose -f infra/compose.yml up -d --build` (migrations run at startup; the volume is untouched).

**Health check (local, no Tailscale needed):**

```bash
curl -s http://127.0.0.1:8094/wesele/api/health                 # 200 {"data":{"status":"ok"},...}
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:8094/wesele   # 301 .../wesele/
curl -s http://127.0.0.1:8094/wesele/goscie | head -c 100       # SPA fallback: index.html
```

(The server answers `GET` only, so use `curl -s`/`-D-`, not `curl -I`, which sends `HEAD` and gets 405.) The prefix is kept end-to-end: the Go server needs the full `/wesele/...` path.

**Backup** (consistent while the app runs; `VACUUM INTO`):

```bash
infra/backup.sh          # -> /data/backups/stoliki-<date-time>.db in the volume + a copy in ~/stoliki-backups (mode 600)
# by hand: docker compose -f infra/compose.yml exec stoliki /app/server backup /data/backups/stoliki-$(date +%F).db
```

The server refuses to overwrite an existing backup file. Backups contain guest names (personal data): move copies off the Pi via your usual means (scp/rsync/Syncthing). Optional daily cron: `15 3 * * * /home/wojtekrpi/Claude-Code/stoliki/infra/backup.sh`. Env: `BACKUP_DIR` (host copy dir), `KEEP_DAYS` (prune host copies older than N days, default 30; the copies inside the volume are never pruned automatically).

**Restore** (stop, put the file in the volume, start; the current DB is kept as `stoliki.db.pre-restore-<ts>` in the volume):

```bash
infra/restore.sh ~/stoliki-backups/stoliki-2026-10-02-130542.db
# drill without touching the live app: STOLIKI_VOLUME=stoliki-scratch infra/restore.sh <file>
#   then: docker run --rm -d --name stoliki-scratch -p 127.0.0.1:8095:8080 -v stoliki-scratch:/data stoliki:local
#   check http://127.0.0.1:8095/wesele/api/guests, then docker stop stoliki-scratch && docker volume rm stoliki-scratch
```

(The image is distroless: no shell, so file copying into the volume goes through a throwaway `alpine` helper container, and the file must be owned by uid 65532.)

**Exposure under `/wesele` (ticket D-02, wired 2026-10-02):** `https://<pi-host>.<tailnet>.ts.net:8444/wesele/`, tailnet-only (never `funnel`; `:443` is funnelled for other apps). Mapping: `sudo tailscale serve --bg --https=8444 --set-path /wesele http://127.0.0.1:8094/wesele` (sudo needs a real terminal). It is shared device state: check `tailscale serve status` / `tailscale funnel status` before and after any change, never `reset`. Details of the verified prefix behaviour: `docs/architecture/02-system-context.md` § "The `/wesele` prefix".
