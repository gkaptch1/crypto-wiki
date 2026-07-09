// Day-2 spike addendum: can cryptocode's core be approximated in pure KaTeX macros?
// Verdict: yes — \procedure is a single macro over array + \hline; notation commands
// and pc* keywords are one-line transcriptions. See PLAN.md "Two-tier rendering".
//
// Run from repo root: node spike/katex-shim-test.mjs
import { createRequire } from 'module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const katex = require('katex');

// seed of a "katex-cryptocode" compatibility layer
const pcMacros = {
  // notation (cryptocode has ~87 of these; all mechanical)
  '\\secpar': '\\lambda',
  '\\adv': '\\mathcal{A}',
  '\\negl': '\\mathsf{negl}',
  '\\sample': '\\stackrel{\\$}{\\leftarrow}',
  // pc* keywords (~35 in cryptocode; all this shape)
  '\\pcreturn': '\\mathbf{return}\\ ',
  '\\pcif': '\\mathbf{if}\\ ',
  '\\pcfor': '\\mathbf{for}\\ ',
  '\\pcind': '\\quad',
  // the game box itself
  '\\procedure': '\\begin{array}{l}\\text{#1}\\\\[0.2em]\\hline\\\\[-0.9em] #2\\end{array}',
};

// the exact EUF-CMA experiment from backend/prisma/seed.ts
const src = `\\procedure{$\\mathsf{SigForge}_{\\adv,\\Sigma}(\\secpar)$}{
(vk, sk) \\sample \\mathsf{KGen}(1^\\secpar) \\\\
(m^*, \\sigma^*) \\sample \\adv^{\\mathsf{Sign}(sk, \\cdot)}(vk) \\\\
\\pcreturn \\mathsf{Vrfy}(vk, m^*, \\sigma^*) = 1 \\land m^* \\notin \\mathcal{Q}
}`;

const html = katex.renderToString(src, {
  displayMode: true,
  macros: { ...pcMacros },
  throwOnError: true,
});
console.log(`rendered OK (${html.length} chars of KaTeX HTML)`);
console.log('known gaps needing a JS preprocessing layer (not just macros):');
console.log('  optional args \\procedure[...], line numbers \\pcln, alignment tabs \\t,');
console.log('  side-by-side \\pchstack, \\gamechange highlights');
console.log('permanently out of scope (stays on real LaTeX): tikz protocol flows, game trees');
