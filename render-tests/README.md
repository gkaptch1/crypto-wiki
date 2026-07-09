# Shim-vs-real-LaTeX regression harness

Keeps the katex-cryptocode shim (Tier 1, `shared/src/cryptocode-macros.ts` +
`shared/src/cryptocode-preprocess.ts` + `shared/src/latex-render.ts`) honest
against real cryptocode (Tier 2, the Phase-0 spike pipeline). See PLAN.md
→ "Two-tier rendering".

```
npm run render-tests          # all fragments (builds shared first)
node render-tests/run.mjs tabs game-hop   # a subset
```

Each fragment in `fragments/` is a pure-LaTeX definition body — exactly what
the wiki stores in `Revision.bodyLatex`. Per fragment the harness:

1. compiles it with **real cryptocode** (`latex -no-shell-escape` → `dvisvgm`
   SVG), proving the body is genuine LaTeX a paper could `\input`;
2. renders it with the **shim** — the same `renderLatexFragment` code path
   the frontend serves, KaTeX in `throwOnError` mode;
3. cross-checks tokens: every word from the source and every attributable
   word/number that real LaTeX typeset (extracted with `dvi2tty`) must appear
   in the shim's rendered text. Line numbers are numbers, so numbering
   behavior is compared against ground truth, not assumed;
4. writes `out/report.html` — real SVG next to shim HTML for human eyes.

Requires a TeX install with `cryptocode` (MacTeX/TeX Live); without one the
Tier-2 steps are skipped with a warning and only shim self-checks run.
Phase 3 wires this into CI and the publish flow.

The corpus covers the shim v1 feature set: plain math (`prf`), the basic
`\procedure` box (`euf-cma`), `\t` alignment tabs (`tabs`), automatic +
manual line numbers (`line-numbers`), `\pchstack`/`\pchspace`/`\gamechange`
(`game-hop`), and headerless `\pseudocode` with `\pcind[n]` (`pseudocode`).
When the shim learns a new construct, add a fragment here first.
