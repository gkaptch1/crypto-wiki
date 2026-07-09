/**
 * katex-cryptocode shim v1: the JS preprocessing pass.
 *
 * Covers the cryptocode constructs that plain KaTeX macros cannot express
 * (PLAN.md "Two-tier rendering"): optional args on \procedure[...], \pcln /
 * [linenumbering] line numbers, \t alignment tabs, \gamechange highlights,
 * \pcind[n], and the pchstack/pcvstack side-by-side layout (parsed here,
 * laid out as flexbox by the fragment renderer).
 *
 * Everything is rewritten into KaTeX-supported markup (nested arrays,
 * \colorbox, \scriptstyle) BEFORE macro expansion, so a viewer's macro set
 * still applies to all the content. Ground truth is real cryptocode via the
 * Tier-2 pipeline; render-tests/ keeps this pass honest.
 *
 * Known limits (Tier-2 escape hatch territory): a pchstack directly inside
 * another pchstack (same-name nesting) is not parsed; macros that themselves
 * expand to \procedure are invisible to this pass.
 */

// ---------------------------------------------------------------------------
// scanning utilities (brace- and environment-aware)

/** Index of the '}' matching the '{' at `open`, or -1. */
export function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      i++; // skip escaped char (\{, \}, \\)
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index of the ']' matching the '[' at `open` (brace-aware), or -1. */
export function matchBracket(src: string, open: number): number {
  let braces = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') i++;
    else if (c === '{') braces++;
    else if (c === '}') braces--;
    else if (c === ']' && braces === 0) return i;
  }
  return -1;
}

/**
 * Split `src` on a separator at top level (outside braces and \begin/\end
 * pairs). `sep` is either the row break `\\` or the cryptocode tab `\t`
 * (matched as a whole command name, so \text/\times are untouched).
 */
function splitTopLevel(src: string, sep: 'rows' | 'tabs'): string[] {
  const parts: string[] = [];
  let cur = '';
  let braces = 0;
  let envs = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') {
      braces++;
      cur += c;
      i++;
    } else if (c === '}') {
      braces--;
      cur += c;
      i++;
    } else if (c === '\\') {
      if (src[i + 1] === '\\') {
        if (sep === 'rows' && braces === 0 && envs === 0) {
          i += 2;
          // swallow an optional row-spacing arg: \\[2pt]
          if (src[i] === '[') {
            const close = matchBracket(src, i);
            if (close !== -1) i = close + 1;
          }
          parts.push(cur);
          cur = '';
        } else {
          cur += '\\\\';
          i += 2;
        }
      } else {
        const m = /^\\[a-zA-Z]+/.exec(src.slice(i));
        if (m) {
          if (m[0] === '\\begin') envs++;
          else if (m[0] === '\\end') envs--;
          if (m[0] === '\\t' && sep === 'tabs' && braces === 0 && envs === 0) {
            parts.push(cur);
            cur = '';
          } else {
            cur += m[0];
          }
          i += m[0].length;
        } else {
          cur += src.slice(i, i + 2); // \$, \{, ... escaped symbol
          i += 2;
        }
      }
    } else {
      cur += c;
      i++;
    }
  }
  parts.push(cur);
  return parts;
}

/** Parse a cryptocode options list `linenumbering, mode=text, width=5cm`. */
function parseOptions(src: string): Map<string, string> {
  const opts = new Map<string, string>();
  for (const part of src.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      const key = part.trim();
      if (key) opts.set(key, 'true');
    } else {
      opts.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// \gamechange highlights

/** cryptocode's default: \definecolor{gamechangecolor}{gray}{0.90}. */
const GAMECHANGE_COLOR = '#e5e5e5';

/** Approximate xcolor names (+ `name!NN` white-dilution) as hex for KaTeX. */
function resolveColor(spec: string): string {
  const named: Record<string, [number, number, number]> = {
    gray: [128, 128, 128],
    lightgray: [191, 191, 191],
    red: [255, 0, 0],
    green: [0, 255, 0],
    blue: [0, 0, 255],
    yellow: [255, 255, 0],
    orange: [255, 165, 0],
    cyan: [0, 255, 255],
  };
  const m = /^([a-zA-Z]+)(?:!(\d+))?$/.exec(spec.trim());
  if (!m || !named[m[1].toLowerCase()]) return GAMECHANGE_COLOR;
  const [r, g, b] = named[m[1].toLowerCase()];
  const pct = m[2] === undefined ? 100 : Math.min(100, parseInt(m[2], 10));
  const mix = (v: number) => Math.round((v * pct + 255 * (100 - pct)) / 100);
  const hex = (v: number) => mix(v).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Rewrite \gamechange[color]{content} to a \colorbox highlight. Mirrors real
 * cryptocode exactly: the content lands in text mode (colorbox is an hbox),
 * so math must carry its own $...$ — \gamechange{$y \sample \bin$} — just as
 * in the cryptocode manual (verified against the Tier-2 pipeline; a bare
 * math body is a "Missing $" error under real cryptocode too).
 */
function rewriteGamechange(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf('\\gamechange', i);
    if (at === -1 || /[a-zA-Z]/.test(src[at + 11] ?? '')) {
      if (at === -1) break;
      out += src.slice(i, at + 11);
      i = at + 11;
      continue;
    }
    out += src.slice(i, at);
    i = at + 11;
    let color = GAMECHANGE_COLOR;
    while (/\s/.test(src[i] ?? '')) i++;
    if (src[i] === '[') {
      const close = matchBracket(src, i);
      color = resolveColor(src.slice(i + 1, close));
      i = close + 1;
      while (/\s/.test(src[i] ?? '')) i++;
    }
    if (src[i] !== '{') {
      out += '\\gamechange'; // malformed; put the command back untouched
      continue;
    }
    const close = matchBrace(src, i);
    const content = src.slice(i + 1, close);
    i = close + 1;
    out += `\\colorbox{${color}}{${content}}`;
  }
  out += src.slice(i);
  return out;
}

// ---------------------------------------------------------------------------
// \procedure / \pseudocode → nested KaTeX arrays

interface PcLine {
  numbered: boolean;
  cells: string[];
}

function parseLines(body: string, autoNumber: boolean): PcLine[] {
  return splitTopLevel(rewriteGamechange(body), 'rows')
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
    .map((row) => {
      let numbered = autoNumber;
      if (/^\\pcln(?![a-zA-Z])/.test(row)) {
        numbered = true;
        row = row.slice(5).trim();
      } else if (/^\\pclnomit(?![a-zA-Z])/.test(row)) {
        numbered = false;
        row = row.slice(9).trim();
      }
      return { numbered, cells: splitTopLevel(row, 'tabs').map((c) => c.trim()) };
    });
}

function buildCodeArray(lines: PcLine[], textMode: boolean): string {
  const numbering = lines.some((l) => l.numbered);
  const nCols = Math.max(1, ...lines.map((l) => l.cells.length));
  let counter = 0;
  const rows = lines.map((line) => {
    const cells = line.cells.map((c) => (textMode && c ? `\\text{${c}}` : c));
    while (cells.length < nCols) cells.push('');
    // cryptocode typesets \text{\scriptsize N}: — match it (resets per box)
    if (numbering) cells.unshift(line.numbered ? `\\text{\\scriptsize ${++counter}:}` : '');
    return cells.join(' & ');
  });
  const spec = (numbering ? 'r' : '') + 'l'.repeat(nCols);
  // single plain column: skip the inner array so simple boxes stay v0-shaped
  if (spec === 'l') return rows.join(' \\\\ ');
  return `\\begin{array}{${spec}} ${rows.join(' \\\\ ')} \\end{array}`;
}

/** The game box: header line, rule, code — all KaTeX-supported. */
function buildProcedure(header: string, body: string, opts: Map<string, string>): string {
  const code = buildCodeArray(
    parseLines(body, opts.has('linenumbering')),
    opts.get('mode') === 'text',
  );
  if (!header.trim()) return `\\begin{array}{l} ${code} \\end{array}`;
  return `\\begin{array}{l}\\text{${header}}\\\\[0.2em]\\hline\\\\[-0.6em] ${code} \\end{array}`;
}

/** Rewrite every \procedure[opts]{header}{body} / \pseudocode[opts]{body}. */
function rewriteProcedures(src: string): string {
  const re = /\\(procedure|pseudocode)(?![a-zA-Z])\*?/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length;
    let opts = new Map<string, string>();
    while (/\s/.test(src[i] ?? '')) i++;
    if (src[i] === '[') {
      const close = matchBracket(src, i);
      if (close === -1) continue;
      opts = parseOptions(src.slice(i + 1, close));
      i = close + 1;
      while (/\s/.test(src[i] ?? '')) i++;
    }
    const args: string[] = [];
    const nArgs = m[1] === 'procedure' ? 2 : 1;
    while (args.length < nArgs && src[i] === '{') {
      const close = matchBrace(src, i);
      if (close === -1) break;
      args.push(src.slice(i + 1, close));
      i = close + 1;
      if (args.length < nArgs) while (/\s/.test(src[i] ?? '')) i++;
    }
    if (args.length < nArgs) continue; // malformed; leave as-is for KaTeX to flag
    out += src.slice(last, m.index);
    out += m[1] === 'procedure' ? buildProcedure(args[0], args[1], opts) : buildProcedure('', args[0], opts);
    last = i;
    re.lastIndex = i;
  }
  return out + src.slice(last);
}

// ---------------------------------------------------------------------------

/**
 * The full preprocessing pass over one math segment. Idempotent on output
 * (the rewritten markup contains none of the rewritten commands).
 */
export function preprocessCryptocode(tex: string): string {
  if (!/\\(procedure|pseudocode|gamechange|pcind\[)/.test(tex)) return tex;
  let out = tex.replace(/\\pcind\[(\d+)\]/g, (_, n) => '\\quad'.repeat(parseInt(n, 10)));
  out = rewriteProcedures(out);
  return rewriteGamechange(out); // highlights outside any procedure
}

// ---------------------------------------------------------------------------
// pchstack / pcvstack — parsed here, rendered as flexbox by latex-render

export type StackNode =
  | { kind: 'stack'; direction: 'h' | 'v'; center: boolean; items: StackNode[] }
  | { kind: 'space' }
  | { kind: 'math'; tex: string };

/**
 * Parse the content of a stack environment (or a center block holding
 * procedures) into layout items: procedures/pseudocode blocks, nested
 * pc{h,v}stack environments, \pchspace/\pcvspace gaps, raw math chunks.
 */
export function parseStackContent(src: string): StackNode[] {
  const items: StackNode[] = [];
  let raw = '';
  const flushRaw = () => {
    if (raw.trim()) items.push({ kind: 'math', tex: raw.trim() });
    raw = '';
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m = /^\\begin\{(pchstack|pcvstack)\}(\[[^\]]*\])?/.exec(rest);
    if (m) {
      const env = m[1];
      const end = rest.indexOf(`\\end{${env}}`);
      if (end !== -1) {
        flushRaw();
        items.push({
          kind: 'stack',
          direction: env === 'pchstack' ? 'h' : 'v',
          center: (m[2] ?? '').includes('center'),
          items: parseStackContent(rest.slice(m[0].length, end)),
        });
        i += end + `\\end{${env}}`.length;
        continue;
      }
    }
    m = /^\\(pchspace|pcvspace)(?![a-zA-Z])(\[[^\]]*\])?/.exec(rest);
    if (m) {
      flushRaw();
      items.push({ kind: 'space' });
      i += m[0].length;
      continue;
    }
    m = /^\\(procedure|pseudocode)(?![a-zA-Z])/.exec(rest);
    if (m) {
      // capture the whole command (opts + args) as one math item
      let j = m[0].length;
      while (/\s/.test(rest[j] ?? '')) j++;
      if (rest[j] === '[') {
        const close = matchBracket(rest, j);
        if (close === -1) { raw += rest[i]; i++; continue; }
        j = close + 1;
        while (/\s/.test(rest[j] ?? '')) j++;
      }
      let ok = true;
      for (let n = 0; n < (m[1] === 'procedure' ? 2 : 1); n++) {
        while (/\s/.test(rest[j] ?? '')) j++;
        if (rest[j] !== '{') { ok = false; break; }
        const close = matchBrace(rest, j);
        if (close === -1) { ok = false; break; }
        j = close + 1;
      }
      if (ok) {
        flushRaw();
        items.push({ kind: 'math', tex: rest.slice(0, j) });
        i += j;
        continue;
      }
    }
    raw += src[i];
    i++;
  }
  flushRaw();
  return items;
}

/** Does this fragment need stack/procedure layout (vs plain display math)? */
export function hasStructuralCryptocode(src: string): boolean {
  return /\\(procedure|pseudocode)(?![a-zA-Z])|\\begin\{pc[hv]stack\}/.test(src);
}
