#!/usr/bin/env node
// Corpus harness for the deterministic paper importer (PLAN.md Phase 3).
//
// Runs @crypto-wiki/shared extractFromLatex — the exact code the site will
// serve — over every downloaded corpus paper (import-tests/fetch.mjs) and
// checks the results against the hand-verified expectations in papers.json:
//
//   definitions   exact count of theorem-env candidates in definition-like
//                 environments (grep-verified against the source).
//   procedures /  count of standalone cryptocode game-box candidates
//   proceduresAtLeast
//   macrosAtLeast lower bound on extracted macro declarations.
//
// Full extraction results land in out/<id>.json for eyeballing; papers not
// yet downloaded are skipped with a warning (mirrors render-tests' TeX
// skip). Run from the repo root:  npm run import-tests  [arxiv-id ...]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { extractFromLatex } = await import('../shared/dist/index.js');
const { papers } = JSON.parse(fs.readFileSync(path.join(here, 'papers.json'), 'utf8'));
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

const only = process.argv.slice(2);
let failures = 0;
let skipped = 0;

/** All .tex/.sty files under dir (recursive), as a relative-path → content map. */
function readTexFiles(dir, base = dir) {
  const files = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, readTexFiles(full, base));
    else if (entry.name.endsWith('.tex') || entry.name.endsWith('.sty'))
      files[path.relative(base, full)] = fs.readFileSync(full, 'utf8');
  }
  return files;
}

for (const paper of papers) {
  if (only.length > 0 && !only.includes(paper.arxiv)) continue;
  const dir = path.join(here, 'corpus', paper.arxiv);
  if (!fs.existsSync(dir)) {
    console.log(`SKIP ${paper.arxiv} — not downloaded (node import-tests/fetch.mjs)`);
    skipped++;
    continue;
  }

  const files = readTexFiles(dir);
  const result = extractFromLatex(files, paper.mainFile ? { mainFile: paper.mainFile } : {});
  fs.writeFileSync(path.join(outDir, `${paper.arxiv}.json`), JSON.stringify(result, null, 2));

  // `definitions` = \begin{definition} proper (what the hand greps counted);
  // other definition-like envs (construction, experiment, ...) are a bonus
  const definitions = result.candidates.filter(
    (c) => c.kind === 'theorem-env' && c.envName === 'definition',
  ).length;
  const otherEnvs = result.candidates.filter(
    (c) => c.kind === 'theorem-env' && c.envName !== 'definition',
  ).length;
  const procedures = result.candidates.filter((c) => c.kind === 'procedure').length;
  const macros = result.macros.length;
  const katexSafe = Object.keys(result.macroMap).length;

  const problems = [];
  const expect = paper.expect ?? {};
  if (expect.definitions !== undefined && definitions !== expect.definitions)
    problems.push(`definitions: got ${definitions}, expected ${expect.definitions}`);
  if (expect.procedures !== undefined && procedures !== expect.procedures)
    problems.push(`procedures: got ${procedures}, expected ${expect.procedures}`);
  if (expect.proceduresAtLeast !== undefined && procedures < expect.proceduresAtLeast)
    problems.push(`procedures: got ${procedures}, expected ≥ ${expect.proceduresAtLeast}`);
  if (expect.macrosAtLeast !== undefined && macros < expect.macrosAtLeast)
    problems.push(`macros: got ${macros}, expected ≥ ${expect.macrosAtLeast}`);

  const status = problems.length === 0 ? ' ok ' : 'FAIL';
  console.log(
    `${status} ${paper.arxiv}  files:${Object.keys(files).length}(scanned ${result.scannedFiles.length})` +
      `  macros:${macros}(${katexSafe} katex-safe)  defs:${definitions}(+${otherEnvs} other envs)` +
      `  procs:${procedures}  warnings:${result.warnings.length}`,
  );
  for (const p of problems) console.log(`       ${p}`);
  for (const w of result.warnings) console.log(`       warn: ${w}`);
  if (problems.length > 0) failures++;
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${papers.length - skipped} papers checked, ${skipped} skipped; details in import-tests/out/`);
process.exit(failures === 0 ? 0 : 1);
