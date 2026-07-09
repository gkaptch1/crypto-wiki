/**
 * Tier-1 fragment renderer: walks a pure-LaTeX definition body's block
 * structure (paragraphs, $…$, \[…\], center blocks, itemize, pchstack /
 * pcvstack) and hands every math segment — after the cryptocode
 * preprocessing pass — to an injected `renderMath` callback.
 *
 * Lives in shared (not frontend) so the render-tests regression harness
 * exercises the exact code path the site serves; the frontend binds KaTeX +
 * the merged macro layer in `frontend/src/lib/latex.ts`. Output uses
 * semantic `cc-*` classes styled in the frontend's CSS.
 *
 * Anything beyond this subset is Tier-2 territory (real LaTeX → SVG).
 */

import {
  preprocessCryptocode,
  parseStackContent,
  hasStructuralCryptocode,
  type StackNode,
} from './cryptocode-preprocess.js';

/** Renders one math segment (KaTeX in practice) to HTML. */
export type RenderMath = (tex: string, displayMode: boolean) => string;

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// inline segments: $...$ math plus the tiny set of text commands we support
function renderText(text: string, renderMath: RenderMath): string {
  let html = '';
  for (const part of text.split(/(\$[^$]+\$)/g)) {
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      html += renderMath(preprocessCryptocode(part.slice(1, -1)), false);
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

function renderParagraphs(text: string, renderMath: RenderMath): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="cc-par">${renderText(p, renderMath)}</p>`)
    .join('');
}

function renderDisplayMath(tex: string, renderMath: RenderMath): string {
  return `<div class="cc-display">${renderMath(preprocessCryptocode(tex), true)}</div>`;
}

function renderStackNodes(nodes: StackNode[], renderMath: RenderMath): string {
  return nodes
    .map((node) => {
      if (node.kind === 'space') return '<div class="cc-stack-space"></div>';
      if (node.kind === 'stack') {
        const dir = node.direction === 'h' ? 'cc-hstack' : 'cc-vstack';
        const center = node.center ? ' cc-stack-center' : '';
        return `<div class="${dir}${center}">${renderStackNodes(node.items, renderMath)}</div>`;
      }
      return `<div class="cc-stack-item">${renderMath(preprocessCryptocode(node.tex), true)}</div>`;
    })
    .join('');
}

/** A center block / stack env: game boxes laid out as flexbox. */
function renderStructural(content: string, renderMath: RenderMath, direction: 'h' | 'v'): string {
  const dir = direction === 'h' ? 'cc-hstack' : 'cc-vstack';
  return `<div class="cc-center"><div class="${dir}">${renderStackNodes(
    parseStackContent(content),
    renderMath,
  )}</div></div>`;
}

const BLOCK =
  /\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\\begin\{center\}([\s\S]*?)\\end\{center\}|\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}|\\begin\{pchstack\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{pchstack\}|\\begin\{pcvstack\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{pcvstack\}/g;

function renderBlocks(body: string, renderMath: RenderMath): string {
  let html = '';
  let last = 0;
  for (const m of body.matchAll(BLOCK)) {
    html += renderParagraphs(body.slice(last, m.index), renderMath);
    const [, display, displayDollars, center, itemize, hstack, vstack] = m;
    if (display !== undefined || displayDollars !== undefined) {
      html += renderDisplayMath((display ?? displayDollars).trim(), renderMath);
    } else if (center !== undefined) {
      // center blocks hold math-mode content; game boxes get flex layout
      if (hasStructuralCryptocode(center)) {
        html += renderStructural(center.trim(), renderMath, 'h');
      } else {
        html += `<div class="cc-center">${renderMath(preprocessCryptocode(center.trim()), true)}</div>`;
      }
    } else if (itemize !== undefined) {
      const items = itemize
        .split('\\item')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((item) => `<li>${renderBlocks(item, renderMath)}</li>`)
        .join('');
      html += `<ul class="cc-list">${items}</ul>`;
    } else if (hstack !== undefined) {
      html += renderStructural(hstack.trim(), renderMath, 'h');
    } else if (vstack !== undefined) {
      html += renderStructural(vstack.trim(), renderMath, 'v');
    }
    last = m.index + m[0].length;
  }
  html += renderParagraphs(body.slice(last), renderMath);
  return html;
}

/**
 * Render a pure-LaTeX definition body to HTML. `renderMath` receives each
 * math segment already run through the cryptocode preprocessing pass.
 */
export function renderLatexFragment(body: string, renderMath: RenderMath): string {
  return renderBlocks(body, renderMath);
}
