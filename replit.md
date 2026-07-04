# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `pikkit-bot/` — standalone Playwright automation package for the Pikkit trading bot (separate from the web artifacts under `artifacts/`)
  - `src/config.ts` — shared URLs, session file path, headless toggle
  - `src/auth/login.ts` — one-time manual login (headed browser), saves session to `sessions/pikkit.json`
  - `src/auth/verify.ts` — reuses the saved session (headless), confirms it's still valid
  - `sessions/pikkit.json` — saved Playwright storage state (gitignored, contains live session cookies — never commit)

## Architecture decisions

- Pikkit automation lives in its own workspace package (`pikkit-bot`), not inside an `artifacts/*` web app — it has no UI/preview, it's a background automation tool.
- Login (manual, headed) and verification/everyday use (headless, session reuse) are split into separate scripts. Only `login.ts` ever performs interactive login; every other script must only read the saved session file.
- `login.ts` requires a visible display, so it must be run on a local machine (or anywhere with a GUI) — not in this cloud workspace, which has no display. `verify.ts` and future automation are headless and safe to run anywhere, including here.

## Product

- (Milestone 1, in progress) A Playwright-based automation tool that logs into Pikkit once (manually) and reuses that session going forward, verifying it's still authenticated. Future milestones will add event retrieval, betting strategies, Kalshi integration, automated trading, and a dashboard.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
