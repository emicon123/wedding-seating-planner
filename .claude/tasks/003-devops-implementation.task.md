# Task: DevOps implementation (MVP) — tickets

## Orchestrator Routing

**Assigned Phase:** Implementation of the Phase 1–5 design (tickets produced by the Architect in Phase 6, Skill 17).
**Agent:** DevOps (`.claude/agents/devops.md`).

**Ground rules:** tailnet-only; **never** `tailscale serve reset` / `funnel reset` and never `tailscale funnel` for Stoliki; run `tailscale serve status` and `tailscale funnel status` before and after; do not touch `../investing-app`. Images: `linux/arm64`, pinned, non-root, hadolint + trivy clean.

**Reading:** `docs/architecture/02-system-context.md` lines 5–110 (shape, layout, prefix, access control, persistence/backup, stack + env vars); `docs/adr/ADR-001-stack-and-shape.md` §2–§4; `docs/architecture/diagrams/001-c4-context.md` lines 33–62 (containers).

## Order and parallelism

```
D-01 can start once B-01 and F-01 exist (it needs both build contexts). It runs parallel to slices 2–4.
D-02 after D-01 runs locally. D-03 after D-02.
```

### D-01 One image + compose
- **Where:**
  - `infra/Dockerfile` (multi-stage). Stage 1, `node:22-alpine`: `npm ci && npm run build` in `frontend-web/`. Stage 2, `golang:<go.mod ver>-alpine`: `CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o /out/server ./cmd/server`. Runtime: `gcr.io/distroless/static-debian12:nonroot` with `/app/server` and `/app/web`.
  - `.dockerignore` files.
  - `infra/compose.yml`:
    - service `stoliki`, `ports: "127.0.0.1:<free host port>:8080"`;
    - env `BASE_PATH=/wesele`, `PORT=8080`, `DB_PATH=/data/stoliki.db`, `WEB_ROOT=/app/web`;
    - named volume `stoliki-data:/data`;
    - healthcheck `["CMD","/app/server","healthcheck"]`;
    - `mem_limit` around 128–192m;
    - `restart: unless-stopped`.
  - `infra/.env.example` (no secrets).
- **Check first (acceptance tests):**
  - `docker compose config` passes and hadolint is clean.
  - After `docker compose up -d`: `curl -s 127.0.0.1:<port>/wesele/api/health` returns `ok`; `curl -I 127.0.0.1:<port>/wesele` returns 301; a deep link `/wesele/plany/10` returns index.html.
  - The container restarts with its data intact (the volume persists).
  - trivy shows no HIGH or CRITICAL findings.
- Port: check `ss -ltn` / `docker ps`. 80, 8090–8093 and 8123 are taken.

### D-02 Tailscale serve mapping (tailnet-only, separate port)
- **Do:**
  1. Record `tailscale serve status` and `tailscale funnel status`.
  2. Add only the Stoliki mapping on a **separate HTTPS port** (e.g. `8444`; `8443` is taken): `tailscale serve --bg --https=<port> --set-path /wesele http://127.0.0.1:<host port>/wesele`. Check the current CLI syntax first; never use the `funnel` command.
  3. Verify empirically **whether the prefix reaches the container intact** (container logs show the request path) and adjust the target if needed.
- **Acceptance:**
  - `https://<pi-host>.<tailnet>.ts.net:<port>/wesele/` loads from a tailnet device, and a deep link with a hard refresh works.
  - The new port is not listed by `tailscale funnel status`.
  - The existing mappings (`/`, `/sibling-a`, `/sibling-b`, `:8443`) are unchanged and still respond.
- **Document:** the verified stripping behaviour and the final URL in `docs/architecture/02-system-context.md` § "The `/wesele` prefix" (lines 33–44). That is the only architecture-doc edit DevOps makes.

### D-03 Backup + runbook
- **Do:**
  - Document the backup command (`docker compose exec stoliki /app/server backup /data/backups/stoliki-$(date +%F).db`) and optionally a host cron entry. Copies leave the Pi via the user's normal means.
  - Fill in the AGENTS.md section *Rebuilding and restarting the app* (build, up, logs, health, backup, restore = stop, copy the file into the volume, start).
- **Acceptance:** a backup file is created and a restore drill on a scratch volume works.

## Verification
- [ ] D-01…D-03 acceptance checks recorded in the task report
- [ ] Other apps' Tailscale routes verified unchanged
