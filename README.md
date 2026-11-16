# Wedding Seating Planner ("Stoliki")

A small self-hosted web app for planning wedding table seating: the guest list, the relationships
between guests, and an optimiser that proposes who sits at which table. It runs as a single Docker
container on a Raspberry Pi and is protected by a shared PIN.

The UI is in Polish ("stoliki" means "tables"); code and docs are in English.

## Features

- **Guest list** edited continuously (declines, children, notes), with bulk import.
- **Relationship groups** between guests:
  - group 0 — must sit together (a family or couple becomes one seating unit, a *cluster*),
  - group 1 — should sit together,
  - group 2 — may sit together if nothing better fits.
- **Five plans at once:** uniform tables of 9, 10, 11 and 12 seats, plus a mixed plan whose
  tables have 9–12 seats sized by the optimiser.
- **Auto-seating** ("Generuj plany") proposes a layout for all five plans in one request.
- **Manual editing** with drag and drop and pinning: pinned clusters keep their table and the
  optimiser only moves the rest. Every change is re-evaluated, and violations are shown live.

## Seating model

The optimiser (`backend-go/internal/seating`, pure Go, no I/O) applies these rules in strict
priority order:

1. **Cluster integrity** (hard) — all enabled members of a group-0 cluster sit at one table.
2. **Capacity** (hard) — a table never exceeds its seats.
3. **Fewest tables** — the smallest feasible table count (uniform plans).
4. **Floor** (hard) — at least 8 guests per table (9 in the mixed plan), e.g. 12 + 12 + 4 is
   rebalanced to 12 + 8 + 8.
5. **No isolated guests** — avoid seating someone with nobody they know.
6. **Fewest stranger pairs.**
7. **Maximum satisfaction** — group 1 counts more than group 2 more than strangers; children take
   seats but are not scored.
8. **Pins** — pinned clusters stay where they are.

The full rules and the scoring function are in
[`docs/architecture/03-seating-model.md`](docs/architecture/03-seating-model.md).

## Tech stack

| Layer | Technology |
| --- | --- |
| Backend | Go, chi, oapi-codegen (server generated from an OpenAPI 3.1 contract), SQLite (`modernc.org/sqlite`, pure Go) with goose migrations |
| Frontend | React 19, TypeScript, Vite, TanStack Query, Tailwind CSS 4, dnd-kit |
| Packaging | One Docker image: the static Go binary serves both the API and the built SPA; compose with a named data volume |
| Access | Shared PIN gate: signed `HttpOnly` session cookie, login throttling, CSRF header check |

The app is served under a path prefix (`/wesele`) end to end: SPA router basename, Vite `base`
and the API (`/wesele/api/...`).

## Repository layout

```
backend-go/      Go API: cmd/server, internal/{seating,scenarios,guests,store,accessgate,httpapi}
frontend-web/    React SPA
docs/            OpenAPI contract, ADR, architecture docs (domain glossary, seating model, data model, access gate)
infra/           Dockerfile, compose file, backup/restore scripts
```

## Running

```bash
cp infra/.env.example infra/.env      # set STOLIKI_PIN (required)
docker compose -f infra/compose.yml --env-file infra/.env up -d --build
# open http://localhost:8094/wesele/
```

Backups of the SQLite volume: `infra/backup.sh` and `infra/restore.sh`.

Development:

```bash
(cd backend-go && go test ./...)
(cd frontend-web && npm install && npm test)
make openapi          # lint the OpenAPI source and regenerate the bundle
```

## Security

Guest names are personal data, so every route — including the SPA — sits behind the PIN gate. The
real guest database lives only in the Docker volume and is never committed; test fixtures use
made-up names.

## How it was built

Developed with Claude Code in an orchestrated workflow (architect agent → backend and frontend
agents → DevOps), described in `AGENTS.md`; design decisions are recorded in `docs/`.
