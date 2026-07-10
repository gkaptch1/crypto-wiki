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
7. **Import definitions from papers** (deterministic scripts first, LLM-assisted after).
   *Pulled forward to Phase 3 (2026-07-09) — see phase re-org note below.*

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

### Layered macros: definition-scoped maps + a site name registry *(2026-07-09, user)*
Motivating problem: macros lived in one flat namespace (a formulation pointed at a
global macro set), so macros from different definitions **contaminated** each other —
`\enc` can mean *encrypt* in one definition and *encode* in another, and a viewer's
notation set that restyles `\enc` corrupts one of them. Also, an unpinned permalink's
rendering could drift when the formulation's default macro set was edited (only the
body was truly frozen).

The model (render order = later wins):

1. **Shim base** — the cryptocode table; rendering plumbing.
2. **Revision `macros`** — *shared symbols*: registered names this definition uses,
   with the definition's default expansions. Overridable by notation sets.
3. **Viewer notation set** — overrides a *subset* of registered names the set's
   maker cares about (`?macros=` / formulation default, as before).
4. **Revision `localMacros`** — definition-private macros (`\LDPCPRC[n,g,t,r]`…).
   Merged **last**, so no notation set can ever touch them (sealed).

Both revision maps are draft-editable and **frozen at publish** with the body, so a
published permalink is fully self-contained and immutable.

**`MacroName` registry** — the site-enforced naming: a table of canonical macro
names + meanings (seeded from cryptocode's conventions, extended by editors, e.g.
`\encode` for code encoders vs `\enc` for encryption). Enforcement points:
- Notation sets may only define registered names (validated at create/update;
  legacy sets/snapshots are untouched — validation is write-time only).
- The registry is **never consulted at render time** — classification into
  shared/local is stored on the revision, so registering a name later never
  changes what a published permalink renders.
- Import auto-classifies each candidate's macro slice (registered → shared,
  else local) and offers per-macro renames (paper's `\enc` meaning encode →
  imported as `\encode`, body rewritten) — the first piece of the
  human-in-the-loop refinement loop.

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
- [x] **katex-cryptocode shim v0** (2026-07-09): 68-macro table
      (`shared/src/cryptocode-macros.ts`— notation, `\adv`–`\zdv`, `pc*` keywords,
      basic `\procedure`) as the site's base macro layer, merged under the viewer's
      macro set; plus a minimal LaTeX-fragment renderer (`frontend/src/lib/latex.ts`:
      paragraphs, `$…$`, `\[…\]`, center blocks, itemize, `\textbf`/`\emph`).
      Verified in-browser: the seeded cryptocode EUF-CMA game box renders.
- [x] **shim v1** (2026-07-09): JS preprocessing pass
      (`shared/src/cryptocode-preprocess.ts`, exercised through the shared
      fragment renderer `shared/src/latex-render.ts` that the frontend now
      binds KaTeX to): `\procedure[…]`/`\pseudocode[…]` optional args
      (`linenumbering`, `mode=text`), `\pcln`/`\pclnomit` line numbers
      (typeset as cryptocode does: `\text{\scriptsize N}:`, reset per box),
      `\t` alignment tabs (nested KaTeX arrays), `\pchstack`/`\pcvstack`/
      `\pchspace` (flexbox, reflows on mobile), `\gamechange[color]{…}`
      highlights (exact cryptocode semantics: content is text mode, math
      needs its own `$…$` — a bare math body errors under real cryptocode
      too), `\pcind[n]`. Plus the **regression harness** (`render-tests/`,
      `npm run render-tests`): 7-fragment corpus compiled with real
      cryptocode (spike pipeline → SVG + dvi2tty text) and cross-checked
      token-by-token against the shim render, with a side-by-side HTML
      report. It caught a real shim bug (auto-`$…$` in `\gamechange`) on its
      first run. Seed grew an IND-CPA `left-or-right` formulation exercising
      everything at once; verified in-browser incl. macro-set swap.
- [x] Frontend rebuild (2026-07-09), on React Query throughout:
  - Wiki browse/search + category filter chips.
  - Definition page (`/def/...` permalinks as specced): formulation tabs, revision
    history dropdown + pinned-revision banner, macro-set switcher, citation line,
    "copy citable permalink" (pins revision + macro snapshot via POST /pin).
  - Editor: definition metadata, formulations (citation, default macro set, make
    default), draft/publish revision lifecycle, KaTeX live preview.
  - Macro-set manager: CRUD, fork, pin (shows citable ref), visibility selector,
    open-by-UUID for unlisted/anonymous sets.

### Phase 2 — Accounts & invited write — ✅ DONE (2026-07-09)
- [x] better-auth (v1.6, Prisma adapter) with Google + GitHub, cookie sessions.
      Mounted on Fastify via a Web-Request bridge (`backend/src/routes/auth.ts`);
      config in `backend/src/lib/auth.ts`. Providers enable only when their env
      credentials exist (`GOOGLE_/GITHUB_CLIENT_ID/SECRET` — **still to be created**
      in Google Cloud console / GitHub developer settings). Dev/test fallback:
      email+password strategy behind `AUTH_PASSWORD_SIGNIN=1` (never in prod);
      the /signin page shows the dev form only under `import.meta.env.DEV`.
- [x] Roles + invitation flow: `Role` enum on User (admin/editor/viewer); role
      assigned once in better-auth's `user.create` hook — `ADMIN_EMAILS` env
      bootstrap → invitation lookup → viewer. Admin-only `/invitations` CRUD;
      inviting an existing account applies the role immediately (upgrade only,
      never demotes). Frontend /admin page.
- [x] Ownership: `createdById` on Definition/Formulation, `authorId` on Revision,
      `ownerId` on MacroSet (all nullable; pre-auth rows are admin-managed).
      Wiki writes need editor; draft reads (editor GET surface) too. Macro-set
      create/fork needs any sign-in; update/delete is owner-or-admin. **Pin stays
      public** (the "copy citable permalink" flow must work signed-out) — accepted
      trade-off: a drive-by pin can block deletion of a public set.
- [x] "My macro sets" (`GET /me/macro-sets`, owner-scoped, all visibilities,
      timestamps included) + section on /macros. De-anonymize = PATCH visibility;
      uuid (and thus all links) unchanged. Public serializations attribute by
      display name only; anonymous sets carry no owner AND no timestamps anywhere.
      The audit is `backend/test/anonymous-audit.test.ts` (substring-scans every
      public surface that can carry a macro set, incl. permalink pages).
- [x] Publish (freeze) workflow: editor-gated publish button + explicit
      "frozen forever" confirm dialog; API already enforced immutability.
- Gotcha fixed en route: `@fastify/cors` only allows GET/HEAD/POST unless
  `methods` is explicit — cross-origin PATCH (editor save) was silently blocked;
  now pinned + regression-tested.

> **Phase re-org (2026-07-09):** paper import (previously Phase 4) moved ahead of
> production rendering + deploy (previously Phase 3). Rationale: the deploy-shaped
> work is blocked on things only the user can provide (university VM, Google/GitHub
> OAuth app credentials, Docker locally), while the importer needs nothing that's
> blocked; and importing real papers is the fastest way to explore the system's
> usability and to stress the Tier-1 shim with wild LaTeX — every import failure
> becomes a new `render-tests/` fragment, so shim hardening happens organically.

### Phase 3 — Import from papers
- [x] **Deterministic extractor core** (2026-07-09): `shared/src/latex-import.ts`,
      a pure function (single source string or filename→content map in →
      `{macros, macroMap, theoremEnvs, candidates, warnings}` out). Follows
      `\input`/`\include` and shipped `.sty` files via `\usepackage`; strips
      comments/verbatim; parses the `\newcommand` family, `\def`,
      `\DeclareMathOperator`, `\DeclarePairedDelimiter` (unparseable declarations
      carry an `issue` for human review instead of vanishing — nothing is silently
      dropped); discovers theorem envs via `\newtheorem`/`\spnewtheorem`/
      `\declaretheorem`; extracts definition-like env instances (nested same-name
      ones too — papers do nest definitions) and standalone `\procedure`/
      `\pseudocode` game boxes; computes each candidate's transitive `usedMacros`
      closure — the per-candidate macro-set slice, which matters because whole
      preambles can exceed the 500-macro set cap (the iO paper has 685 usable
      macros). 23 vitest unit tests (`shared/test/`, in `npm test`).
- [x] **Corpus harness** (2026-07-09): `import-tests/`, mirroring `render-tests/`:
      `node import-tests/fetch.mjs` downloads arXiv sources into gitignored
      `corpus/`; `npm run import-tests` runs the extractor the site will serve over
      the starting six and checks the grep-verified expectations in `papers.json`
      (exact `definition` counts, macro minima, game-box counts); full extraction
      results land in `out/<id>.json`. **All six pass.** Found en route: naive
      greps overcount (3 commented-out definitions in the iO paper), 2512.20583
      genuinely nests one definition inside another, and 2402.09370 ships a stray
      duplicate `\begin{construction}` — which the extractor flags as a warning.
- [x] **Importer surface** — scan first, then select (user, 2026-07-09), BUILT
      same day: almost every paper carries more definitions than anyone wants
      to import (prelim sections restate PRFs etc.), so the flow is two-step.
      Step 1: `POST /import/scan` (editor-gated, 32 MB body limit) takes either
      a `files` map (paste/upload — the primary path since ePrint has no
      source) or an `arxivId` the backend fetches from `arxiv.org/e-print/`
      (gunzip + minimal ustar reader in `backend/src/lib/arxiv.ts`; PDF-only
      submissions get a distinct ARXIV_NO_SOURCE error pointing at the paste
      path), runs `extractFromLatex`, and returns the candidate list — nothing
      is created by scanning. Step 2 needs **no new backend surface**: the
      `/import` frontend page drives the ordinary editor CRUD (definition →
      formulation → draft revision), so role gates and slug invariants stay
      enforced in one place. The page renders per-candidate previews through
      the Tier-1 shim (side by side with the raw LaTeX), prefills slugs/titles
      from candidate metadata, adds a formulation to an existing definition
      when the slug already exists, stamps provenance (`Imported from …,
      file:line`) into the commentary, and reports per-candidate
      success/errors with editor links. *(Revised same day for layered
      macros:)* each candidate's own `usedMacros` slice lands on **its**
      revision — registered names as shared symbols, the rest as sealed
      locals — with a per-macro rename control (body rewritten, e.g. a
      paper's `\enc` meaning encode → `\encode`) and an inline "register as
      shared" action. Everything lands as drafts; nothing auto-publishes.
      14+10 backend tests (`test/import.test.ts`, `test/layered-macros.test.ts`);
      Playwright-driven end to end (paste and arXiv flows, incl. the real
      2402.09370, and the rename→publish→restyle-vs-sealed loop).
- [ ] **Citation auto-import + link to the paper** *(user, 2026-07-09)*: imports
      should arrive citing their source. arXiv exposes BibTeX at
      `arxiv.org/bibtex/<id>` and ePrint shows a BibTeX block on every paper
      page — when a scan comes from an `arxivId` (and later, when the PDF stage
      takes ePrint links), fetch + parse it and prefill the formulation's
      citation fields (`citePaper`, `citeAuthors`, `citeVenue`, `citeYear`,
      `citeDoi`, `citeEprint`) in the select step. For pasted-source imports
      (no id), accept a pasted BibTeX entry or a DBLP key
      (`dblp.org/rec/<key>.bib`) as the citation source. Definition pages
      should also **link out to the paper itself** — derivable from
      `citeEprint` / arXiv id / DOI today; anything else needs a `citeUrl`
      column (migration).
- [ ] **Test corpus** of real papers (below): `.tex`-source papers for the
      deterministic importer, ePrint-only PDFs for the PDF/LLM stage, and one
      dual-hosted paper (ePrint PDF + arXiv source) whose source is ground truth for
      validating PDF extraction. Shim failures found while importing become
      `render-tests/` fragments. *Starting six wired into `import-tests/`; PDF-stage
      papers pending that pipeline.*
- [x] **LLM-assisted importer** — first cut BUILT (2026-07-10): from an ePrint id
      or an uploaded PDF, extract candidate definitions + notation. Hybrid by
      design (user, 2026-07-10: burn as few tokens as possible on things
      traditional tools can do): a **deterministic scout** (`pdf-scout.ts`,
      pdfjs text layer, zero tokens) locates definition-like headings first —
      on the real 2402.09370 PDF it finds all 18 ground-truth definitions + 9
      constructions with 3 noise entries — then the LLM
      (`pdf-extract.ts`, claude-opus-4-8, JSON-schema-forced output, streaming)
      only does the irreducible part: faithful LaTeX reconstruction + macro
      declarations. Its JSON is assembled into a synthetic .tex and run through
      `extractFromLatex` — the deterministic parser as validation harness, as
      planned — so the response is the same ImportScanResult the select step
      already consumes, with provenance remapped to PDF pages and scout-vs-LLM
      mismatches surfacing as warnings. Two modes: `full` (whole PDF, the
      learn-the-limitations baseline) and `guided` (pdf-lib sub-PDF of scout
      pages +1 spillover; 25/71 pages on 2402.09370 ≈ 65% input-token cut).
      Every scan reports model/mode/token usage + estimated $ in the response.
      Needs `ANTHROPIC_API_KEY` in backend/.env (else 503 LLM_NOT_CONFIGURED;
      all other paths unaffected). 20 backend tests (`test/pdf-import.test.ts`).
      **Found en route: eprint.iacr.org bot-blocks server-side fetches (403
      challenge page even for curl)** — so upload-a-PDF is the reliable path
      (mirroring paste-your-own-.tex for source); the eprintId fetch path stays
      in case other networks fare better. Always drafts, never auto-publishes.
      *(Same-day addition, user question → decision:)* we do **NOT** feed our
      own text extraction alongside the PDF — the Messages API already
      extracts the text layer server-side and hands the model text + page
      images for every document block, so it would be redundant tokens; and
      text-*instead of*-PDF was rejected because garbled text-layer math is
      precisely what the vision channel is there to fix. What we built instead
      (both zero-token): the scout's text-layer **previews are embedded in the
      checklist** (anchors block-matching; prompt says math there is garbled,
      locate-only) and a **text-layer agreement post-check** — <40% prose
      overlap between a reconstructed body and the preview near its heading ⇒
      "check the reconstruction" warning (`textLayerAgreement`, threshold
      tunable by experiment).
- [ ] **PDF-stage validation** *(next; needs an Anthropic API key — user todo;
      experiment protocol agreed 2026-07-10, user wants a walkthrough)*:
      run the real LLM over the corpus PDFs, dual-hosted paper first
      (2402.09370: arXiv PDF in via the pipeline ↔ its .tex source as ground
      truth — `npm run import-tests` writes the source-side extraction to
      `import-tests/out/2402.09370.json`; the arXiv PDF downloads fine from
      `arxiv.org/pdf/2402.09370`).
      **Framing revised 2026-07-10 (user): cost-per-paper is a PRIMARY axis,
      not a readout.** Full-PDF-through-Opus lands at ~$1–2/paper — infeasible
      at scale (target corpus is hundreds–thousands of papers; target cost
      more like $0.05–0.15/paper). **Order revised same day (user): cheapest
      config FIRST, escalate only on failure — early exit means the expensive
      runs may never happen.** This works because the ground truth (the
      deterministic extraction of the paper's own arXiv source) is an
      ABSOLUTE quality bar — no Opus baseline is needed to judge a cheap
      config against it.
      **Scoring, every rung, vs `import-tests/out/2402.09370.json`**:
      candidate coverage (18 definitions + 9 constructions), body fidelity
      (spot-check + agreement warnings), macro quality (katexSafe rate,
      sensible semantic names), token cost (the scan returns
      `llm.{inputTokens,outputTokens,estimatedCostUsd}`).
      **Pass bar (early exit)**: ground-truth candidates all present,
      spot-checked bodies faithful, no agreement-warning flood → stop
      climbing, adopt that config as the default, go to prompt-tune +
      ePrint papers. Model swaps are zero code (`IMPORT_LLM_MODEL` env var);
      reconstruction is a vision/transcription task, not deep reasoning, so
      a small model is genuinely plausible.
      - **E1 — guided + haiku-4-5 ($1/$5 per MTok, ~$0.16 this paper)**:
        cheapest plausible config, `pdfMode: "guided"` (scout subset =
        25/71 pages ≈65% input cut).
      - **E2 (only if E1 fails the bar) — guided + sonnet ($3/$15,
        ~$0.50)**. If Haiku and Sonnet fail the SAME way, suspect the
        mode/prompt rather than the model — jump to E4 before spending more
        on bigger models.
      - **E3 (only if E2 fails) — guided + opus-4-8 ($5/$25, ~$0.80)**; and
        as the last resort, one full-mode opus run (~$1.25) — the diagnostic
        that separates "model can't reconstruct" from "guided subset is
        missing needed context".
      - **E4 (at any rung, when failures look like block-matching or
        fidelity problems)**: ablate the preview-anchored checklist to see
        if it earns its place; likewise revisit the 40% agreement threshold
        against observed scores.
      - Prompt-tune on whatever diverges; then the ePrint-only picks with
        the passing config (2021/422 Stacking Sigmas — owner holds the
        private .tex to cross-check; 2025/1565 OPRF game boxes; all three
        corpus PDFs already on disk in `import-tests/corpus/`, incl. the
        arXiv-fetched 2402.09370.pdf). Wire an opt-in `import-tests/` PDF
        harness (costs real tokens) once the prompt settles.
- [ ] **PDF cost strategy — levers beyond model choice** *(user-raised
      2026-07-10: $1–2/paper "wildly expensive" at scale; complementary, in
      rough order of leverage)*:
      1. **Scout-first user selection** (moderate code; merges into the
         human-in-the-loop UX item below): split the PDF scan into scout
         (free, zero tokens — already built) → user ticks the candidates they
         actually want → LLM extracts ONLY the selected blocks' pages. Editors
         rarely want all ~27 candidates; 3–5 selections spanning a handful of
         pages ≈ $0.02–0.06 on Haiku, independent of paper length. Also
         doubles as explicit user verification of exactly what gets sent to
         the API. This is the likely production interactive path.
      2. **Cheaper model as default** — whatever E3 says survives quality
         scoring (env-var change only).
      3. **Batch API for bulk backfill** — 50% off all token costs on
         non-interactive imports; combine with 1–2 for any mass-import job
         (guided-Haiku-batch ≈ $0.08/paper → ~$80 per 1k papers). Not built;
         only worth it if a true bulk backfill materializes.
      4. **Open-source academic-OCR spike** (after E1 sets the quality bar):
         purpose-built PDF→LaTeX/markdown models — olmOCR (AllenAI),
         Nougat (Meta), Marker — run locally at zero marginal cost and target
         exactly this task (math OCR from scholarly PDFs). Benchmark against
         the same 2402.09370 ground truth; known risk is math hallucination
         on out-of-distribution content. If good, they become a free stage-1
         whose text output feeds `extractFromLatex` directly or a cheap LLM
         cleanup pass over candidate blocks only (text-in is far cheaper
         than PDF-in). Fits the deterministic-before-LLM principle: local
         model ≠ deterministic, but zero marginal cost changes the calculus.
      5. **Reality check on scale**: papers with arXiv source stay on the
         free deterministic path forever — the PDF/LLM stage only pays for
         the ePrint-only subset, so the effective per-corpus cost is lower
         than per-paper × corpus size.
- [ ] **Human-in-the-loop import UX** *(build after the extraction pipeline works)*:
      importing is a review loop, not a batch job — pull in a link/PDF/`.tex`, the
      pipeline proposes candidate definitions + a macro set, and the user gives
      feedback / edits to refine the candidates before accepting them as drafts.
      Mostly UI design; preserves the nothing-auto-publishes invariant. The
      importer surface's scan-then-select step above is the first increment of
      this loop (built); this item extends it to editing/refining candidate
      content, not just choosing among candidates. Observed need from driving
      the real flow: candidate titles are sometimes raw LaTeX
      (`\Cref{def:skPRC,def:pkPRC}` in 2402.09370's intro) — cleaning those up
      is exactly the refinement step this item covers.

#### Candidate import corpus *(2026-07-09, revised with user picks same day)*

Source-availability finding that shapes the importer's input design: **IACR ePrint
serves only PDFs** (verified — there is no `.tex` download path), and most crypto
papers live primarily there; arXiv serves full source via
`arxiv.org/e-print/<id>`. So the importer's primary input is **pasted/uploaded
`.tex`** (authors always have their own source), with fetch-by-arXiv-id as the
convenience path — and the PDF/LLM stage exists precisely for the ePrint-only
majority. Candidates with an arXiv id were verified by downloading and grepping
the actual source (counts are real); the ePrint-only entries are user picks that
exercise the PDF pipeline (and rebalance the corpus away from quantum).

★ = recommended starting set (six): begin with the dual-hosted paper, then the
rest span every extraction target (macro sets, definition envs, theorem-style
envs, `\procedure` game boxes) and the difficulty range from minimal preamble
to pathological.

**Start here — dual-hosted (ePrint PDF + arXiv source = ground truth for PDF
extraction):**
- ★ [ePrint 2024/235](https://eprint.iacr.org/2024/235) =
  [arXiv:2402.09370](https://arxiv.org/abs/2402.09370) — Christ, Gunn,
  *Pseudorandom Error-Correcting Codes* (2024). 18 definitions (PRC
  syntax/security, watermarking, steganography), 283 macro declarations (204
  `\newcommand` + 62 `\DeclareMathOperator` + 17 `\renewcommand`) split across
  dedicated `macros.tex` + `Z-macros-crypto.tex` (multi-file test), 8
  theorem-style envs. Run the deterministic importer on the arXiv source AND the
  PDF pipeline on the ePrint PDF, then diff the two results.

**ePrint-only PDFs (test the PDF-extraction pipeline; user picks):**
- [ePrint 2021/422](https://eprint.iacr.org/2021/422) — Goel, Green,
  Hall-Andersen, **Kaptchuk**, *Stacking Sigmas: A Framework to Compose
  Σ-Protocols for Disjunctions* (2021). Classical crypto; owner is an author, so
  the real `.tex` is privately available to cross-check the PDF pipeline the same
  way the dual-hosted paper does.
- [ePrint 2025/1565](https://eprint.iacr.org/2025/1565) — Friedrichs, Lehmann,
  Özbay, *Game Changer: A Modular Framework for OPRF Security* (2025). Game-based
  OPRF security framework — the PDF-side game-box extraction test.

**Cryptocode users (shim stress-tests):**
- ★ [arXiv:2003.00578](https://arxiv.org/abs/2003.00578) — Gagliardoni, Krämer,
  Struck, *Quantum Indistinguishability for PKE* (2020). The only confirmed
  `\procedure` game-box **source**: 11 `\procedure[`, 10 `\pchstack`, 4
  `\pcvstack` + 253 newcommands + 15 definitions (qIND-qCPA, IND-qCPA, PKE
  correctness). *(Re-added to the starting set 2026-07-09 — quantum, but nothing
  else exercises game-box extraction from source.)*
- ★ [arXiv:2512.20583](https://arxiv.org/abs/2512.20583) — Hogan, Chator,
  **Kaptchuk**, Varia, Devadas, *Making Sense of Private Advertising* (2025).
  Cryptocode with 8 option keys in a separate `preamble.tex`, `\advantage`/`\adv`
  macros, 10 definitions, 44 newcommands. Best all-rounder + owner can eyeball
  extraction quality.

**Canonical `\begin{definition}` environments:**
- [arXiv:1705.02417](https://arxiv.org/abs/1705.02417) — Gagliardoni PhD thesis
  (2017). **84 definitions**: OWF/OWP, PRF, PRP variants, IND-CPA/CCA1/CCA2,
  EUF-CMA, Σ-protocols, commitments + quantum analogues. 267 newcommands.
  Book-length scale test; graduate to this after the first five.
- ★ [arXiv:1504.05255](https://arxiv.org/abs/1504.05255) — Gagliardoni, Hülsing,
  Schaffner (CRYPTO 2016). 22 textbook-style definitions (IND-CPA, SEM-CPA,
  qIND-qCPA); moderate 76-macro preamble — the mid-difficulty case, and its
  definitions match the wiki's seed content.
- [arXiv:1602.01441](https://arxiv.org/abs/1602.01441) — Alagic et al.,
  *Computational Security of Quantum Encryption* (2016). 15 definitions plus a
  custom `\newtheorem{experiment}` — tests non-`definition` theorem-style envs.
- [arXiv:1811.11858](https://arxiv.org/abs/1811.11858) — Alagic, Gagliardoni,
  Majenz, *Can You Sign A Quantum State?* (2018). 28 signature definitions incl.
  deliberately-wrong ones (commentary fodder); ships as single-file `.tex` gzip,
  not a tarball — tests that importer path. 245 newcommands.
- ★ [arXiv:2210.05138](https://arxiv.org/abs/2210.05138) — Gunn, Ju, Ma, Zhandry,
  *Commitments to Quantum States* (2022). 27 definitions (hiding, swap binding),
  only 15 newcommands — the clean-minimal-preamble baseline that should extract
  near-perfectly.
- [arXiv:1604.02804](https://arxiv.org/abs/1604.02804) — Broadbent, Ji, Song,
  Watrous, *ZK proof systems for QMA* (2016). Covers the zero-knowledge slot.
- [arXiv:1909.13770](https://arxiv.org/abs/1909.13770) — Dulek et al. (EUROCRYPT
  2020). Ideal/real simulation-based MPC definitions — covers the MPC slot.

**Macro-heavy preamble:**
- ★ [arXiv:2008.09317](https://arxiv.org/abs/2008.09317) — Jain, Lin, Sahai, *iO
  from Well-Founded Assumptions* (STOC 2021). **723 newcommands** — the macro
  extractor's worst case, 3× the runner-up; fully classical, 20 definitions.

**Kaptchuk papers (owner-verifiable):**
- [arXiv:2502.02709](https://arxiv.org/abs/2502.02709) — Bun, Carmosino, Jain,
  **Kaptchuk**, Sivakumar, *Enforcing Demographic Coherence* (2025). 12
  definitions citing original sources (provenance test), 122 newcommands + 6
  `\DeclareMathOperator`, macros in a dedicated `macros.tex` (multi-file test).
- (Meteor, Fluid MPC, etc. are ePrint-only PDFs — the cleanest demonstration of
  why the paste-your-own-`.tex` path is primary.)

**Verified spares:** [arXiv:1709.06539](https://arxiv.org/abs/1709.06539)
(*Unforgeable Quantum Encryption*), [arXiv:2112.10020](https://arxiv.org/abs/2112.10020)
(*Cryptography from Pseudorandom Quantum States* — statistical binding /
computational hiding),
[arXiv:2112.07530](https://arxiv.org/abs/2112.07530) (*PQ Security of
Even-Mansour* — loads cryptocode but no game boxes, definitions inline in prose;
a "importer finds nothing" case).

### Phase 4 — Production rendering + paper-linking polish
- [ ] Productionize Tier 2 in its revised roles: sandboxed render container, on-demand
      + LRU compile cache for escape-hatch bodies, and wiring the existing
      `render-tests/` harness into CI and the publish flow.
- [ ] **Ideal-functionality rendering** *(user, 2026-07-09)*: UC/simulation-based
      definitions are typeset as a titled framed box ("Functionality
      $\mathcal{F}_{\mathsf{ZK}}$" + itemized behaviors), but there is no
      standard package — every paper rolls its own (`mdframed`/`tcolorbox`/
      figure+framed). Plan: curate **one site `functionality` environment**,
      rendered by the Tier-1 shim as a styled box (title bar, numbered
      behavior list), shipped with a matching real-LaTeX implementation in a
      small `crypto-wiki.sty` so bodies stay compilable (Tier-2 escape hatch,
      regression harness, and paper export all need it) — this makes the
      curated-environments open question concrete rather than preview-only.
      Add a `render-tests/` fragment; the importer maps common hand-rolled
      patterns onto the site environment. Test material: corpus paper
      1909.13770 (ideal/real simulation-based MPC definitions).
- [ ] **Additive ⇄ multiplicative group notation** *(user, 2026-07-09)*: layered
      macros are the mechanism; what's missing is a content convention, because
      the switch restructures expressions ($g^x$ vs. $[x]G$) — plain renames
      can't do it. Write group expressions via registered semantic macros
      (e.g. `\gexp{g}{x}`, `\ggen`, `\gmul`) in MacroName, and ship two
      site-curated notation sets: `multiplicative-notation` (`\gexp` →
      `#1^{#2}`, `\ggen` → `g`) and `additive-notation` (`\gexp` → `[#2]#1`,
      `\ggen` → `G`). The existing macro-set switcher then flips a whole
      definition; consider a dedicated one-click toggle when a definition's
      formulation pairs with these sets. **Pilot: the seeded DDH entry**, whose
      body currently hardcodes `g^x, g^y, g^{xy}` — retrofit it to the
      semantic macros as the worked example.
- [ ] "Cite this" widget: copies a LaTeX snippet (`\href`/footnote or a provided
      `\defcite` macro) with the pinned permalink + chosen macro set.
- [ ] og-image/meta previews so links unfurl nicely.
- [ ] Cross-links between definitions in commentary (`[[commitment-scheme]]` style).
- [ ] Deploy: Compose stack on university VM, Caddy/nginx + TLS, backups, minimal CI
      (typecheck, lint, tests on GitHub Actions).

### Phase 4+ — small follow-ups
- [ ] **Send invitation emails.** Today an invitation just sits in the DB and the
      role applies on first sign-in; the admin UI says to notify people out of band.
      Wire better-auth's mailer to the university SMTP relay (the same relay the
      "email magic links" fallback in the Auth section would use) so `POST
      /invitations` also sends a "you've been invited, sign in here" email.

---

## Open questions
- Which site-provided environments do we curate for the Tier-1/editor preview
  (definition box, game box styling)? *Deferred by user until later — Tier 2 runs
  real LaTeX regardless, so this only affects preview quality.* *(2026-07-09:
  first concrete answer — a `functionality` environment for ideal
  functionalities, see the Phase 4 item; that one is NOT preview-only since no
  standard package exists, so it needs a paired `crypto-wiki.sty`.)*
- Search: Postgres full-text is likely enough at this scale — revisit only if not.

## Answered
- Anonymous macro sets need no lifecycle policy for now — they can live forever.
- Deployment: self-hosted university VM, no cloud dependencies (see Deployment).
