import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { CitationInput, CitationLookupBody, ImportScanResult } from '@crypto-wiki/shared';
import {
  createDefinition,
  createFormulation,
  createMacroName,
  createRevision,
  getDefinitions,
  getMacroNames,
  importScan,
  lookupCitation,
} from '../api/definitions';
import { ApiRequestError } from '../api/client';
import RequireEditor from '../components/RequireEditor';
import LatexView from '../components/LatexView';

// Paper importer (PLAN.md Phase 3), the scan-then-select flow:
// 1. submit LaTeX source (arXiv id / uploaded files / paste) → the backend
//    runs the deterministic extractor and returns candidates — nothing is
//    created by scanning;
// 2. pick candidates, name them, review each one's macro slice (registered
//    names become the revision's shared symbols, everything else its sealed
//    local macros; renames rewrite the body, e.g. a paper's \enc that means
//    encode → \encode), and import: each candidate becomes a DRAFT revision
//    carrying its own macros. Nothing is ever auto-published.

export const Route = createFileRoute('/import')({
  component: () => (
    <RequireEditor>
      <ImportPage />
    </RequireEditor>
  ),
});

type Candidate = ImportScanResult['candidates'][number];

interface Pick {
  defSlug: string;
  title: string;
  fSlug: string;
  /** original macro name → name to import as (identity entries omitted). */
  renames: Record<string, string>;
}

interface ItemResult {
  ok: boolean;
  message?: string;
}

const slugify = (s: string, fallback: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '') || fallback;

/** Accept a bare id, arXiv URL, or "arXiv:..." prefix. */
function parseArxivId(input: string): string | null {
  const m = input
    .trim()
    .match(/(?:arxiv\.org\/(?:abs|e-print|pdf)\/|^arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i);
  return m ? m[1] : null;
}

/** Accept "2024/235", an ePrint URL, or "ePrint 2024/235". */
function parseEprintId(input: string): string | null {
  const m = input.trim().match(/(\d{4}\/\d{1,6})/);
  return m ? m[1] : null;
}

/** File → base64 without blowing the call stack on multi-MB PDFs. */
async function pdfToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Replace every \old with \new in a body, without eating longer names (\enc vs \encode). */
function renameMacroInBody(body: string, from: string, to: string): string {
  const escaped = from.replace(/\\/g, '\\\\');
  return body.replace(new RegExp(`${escaped}(?![a-zA-Z])`, 'g'), to);
}

const MACRO_NAME_RE = /^\\[a-zA-Z]+$/;

const EMPTY_CITATION = { paper: '', authors: '', venue: '', year: '', doi: '', eprint: '', url: '' };

/** A pasted BibTeX entry (starts with @) vs a DBLP key/URL. */
function lookupInputFor(raw: string): CitationLookupBody | null {
  const s = raw.trim();
  if (!s) return null;
  return s.startsWith('@') ? { bibtex: s } : { dblpKey: s };
}

const inputCls = 'mt-1 w-full border border-gray-300 rounded px-2 py-1.5';
const monoInputCls = `${inputCls} font-mono`;
const buttonCls = 'bg-black text-white rounded px-4 py-2 text-sm disabled:opacity-50';

function ImportPage() {
  const queryClient = useQueryClient();
  const defs = useQuery({ queryKey: ['definitions', '', ''], queryFn: () => getDefinitions() });
  const registry = useQuery({ queryKey: ['macro-names'], queryFn: getMacroNames });
  const registered = useMemo(
    () => new Map((registry.data ?? []).map((n) => [n.name, n.description])),
    [registry.data],
  );

  // ---- step 1: source input
  const [mode, setMode] = useState<'arxiv' | 'pdf' | 'upload' | 'paste'>('arxiv');
  const [arxivInput, setArxivInput] = useState('');
  const [pasted, setPasted] = useState('');
  const [uploaded, setUploaded] = useState<Record<string, string>>({});
  const [eprintInput, setEprintInput] = useState('');
  const [pdfFile, setPdfFile] = useState<{ name: string; base64: string } | null>(null);
  const [pdfMode, setPdfMode] = useState<'full' | 'guided'>('guided');
  const [scanError, setScanError] = useState<string | null>(null);

  // ---- step 2: scan result + selection
  const [scan, setScan] = useState<ImportScanResult | null>(null);
  const [source, setSource] = useState('');
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [citation, setCitation] = useState(EMPTY_CITATION);
  const [citeLookup, setCiteLookup] = useState('');
  const [results, setResults] = useState<Record<number, ItemResult>>({});

  // Fill only the fields the lookup found, leaving anything the user already typed.
  const applyCitation = (c: CitationInput) =>
    setCitation((prev) => ({
      paper: c.paper ?? prev.paper,
      authors: c.authors ?? prev.authors,
      venue: c.venue ?? prev.venue,
      year: c.year != null ? String(c.year) : prev.year,
      doi: c.doi ?? prev.doi,
      eprint: c.eprint ?? prev.eprint,
      url: c.url ?? prev.url,
    }));

  const citationMut = useMutation({
    mutationFn: (body: CitationLookupBody) => lookupCitation(body),
    onSuccess: (res) => applyCitation(res.citation),
  });

  const scanMut = useMutation({
    mutationFn: () => {
      if (mode === 'arxiv') {
        const id = parseArxivId(arxivInput);
        if (!id) throw new Error('Not a recognizable arXiv id or URL.');
        return importScan({ arxivId: id });
      }
      if (mode === 'pdf') {
        if (pdfFile) return importScan({ pdfBase64: pdfFile.base64, pdfName: pdfFile.name, pdfMode });
        const id = parseEprintId(eprintInput);
        if (!id) throw new Error('Not a recognizable ePrint id or URL (e.g. 2024/235).');
        return importScan({ eprintId: id, pdfMode });
      }
      const files = mode === 'paste' ? { 'main.tex': pasted } : uploaded;
      if (Object.keys(files).length === 0 || (mode === 'paste' && !pasted.trim())) {
        throw new Error(mode === 'paste' ? 'Paste some LaTeX first.' : 'Add at least one file.');
      }
      return importScan({ files });
    },
    onSuccess: (result) => {
      const arxId = mode === 'arxiv' ? parseArxivId(arxivInput) : null;
      const epId = mode === 'pdf' && !pdfFile ? parseEprintId(eprintInput) : null;
      setScan(result);
      setSource(
        arxId
          ? `arXiv:${arxId}`
          : epId
            ? `ePrint ${epId}`
            : mode === 'pdf'
              ? `${pdfFile?.name ?? 'uploaded PDF'} (LLM extraction)`
              : 'uploaded source',
      );
      setPicks({});
      setExpanded({});
      setResults({});
      setCitation(EMPTY_CITATION);
      setCiteLookup('');
      // Auto-fetch the citation for a known id; pasted/uploaded imports use the
      // "Look up citation" box below instead.
      if (arxId) citationMut.mutate({ arxivId: arxId });
      else if (epId) citationMut.mutate({ eprintId: epId });
    },
    onError: (err) => setScanError(err.message),
  });

  const selected = useMemo(
    () =>
      Object.entries(picks).map(([i, pick]) => ({
        index: Number(i),
        pick,
        candidate: scan!.candidates[Number(i)],
      })),
    [picks, scan],
  );

  const existingSlugs = useMemo(() => new Set((defs.data ?? []).map((d) => d.slug)), [defs.data]);

  function togglePick(index: number, candidate: Candidate) {
    setPicks((prev) => {
      if (index in prev) {
        const next = { ...prev };
        delete next[index];
        return next;
      }
      const title = candidate.title ?? '';
      const base = title || candidate.label?.replace(/^[a-z]+:/i, '') || '';
      return {
        ...prev,
        [index]: {
          defSlug: slugify(base, `${candidate.envName}-${index + 1}`),
          title,
          fSlug: 'imported',
          renames: {},
        },
      };
    });
  }

  const setPick = (index: number, patch: Partial<Pick>) =>
    setPicks((prev) => ({ ...prev, [index]: { ...prev[index], ...patch } }));

  /** The candidate's definable macro slice, with renames applied and classified. */
  function candidateMacroPlan(candidate: Candidate, pick: Pick) {
    const rows = candidate.usedMacros
      .filter((n) => n in scan!.macroMap)
      .map((orig) => {
        const target = pick.renames[orig] ?? orig;
        const valid = MACRO_NAME_RE.test(target);
        return {
          orig,
          target,
          valid,
          shared: valid && registered.has(target),
          description: registered.get(target),
        };
      });
    const undefinable = candidate.usedMacros.filter((n) => !(n in scan!.macroMap));
    return { rows, undefinable };
  }

  const importMut = useMutation({
    mutationFn: async () => {
      const cite: CitationInput = {};
      if (citation.paper.trim()) cite.paper = citation.paper.trim();
      if (citation.authors.trim()) cite.authors = citation.authors.trim();
      if (citation.venue.trim()) cite.venue = citation.venue.trim();
      if (citation.eprint.trim()) cite.eprint = citation.eprint.trim();
      if (citation.doi.trim()) cite.doi = citation.doi.trim();
      if (citation.url.trim()) cite.url = citation.url.trim();
      const year = parseInt(citation.year, 10);
      if (!Number.isNaN(year)) cite.year = year;

      const itemResults: Record<number, ItemResult> = {};
      const created = new Set<string>();
      for (const { index, pick, candidate } of selected) {
        if (results[index]?.ok) continue; // already imported in a previous run
        try {
          const { rows } = candidateMacroPlan(candidate, pick);
          let body = candidate.body;
          const macros: Record<string, string> = {};
          const localMacros: Record<string, string> = {};
          for (const row of rows) {
            if (row.target !== row.orig) body = renameMacroInBody(body, row.orig, row.target);
            (row.shared ? macros : localMacros)[row.target] = scan!.macroMap[row.orig];
          }

          if (!existingSlugs.has(pick.defSlug) && !created.has(pick.defSlug)) {
            try {
              await createDefinition({ slug: pick.defSlug, title: pick.title });
            } catch (err) {
              // raced/stale list: slug already exists → just add the formulation
              if (!(err instanceof ApiRequestError && err.code === 'SLUG_TAKEN')) throw err;
            }
            created.add(pick.defSlug);
          }
          await createFormulation(pick.defSlug, { slug: pick.fSlug, citation: cite });
          await createRevision(pick.defSlug, pick.fSlug, {
            bodyLatex: body,
            commentaryMd: `*Imported from ${source} (\`${
              scan!.llm ? `${candidate.file} p.${candidate.line}` : `${candidate.file}:${candidate.line}`
            }\`).*`,
            macros,
            localMacros,
          });
          itemResults[index] = { ok: true };
        } catch (err) {
          itemResults[index] = {
            ok: false,
            message: err instanceof ApiRequestError ? err.message : 'Import failed.',
          };
        }
      }
      return itemResults;
    },
    onSuccess: (itemResults) => {
      setResults((prev) => ({ ...prev, ...itemResults }));
      queryClient.invalidateQueries({ queryKey: ['definitions'] });
    },
  });

  const registerName = useMutation({
    mutationFn: (name: string) => {
      const description = window.prompt(
        `Register ${name} in the site's macro-name registry.\n\nOne-line meaning (e.g. "Encoder of a code"):`,
      );
      if (!description?.trim()) return Promise.reject(new Error('cancelled'));
      return createMacroName({ name, description: description.trim() });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['macro-names'] }),
  });

  async function onFiles(list: FileList | null) {
    if (!list) return;
    const next = { ...uploaded };
    for (const file of Array.from(list)) next[file.name] = await file.text();
    setUploaded(next);
  }

  const doneCount = Object.values(results).filter((r) => r.ok).length;
  const importable = selected.filter(({ index }) => !results[index]?.ok);
  const hasInvalidRename = importable.some(({ pick, candidate }) =>
    candidateMacroPlan(candidate, pick).rows.some((r) => !r.valid),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Import from a paper</h1>
        <p className="text-sm text-gray-600 mt-1">
          Scan LaTeX source for definition-like environments and game boxes, then choose what to
          pull in. Each import lands as a <em>draft</em> carrying its own macros — nothing is
          published by importing.
        </p>
      </div>

      {/* ------------------------------------------------ step 1: source */}
      <section className="border border-gray-200 rounded-lg p-4 space-y-3 max-w-2xl">
        <div className="flex gap-1 text-sm">
          {(
            [
              ['arxiv', 'arXiv id'],
              ['pdf', 'ePrint / PDF (LLM)'],
              ['upload', 'Upload .tex files'],
              ['paste', 'Paste LaTeX'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded px-3 py-1.5 border ${
                mode === m ? 'border-black font-semibold' : 'border-gray-200 text-gray-600 hover:border-gray-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'arxiv' && (
          <label className="block text-sm">
            arXiv id or URL (ePrint has no source downloads — for ePrint-only papers, paste or
            upload your own .tex)
            <input
              className={monoInputCls}
              placeholder="2402.09370 or https://arxiv.org/abs/2402.09370"
              value={arxivInput}
              onChange={(e) => setArxivInput(e.target.value)}
            />
          </label>
        )}

        {mode === 'pdf' && (
          <div className="space-y-2 text-sm">
            <label className="block">
              ePrint id or URL (the server fetches the PDF)
              <input
                className={monoInputCls}
                placeholder="2024/235 or https://eprint.iacr.org/2024/235"
                value={eprintInput}
                onChange={(e) => setEprintInput(e.target.value)}
              />
            </label>
            <div>
              …or upload a PDF:{' '}
              <input
                type="file"
                accept=".pdf,application/pdf"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  setPdfFile(f ? { name: f.name, base64: await pdfToBase64(f) } : null);
                }}
              />
              {pdfFile && (
                <span className="text-gray-600">
                  {pdfFile.name}{' '}
                  <button type="button" className="underline" onClick={() => setPdfFile(null)}>
                    clear
                  </button>
                </span>
              )}
            </div>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={pdfMode === 'guided'}
                onChange={(e) => setPdfMode(e.target.checked ? 'guided' : 'full')}
              />
              <span>
                Guided mode: send only the pages where a text scan finds candidate headings —
                much cheaper on long papers, but misses blocks the text layer can't see.
              </span>
            </label>
            <p className="text-gray-500">
              PDF extraction reconstructs LaTeX with an LLM (the PDF is sent to the Anthropic
              API); a scan takes a few minutes and costs tokens. Everything still lands as
              drafts for review.
            </p>
          </div>
        )}

        {mode === 'upload' && (
          <div className="space-y-2 text-sm">
            <input
              type="file"
              multiple
              accept=".tex,.sty,.cls,.ltx,.clo,.def,.bbl"
              onChange={(e) => onFiles(e.target.files)}
            />
            {Object.keys(uploaded).length > 0 && (
              <p className="text-gray-600">
                {Object.keys(uploaded).length} file(s): {Object.keys(uploaded).join(', ')}{' '}
                <button type="button" className="underline" onClick={() => setUploaded({})}>
                  clear
                </button>
              </p>
            )}
            <p className="text-gray-500">
              Include the main file and anything it <code>\input</code>s (macros.tex etc.).
            </p>
          </div>
        )}

        {mode === 'paste' && (
          <label className="block text-sm">
            LaTeX source (preamble + body; macros are picked up from what you paste)
            <textarea
              className={`${monoInputCls} h-48`}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
          </label>
        )}

        {scanError && <p className="text-sm text-red-600">{scanError}</p>}
        <button
          type="button"
          className={buttonCls}
          disabled={scanMut.isPending}
          onClick={() => {
            setScanError(null);
            scanMut.mutate();
          }}
        >
          {scanMut.isPending
            ? mode === 'pdf'
              ? 'Scanning with LLM (can take minutes)…'
              : 'Scanning…'
            : 'Scan'}
        </button>
      </section>

      {/* ------------------------------------------- step 2: select & import */}
      {scan && (
        <section className="space-y-4">
          <div className="text-sm text-gray-600">
            Scanned <strong>{scan.scannedFiles.length}</strong> file(s) from {source}:{' '}
            <strong>{scan.candidates.length}</strong> candidate(s),{' '}
            <strong>{scan.macros.length}</strong> macros ({Object.keys(scan.macroMap).length}{' '}
            usable as-is).
            {scan.llm && (
              <>
                {' '}
                LLM: <strong>{scan.llm.model}</strong> ({scan.llm.mode} mode),{' '}
                {scan.llm.inputTokens.toLocaleString()} in /{' '}
                {scan.llm.outputTokens.toLocaleString()} out tokens ≈ $
                {scan.llm.estimatedCostUsd.toFixed(2)}.
              </>
            )}
          </div>

          {scan.warnings.length > 0 && (
            <ul className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 space-y-1">
              {scan.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}

          {scan.candidates.length === 0 && (
            <p className="text-gray-600">
              No definition-like environments or game boxes found. If the paper states its
              definitions in prose, create them by hand in the{' '}
              <Link to="/editor" className="text-blue-700 underline">
                editor
              </Link>
              .
            </p>
          )}

          <ul className="space-y-2">
            {scan.candidates.map((candidate, index) => {
              const pick = picks[index];
              const result = results[index];
              const plan = pick ? candidateMacroPlan(candidate, pick) : null;
              return (
                <li key={index} className="border border-gray-200 rounded-lg">
                  <div className="flex items-baseline gap-3 px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={!!pick}
                      disabled={!!result?.ok}
                      onChange={() => togglePick(index, candidate)}
                    />
                    <span className="font-medium">
                      {candidate.displayName}
                      {candidate.title && candidate.title !== candidate.displayName && (
                        <span className="font-normal"> — {candidate.title}</span>
                      )}
                    </span>
                    <span className="text-xs rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                      {candidate.kind === 'procedure' ? 'game box' : candidate.envName}
                    </span>
                    <span className="ml-auto text-xs text-gray-500 font-mono">
                      {scan.llm
                        ? `${candidate.file} p.${candidate.line}`
                        : `${candidate.file}:${candidate.line}`}
                    </span>
                    <span className="text-xs text-gray-500">
                      {candidate.usedMacros.length} macro{candidate.usedMacros.length === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      className="text-xs underline text-gray-600"
                      onClick={() => setExpanded((p) => ({ ...p, [index]: !p[index] }))}
                    >
                      {expanded[index] ? 'hide' : 'preview'}
                    </button>
                  </div>

                  {expanded[index] && (
                    <div className="border-t border-gray-100 px-4 py-3 grid gap-4 md:grid-cols-2">
                      <LatexView
                        body={candidate.body}
                        macros={Object.fromEntries(
                          candidate.usedMacros
                            .filter((n) => n in scan.macroMap)
                            .map((n) => [n, scan.macroMap[n]]),
                        )}
                        className="min-w-0 overflow-x-auto"
                      />
                      <pre className="min-w-0 overflow-x-auto text-xs bg-gray-50 rounded p-2 whitespace-pre-wrap">
                        {candidate.body}
                      </pre>
                    </div>
                  )}

                  {pick && !result?.ok && (
                    <div className="border-t border-gray-100 px-4 py-3 space-y-3 text-sm bg-gray-50/50">
                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="block">
                          Definition title
                          <input
                            className={inputCls}
                            value={pick.title}
                            placeholder="Pseudorandom Function"
                            onChange={(e) => setPick(index, { title: e.target.value })}
                          />
                        </label>
                        <label className="block">
                          Definition slug
                          <input
                            className={monoInputCls}
                            value={pick.defSlug}
                            onChange={(e) => setPick(index, { defSlug: e.target.value })}
                          />
                          {existingSlugs.has(pick.defSlug) && (
                            <span className="text-xs text-blue-700">
                              exists — will add a formulation to it
                            </span>
                          )}
                        </label>
                        <label className="block">
                          Formulation slug
                          <input
                            className={monoInputCls}
                            value={pick.fSlug}
                            onChange={(e) => setPick(index, { fSlug: e.target.value })}
                          />
                        </label>
                      </div>

                      {plan && plan.rows.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-gray-600">
                            Macros this candidate carries — registered names become shared symbols
                            (notation sets can restyle them), the rest stay local (sealed). Rename
                            to fix semantics, e.g. a paper's <code>\enc</code> that means encode →{' '}
                            <code>\encode</code>.
                          </p>
                          {plan.rows.map((row) => (
                            <div key={row.orig} className="flex items-center gap-2 text-xs">
                              <code className="w-28 shrink-0">{row.orig}</code>
                              <span className="text-gray-400">import as</span>
                              <input
                                className={`border rounded px-1.5 py-0.5 font-mono w-32 ${
                                  row.valid ? 'border-gray-300' : 'border-red-500'
                                }`}
                                value={row.target}
                                onChange={(e) =>
                                  setPick(index, {
                                    renames: { ...pick.renames, [row.orig]: e.target.value },
                                  })
                                }
                              />
                              {row.shared ? (
                                <span className="rounded bg-green-100 text-green-800 px-1.5 py-0.5">
                                  shared — {row.description}
                                </span>
                              ) : (
                                <>
                                  <span className="rounded bg-gray-200 text-gray-700 px-1.5 py-0.5">
                                    local (sealed)
                                  </span>
                                  {row.valid && (
                                    <button
                                      type="button"
                                      className="underline text-gray-500"
                                      onClick={() => registerName.mutate(row.target)}
                                    >
                                      register as shared…
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          ))}
                          {plan.undefinable.length > 0 && (
                            <p className="text-xs text-amber-700">
                              Used but not importable as-is (define by hand in the editor):{' '}
                              <span className="font-mono">{plan.undefinable.join(' ')}</span>
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {result && (
                    <div
                      className={`border-t border-gray-100 px-4 py-2 text-sm ${
                        result.ok ? 'text-green-700' : 'text-red-600'
                      }`}
                    >
                      {result.ok ? (
                        <>
                          ✓ Imported as draft —{' '}
                          <Link
                            to="/editor/$defSlug"
                            params={{ defSlug: picks[index].defSlug }}
                            className="underline"
                          >
                            open in editor
                          </Link>
                        </>
                      ) : (
                        <>✗ {result.message}</>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {selected.length > 0 && (
            <div className="border border-gray-200 rounded-lg p-4 space-y-3 max-w-2xl">
              <h2 className="font-semibold">Import {importable.length} selected as drafts</h2>

              <p className="text-xs text-gray-600">
                The same citation is stamped on every formulation you import.
                {citationMut.isPending && ' Looking up citation…'}
                {!citationMut.isPending && citationMut.data && (
                  <span className="text-green-700"> Prefilled from {citationMut.data.source}.</span>
                )}
                {citationMut.isError && (
                  <span className="text-amber-700">
                    {' '}
                    Couldn’t fetch a citation automatically ({(citationMut.error as Error).message}) — paste
                    BibTeX or fill the fields below.
                  </span>
                )}
              </p>

              {/* Manual citation source: pasted BibTeX or a DBLP key (arXiv/ePrint
                  scans prefill automatically above). */}
              <div className="flex gap-2 items-start">
                <textarea
                  className={`${monoInputCls} h-16 text-xs`}
                  placeholder="Paste a BibTeX entry, or a DBLP key / URL (e.g. conf/crypto/GoelGHK22)…"
                  value={citeLookup}
                  onChange={(e) => setCiteLookup(e.target.value)}
                />
                <button
                  type="button"
                  className="shrink-0 border border-gray-300 rounded px-3 py-1.5 text-sm hover:border-black disabled:opacity-50"
                  disabled={citationMut.isPending || !lookupInputFor(citeLookup)}
                  onClick={() => {
                    const body = lookupInputFor(citeLookup);
                    if (body) citationMut.mutate(body);
                  }}
                >
                  Look up
                </button>
              </div>

              <fieldset className="grid gap-3 md:grid-cols-2 text-sm">
                <label className="block md:col-span-2">
                  Paper title
                  <input
                    className={inputCls}
                    value={citation.paper}
                    onChange={(e) => setCitation({ ...citation, paper: e.target.value })}
                  />
                </label>
                <label className="block">
                  Authors
                  <input
                    className={inputCls}
                    value={citation.authors}
                    onChange={(e) => setCitation({ ...citation, authors: e.target.value })}
                  />
                </label>
                <label className="block">
                  Venue
                  <input
                    className={inputCls}
                    value={citation.venue}
                    onChange={(e) => setCitation({ ...citation, venue: e.target.value })}
                  />
                </label>
                <label className="block">
                  Year
                  <input
                    className={inputCls}
                    value={citation.year}
                    onChange={(e) => setCitation({ ...citation, year: e.target.value })}
                  />
                </label>
                <label className="block">
                  Paper URL (link on the definition page)
                  <input
                    className={monoInputCls}
                    value={citation.url}
                    onChange={(e) => setCitation({ ...citation, url: e.target.value })}
                  />
                </label>
                <label className="block">
                  ePrint id (e.g. 2024/235)
                  <input
                    className={monoInputCls}
                    value={citation.eprint}
                    onChange={(e) => setCitation({ ...citation, eprint: e.target.value })}
                  />
                </label>
                <label className="block">
                  DOI
                  <input
                    className={monoInputCls}
                    value={citation.doi}
                    onChange={(e) => setCitation({ ...citation, doi: e.target.value })}
                  />
                </label>
              </fieldset>

              {doneCount > 0 && (
                <p className="text-sm text-green-700">
                  {doneCount} draft(s) imported — find them under{' '}
                  <Link to="/editor" className="underline">
                    Editor
                  </Link>
                  .
                </p>
              )}

              <button
                type="button"
                className={buttonCls}
                disabled={
                  importMut.isPending ||
                  importable.length === 0 ||
                  hasInvalidRename ||
                  importable.some(({ pick }) => !pick.title.trim() || !pick.defSlug || !pick.fSlug)
                }
                onClick={() => importMut.mutate()}
              >
                {importMut.isPending ? 'Importing…' : `Import ${importable.length} as drafts`}
              </button>
              {importable.some(({ pick }) => !pick.title.trim()) && (
                <p className="text-xs text-gray-500">
                  Every selected candidate needs a definition title.
                </p>
              )}
              {hasInvalidRename && (
                <p className="text-xs text-red-600">
                  Macro names must look like <code>\name</code> (letters only).
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
