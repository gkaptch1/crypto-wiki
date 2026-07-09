import { useMemo } from 'react';
import type { MacroMap } from '@crypto-wiki/shared';
import { renderLatexBody } from '../lib/latex';
import 'katex/dist/katex.min.css';

interface LatexViewProps {
  body: string;
  macros?: MacroMap;
  className?: string;
}

// Pure-LaTeX definition body rendered via KaTeX + the cryptocode shim.
// The HTML comes from KaTeX plus our own escaped text segments, so it is
// safe to inject.
export default function LatexView({ body, macros = {}, className = '' }: LatexViewProps) {
  const html = useMemo(() => renderLatexBody(body, macros), [body, macros]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
