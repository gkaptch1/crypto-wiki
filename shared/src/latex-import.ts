/**
 * Deterministic paper importer (PLAN.md Phase 3, "Import from papers").
 *
 * Pure function over a paper's LaTeX source (one file or a filename→content
 * map): extracts macro declarations into a candidate macro set and
 * definition-like content (theorem-style environments + cryptocode
 * \procedure/\pseudocode game boxes) into import candidates that the editor
 * can turn into draft formulations. No I/O, no network — callers (backend
 * endpoint, import-tests/ corpus harness, tests) hand it file contents.
 *
 * Everything here is best-effort surface parsing of real-world LaTeX, not a
 * TeX engine: unparseable declarations are reported with an `issue` instead
 * of being silently dropped, and nothing is ever auto-published downstream.
 */

import { matchBrace, matchBracket } from './cryptocode-preprocess.js';

// ---------------------------------------------------------------------------
// result shapes

export type MacroKind =
  | 'newcommand'
  | 'renewcommand'
  | 'providecommand'
  | 'DeclareRobustCommand'
  | 'def'
  | 'DeclareMathOperator'
  | 'DeclarePairedDelimiter';

export interface ExtractedMacro {
  /** Control sequence including the backslash, e.g. "\\adv". */
  name: string;
  kind: MacroKind;
  numArgs: number;
  /** Default for a leading optional argument (\newcommand{\f}[2][x]{...}). */
  optionalDefault: string | null;
  /** Replacement text (for DeclareMathOperator: the \operatorname form). */
  body: string;
  file: string;
  /** 1-based line of the declaration in `file`. */
  line: number;
  /**
   * Whether the macro can go into a wiki macro set as-is (KaTeX string
   * macros: plain #1..#n substitution, no optional args, /^\\[a-zA-Z]+$/
   * names). When false, `issue` says why — the import UI surfaces it for
   * human review instead of dropping it.
   */
  katexSafe: boolean;
  issue?: string;
}

export interface TheoremEnvInfo {
  /** Environment name, e.g. "definition". */
  envName: string;
  /** Display name, e.g. "Definition". */
  displayName: string;
  file: string;
  line: number;
  /** Matched the definition-like filter, so its instances were extracted. */
  extracted: boolean;
}

export interface ImportCandidate {
  kind: 'theorem-env' | 'procedure';
  /** "definition", "experiment", ... — or "procedure"/"pseudocode". */
  envName: string;
  /** The env's display name ("Definition"); the header for game boxes. */
  displayName: string;
  /** \begin{definition}[Security of ...] optional title, if present. */
  title: string | null;
  /** First \label{...} inside the body, if any. */
  label: string | null;
  /** Inner LaTeX, trimmed, comments already stripped. */
  body: string;
  file: string;
  line: number;
  /** Extracted macros the body (transitively) uses — the candidate's macro-set slice. */
  usedMacros: string[];
}

export interface LatexImportResult {
  /** Final state of every macro declaration found (last definition wins). */
  macros: ExtractedMacro[];
  /**
   * The katexSafe subset as a wiki MacroMap ({"\\adv": "\\mathcal{A}"}),
   * ready for CreateMacroSetBody.macros after human review.
   */
  macroMap: Record<string, string>;
  /** Every theorem-style environment declared in the source. */
  theoremEnvs: TheoremEnvInfo[];
  candidates: ImportCandidate[];
  /** Files that were scanned, in scan order. */
  scannedFiles: string[];
  warnings: string[];
}

export interface LatexImportOptions {
  /** Entry file; default: every file with a \documentclass (all roots). */
  mainFile?: string;
  /**
   * Theorem environments whose instances become candidates. Default: any
   * env whose name or display name looks definition-like (see
   * DEFINITION_LIKE), plus "definition" itself even when the document class
   * predeclares it (llncs does).
   */
  environments?: string[];
}

/** Env/display names that count as definition-like by default. */
export const DEFINITION_LIKE = /defin|experiment|construct|game|functionality/i;

/** A wiki macro set holds at most this many macros (schemas.MacroMap). */
const MACRO_MAP_MAX = 500;

// ---------------------------------------------------------------------------
// comment / verbatim stripping (line-count preserving)

const BLANKED_ENVS = ['comment', 'verbatim', 'verbatim*', 'lstlisting', 'filecontents', 'filecontents*'];

/** Blank %-comments and verbatim-ish environments, preserving newlines. */
export function stripLatexComments(src: string): string {
  // blank verbatim-ish environments first so % inside them can't confuse
  // the comment pass (and vice versa: a commented \begin{comment} is rare
  // enough to ignore)
  for (const env of BLANKED_ENVS) {
    const begin = `\\begin{${env}}`;
    let at = src.indexOf(begin);
    while (at !== -1) {
      const end = src.indexOf(`\\end{${env}}`, at);
      const stop = end === -1 ? src.length : end + `\\end{${env}}`.length;
      src = src.slice(0, at) + src.slice(at, stop).replace(/[^\n]/g, ' ') + src.slice(stop);
      at = src.indexOf(begin, stop);
    }
  }
  // line-by-line: cut from the first unescaped % (keeps line numbers stable)
  return src
    .split('\n')
    .map((line) => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '\\') i++;
        else if (line[i] === '%') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// small scanning helpers

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
  return line;
}

function skipWs(src: string, i: number): number {
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
}

/** Read `{...}` (balanced) or a single control sequence / char at `i`. */
function readGroup(src: string, i: number): { value: string; next: number } | null {
  i = skipWs(src, i);
  if (src[i] === '{') {
    const close = matchBrace(src, i);
    if (close === -1) return null;
    return { value: src.slice(i + 1, close), next: close + 1 };
  }
  if (src[i] === '\\') {
    const m = /^\\([a-zA-Z@]+|.)/.exec(src.slice(i));
    if (!m) return null;
    return { value: m[0], next: i + m[0].length };
  }
  if (i < src.length) return { value: src[i], next: i + 1 };
  return null;
}

/** Read `[...]` at `i` if present. */
function readOptional(src: string, i: number): { value: string; next: number } | null {
  i = skipWs(src, i);
  if (src[i] !== '[') return null;
  const close = matchBracket(src, i);
  if (close === -1) return null;
  return { value: src.slice(i + 1, close), next: close + 1 };
}

/** Control-sequence name (with backslash) at `i`, e.g. "\\foo" or "\\@bar". */
function readCsName(src: string, i: number): { value: string; next: number } | null {
  i = skipWs(src, i);
  // tolerate a braced name: \newcommand{\foo}
  if (src[i] === '{') {
    const close = matchBrace(src, i);
    if (close === -1) return null;
    const inner = src.slice(i + 1, close).trim();
    if (!/^\\[a-zA-Z@]+$/.test(inner)) return null;
    return { value: inner, next: close + 1 };
  }
  const m = /^\\[a-zA-Z@]+/.exec(src.slice(i));
  if (!m) return null;
  return { value: m[0], next: i + m[0].length };
}

// ---------------------------------------------------------------------------
// macro declarations

const MACRO_DECL_RE =
  /\\(newcommand|renewcommand|providecommand|DeclareRobustCommand|DeclareMathOperator|DeclarePairedDelimiter|def)(?![a-zA-Z])(\*)?/g;

function parseMacroDecls(src: string, file: string, out: Map<string, ExtractedMacro>, warnings: string[]): void {
  MACRO_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MACRO_DECL_RE.exec(src)) !== null) {
    const kind = m[1] as MacroKind;
    const starred = m[2] === '*';
    const declLine = lineOf(src, m.index);
    let i = m.index + m[0].length;

    const nameRead = readCsName(src, i);
    if (!nameRead) continue; // e.g. \def inside prose; nothing parseable
    const name = nameRead.value;
    i = nameRead.next;

    let numArgs = 0;
    let optionalDefault: string | null = null;
    let body = '';
    let katexSafe = true;
    let issue: string | undefined;

    if (kind === 'DeclareMathOperator') {
      const arg = readGroup(src, i);
      if (!arg) continue;
      body = `\\operatorname${starred ? '*' : ''}{${arg.value}}`;
      i = arg.next;
    } else if (kind === 'DeclarePairedDelimiter') {
      const left = readGroup(src, i);
      const right = left && readGroup(src, left.next);
      if (!left || !right) continue;
      numArgs = 1;
      body = `${left.value} #1 ${right.value}`;
      issue = 'paired delimiter: only the unstarred form is transcribed (\\foo* and sizing lost)';
      i = right.next;
    } else if (kind === 'def') {
      // parameter text between the name and the body group
      const bodyStart = src.indexOf('{', i);
      if (bodyStart === -1) continue;
      const paramText = src.slice(i, bodyStart).trim();
      if (/^(#[1-9])*$/.test(paramText.replace(/\s+/g, ''))) {
        numArgs = (paramText.match(/#/g) ?? []).length;
      } else {
        katexSafe = false;
        issue = `\\def with delimited parameters (“${paramText}”) — review manually`;
      }
      const close = matchBrace(src, bodyStart);
      if (close === -1) continue;
      body = src.slice(bodyStart + 1, close).trim();
      i = close + 1;
    } else {
      // newcommand family: [nargs][optional default]{body}
      const nArgsOpt = readOptional(src, i);
      if (nArgsOpt) {
        numArgs = parseInt(nArgsOpt.value.trim(), 10) || 0;
        i = nArgsOpt.next;
        const defOpt = readOptional(src, i);
        if (defOpt) {
          optionalDefault = defOpt.value;
          katexSafe = false;
          issue = `optional argument (default “${defOpt.value}”) — KaTeX macros can't express it`;
          i = defOpt.next;
        }
      }
      const bodyRead = readGroup(src, i);
      if (!bodyRead) {
        warnings.push(`${file}:${declLine} — could not read the body of ${kind} ${name}`);
        continue;
      }
      body = bodyRead.value.trim();
      i = bodyRead.next;
    }

    if (!/^\\[a-zA-Z]+$/.test(name)) {
      katexSafe = false;
      issue = issue ?? 'name is not a plain control word (wiki macro keys must match \\\\[a-zA-Z]+)';
    }
    if (body.length > 2000) {
      katexSafe = false;
      issue = issue ?? `body is ${body.length} chars (wiki macro values cap at 2000)`;
    }

    // LaTeX semantics for repeat declarations: \providecommand keeps an
    // existing definition; everything else overrides.
    if (kind === 'providecommand' && out.has(name)) continue;
    out.set(name, { name, kind, numArgs, optionalDefault, body, file, line: declLine, katexSafe, ...(issue ? { issue } : {}) });

    MACRO_DECL_RE.lastIndex = i;
  }
}

// ---------------------------------------------------------------------------
// theorem-style environment declarations

const THEOREM_DECL_RE = /\\(newtheorem|spnewtheorem|declaretheorem)(?![a-zA-Z])(\*)?/g;

function parseTheoremDecls(src: string, file: string, out: Map<string, TheoremEnvInfo>): void {
  THEOREM_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = THEOREM_DECL_RE.exec(src)) !== null) {
    const kind = m[1];
    const line = lineOf(src, m.index);
    let i = m.index + m[0].length;

    if (kind === 'declaretheorem') {
      // \declaretheorem[name=Definition,...]{definition}
      const opts = readOptional(src, i);
      if (opts) i = opts.next;
      const envRead = readGroup(src, i);
      if (!envRead) continue;
      const envName = envRead.value.trim();
      const nameOpt = opts && /(?:^|,)\s*name\s*=\s*([^,]+)/.exec(opts.value);
      const displayName = nameOpt ? nameOpt[1].trim() : envName.charAt(0).toUpperCase() + envName.slice(1);
      out.set(envName, { envName, displayName, file, line, extracted: false });
      THEOREM_DECL_RE.lastIndex = envRead.next;
      continue;
    }

    // \newtheorem{env}[shared]{Display}[within] / \spnewtheorem{env}{Display}{font}{font}
    const envRead = readGroup(src, i);
    if (!envRead) continue;
    const envName = envRead.value.trim();
    i = envRead.next;
    const shared = kind === 'newtheorem' ? readOptional(src, i) : null;
    if (shared) i = shared.next;
    const displayRead = readGroup(src, i);
    if (!displayRead) continue;
    out.set(envName, { envName, displayName: displayRead.value.trim(), file, line, extracted: false });
    THEOREM_DECL_RE.lastIndex = displayRead.next;
  }
}

// ---------------------------------------------------------------------------
// candidate extraction

interface Span {
  start: number;
  end: number;
}

function extractEnvInstances(
  src: string,
  file: string,
  env: TheoremEnvInfo,
  candidates: ImportCandidate[],
  spans: Span[],
  warnings: string[],
): void {
  const begin = `\\begin{${env.envName}}`;
  const end = `\\end{${env.envName}}`;

  // stack-pair every begin/end so nested same-name environments each become
  // their own candidate (papers do nest definitions — real LaTeX numbers both)
  const tokens: Array<{ at: number; kind: 'begin' | 'end' }> = [];
  for (let at = src.indexOf(begin); at !== -1; at = src.indexOf(begin, at + begin.length))
    tokens.push({ at, kind: 'begin' });
  for (let at = src.indexOf(end); at !== -1; at = src.indexOf(end, at + end.length))
    tokens.push({ at, kind: 'end' });
  tokens.sort((a, b) => a.at - b.at);

  const stack: number[] = [];
  const pairs: Span[] = [];
  for (const t of tokens) {
    if (t.kind === 'begin') stack.push(t.at);
    else if (stack.length > 0) pairs.push({ start: stack.pop()!, end: t.at + end.length });
    // a stray \end with no open \begin is ignored
  }
  for (const open of stack)
    warnings.push(`${file}:${lineOf(src, open)} — \\begin{${env.envName}} without matching \\end`);
  pairs.sort((a, b) => a.start - b.start);

  for (const span of pairs) {
    let bodyStart = span.start + begin.length;
    let title: string | null = null;
    const titleOpt = readOptional(src, bodyStart);
    if (titleOpt) {
      title = titleOpt.value.trim();
      bodyStart = titleOpt.next;
    }
    const body = src.slice(bodyStart, span.end - end.length).trim();
    const label = /\\label\{([^}]*)\}/.exec(body)?.[1] ?? null;

    candidates.push({
      kind: 'theorem-env',
      envName: env.envName,
      displayName: env.displayName,
      title,
      label,
      body,
      file,
      line: lineOf(src, span.start),
      usedMacros: [], // filled in after all macros are known
    });
    spans.push(span);
  }
}

/** \procedure[opts]{header}{body} / \pseudocode[opts]{body} outside theorem envs. */
function extractProcedures(
  src: string,
  file: string,
  candidates: ImportCandidate[],
  coveredSpans: Span[],
): void {
  const re = /\\(procedure|pseudocode)(?![a-zA-Z])\*?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const start = m.index;
    let i = m.index + m[0].length;
    const opt = readOptional(src, i);
    if (opt) i = opt.next;
    const nArgs = m[1] === 'procedure' ? 2 : 1;
    const args: string[] = [];
    while (args.length < nArgs) {
      const g = skipWs(src, i);
      if (src[g] !== '{') break;
      const close = matchBrace(src, g);
      if (close === -1) break;
      args.push(src.slice(g + 1, close));
      i = close + 1;
    }
    if (args.length < nArgs) continue; // malformed or a macro definition's #1 args
    re.lastIndex = i;
    // skip game boxes that already live inside an extracted theorem env
    if (coveredSpans.some((s) => start >= s.start && start < s.end)) continue;
    const header = m[1] === 'procedure' ? args[0].trim() : '';
    candidates.push({
      kind: 'procedure',
      envName: m[1],
      displayName: header || 'pseudocode',
      title: header || null,
      label: null,
      // keep the whole invocation: it IS the renderable body
      body: src.slice(start, i).trim(),
      file,
      line: lineOf(src, start),
      usedMacros: [],
    });
  }
}

// ---------------------------------------------------------------------------
// \input/\include reachability

const INPUT_RE = /\\(?:input|include|subfile|subimport)\s*\{([^}]+)\}/g;

/** \usepackage[opts]{a,b} / \RequirePackage — macro-heavy papers ship .sty files. */
const PACKAGE_RE = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;

function resolveInput(name: string, files: Record<string, string>, exts: string[]): string | null {
  const clean = name.trim().replace(/^\.\//, '');
  for (const cand of [clean, ...exts.map((e) => clean + e)]) {
    if (cand in files) return cand;
  }
  return null;
}

// ---------------------------------------------------------------------------
// used-macro closure

function collectUsedMacros(body: string, macros: Map<string, ExtractedMacro>): string[] {
  const used = new Set<string>();
  const queue = [body];
  while (queue.length > 0) {
    const tex = queue.pop()!;
    for (const cs of tex.match(/\\[a-zA-Z]+/g) ?? []) {
      if (macros.has(cs) && !used.has(cs)) {
        used.add(cs);
        queue.push(macros.get(cs)!.body);
      }
    }
  }
  return [...used].sort();
}

// ---------------------------------------------------------------------------
// entry point

export function extractFromLatex(
  input: string | Record<string, string>,
  options: LatexImportOptions = {},
): LatexImportResult {
  const files: Record<string, string> = typeof input === 'string' ? { 'main.tex': input } : input;
  const warnings: string[] = [];

  // strip comments once, up front (line counts preserved)
  const stripped: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) stripped[name] = stripLatexComments(content);

  // roots: explicit mainFile, else every file with a \documentclass, else all
  let roots: string[];
  if (options.mainFile) {
    if (!(options.mainFile in stripped)) throw new Error(`mainFile ${options.mainFile} not in input files`);
    roots = [options.mainFile];
  } else {
    roots = Object.keys(stripped).filter((f) => stripped[f].includes('\\documentclass'));
    if (roots.length === 0) roots = Object.keys(stripped);
    else if (roots.length > 1) warnings.push(`multiple \\documentclass roots (${roots.join(', ')}) — scanning all of them`);
  }

  // BFS over \input/\include from the roots
  const scanOrder: string[] = [];
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    scanOrder.push(file);
    INPUT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INPUT_RE.exec(stripped[file])) !== null) {
      const resolved = resolveInput(m[1], stripped, ['.tex']);
      if (resolved) queue.push(resolved);
      else warnings.push(`${file} — \\input{${m[1]}} not found in the provided files`);
    }
    // follow \usepackage only into .sty files the paper actually ships;
    // standard packages are expected to be absent (no warning)
    PACKAGE_RE.lastIndex = 0;
    while ((m = PACKAGE_RE.exec(stripped[file])) !== null) {
      for (const pkg of m[1].split(',')) {
        const resolved = resolveInput(pkg, stripped, ['.sty']);
        if (resolved) queue.push(resolved);
      }
    }
  }
  const unreached = Object.keys(stripped).filter(
    (f) => !seen.has(f) && (f.endsWith('.tex') || f.endsWith('.sty')),
  );
  if (unreached.length > 0) warnings.push(`not reachable from ${roots.join(', ')} — skipped: ${unreached.join(', ')}`);

  // pass 1: declarations (macros + theorem envs) across all scanned files
  const macroTable = new Map<string, ExtractedMacro>();
  const theoremTable = new Map<string, TheoremEnvInfo>();
  for (const file of scanOrder) {
    parseMacroDecls(stripped[file], file, macroTable, warnings);
    parseTheoremDecls(stripped[file], file, theoremTable);
  }

  // which envs to extract: explicit list, else definition-like (llncs et al.
  // predeclare `definition`, so it counts even when never \newtheorem'd)
  const wanted = new Set(
    options.environments ??
      [...theoremTable.values()]
        .filter(
          (t) =>
            // env names with @ are package internals (thmtools' rep@definition
            // etc.), never something a document body \begin{...}s directly
            !t.envName.includes('@') &&
            (DEFINITION_LIKE.test(t.envName) || DEFINITION_LIKE.test(t.displayName)),
        )
        .map((t) => t.envName),
  );
  if (!options.environments && !theoremTable.has('definition')) wanted.add('definition');
  for (const env of wanted) {
    if (!theoremTable.has(env)) {
      theoremTable.set(env, {
        envName: env,
        displayName: env.charAt(0).toUpperCase() + env.slice(1),
        file: '',
        line: 0,
        extracted: false,
      });
    }
  }

  // pass 2: candidate extraction
  const candidates: ImportCandidate[] = [];
  for (const file of scanOrder) {
    const spans: Span[] = [];
    for (const envName of wanted) {
      const env = theoremTable.get(envName)!;
      const before = candidates.length;
      extractEnvInstances(stripped[file], file, env, candidates, spans, warnings);
      if (candidates.length > before) env.extracted = true;
    }
    extractProcedures(stripped[file], file, candidates, spans);
  }
  candidates.sort((a, b) => (a.file === b.file ? a.line - b.line : scanOrder.indexOf(a.file) - scanOrder.indexOf(b.file)));

  // used-macro closure per candidate
  for (const c of candidates) c.usedMacros = collectUsedMacros(`${c.title ?? ''} ${c.body}`, macroTable);

  // the katexSafe subset, MacroMap-shaped
  const macroMap: Record<string, string> = {};
  for (const macro of macroTable.values()) {
    if (macro.katexSafe) macroMap[macro.name] = macro.body;
  }
  if (Object.keys(macroMap).length > MACRO_MAP_MAX) {
    warnings.push(
      `${Object.keys(macroMap).length} usable macros, but a wiki macro set holds at most ${MACRO_MAP_MAX} — ` +
        `import per-candidate usedMacros slices instead of the whole preamble`,
    );
  }

  return {
    macros: [...macroTable.values()],
    macroMap,
    theoremEnvs: [...theoremTable.values()].filter((t) => t.file !== '' || t.extracted),
    candidates,
    scannedFiles: scanOrder,
    warnings,
  };
}
