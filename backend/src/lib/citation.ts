import { parseBibtex } from '@crypto-wiki/shared';
import type { CitationInput } from '@crypto-wiki/shared';

// Citation auto-import (PLAN.md Phase 3): resolve an import's source into
// citation fields to prefill the select step. arXiv and DBLP expose BibTeX at
// stable URLs; ePrint embeds it in the paper page (and bot-blocks server-side
// fetches — see PLAN.md — so pasted BibTeX is the reliable ePrint path). All
// paths funnel through the deterministic shared `parseBibtex`.

/** Thrown for every anticipated failure; `code`/`statusCode` map onto sendError. */
export class CitationFetchError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CitationFetchError';
  }
}

const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = 'crypto-wiki importer (mailto:kaptchuk@umd.edu)';

export interface CitationLookupInput {
  arxivId?: string;
  eprintId?: string;
  dblpKey?: string;
  bibtex?: string;
}

export interface CitationResult {
  citation: CitationInput;
  source: string;
  warnings: string[];
}

async function fetchText(url: string, fetchImpl: typeof fetch, label: string): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/x-bibtex, text/plain, text/html' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
  } catch {
    throw new CitationFetchError(502, 'CITATION_UNREACHABLE', `Could not reach ${label}.`);
  }
  if (res.status === 404) {
    throw new CitationFetchError(404, 'CITATION_NOT_FOUND', `${label} has no citation for that id.`);
  }
  if (!res.ok) {
    throw new CitationFetchError(502, 'CITATION_UNREACHABLE', `${label} responded with HTTP ${res.status}.`);
  }
  return res.text();
}

/** conf/crypto/GoelGHK22, a dblp.org/rec URL, or a trailing .bib — all → the bare key. */
function normalizeDblpKey(input: string): string {
  const key = input
    .trim()
    .replace(/^https?:\/\/dblp\.org\/rec\//i, '')
    .replace(/\.html?$/i, '')
    .replace(/\.bib.*$/i, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(key)) {
    throw new CitationFetchError(400, 'BAD_DBLP_KEY', `"${input}" is not a recognizable DBLP key.`);
  }
  return key;
}

export async function resolveCitation(
  input: CitationLookupInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CitationResult> {
  const warnings: string[] = [];
  let bibtex: string;
  let source: string;
  // Source-specific defaults for fields BibTeX may omit (the id we already know).
  let applyDefaults: (c: CitationInput) => void = () => {};

  if (input.bibtex !== undefined) {
    bibtex = input.bibtex;
    source = 'pasted BibTeX';
  } else if (input.arxivId !== undefined) {
    bibtex = await fetchText(`https://arxiv.org/bibtex/${input.arxivId}`, fetchImpl, 'arXiv');
    source = `arXiv:${input.arxivId}`;
    applyDefaults = (c) => {
      if (!c.url) c.url = `https://arxiv.org/abs/${input.arxivId}`;
    };
  } else if (input.eprintId !== undefined) {
    // ePrint has no .bib endpoint — the BibTeX block lives in the paper page.
    const html = await fetchText(`https://eprint.iacr.org/${input.eprintId}`, fetchImpl, 'ePrint');
    const block = html.match(/@\w+\s*\{[\s\S]*?\n\}/);
    if (!block) {
      throw new CitationFetchError(
        502,
        'CITATION_NO_BIBTEX',
        'Could not find a BibTeX entry on the ePrint page — paste the BibTeX instead.',
      );
    }
    bibtex = block[0];
    source = `ePrint ${input.eprintId}`;
    applyDefaults = (c) => {
      if (!c.eprint) c.eprint = input.eprintId!;
      if (!c.url) c.url = `https://eprint.iacr.org/${input.eprintId}`;
    };
  } else if (input.dblpKey !== undefined) {
    const key = normalizeDblpKey(input.dblpKey);
    bibtex = await fetchText(`https://dblp.org/rec/${key}.bib`, fetchImpl, 'DBLP');
    source = `DBLP ${key}`;
  } else {
    throw new CitationFetchError(400, 'BAD_INPUT', 'Provide one of arxivId, eprintId, dblpKey, or bibtex.');
  }

  const parsed = parseBibtex(bibtex);
  if (!parsed) warnings.push('No BibTeX entry could be parsed from the source.');
  // Apply id-derived defaults even on a parse miss, so the paper link still works.
  const citation = parsed ?? {};
  applyDefaults(citation);
  return { citation, source, warnings };
}
