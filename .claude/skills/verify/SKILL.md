---
name: verify
description: Build, launch, and drive crypto-wiki end-to-end (backend API + frontend in a headless browser) to verify changes at their real surface.
---

# Verifying crypto-wiki changes

## Build & launch
1. `npm install` at the repo root (npm workspaces). After editing `shared/`,
   rebuild it: `npm run build -w @crypto-wiki/shared` (backend/frontend consume dist/).
2. Postgres must be on 5432 (brew service; no Docker on this machine).
   Migrate + seed: `cd backend && npx prisma migrate deploy && npm run db:seed`.
   The seed prints the macro-set UUIDs — capture them for URL probes.
3. Backend: `npm run dev -w @crypto-wiki/backend` → http://localhost:3000
   (health check: `curl localhost:3000/` → `{"service":"crypto-wiki api","status":"ok"}`).
4. Frontend: `npm run dev -w @crypto-wiki/frontend` → http://localhost:5173.
   `vite` regenerates `src/routeTree.gen.ts`; run `vite build` BEFORE `tsc -b`
   if route files changed.

## Drive (surfaces)
- **API**: curl the permalink routes directly — `/def/prf`, `/def/prf/standard@r1`,
  `?macros=<uuid>@<hash>`; assert on `code` fields of error responses.
- **Frontend**: Playwright headless. No repo dependency — install in the scratchpad:
  `npm init -y && npm install playwright && npx playwright install chromium`.
  Flows worth driving: /def/prf (KaTeX `.katex` nodes), macro switcher select
  (URL gains `?macros=`, notation visibly changes), pinned `@r1` banner,
  /def/euf-cma (cryptocode `\procedure` box via the shim), editor live preview
  (fill textarea → preview updates), macro pin flow (green "Citable ref" box),
  /def/nonexistent (red error card, not a crash).

## Gotchas
- Backend tests (`npm test -w @crypto-wiki/backend`) auto-create + migrate a
  `cryptowiki_test` DB — they never touch dev data. Tests are CI's job though;
  verification means driving the app.
- The seeded euf-cma draft body has no math, so an editor preview can legitimately
  contain zero `.katex` nodes — don't assert on that.
- Intentional 404/400 probes show up in the browser console error log; expected.
