# Crypto Wiki

Wiki of formal cryptographic definitions that render exactly as in papers, with
citable permalinks and per-viewer notation via macro sets. **PLAN.md is the source
of truth** for architecture decisions and phased roadmap — read it before making
design choices. Phases 0–2 done (revive + spike; core wiki loop incl. shim v1 +
regression harness; accounts & invited write via better-auth). Phases re-ordered
2026-07-09: **Phase 3 is now paper import** (deterministic LaTeX extractor →
macro set + draft formulations; test corpus in PLAN.md). Extractor, corpus
harness, and the scan-then-select importer surface (`POST /import/scan` +
`/import` page) are built; remaining: human-in-the-loop refinement UX, PDF/LLM
stage. Production rendering +
deploy polish moved to Phase 4 (blocked on university VM / OAuth creds / Docker
anyway). Google/GitHub OAuth app credentials are NOT yet created — dev uses the
password fallback below.

## Layout & stack (npm workspaces monorepo — run `npm install` at the ROOT)
- `shared/` — `@crypto-wiki/shared`: TypeBox schemas + types + permalink-ref parsing,
  plus the whole Tier-1 renderer: cryptocode macro table, the shim-v1 preprocessing
  pass (`cryptocode-preprocess.ts`), and the block/fragment renderer
  (`latex-render.ts`; frontend injects KaTeX, styles its `cc-*` classes in
  `index.css`); plus the deterministic paper importer (`latex-import.ts`:
  `extractFromLatex` — macros + definition-like envs + game boxes out of paper
  sources; unit tests in `shared/test/`, vitest). **Build it after editing**
  (`npm run build -w @crypto-wiki/shared`) — backend/frontend consume `dist/`.
- `backend/` — Fastify + Prisma 7 + PostgreSQL + better-auth. App in `src/app.ts`
  (buildApp, used by tests), routes in `src/routes/` (permalinks / definitions /
  macro-sets / auth / invitations / me / import — `POST /import/scan` is the
  importer's scan step: `files` map or `arxivId` in, extraction out, creates
  nothing; arXiv fetch + gunzip + minimal ustar reader in `src/lib/arxiv.ts`),
  better-auth config + role-assignment hook
  in `src/lib/auth.ts`, session guards (`requireEditor` etc.) in `src/lib/session.ts`,
  schema in `prisma/schema.prisma`, seed in `prisma/seed.ts`, tests in `test/`.
- `frontend/` — React + Vite + TanStack Router (file-based routes in `src/routes/`)
  + React Query + Tailwind. KaTeX rendering. `/import` (editor-gated) is the
  scan-then-select import page; its select step calls the ordinary editor CRUD
  (macro set → definition → formulation → draft revision), no import-specific
  write endpoint exists.
- `spike/` — Phase 0 rendering spike (real LaTeX + cryptocode → SVG). Verdict: passed.
- `render-tests/` — shim-vs-real-cryptocode regression harness (`npm run
  render-tests`; needs a TeX install, else shim-only): compiles each
  `fragments/*.tex` with real cryptocode, cross-checks tokens against the shim
  render, writes `out/report.html` side by side. Teach the shim nothing without
  adding a fragment; the seeded IND-CPA left-or-right body must stay in sync
  with its fragment.
- `import-tests/` — paper-importer corpus harness: `node import-tests/fetch.mjs`
  downloads the PLAN.md starting-six arXiv sources into gitignored `corpus/`,
  `npm run import-tests` runs `extractFromLatex` over them against the
  grep-verified expectations in `papers.json` (results in `out/<id>.json`;
  papers not downloaded are skipped).

## Commands
- Backend (`-w @crypto-wiki/backend` from root, or cd backend): `npm run dev`
  (port 3000), `npm run db:seed`, `npx prisma migrate deploy`, `npm test`
  (vitest; auto-creates + migrates the `cryptowiki_test` DB), `npm run typecheck`.
- Root `npm test` runs shared (importer unit tests) then backend suites.
- Frontend: `npm run dev` (port 5173), `npm run build` (tsc + vite)
- Needs Postgres on 5432; `backend/.env` sets `DATABASE_URL`,
  `frontend/.env` sets `VITE_BACKEND_URL` (must be `VITE_`-prefixed to reach Vite).
- Auth env in `backend/.env` (documented in `.env.example`): `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL`, `FRONTEND_ORIGIN` (CORS pin + trusted origin), `ADMIN_EMAILS`
  (comma list; admin on first sign-in), `GOOGLE_/GITHUB_CLIENT_ID/SECRET` (a provider
  is disabled while its creds are empty), `AUTH_PASSWORD_SIGNIN=1` — dev/test-only
  email+password strategy (powers the /signin dev form and how tests mint sessions;
  NEVER set in production).

## Gotchas (learned the hard way)
- **`prisma migrate dev` cannot run non-interactively.** Generate migration SQL with
  `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma
  --script`, write it to a hand-named `prisma/migrations/<timestamp>_<name>/migration.sql`,
  then `npx prisma migrate deploy`.
- **Prisma 7 driver adapters change error shapes**: unique-constraint violations put
  fields in `err.meta.driverAdapterError.cause.constraint.fields`, NOT `err.meta.target`.
  Use `p2002Fields()`/`isP2002()` in `backend/src/lib/errors.ts`.
- Never edit `schema.prisma` without generating a migration — drift between schema and
  migrations bit us in Phase 0.
- **TypeBox `Type.Record` with a key pattern does NOT reject non-matching keys** unless
  you pass `additionalProperties: false` — and Fastify's default AJV `removeAdditional`
  would then silently strip them instead of erroring, so `buildApp` sets
  `removeAdditional: false`.
- `frontend/src/routeTree.gen.ts` is generated by the TanStack Router Vite plugin;
  don't hand-edit.
- **`@fastify/cors` only preflights GET/HEAD/POST by default** — without an explicit
  `methods` list, cross-origin PATCH/DELETE fail in the browser only (curl and
  app.inject never hit preflight). Pinned in app.ts; regression test in
  `test/auth.test.ts`.
- The better-auth↔Fastify bridge (`routes/auth.ts`) must use `getSetCookie()`;
  iterating response headers comma-joins multiple Set-Cookie values and corrupts
  the OAuth state+PKCE cookie pair.
- Anonymous macro sets must never serialize owner OR timestamps, and no endpoint
  may enumerate them. `test/anonymous-audit.test.ts` substring-scans every public
  surface that can carry a macro set — extend it when adding such endpoints.

## Domain model (Phases 1–2)
`Definition` (concept; unique url `slug` + display `title`; categories) → many
`Formulation` (a way of formalizing it: slug, `isDefault`, `order`, citation metadata,
optional default `MacroSet`) → many `Revision` (pure-LaTeX `bodyLatex` + Markdown
`commentaryMd`; `draft` → `published`; published ones are **immutable** and numbered
r1, r2, … per formulation — that's what permalinks pin). `MacroSet` has an unguessable
UUID, a visibility enum (`public`/`unlisted`/`anonymous` — anonymous sets are never
listed and never serialize owner or timestamps), and immutable content-hash
`MacroSetSnapshot`s for `?macros=<uuid>@<hash>` pinning. Permalinks: `/def/prf`,
`/def/prf/game-based`, `/def/prf/game-based@r2` (what papers cite).

Auth (Phase 2): better-auth tables `User`(+`role`)/`Session`/`Account`/`Verification`
plus `Invitation`. Roles: viewer (default, sign-in optional) < editor (invited; wiki
writes + the draft-bearing editor GET surface) < admin (invitations; can moderate any
macro set). Role is granted once, at user-create (`ADMIN_EMAILS` → invitation →
viewer); inviting an existing account upgrades immediately, never demotes. Content
records authorship (`createdById`/`authorId`, nullable for pre-auth rows); macro sets
have `ownerId` — any signed-in user creates/forks, owner-or-admin modifies/deletes,
**pin stays public** so the "copy citable permalink" flow works signed-out.
