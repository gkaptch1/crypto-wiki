# Phase 0 rendering spike

Answers PLAN.md's decision checkpoint: *is server-side LaTeX → SVG paper-quality?*

**Verdict: yes.** Real LaTeX (including the `cryptocode` package) compiled to
self-contained SVG in ~0.6 s per definition; macro-set swapping works via
`\providecommand`+`\renewcommand` injection. See PLAN.md → "Two-tier rendering".

- `fragments/` — pure-LaTeX definition bodies (PRF, EUF-CMA with a cryptocode
  `\procedure` game box)
- `macros/` — two macro sets rendering the same bodies in different notation
- `build.sh` — fragment × macro set → `latex -no-shell-escape` → `dvisvgm
  --no-fonts` → `out/*.svg`

Requires a TeX installation with `cryptocode` (MacTeX/TeX Live). The production
renderer will run the same pipeline inside a sandboxed container.

## Day-2 addendum: cryptocode in KaTeX

`katex-shim-test.mjs` (run with `node spike/katex-shim-test.mjs`, needs
`frontend/node_modules`) shows cryptocode's core `\procedure` game box works as a
*single KaTeX macro*. This flipped the recommendation: KaTeX + compat shim becomes
the canonical renderer (macro sets apply client-side → no render-cache explosion,
and pages reflow on mobile); the LaTeX→SVG pipeline stays as escape hatch for
tikz-based features and as the regression harness. Details in PLAN.md.
