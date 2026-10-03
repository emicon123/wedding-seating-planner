# 009 — Expose the app publicly, behind a PIN

## Requirement (user, 2026-10-03)
"Potem kolejne zadanie żeby jednak wyeksponować aplikację publicznie. Z pin 1234" — run **after** task 008.
This is the user's explicit decision to revisit the earlier "tailnet + home LAN only, never Funnel" rule (AGENTS.md, ADR-001 §2). That rule says: auth first, then exposure. So auth (PIN) is Phase A–B and exposure is the last step.

## Facts / constraints the Architect must respect
- Guest names are personal data; today the app has **no login**. Going public = anyone on the internet can reach it, so the PIN gate must protect **every** route: SPA data, `/wesele/api/*` (all methods), exports/print if any. Only `/wesele/api/health` (compose healthcheck) and the static SPA shell + the PIN screen may be open.
- **The PIN is 1234 (4 digits, user's choice) — weak by nature.** Do not argue it away; compensate in the design so it is not brute-forceable: per-client and global attempt throttling with exponential back-off / temporary lockout (10 000 combinations must not be enumerable in practice), constant-time comparison, no information leak between "wrong PIN" and "locked", generic error text. Flag in the design that a longer PIN is a one-line config change (`STOLIKI_PIN` any length/charset) and recommend it to the user; do not enforce a length.
- **The PIN is a secret → `.env`, never in code, tests, docs or git history.** Env var `STOLIKI_PIN` read from `infra/.env` (gitignored); `.env.example` carries a placeholder, not 1234. Docs/ADR must not contain the actual PIN. If `STOLIKI_PIN` is unset the server must refuse to start in "public" mode (decide the mode switch: e.g. `STOLIKI_PIN` set ⇒ gate on; unset ⇒ today's behaviour for tailnet/LAN-only runs). Hash/derive in memory, never log the PIN or attempts' values; logs stay ids/counts only.
- Session after a correct PIN: signed, `HttpOnly`, `Secure` (behind HTTPS), `SameSite=Lax` cookie scoped to `Path=/wesele`, server-side-verifiable (HMAC with a key derived from a random per-install secret stored in the volume, or random per-start key — decide; per-start key means re-entering the PIN after every restart, acceptable), sensible lifetime (e.g. 30 days, sliding is fine). Logout = clear cookie. State-changing requests need CSRF protection (SameSite + a custom header check is enough; YAGNI).
- All `/wesele` path rules still hold (SPA basename, API prefix). Do **not** break the home-LAN URL `http://<pi-lan-ip>:8094/wesele/`: decide whether LAN also needs the PIN (default: **yes, same gate everywhere** — simplest, one code path) and flag it.
- Public exposure mechanics (DevOps, last step): Tailscale Funnel only serves ports **443, 8443, 10000**. `:443` is already funnelled for other apps (investing-app edge Nginx owns `/`, routes `/sibling-a`, `/sibling-b`) and the Stoliki serve mapping lives on `:8444` (not funnel-capable). DevOps/Architect must work out the least invasive option (e.g. `tailscale funnel --https=8443 --set-path /wesele http://127.0.0.1:8094/wesele`, or a `/wesele` route in investing-app's edge Nginx — **a cross-repo change: ask the user first**), and record it. Rules from AGENTS.md hold: **never `tailscale serve reset` / `funnel reset`**, check `tailscale serve status` and `tailscale funnel status` before and after, never touch the investing-app repo without asking. Never forward a port on the router.
- **Do not run any `tailscale funnel` command or otherwise publish anything until the PIN gate is deployed, verified (unauthenticated requests to API → 401, brute-force throttling works) AND the user has confirmed the final step in this conversation.** Publishing is outward-facing and hard to reverse (names may be cached/indexed).
- Cost-free, ARM64, single container, YAGNI/KISS: no external auth provider, no DB table unless truly needed (attempt counters may live in memory).

## Phases

### Phase A — Architect
Design: gate placement (Go middleware in front of the API and static handler), PIN verification endpoint (`POST /wesele/api/session`, `DELETE` to log out, `GET` for "am I logged in") in `docs/openapi/**` + bundle (`make openapi-bundle openapi-lint`; 401 response on every protected operation), cookie/session design, throttling parameters, config (`STOLIKI_PIN`, mode switch), threat model paragraph (what the PIN does and does not protect; weak-PIN caveat; personal data), frontend flow (PIN screen at app start when the first API call returns 401, "Wyloguj"), sequences/state diagrams, ADR-001 amendment replacing the "no login / never Funnel" rule with the new one (dated 2026-10-03), and update `AGENTS.md` "Hard constraints" + "Tailscale & the `/wesele` path" wording **only in the final phase C after deployment** (so the docs never claim a state that is not live). Commit the phase.

### Phase B1 — Backend-Go
Gate middleware, session endpoints, throttling, config, tests against real SQLite/httpapi (every protected route returns 401 without the cookie; wrong PIN throttled; lockout; correct PIN sets the cookie; cookie works on API + static SPA data routes; health stays open; PIN never appears in logs/errors; with `STOLIKI_PIN` unset behaviour is unchanged). `go vet`, `go test ./...` green.

### Phase B2 — Frontend-web (parallel with B1 once the contract is in)
PIN screen (large, readable, numeric keypad friendly on phones, Polish copy: "Podaj PIN", "Zły PIN", "Za dużo prób — spróbuj za chwilę"), 401 handling in the API client (any 401 → back to the PIN screen without losing router state), "Wyloguj" in the shell, tests; `npm run typecheck`/lint/test/build green.

### Phase C1 — DevOps
`infra/compose.yml` passes `STOLIKI_PIN` from `.env`; `.env.example` placeholder; healthcheck stays open. Put the real PIN into `infra/.env` (not committed — user chose 1234; do not echo it into logs/commit messages). Backup first (`infra/backup.sh`), redeploy, verify through `/wesele` on the LAN and tailnet: unauthenticated `GET /wesele/api/guests` → 401, PIN screen works, brute-force throttle works.

### Phase C2 — Exposure (needs explicit user confirmation first)
Present the user the exact funnel/serve commands and the effect (URL, which port, impact on other apps), wait for a yes, then apply additively, verify from outside the tailnet if possible (e.g. phone on mobile data), check `tailscale serve status` / `funnel status` before/after. Then update `AGENTS.md`/docs to the new reality and move this file to `done/`.

## Deliverables
PIN-gated app (A, B1, B2, C1) verified locally; after the user's confirmation, publicly reachable URL (C2) and docs/AGENTS.md updated.
