/**
 * katex-cryptocode shim v0: the site's base macro layer.
 *
 * One-line KaTeX transcriptions of cryptocode's notation commands, pc*
 * keywords, and the core \procedure game box (validated in the Phase 0 day-2
 * spike: `spike/katex-shim-test.mjs`). A user macro set is merged OVER this
 * table at render time, so definitions can freely reuse or override any of it.
 *
 * v1 (cryptocode-preprocess.ts) adds the JS preprocessing pass for the parts
 * plain macros cannot express: optional args (\procedure[...]), \pcln line
 * numbers, alignment tabs, \pchstack side-by-side games, \gamechange
 * highlights.
 *
 * Ground truth is always real cryptocode via the Tier-2 pipeline; the
 * render-tests/ harness keeps this shim honest.
 */

const notation: Record<string, string> = {
  // security parameter
  '\\secpar': '\\lambda',
  '\\secparam': '1^{\\secpar}',
  // probability & asymptotics
  '\\negl': '\\mathsf{negl}',
  '\\poly': '\\mathsf{poly}',
  '\\ppt': '\\mathsf{PPT}',
  // sampling & strings
  '\\sample': '\\mathrel{\\stackrel{\\$}{\\leftarrow}}',
  '\\bin': '\\{0,1\\}',
  '\\concat': '\\mathbin{\\|}',
  '\\emptystring': '\\varepsilon',
};

// adversaries: \adv..\zdv render as calligraphic letters, as in cryptocode
const adversaries: Record<string, string> = {};
for (let i = 0; i < 26; i++) {
  adversaries[`\\${String.fromCharCode(97 + i)}dv`] = `\\mathcal{${String.fromCharCode(65 + i)}}`;
}

// pc* pseudocode keywords: bold keyword, trailing space where cryptocode has one
const keywords: Record<string, string> = {
  '\\pcreturn': '\\mathbf{return}\\ ',
  '\\pcif': '\\mathbf{if}\\ ',
  '\\pcthen': '\\ \\mathbf{then}\\ ',
  '\\pcelse': '\\mathbf{else}\\ ',
  '\\pcelseif': '\\mathbf{else\\ if}\\ ',
  '\\pcfi': '\\mathbf{fi}',
  '\\pcendif': '\\mathbf{endif}',
  '\\pcfor': '\\mathbf{for}\\ ',
  '\\pcforeach': '\\mathbf{foreach}\\ ',
  '\\pcdo': '\\ \\mathbf{do}\\ ',
  '\\pcendfor': '\\mathbf{endfor}',
  '\\pcwhile': '\\mathbf{while}\\ ',
  '\\pcendwhile': '\\mathbf{endwhile}',
  '\\pcrepeat': '\\mathbf{repeat}\\ ',
  '\\pcuntil': '\\mathbf{until}\\ ',
  '\\pcnew': '\\mathbf{new}\\ ',
  '\\pcparse': '\\mathbf{parse}\\ ',
  '\\pcassert': '\\mathbf{assert}\\ ',
  '\\pcabort': '\\mathbf{abort}',
  '\\pccontinue': '\\mathbf{continue}',
  '\\pcbreak': '\\mathbf{break}',
  '\\pcnull': '\\mathbf{null}',
  '\\pctrue': '\\mathbf{true}',
  '\\pcfalse': '\\mathbf{false}',
  '\\pcand': '\\mathbin{\\mathbf{and}}',
  '\\pcor': '\\mathbin{\\mathbf{or}}',
  '\\pcnot': '\\mathbf{not}\\ ',
  '\\pcin': '\\mathbin{\\mathbf{in}}',
  '\\pcto': '\\mathbin{\\mathbf{to}}',
  '\\pcdownto': '\\mathbin{\\mathbf{downto}}',
  '\\pcind': '\\quad',
  '\\pccomment': '\\quad\\text{// #1}',
};

// The game box as a plain macro. Definition bodies never hit this: the v1
// preprocessing pass rewrites \procedure (with optional args, tabs, line
// numbers) before KaTeX sees it. It stays here as a fallback for Markdown
// commentary, where rehype-katex renders without the preprocessing pass.
const gameBox: Record<string, string> = {
  '\\procedure': '\\begin{array}{l}\\text{#1}\\\\[0.2em]\\hline\\\\[-0.9em] #2\\end{array}',
};

export const cryptocodeMacros: Record<string, string> = {
  ...notation,
  ...adversaries,
  ...keywords,
  ...gameBox,
};
