# Crypto Wiki — Project Plan

A wiki of formal cryptographic definitions that render exactly as they would in a paper,
with stable permalinks so papers can cite a definition instead of restating it.

## Product requirements

1. **Paper-quality LaTeX rendering**, including the `cryptocode` package (security games,
   procedure boxes), not just browser-math subsets.
2. **Macro sets**: user-defined collections of `\newcommand`-style macros. One formal
   definition body can be re-rendered under different macro sets, so each paper can link
   to the same definition rendered in *its own notation*.
3. **Multiple formulations per definition** (e.g. game-based vs. indistinguishability-based
   PRF), plus revisions within a formulation.
4. **Citable permalinks**: published content is immutable; a link in a paper must render
   the same thing forever.
5. **Accounts and linking**: public read for everyone; invited write (research group +
   collaborators). Cross-links between definitions.
6. **Anonymous macro sets** for double-blind submission (see below).
7. Later: **import definitions from papers** (deterministic scripts first, LLM-assisted after).

## Key architecture decisions

### Two-tier rendering *(revised 2026-07-09 after spike day 2)*
- **Tier 1 — KaTeX + "katex-cryptocode" compat shim — is the canonical renderer**
  for published pages and the editor preview. The day-2 spike (`spike/katex-shim-test.mjs`,
  artifact §6) showed cryptocode's core `\procedure` game box works as a *single KaTeX
  macro* (`array` + `\hline`); the ~87 notation commands and ~35 `pc*` keywords are
  one-line macro transcriptions. A small JS preprocessing layer covers the rest of the
  common subset: optional args, `\pcln` line numbers, alignment tabs, `\pchstack`
  side-by-side games (flexbox), `\gamechange` highlights. Estimated ~a week of focused
  work for solid coverage.
  - Why canonical: macro sets apply **client-side at view time**, so there is no
    bodies × macro sets render matrix to compile or store; HTML output reflows on
    mobile (compiled SVG cannot).
- **Tier 2 — real LaTeX server-side → SVG** remains, in two roles:
  1. **Escape hatch** for bodies beyond the shim's subset (tikz-based protocol
     message flows, game trees, exotic packages). Rendered on demand, LRU-cached —
     rare by construction, so no storage blowup.
  2. **Regression harness / ground truth**: on publish (and in CI), compile the body
     with real cryptocode and compare against the shim render, so the shim can never
     silently drift from what LaTeX would produce.
  - Pipeline (validated in Phase 0): preamble (`cryptocode` + macro set as
    `\providecommand`/`\renewcommand`) → `latex -no-shell-escape` → `dvisvgm
    --no-fonts` → self-contained SVG, ~0.6 s, ~100–124 KB. Production runs it with
    **Tectonic** in a sandboxed container: no shell-escape, no network, CPU/memory/
    time limits.
- Cache key for Tier-2 renders: `hash(body, macroSet, preamble)` — published bodies
  are immutable, so cached renders never invalidate.

### Body format: pure LaTeX + Markdown commentary
The *formal definition body* is **pure LaTeX** (compilable by real LaTeX, importable from
and exportable to papers). Wiki-ish content — intuition, remarks, history, links to related
definitions — lives in a separate **Markdown commentary** field rendered with
react-markdown + KaTeX. This replaces the current Markdown-with-math body.

### Formulation vs. revision
- **Definition** — the concept (e.g. `prf`). Has a stable URL slug separate from its
  display title.
- **Formulation** — one way of formalizing it (the existing `DefinitionVersion`:
  slug, e.g. `game-based`; one is default; ordered).
- **Revision** — an edit within a formulation. Lifecycle: `draft → published`.
  Published revisions are **immutable** (enforced at the API layer); fixing anything
  creates a new revision.

### Permalinks
- `/def/prf` — default formulation, latest published revision.
- `/def/prf/game-based` — that formulation, latest published revision.
- `/def/prf/game-based@r2` — pinned revision. **This is what papers cite.**
- `?macros=<uuid>` — render under a given macro set.
- Macro sets referenced from papers must be pinnable too: either content-hash pinning or
  frozen snapshots, so a cited page can't change when someone edits their macros.

### Macro sets, including anonymous ones
- CRUD for macro sets; owned by users; JSON map of macro → expansion (already in schema,
  with an unguessable UUID for URL references — keep both).
- **Visibility levels**:
  - `public` — listed in the site directory, attributed to the owner.
  - `unlisted` — link-only, attributed.
  - `anonymous` — link-only, **zero public attribution**, for double-blind submissions.
    The owner is recorded internally (it appears in their own "my macro sets" page and
    they can edit/manage it), but the public API never serializes owner, and for
    anonymous sets also omits timestamps (a `createdAt` can correlate with a submission
    date). No endpoint may enumerate anonymous sets.
  - **De-anonymize toggle**: after acceptance, flip an anonymous set to attributed
    without changing its UUID, so links in the camera-ready keep working.

### Auth
- Google + GitHub OAuth via **better-auth** (TS-native, Fastify + Prisma adapters),
  cookie sessions.
- Roles: `admin` / `editor` (invited, can write) / `viewer` (default; read needs no login).
- Admin invites by email; on first OAuth sign-in with an invited email, the account gets
  `editor`.
- Note: OAuth is an identity dependency on Google/GitHub, not a hosting dependency. If
  that's ever unacceptable, better-auth also supports email magic links via SMTP
  (university mail relay).

### Deployment
- **Self-hosted on a university-administered VM. No cloud-provider dependencies.**
- Docker Compose: Postgres + Fastify API + LaTeX render container + static frontend
  behind Caddy or nginx (TLS). Nightly `pg_dump` backups.

### Stack verdict (student's choices)
Keep: Fastify + Prisma + Postgres; React + Vite + TanStack Router/Query + Tailwind;
the `Definition`/`DefinitionVersion`/`MacroSet` schema shape (extend, don't replace).
Redo: frontend wiring (half-finished and drifted from the API). Replace:
Markdown-as-definition-body (see body format above).

---

## Phases

### Phase 0 — Revive + de-risk rendering — ✅ DONE (2026-07-08)
- [x] Fixed frontend build (removed nonexistent `src/data/defn*.md` imports; wiki
      routes now fetch from the API), `VITE_BACKEND_URL` env, `@fastify/cors`.
- [x] Fixed backend bugs: `POST /definitions/:title` now returns 201; P2002 handling
      rewritten for Prisma 7 driver-adapter error shape
      (`meta.driverAdapterError.cause.constraint.fields`, not `meta.target`);
      `order` now derived from `max(order)+1`, not array length.
- [x] Fixed schema drift: the student edited `schema.prisma` without migrating —
      added migration `20260708000000_sync_schema_drift` (drops leftover
      `Definition.bodyLatex`, adds the two unique indexes).
- [x] Seed script (`backend/prisma/seed.ts`, `npm run db:seed`): PRF (two
      formulations), IND-CPA, DDH, commitment scheme, EUF-CMA (cryptocode), plus
      `standard-notation` and `alternative-notation` macro sets.
- [x] **Rendering spike PASSED** (`spike/`): real LaTeX (incl. cryptocode
      `\procedure` game boxes) → `dvisvgm` SVG at ~0.6 s per definition, ~100–124 KB
      self-contained output; macro-set swap via `\providecommand`+`\renewcommand`
      composes cleanly with cryptocode. KaTeX confirmed unable to render cryptocode
      ("Undefined control sequence: \procedure") — the two-tier design stands.
      All endpoints exercised (list/get/version/macro-override/create/409s/404s).

### Phase 1 — Core wiki loop (no auth yet)
- [x] Schema migration (2026-07-09): `slug` vs `title` on Definition; `Formulation`
      (ex-DefinitionVersion) with citation metadata; `Revision` with `draft/published`
      status, per-formulation `number` assigned at publish, pure-LaTeX body + Markdown
      commentary; macro-set visibility enum + `MacroSetSnapshot` (content-hash pinning).
- [x] Permalink routes: `/def/:slug`, `/def/:slug/:formulation`, `@rN` pinning,
      `?macros=<uuid>` and pinned `?macros=<uuid>@<hash>`; drafts never visible;
      published revisions immutable (API-enforced: no edit/delete/rename of anything
      a permalink depends on).
- [x] Backend hardening: TypeBox schemas (shared package) validate every route;
      response schemas strip stray fields; consistent `{statusCode,error,code,message}`
      errors; macro-set CRUD + pin + fork; 32 vitest tests against `cryptowiki_test`.
- [x] Shared types package: npm workspaces monorepo, `@crypto-wiki/shared` holds
      TypeBox schemas + `Static<>` types + permalink ref parsing.
- [ ] **katex-cryptocode shim v0**: macro table (notation + `pc*` keywords + basic
      `\procedure`) shipped as the site's base macro layer; v1 adds the JS
      preprocessing pass (optional args, line numbers, alignment tabs, `\pchstack`).
      Regression-check both against real-LaTeX SVGs using the spike pipeline.
- [ ] Frontend rebuild on the existing skeleton, actually using React Query:
  - Wiki browse/search + category browse.
  - Definition page: formulation tabs, revision history, macro-set switcher.
  - Editor: create/edit definitions and formulations, KaTeX live preview, draft/publish.
  - Macro-set manager: CRUD, duplicate/fork.

### Phase 2 — Accounts & invited write
- [ ] better-auth with Google + GitHub, cookie sessions.
- [ ] Roles + invitation flow (admin invites email → editor on first sign-in).
- [ ] Ownership: authors on definitions/formulations/revisions; owners on macro sets.
- [ ] "My macro sets" page; **anonymous/unlisted visibility + de-anonymize toggle**;
      audit that no public response ever serializes owner or timestamps for anonymous
      sets and that no endpoint enumerates them.
- [ ] Publish (freeze) workflow in the editor.

### Phase 3 — Production rendering + paper-linking polish
- [ ] Productionize Tier 2 in its revised roles: sandboxed render container, on-demand
      + LRU compile cache for escape-hatch bodies, and the publish-time/CI regression
      check of shim renders against real LaTeX.
- [ ] "Cite this" widget: copies a LaTeX snippet (`\href`/footnote or a provided
      `\defcite` macro) with the pinned permalink + chosen macro set.
- [ ] og-image/meta previews so links unfurl nicely.
- [ ] Cross-links between definitions in commentary (`[[commitment-scheme]]` style).
- [ ] Deploy: Compose stack on university VM, Caddy/nginx + TLS, backups, minimal CI
      (typecheck, lint, tests on GitHub Actions).

### Phase 4 — Import from papers
- [ ] **Deterministic importer**: paste a paper's LaTeX source → extract `\newcommand`s
      into a macro set and definition environments into draft formulations → prefill the
      editor.
- [ ] **LLM-assisted importer**: from a PDF/eprint link, extract candidate definitions +
      notation. Always produces human-reviewed drafts, never auto-publishes. The
      deterministic parser doubles as the LLM's validation harness.

---

## Open questions
- Which site-provided environments do we curate for the Tier-1/editor preview
  (definition box, game box styling)? *Deferred by user until later — Tier 2 runs
  real LaTeX regardless, so this only affects preview quality.*
- Search: Postgres full-text is likely enough at this scale — revisit only if not.

## Answered
- Anonymous macro sets need no lifecycle policy for now — they can live forever.
- Deployment: self-hosted university VM, no cloud dependencies (see Deployment).
