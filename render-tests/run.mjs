#!/usr/bin/env node
// Shim-vs-real-LaTeX regression harness (PLAN.md "Two-tier rendering", shim v1).
//
// For every fragment in fragments/ (pure-LaTeX definition bodies, the same
// shape the wiki stores):
//
//   Tier 2 (ground truth): compile with REAL cryptocode via the Phase-0 spike
//     pipeline (latex -no-shell-escape → dvisvgm SVG) — proving the fragment
//     is genuine cryptocode LaTeX — and extract its typeset text with dvi2tty.
//   Tier 1 (the shim): render with the exact code the site serves
//     (@crypto-wiki/shared renderLatexFragment + KaTeX), but throwOnError so
//     nothing degrades silently.
//
// Checks per fragment:
//   compile   real LaTeX accepts the body (else it isn't cryptocode).
//   shim      KaTeX renders every math segment without errors or leftovers.
//   source    every word token from the fragment source survives into the
//             shim's rendered text (catches dropped lines/cells/highlights).
//   latex     every word/number token real LaTeX typeset (per dvi2tty) also
//             appears in the shim render (catches keyword/numbering drift —
//             e.g. line numbers real cryptocode prints but the shim doesn't).
//
// Writes out/report.html with real-SVG-vs-shim renders side by side for
// human eyeballing. Run from the repo root:  npm run render-tests
// (Tier-2 steps are skipped with a warning when no TeX install is found.)
//
// Usage: node render-tests/run.mjs [fragment-name ...]

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../frontend/package.json'));
const katex = require('katex');
const { cryptocodeMacros, renderLatexFragment } = await import('../shared/dist/index.js');

// Notation used by the fragments beyond cryptocode's own commands. Serves as
// BOTH the Tier-2 preamble (\providecommand+\renewcommand, composing with
// whatever cryptocode defines) and the shim-side "viewer macro set" — the
// same two-layer setup the site uses, guaranteed in sync.
const NOTATION = {
  '\\secpar': '\\lambda',
  '\\adv': '\\mathcal{A}',
  '\\negl': '\\mathsf{negl}',
  '\\sample': '\\mathrel{\\stackrel{\\$}{\\leftarrow}}',
  '\\bin': '\\{0,1\\}',
  '\\concat': '\\mathbin{\\|}',
  '\\Funcs': '\\mathsf{Funcs}',
  '\\Gen': '\\mathsf{Gen}',
  '\\Enc': '\\mathsf{Enc}',
  '\\Dec': '\\mathsf{Dec}',
};

const texBin = '/Library/TeX/texbin';
if (fs.existsSync(texBin) && !process.env.PATH.includes(texBin)) {
  process.env.PATH = `${texBin}:${process.env.PATH}`;
}
const haveTex = ['latex', 'dvisvgm', 'dvi2tty'].every((tool) => {
  try {
    execFileSync('which', [tool], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
});

const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

// --- Tier 1: the shim, exactly as the frontend binds it -------------------

function renderShim(body) {
  const macros = { ...cryptocodeMacros, ...NOTATION };
  const errors = [];
  const html = renderLatexFragment(body, (tex, displayMode) => {
    try {
      return katex.renderToString(tex, {
        displayMode,
        macros,
        throwOnError: true,
        strict: false,
        output: 'html', // no MathML annotation: it echoes the TeX source,
        // which would let the token checks pass vacuously
      });
    } catch (err) {
      errors.push(err.message);
      return '<span class="harness-katex-error"></span>';
    }
  });
  return { html, errors };
}

function htmlToText(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** Everything alphanumeric, squeezed: the haystack for substring checks. */
function squeeze(text) {
  return text.replace(/[^A-Za-z0-9]+/g, '');
}

// --- Tier 2: the real thing ------------------------------------------------

function runLatex(name, fragmentPath) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `render-test-${name}-`));
  const preamble = Object.entries(NOTATION)
    .map(([k, v]) => `\\providecommand{${k}}{}\\renewcommand{${k}}{${v}}`)
    .join('\n');
  fs.writeFileSync(
    path.join(work, 'doc.tex'),
    `\\documentclass[varwidth=12cm, border=8pt]{standalone}
\\usepackage{amsmath,amssymb}
\\usepackage{cryptocode}
${preamble}
\\begin{document}
\\input{${fragmentPath}}
\\end{document}
`,
  );
  try {
    execFileSync(
      'latex',
      ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'doc.tex'],
      { cwd: work, stdio: 'pipe' },
    );
  } catch {
    const log = fs.readFileSync(path.join(work, 'doc.log'), 'utf8');
    return { ok: false, log: log.split('\n').slice(-25).join('\n') };
  }
  execFileSync('dvisvgm', ['--no-fonts', '--exact-bbox', '-o', path.join(outDir, `${name}.latex.svg`), 'doc.dvi'], {
    cwd: work,
    stdio: 'pipe',
  });
  const tty = execFileSync('dvi2tty', ['-q', 'doc.dvi'], { cwd: work, encoding: 'utf8' });
  fs.rmSync(work, { recursive: true, force: true });
  return { ok: true, text: tty };
}

// --- token extraction -------------------------------------------------------

/** Word tokens from the fragment SOURCE that must survive rendering. */
function sourceTokens(src) {
  const stripped = src
    .replace(/(?<!\\)%.*$/gm, '') // comments
    .replace(/\\(?:begin|end)\{[a-zA-Z*]*\}(\[[^\]]*\])?/g, ' ') // env names + options aren't content
    .replace(/\\[a-zA-Z]+(\[[^\]]*\])?/g, ' '); // control words + their options
  return [...new Set(stripped.match(/[A-Za-z]{2,}/g) ?? [])];
}

/**
 * Words the shim macro layer expands commands in this fragment into —
 * e.g. \pcreturn → "return", \negl → "negl". Real cryptocode typesets the
 * same words, so they anchor the shim-vs-LaTeX comparison.
 */
function expansionWords(src) {
  const table = { ...cryptocodeMacros, ...NOTATION };
  const words = new Set();
  for (const cmd of src.match(/\\[a-zA-Z]+/g) ?? []) {
    const expansion = table[cmd];
    if (!expansion) continue;
    const stripped = expansion.replace(/\\[a-zA-Z]+/g, ' ');
    for (const w of stripped.match(/[A-Za-z]{2,}/g) ?? []) words.add(w);
  }
  return words;
}

/**
 * Tokens from dvi2tty's view of the real typeset output that the shim render
 * is REQUIRED to contain: numbers (line numbers — the shim must agree with
 * real cryptocode's numbering) and words we can attribute to the fragment.
 * The rest is dropped: dvi2tty approximates symbol-font glyphs with letter
 * salad ("fifih" for delimiters), and columns that are adjacent on the page
 * can merge into one run, which the shim can't match because KaTeX emits
 * array cells column-major.
 */
function latexTokens(ttyText, attributable) {
  const all = ttyText.match(/[A-Za-z]{2,}|[0-9]+/g) ?? [];
  return [...new Set(all.filter((t) => /^[0-9]+$/.test(t) || attributable.has(t)))];
}

// --- report ----------------------------------------------------------------

function reportSection(name, svgOk, shimHtml, notes) {
  const svg = svgOk
    ? `<img src="${name}.latex.svg" alt="real LaTeX render">`
    : '<em>no TeX install — Tier-2 render skipped</em>';
  return `<section>
  <h2>${name} ${notes.length ? '❌' : '✅'}</h2>
  ${notes.map((n) => `<p class="fail">${n.replace(/</g, '&lt;')}</p>`).join('\n')}
  <div class="cols">
    <div><h3>real cryptocode (ground truth)</h3>${svg}</div>
    <div><h3>katex-cryptocode shim</h3><div class="shim">${shimHtml}</div></div>
  </div>
</section>`;
}

// --- main --------------------------------------------------------------------

const filter = process.argv.slice(2);
const fragmentsDir = path.join(here, 'fragments');
const names = fs
  .readdirSync(fragmentsDir)
  .filter((f) => f.endsWith('.tex'))
  .map((f) => f.replace(/\.tex$/, ''))
  .filter((n) => filter.length === 0 || filter.includes(n));

if (!haveTex) {
  console.warn('WARNING: latex/dvisvgm/dvi2tty not found — running shim-only checks.');
}

let failed = 0;
const sections = [];

for (const name of names) {
  const fragmentPath = path.join(fragmentsDir, `${name}.tex`);
  const src = fs.readFileSync(fragmentPath, 'utf8');
  const notes = [];

  const shim = renderShim(src);
  for (const e of shim.errors) notes.push(`shim: KaTeX error: ${e}`);
  const shimText = htmlToText(shim.html);
  if (/\\(pc[a-z]+|procedure|pseudocode|gamechange|begin)/.test(shimText)) {
    notes.push('shim: unprocessed LaTeX command leaked into rendered text');
  }
  const haystack = squeeze(shimText);

  for (const tok of sourceTokens(src)) {
    if (!haystack.includes(tok)) notes.push(`source: token "${tok}" missing from shim render`);
  }

  let latexed = { ok: false };
  if (haveTex) {
    latexed = runLatex(name, fragmentPath);
    if (!latexed.ok) {
      notes.push(`compile: real LaTeX rejected the fragment:\n${latexed.log}`);
    } else {
      const attributable = new Set([...sourceTokens(src), ...expansionWords(src)]);
      for (const tok of latexTokens(latexed.text, attributable)) {
        if (!haystack.includes(tok)) {
          notes.push(`latex: real render shows "${tok}" but the shim render doesn't`);
        }
      }
    }
  }

  fs.writeFileSync(path.join(outDir, `${name}.shim.html`), shim.html);
  sections.push(reportSection(name, latexed.ok, shim.html, notes));
  if (notes.length) {
    failed++;
    console.error(`FAIL  ${name}`);
    for (const n of notes) console.error(`      ${n}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

// side-by-side report (self-contained apart from KaTeX assets copied below)
const katexDist = path.dirname(require.resolve('katex/dist/katex.min.css'));
fs.cpSync(path.join(katexDist, 'katex.min.css'), path.join(outDir, 'katex/katex.min.css'));
fs.cpSync(path.join(katexDist, 'fonts'), path.join(outDir, 'katex/fonts'), { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'report.html'),
  `<!doctype html><meta charset="utf-8"><title>shim vs real cryptocode</title>
<link rel="stylesheet" href="katex/katex.min.css">
<style>
  body { font-family: system-ui, sans-serif; max-width: 70rem; margin: 2rem auto; padding: 0 1rem; }
  section { border-top: 1px solid #ccc; padding: 1rem 0; }
  .cols { display: flex; gap: 2rem; align-items: flex-start; }
  .cols > div { flex: 1; min-width: 0; overflow-x: auto; }
  .fail { color: #b00; white-space: pre-wrap; }
  img { max-width: 100%; }
  h2 { font-size: 1.1rem; } h3 { font-size: 0.9rem; color: #666; }
  .cc-par { margin: 0.5rem 0; }
  .cc-display, .cc-center { margin: 0.75rem 0; display: flex; justify-content: center; }
  .cc-hstack { display: flex; gap: 1.5rem; align-items: flex-start; flex-wrap: wrap; }
  .cc-vstack { display: flex; flex-direction: column; gap: 0.75rem; }
  .cc-stack-space { flex: 0 0 1rem; }
  .cc-stack-item .katex-display { margin: 0; }
</style>
${sections.join('\n')}`,
);

console.log(`\n${names.length - failed}/${names.length} fragments pass`);
console.log(`report: render-tests/out/report.html`);
process.exit(failed === 0 ? 0 : 1);
