// Deterministic PDF stage of the paper importer: read the PDF's text layer
// (pdfjs, pure JS — no poppler/system deps) and locate definition-like blocks
// by their printed headings ("Definition 3.1 (IND-CPA security)."). Costs
// zero LLM tokens. What this CANNOT do is reconstruct LaTeX — the text layer
// flattens math (g^x becomes "gx", calligraphic letters garble), so faithful
// bodies are the LLM stage's job. The scout's findings become (a) a checklist
// the LLM must cover — free cross-validation — and (b) in guided mode, the
// page subset we actually send, which is the big token saver.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ScoutCandidate {
  /** Heading keyword as printed, e.g. "Definition". */
  kind: string;
  /** Printed number ("3.1"), if any. */
  number: string | null;
  /** Parenthesized heading title, if any. */
  title: string | null;
  /** 1-based PDF page. */
  page: number;
  /** Raw text-layer snippet following the heading (garbled math — preview only). */
  preview: string;
}

export interface ScoutResult {
  pageCount: number;
  candidates: ScoutCandidate[];
}

// Mirrors the LaTeX extractor's DEFINITION_LIKE intent, but against printed
// display names. Theorems/lemmas/proofs are deliberately absent.
const HEADING_RE =
  /(?:^|\n)[ \t]*((?:Definition|Experiment|Construction|Game|Functionality)s?)[ \t]+(\d+(?:\.\d+)*)?[ \t]*(?:\(([^)\n]{0,200})\))?[.:]?/g;

const PREVIEW_CHARS = 240;

/** Assemble a page's text items into line-broken text. */
function pageText(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  let out = '';
  for (const item of items) {
    if (typeof item.str === 'string') out += item.str;
    out += item.hasEOL ? '\n' : ' ';
  }
  return out;
}

export async function scoutPdf(pdf: Buffer): Promise<ScoutResult> {
  // pdfjs wants a plain Uint8Array it can transfer/own — copy out of the Buffer
  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: true });
  const doc = await task.promise;
  try {
    const candidates: ScoutCandidate[] = [];
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      const text = pageText(content.items as Array<{ str?: string; hasEOL?: boolean }>);
      for (const m of text.matchAll(HEADING_RE)) {
        const [, kind, number, title] = m;
        // a bare keyword mid-prose ("the definition of...") has neither a
        // number nor a parenthesized title — require one to count
        if (!number && !title) continue;
        const at = m.index! + m[0].length;
        const preview = text
          .slice(at, at + PREVIEW_CHARS)
          .replace(/\s+/g, ' ')
          .trim();
        candidates.push({
          kind: kind.replace(/s$/, ''),
          number: number ?? null,
          title: title?.trim() || null,
          page: pageNo,
          preview,
        });
      }
    }
    return { pageCount: doc.numPages, candidates };
  } finally {
    await task.destroy();
  }
}
