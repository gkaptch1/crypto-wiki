import katex from 'katex';
import { cryptocodeMacros } from '@crypto-wiki/shared';
import type { MacroMap } from '@crypto-wiki/shared';

// Renders a pure-LaTeX definition body (the Tier-1 path: KaTeX + the
// katex-cryptocode shim). Definition bodies are LaTeX fragments — prose with
// inline math, display math, center blocks (game boxes) and simple lists —
// so this walks the block structure and hands every math segment to KaTeX
// with the shim macros as the base layer and the viewer's macro set on top.
//
// Anything beyond this subset is Tier-2 territory (real LaTeX → SVG).

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderMath(tex: string, displayMode: boolean, macros: Record<string, string>): string {
  return katex.renderToString(tex, {
    displayMode,
    macros,
    throwOnError: false,
    strict: false,
  });
}

// inline segments: $...$ math plus the tiny set of text commands we support
function renderText(text: string, macros: Record<string, string>): string {
  let html = '';
  for (const part of text.split(/(\$[^$]+\$)/g)) {
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      html += renderMath(part.slice(1, -1), false, macros);
    } else {
      let t = escapeHtml(part);
      t = t.replace(/\\textbf\{([^}]*)\}/g, '<strong>$1</strong>');
      t = t.replace(/\\(?:emph|textit)\{([^}]*)\}/g, '<em>$1</em>');
      t = t.replace(/\\(?:medskip|smallskip|bigskip|noindent)\b/g, '');
      html += t;
    }
  }
  return html;
}

function renderParagraphs(text: string, macros: Record<string, string>): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="my-2 leading-relaxed">${renderText(p, macros)}</p>`)
    .join('');
}

const BLOCK = /\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\\begin\{center\}([\s\S]*?)\\end\{center\}|\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g;

function renderBlocks(body: string, macros: Record<string, string>): string {
  let html = '';
  let last = 0;
  for (const m of body.matchAll(BLOCK)) {
    html += renderParagraphs(body.slice(last, m.index), macros);
    const [, display, displayDollars, center, itemize] = m;
    if (display !== undefined || displayDollars !== undefined) {
      html += `<div class="my-3 overflow-x-auto">${renderMath((display ?? displayDollars).trim(), true, macros)}</div>`;
    } else if (center !== undefined) {
      // center blocks hold math-mode content (e.g. cryptocode \procedure boxes)
      html += `<div class="my-4 flex justify-center overflow-x-auto">${renderMath(center.trim(), true, macros)}</div>`;
    } else if (itemize !== undefined) {
      const items = itemize
        .split('\\item')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((item) => `<li>${renderBlocks(item, macros)}</li>`)
        .join('');
      html += `<ul class="list-disc pl-6 my-2 space-y-1">${items}</ul>`;
    }
    last = m.index + m[0].length;
  }
  html += renderParagraphs(body.slice(last), macros);
  return html;
}

/** Merge order matters: the viewer's macro set overrides the shim base layer. */
export function mergedMacros(userMacros: MacroMap = {}): Record<string, string> {
  return { ...cryptocodeMacros, ...userMacros };
}

export function renderLatexBody(body: string, userMacros: MacroMap = {}): string {
  return renderBlocks(body, mergedMacros(userMacros));
}
