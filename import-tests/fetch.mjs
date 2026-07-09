#!/usr/bin/env node
// Download the import-corpus paper sources from arXiv into corpus/<id>/
// (gitignored — we don't commit other people's paper sources). Idempotent:
// already-downloaded papers are skipped. Run from the repo root:
//   node import-tests/fetch.mjs
//
// arXiv e-print payloads are either a gzipped tar (multi-file paper) or a
// single gzipped .tex; both are handled. Be nice to arXiv: this fetches
// sequentially and only what's missing.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { papers } = JSON.parse(fs.readFileSync(path.join(here, 'papers.json'), 'utf8'));
const corpusDir = path.join(here, 'corpus');
fs.mkdirSync(corpusDir, { recursive: true });

for (const paper of papers) {
  const dest = path.join(corpusDir, paper.arxiv);
  if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
    console.log(`✓ ${paper.arxiv} already present`);
    continue;
  }
  console.log(`↓ ${paper.arxiv} — ${paper.title}`);
  const payload = path.join(corpusDir, `${paper.arxiv}.download`);
  const res = await fetch(`https://arxiv.org/e-print/${paper.arxiv}`, {
    headers: { 'user-agent': 'crypto-wiki import-tests (mailto:kaptchuk@umd.edu)' },
  });
  if (!res.ok) {
    console.error(`  FAILED: HTTP ${res.status}`);
    process.exitCode = 1;
    continue;
  }
  fs.writeFileSync(payload, Buffer.from(await res.arrayBuffer()));
  fs.mkdirSync(dest, { recursive: true });
  try {
    execFileSync('tar', ['xzf', payload, '-C', dest], { stdio: 'pipe' });
  } catch {
    // not a tarball: single gzipped .tex (e.g. arXiv:1811.11858 style)
    execFileSync('sh', ['-c', `gunzip -c '${payload}' > '${path.join(dest, 'main.tex')}'`]);
  }
  fs.rmSync(payload);
  console.log(`  → ${fs.readdirSync(dest).length} files`);
}
