// Deterministic BibTeX → Citation parser for the paper importer (PLAN.md
// Phase 3, "Citation auto-import"). Pure and dependency-free so it lives in
// shared: the backend parses BibTeX fetched from arXiv / DBLP / ePrint (or
// pasted by the user) into the flat citation fields the select step prefills.
// This does NOT aim to be a general BibTeX library — it reads the first real
// entry and maps the handful of fields a citation line needs, tolerating the
// dialects arXiv, IACR ePrint, and DBLP actually emit.

import type { CitationInput } from './types.js';

// --- LaTeX de-escaping, enough for author names and titles ------------------

// \'e, \"o, \v{s}, … → the composed unicode letter. Only accents that appear
// in real author names; anything unmapped just drops the accent command.
const ACCENTS: Record<string, Record<string, string>> = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', n: 'ń', c: 'ć', s: 'ś', z: 'ź', r: 'ŕ', l: 'ĺ', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', N: 'Ń', C: 'Ć', S: 'Ś', Z: 'Ź' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
  '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  '=': { a: 'ā', e: 'ē', i: 'ī', o: 'ō', u: 'ū' },
  '.': { z: 'ż', Z: 'Ż', e: 'ė', I: 'İ' },
  v: { c: 'č', d: 'ď', e: 'ě', n: 'ň', r: 'ř', s: 'š', t: 'ť', z: 'ž', C: 'Č', D: 'Ď', E: 'Ě', N: 'Ň', R: 'Ř', S: 'Š', T: 'Ť', Z: 'Ž' },
  c: { c: 'ç', s: 'ş', t: 'ţ', C: 'Ç', S: 'Ş' },
  H: { o: 'ő', u: 'ű', O: 'Ő', U: 'Ű' },
  k: { a: 'ą', e: 'ę', A: 'Ą', E: 'Ę' },
  u: { a: 'ă', g: 'ğ', A: 'Ă', G: 'Ğ' },
  r: { a: 'å', u: 'ů', A: 'Å', U: 'Ů' },
};

// Standalone special letters: \o \ss \aa \ae … → unicode.
const SPECIAL: Record<string, string> = {
  o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', i: 'i', j: 'j',
  aa: 'å', AA: 'Å', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', ss: 'ß',
};

// Common math letters/symbols that show up in crypto titles ($\Sigma$-protocols,
// $k$-anonymity). Any other \command is dropped, keeping its braced argument.
const MATH: Record<string, string> = {
  Sigma: 'Σ', Pi: 'Π', Gamma: 'Γ', Delta: 'Δ', Lambda: 'Λ', Omega: 'Ω', Theta: 'Θ', Phi: 'Φ', Psi: 'Ψ', Xi: 'Ξ',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω', pi: 'π', times: '×', cdot: '·', to: '→', ell: 'ℓ', infty: '∞',
};

/** Turn a LaTeX-ish field value into readable plain text. Not for URLs. */
export function cleanLatex(input: string): string {
  return input
    // symbol accents: \'e  \'{e}  \'\i
    .replace(/\\(['`^"~=.])\s*\{?\\?([a-zA-Z])\}?/g, (_m, acc, ch) => ACCENTS[acc]?.[ch] ?? ch)
    // letter accents: \v{s}  \v s  (require braces or a space so \vs isn't eaten)
    .replace(/\\([vcHkur])\s*(?:\{\\?([a-zA-Z])\}|\\?([a-zA-Z])\b)/g, (_m, acc, a, b) => ACCENTS[acc]?.[a ?? b] ?? (a ?? b))
    // standalone special letters
    .replace(/\\(AA|ae|AE|oe|OE|aa|ss|[oOlLij])(?![a-zA-Z])/g, (_m, c) => SPECIAL[c] ?? c)
    // drop math-mode delimiters (keep an escaped \$ for the next step)
    .replace(/(?<!\\)\$/g, '')
    // escaped punctuation
    .replace(/\\([&%_#$])/g, '$1')
    // ties and thin spaces
    .replace(/~|\\[,;: ]/g, ' ')
    // decode known symbols; drop any other control sequence (\emph{X} → X)
    .replace(/\\([a-zA-Z]+)\*?/g, (_m, w) => MATH[w] ?? '')
    // protective / grouping braces
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip a \url{…} wrapper and surrounding braces, de-escape LaTeX-escaped
 * punctuation (DOIs write `\_`), but leave the URL otherwise intact (`~` is
 * a valid URL character, so don't touch it). */
function cleanUrl(input: string): string {
  return input
    .trim()
    .replace(/^\\url\s*\{([^}]*)\}$/, '$1')
    .replace(/^[{"]+|[}"]+$/g, '')
    .replace(/\\([&%_#$])/g, '$1')
    .trim();
}

/**
 * "Last, First and Von Last, First" → "First Last, First Von Last".
 * arXiv already emits "First Last and …"; DBLP appends a "0001"-style
 * disambiguator we drop.
 */
export function normalizeAuthors(raw: string): string {
  return raw
    .split(/\s+and\s+/i)
    .map((name) => {
      const n = name.replace(/\s+\d{4}$/, '').trim();
      if (!n.includes(',')) return n;
      const parts = n.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) return parts[0] ?? '';
      return `${parts.slice(1).join(' ')} ${parts[0]}`.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean)
    .join(', ');
}

// --- entry tokenizer --------------------------------------------------------

interface BibEntry {
  type: string;
  fields: Record<string, string>;
}

/** Read the first non-@comment/@string/@preamble entry as {type, fields}. */
function parseFirstEntry(input: string): BibEntry | null {
  const re = /@(\w+)\s*[{(]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    const openIdx = m.index + m[0].length - 1;
    const open = input[openIdx];
    const close = open === '{' ? '}' : ')';
    const end = findEntryEnd(input, openIdx, open, close);
    if (end < 0) return null;
    return { type, fields: parseFields(input.slice(openIdx + 1, end)) };
  }
  return null;
}

/** Index of the delimiter that closes the entry opened at `startIdx`. */
function findEntryEnd(s: string, startIdx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (open === '{' && depth === 0) return i;
    } else if (ch === close && open === '(' && depth === 0) return i;
  }
  return -1;
}

/** Parse "citekey, name = value, …" (value may be {…}, "…", or bare). */
function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;
  const n = body.length;
  while (i < n && body[i] !== ',') i++; // skip the citekey
  i++;
  while (i < n) {
    while (i < n && /[\s,]/.test(body[i])) i++; // skip separators/whitespace
    let name = '';
    for (; i < n && body[i] !== '=' && body[i] !== ','; i++) name += body[i];
    if (body[i] !== '=') {
      i++;
      continue;
    }
    i++; // skip '='
    while (i < n && /\s/.test(body[i])) i++;
    let val = '';
    if (body[i] === '{') {
      let depth = 0;
      for (; i < n; i++) {
        const ch = body[i];
        if (ch === '{') {
          depth++;
          if (depth === 1) continue;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        val += ch;
      }
    } else if (body[i] === '"') {
      i++;
      let depth = 0;
      for (; i < n; i++) {
        const ch = body[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        else if (ch === '"' && depth === 0) {
          i++;
          break;
        }
        val += ch;
      }
    } else {
      while (i < n && body[i] !== ',') val += body[i++];
    }
    while (i < n && body[i] !== ',') i++;
    i++; // skip the trailing comma
    if (name.trim()) fields[name.trim().toLowerCase()] = val.trim();
  }
  return fields;
}

// --- field → citation mapping -----------------------------------------------

/**
 * Parse a BibTeX string into citation fields. Returns null only when no entry
 * is found; an entry with few recognizable fields returns a sparse object.
 * arXiv ids become an arxiv.org URL (never the IACR `eprint` field); IACR
 * ePrint ids are recovered from howpublished/note/url.
 */
export function parseBibtex(input: string): CitationInput | null {
  const entry = parseFirstEntry(input);
  if (!entry) return null;
  const f = entry.fields;
  const out: CitationInput = {};

  const paper = f.title ? cleanLatex(f.title) : '';
  if (paper) out.paper = paper;

  const authors = f.author ? normalizeAuthors(cleanLatex(f.author)) : '';
  if (authors) out.authors = authors;

  const venue = cleanLatex(f.journal || f.booktitle || f.series || '');
  if (venue) out.venue = venue;

  const yearMatch = (f.year || f.date || '').match(/\d{4}/);
  if (yearMatch) out.year = parseInt(yearMatch[0], 10);

  let url = f.url ? cleanUrl(f.url) : '';
  const note = f.note || '';
  if (!url) {
    const noteUrl = note.match(/\\url\{([^}]+)\}/) || note.match(/https?:\/\/\S+/);
    if (noteUrl) url = (noteUrl[1] ?? noteUrl[0]).replace(/[.,)}]+$/, '');
  }

  // arXiv: the `eprint` field is the arXiv id, NOT an IACR ePrint id.
  const isArxiv = /arxiv/i.test(f.archiveprefix || f.eprinttype || '') || !!f.primaryclass;
  if (isArxiv && f.eprint) {
    const arxivId = cleanLatex(f.eprint);
    if (!url && arxivId) url = `https://arxiv.org/abs/${arxivId}`;
  }

  // IACR ePrint id, from howpublished / note / url (an eprint context + YYYY/N).
  const eprintCtx = `${f.howpublished || ''} ${note} ${url}`;
  if (/eprint\.iacr\.org|eprint archive|cryptology eprint/i.test(eprintCtx)) {
    const id = eprintCtx.match(/(\d{4}\/\d{1,6})/);
    if (id) out.eprint = id[1];
  }

  let doi = f.doi ? cleanLatex(f.doi) : '';
  doi = doi.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)\s*/i, '');
  if (!doi && url) {
    const dm = url.match(/doi\.org\/(10\.\S+)/i);
    if (dm) doi = dm[1];
  }
  if (doi) out.doi = doi;

  if (url) out.url = url;
  return out;
}
