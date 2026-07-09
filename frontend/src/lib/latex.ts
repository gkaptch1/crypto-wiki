import katex from 'katex';
import { cryptocodeMacros, renderLatexFragment } from '@crypto-wiki/shared';
import type { MacroMap } from '@crypto-wiki/shared';

// Tier-1 rendering: binds KaTeX + the merged macro layer to the shared
// fragment renderer (block walking + the cryptocode preprocessing pass live
// in @crypto-wiki/shared so the render-tests harness exercises the same
// code). Styling for the renderer's cc-* classes is in index.css.

/** Merge order matters: the viewer's macro set overrides the shim base layer. */
export function mergedMacros(userMacros: MacroMap = {}): Record<string, string> {
  return { ...cryptocodeMacros, ...userMacros };
}

export function renderLatexBody(body: string, userMacros: MacroMap = {}): string {
  // one macros object per body: KaTeX accumulates \newcommand definitions
  // into it, so a macro defined early in a body stays visible later
  const macros = mergedMacros(userMacros);
  return renderLatexFragment(body, (tex, displayMode) =>
    katex.renderToString(tex, {
      displayMode,
      macros,
      throwOnError: false,
      strict: false,
    }),
  );
}
