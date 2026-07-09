import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { CitationInput, ImportScanResult, MacroSetVisibility } from '@crypto-wiki/shared';
import {
  createDefinition,
  createFormulation,
  createMacroSet,
  createRevision,
  getDefinitions,
  importScan,
} from '../api/definitions';
import { ApiRequestError } from '../api/client';
import RequireEditor from '../components/RequireEditor';
import LatexView from '../components/LatexView';

// Paper importer (PLAN.md Phase 3), the scan-then-select flow:
// 1. submit LaTeX source (arXiv id / uploaded files / paste) → the backend
//    runs the deterministic extractor and returns candidates — nothing is
//    created by scanning;
// 2. pick candidates, name them, and import: each becomes a DRAFT revision
//    in a new or existing definition via the ordinary editor endpoints, with
//    the combined used-macro slices offered as a macro set. Nothing is ever
//    auto-published.

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

const inputCls = 'mt-1 w-full border border-gray-300 rounded px-2 py-1.5';
const monoInputCls = `${inputCls} font-mono`;
const buttonCls = 'bg-black text-white rounded px-4 py-2 text-sm disabled:opacity-50';

function ImportPage() {
  const queryClient = useQueryClient();
  const defs = useQuery({ queryKey: ['definitions', '', ''], queryFn: () => getDefinitions() });

  // ---- step 1: source input
  const [mode, setMode] = useState<'arxiv' | 'upload' | 'paste'>('arxiv');
  const [arxivInput, setArxivInput] = useState('');
  const [pasted, setPasted] = useState('');
  const [uploaded, setUploaded] = useState<Record<string, string>>({});
  const [scanError, setScanError] = useState<string | null>(null);

  // ---- step 2: scan result + selection
  const [scan, setScan] = useState<ImportScanResult | null>(null);
  /** Human label + citation eprint for where the source came from. */
  const [source, setSource] = useState('');
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [citation, setCitation] = useState({ paper: '', authors: '', year: '', eprint: '' });
  const [makeMacroSet, setMakeMacroSet] = useState(true);
  const [macroSetName, setMacroSetName] = useState('');
  const [macroSetVisibility, setMacroSetVisibility] = useState<MacroSetVisibility>('unlisted');
  const [results, setResults] = useState<Record<number, ItemResult>>({});
  const [macroSetResult, setMacroSetResult] = useState<string | null>(null);
  /** Set once per scan so a retry after partial failure doesn't duplicate it. */
  const [createdMacroSetUuid, setCreatedMacroSetUuid] = useState<string | null>(null);

  const scanMut = useMutation({
    mutationFn: () => {
      if (mode === 'arxiv') {
        const id = parseArxivId(arxivInput);
        if (!id) throw new Error('Not a recognizable arXiv id or URL.');
        return importScan({ arxivId: id });
      }
      const files = mode === 'paste' ? { 'main.tex': pasted } : uploaded;
      if (Object.keys(files).length === 0 || (mode === 'paste' && !pasted.trim())) {
        throw new Error(mode === 'paste' ? 'Paste some LaTeX first.' : 'Add at least one file.');
      }
      return importScan({ files });
    },
    onSuccess: (result) => {
      const id = mode === 'arxiv' ? parseArxivId(arxivInput) : null;
      setScan(result);
      setSource(id ? `arXiv:${id}` : 'uploaded source');
      setPicks({});
      setExpanded({});
      setResults({});
      setMacroSetResult(null);
      setCreatedMacroSetUuid(null);
      setCitation({ paper: '', authors: '', year: '', eprint: id ?? '' });
      setMacroSetName(id ? `arXiv:${id} notation` : 'Imported notation');
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

  // union of the selected candidates' macro slices, split by KaTeX safety
  const macroUnion = useMemo(() => {
    if (!scan) return { safe: [] as string[], unsafe: [] as string[] };
    const names = new Set(selected.flatMap(({ candidate }) => candidate.usedMacros));
    const safe = [...names].filter((n) => n in scan.macroMap).sort();
    const unsafe = [...names].filter((n) => !(n in scan.macroMap)).sort();
    return { safe, unsafe };
  }, [scan, selected]);

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
        },
      };
    });
  }

  const setPick = (index: number, patch: Partial<Pick>) =>
    setPicks((prev) => ({ ...prev, [index]: { ...prev[index], ...patch } }));

  const importMut = useMutation({
    mutationFn: async () => {
      const cite: CitationInput = {};
      if (citation.paper.trim()) cite.paper = citation.paper.trim();
      if (citation.authors.trim()) cite.authors = citation.authors.trim();
      if (citation.eprint.trim()) cite.eprint = citation.eprint.trim();
      const year = parseInt(citation.year, 10);
      if (!Number.isNaN(year)) cite.year = year;

      let macroSetUuid = createdMacroSetUuid ?? undefined;
      let macroSetMessage: string | null = macroSetResult;
      if (!macroSetUuid && makeMacroSet && macroUnion.safe.length > 0) {
        try {
          const set = await createMacroSet({
            name: macroSetName.trim() || 'Imported notation',
            macros: Object.fromEntries(macroUnion.safe.map((n) => [n, scan!.macroMap[n]])),
            visibility: macroSetVisibility,
          });
          macroSetUuid = set.uuid;
          setCreatedMacroSetUuid(set.uuid);
          macroSetMessage = `Created macro set "${set.name}" (${macroUnion.safe.length} macros).`;
        } catch (err) {
          macroSetMessage = `Macro set failed: ${err instanceof ApiRequestError ? err.message : String(err)}`;
        }
      }

      const itemResults: Record<number, ItemResult> = {};
      const created = new Set<string>();
      for (const { index, pick, candidate } of selected) {
        if (results[index]?.ok) continue; // already imported in a previous run
        try {
          if (!existingSlugs.has(pick.defSlug) && !created.has(pick.defSlug)) {
            try {
              await createDefinition({ slug: pick.defSlug, title: pick.title });
            } catch (err) {
              // raced/stale list: slug already exists → just add the formulation
              if (!(err instanceof ApiRequestError && err.code === 'SLUG_TAKEN')) throw err;
            }
            created.add(pick.defSlug);
          }
          await createFormulation(pick.defSlug, {
            slug: pick.fSlug,
            citation: cite,
            ...(macroSetUuid ? { defaultMacroSetUuid: macroSetUuid } : {}),
          });
          await createRevision(pick.defSlug, pick.fSlug, {
            bodyLatex: candidate.body,
            commentaryMd: `*Imported from ${source} (\`${candidate.file}:${candidate.line}\`).*`,
          });
          itemResults[index] = { ok: true };
        } catch (err) {
          itemResults[index] = {
            ok: false,
            message: err instanceof ApiRequestError ? err.message : 'Import failed.',
          };
        }
      }
      return { itemResults, macroSetMessage };
    },
    onSuccess: ({ itemResults, macroSetMessage }) => {
      setResults((prev) => ({ ...prev, ...itemResults }));
      setMacroSetResult(macroSetMessage);
      queryClient.invalidateQueries({ queryKey: ['definitions'] });
    },
  });

  async function onFiles(list: FileList | null) {
    if (!list) return;
    const next = { ...uploaded };
    for (const file of Array.from(list)) next[file.name] = await file.text();
    setUploaded(next);
  }

  const doneCount = Object.values(results).filter((r) => r.ok).length;
  const importable = selected.filter(({ index }) => !results[index]?.ok);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Import from a paper</h1>
        <p className="text-sm text-gray-600 mt-1">
          Scan LaTeX source for definition-like environments and game boxes, then choose what to
          pull in. Everything lands as <em>drafts</em> — nothing is published by importing.
        </p>
      </div>

      {/* ------------------------------------------------ step 1: source */}
      <section className="border border-gray-200 rounded-lg p-4 space-y-3 max-w-2xl">
        <div className="flex gap-1 text-sm">
          {(
            [
              ['arxiv', 'arXiv id'],
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
          {scanMut.isPending ? 'Scanning…' : 'Scan'}
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
                      {candidate.file}:{candidate.line}
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
                    <div className="border-t border-gray-100 px-4 py-3 grid gap-3 md:grid-cols-3 text-sm bg-gray-50/50">
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

              <fieldset className="grid gap-3 md:grid-cols-2 text-sm">
                <label className="block">
                  Paper title (citation on each formulation)
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
                  Year
                  <input
                    className={inputCls}
                    value={citation.year}
                    onChange={(e) => setCitation({ ...citation, year: e.target.value })}
                  />
                </label>
                <label className="block">
                  ePrint / arXiv id
                  <input
                    className={monoInputCls}
                    value={citation.eprint}
                    onChange={(e) => setCitation({ ...citation, eprint: e.target.value })}
                  />
                </label>
              </fieldset>

              <div className="text-sm space-y-2 border-t border-gray-100 pt-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={makeMacroSet}
                    onChange={(e) => setMakeMacroSet(e.target.checked)}
                    disabled={macroUnion.safe.length === 0}
                  />
                  Create a macro set from the {macroUnion.safe.length} macros these candidates use
                </label>
                {makeMacroSet && macroUnion.safe.length > 0 && (
                  <div className="grid gap-3 md:grid-cols-2 pl-6">
                    <label className="block">
                      Name
                      <input
                        className={inputCls}
                        value={macroSetName}
                        onChange={(e) => setMacroSetName(e.target.value)}
                      />
                    </label>
                    <label className="block">
                      Visibility
                      <select
                        className={inputCls}
                        value={macroSetVisibility}
                        onChange={(e) => setMacroSetVisibility(e.target.value as MacroSetVisibility)}
                      >
                        <option value="unlisted">unlisted (link-only)</option>
                        <option value="public">public</option>
                      </select>
                    </label>
                    <p className="md:col-span-2 text-xs text-gray-500 font-mono break-words">
                      {macroUnion.safe.join(' ')}
                    </p>
                  </div>
                )}
                {macroUnion.safe.length > 500 && (
                  <p className="text-amber-700">
                    {macroUnion.safe.length} macros exceeds the 500-macro set limit — deselect some
                    candidates or trim the set afterwards.
                  </p>
                )}
                {macroUnion.unsafe.length > 0 && (
                  <p className="text-amber-700">
                    Used but not importable as-is (edit by hand later):{' '}
                    <span className="font-mono">{macroUnion.unsafe.join(' ')}</span>
                  </p>
                )}
              </div>

              {macroSetResult && <p className="text-sm text-gray-700">{macroSetResult}</p>}
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
                  (makeMacroSet && macroUnion.safe.length > 500) ||
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
            </div>
          )}
        </section>
      )}
    </div>
  );
}
