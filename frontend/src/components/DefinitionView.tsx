import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { parseMacroSetRef } from '@crypto-wiki/shared';
import type { Citation } from '@crypto-wiki/shared';
import { getDefinitionPage, getMacroSets, pinMacroSet } from '../api/definitions';
import { ApiRequestError } from '../api/client';
import { mergedMacros } from '../lib/latex';
import LatexView from './LatexView';
import MarkdownRenderer from './MarkdownRenderer';

interface Props {
  defSlug: string;
  formulationRef?: string;
  macros?: string;
}

function citationLine(c: Citation): string | null {
  if (!c.paper && !c.authors) return null;
  const parts = [c.authors, c.paper && `“${c.paper}”`, c.venue, c.year?.toString()].filter(Boolean);
  return parts.join(', ');
}

// The public, citable definition page: formulation tabs, revision history,
// macro-set switcher, and permalink copying (pinned form for papers).
export default function DefinitionView({ defSlug, formulationRef, macros }: Props) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState<string | null>(null);

  const page = useQuery({
    queryKey: ['def-page', defSlug, formulationRef ?? '', macros ?? ''],
    queryFn: () => getDefinitionPage(defSlug, formulationRef, macros),
  });
  const macroSets = useQuery({ queryKey: ['macro-sets'], queryFn: getMacroSets });

  if (page.isPending) return <p className="text-gray-500">Loading…</p>;
  if (page.isError) {
    const err = page.error;
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-red-700">
        {err instanceof ApiRequestError ? err.message : 'Failed to load definition.'}
      </div>
    );
  }

  const data = page.data;
  const latest = data.publishedRevisions[0]?.number;
  const viewingOld = data.revision.number !== latest;
  const macroRef = macros ? parseMacroSetRef(macros) : null;
  const knownUuids = new Set(macroSets.data?.map((s) => s.uuid) ?? []);
  const citation = citationLine(data.formulation.citation);

  const setMacros = (value?: string) => {
    if (formulationRef) {
      navigate({
        to: '/def/$defSlug/$formulationRef',
        params: { defSlug, formulationRef },
        search: { macros: value },
        replace: true,
      });
    } else {
      navigate({ to: '/def/$defSlug', params: { defSlug }, search: { macros: value }, replace: true });
    }
  };

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  const copyCitable = async () => {
    // pinned form: formulation@rN plus a pinned macro-set snapshot if one is selected
    let macroPart = '';
    if (macroRef) {
      const pin = macroRef.hash
        ? { ref: macros! }
        : await pinMacroSet(macroRef.uuid);
      macroPart = `?macros=${pin.ref}`;
    }
    const url = `${window.location.origin}/def/${defSlug}/${data.formulation.slug}@r${data.revision.number}${macroPart}`;
    await copy('citable', url);
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-bold">{data.definition.title}</h1>
          <code className="text-sm text-gray-400">/def/{data.definition.slug}</code>
        </div>
        {data.definition.categories.length > 0 && (
          <div className="mt-1 flex gap-1.5">
            {data.definition.categories.map((c) => (
              <Link
                key={c}
                to="/wiki"
                search={{ category: c }}
                className="text-xs rounded-full px-2.5 py-0.5 border border-gray-300 text-gray-600 hover:border-black"
              >
                {c}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* formulation tabs */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {data.formulations.map((f) => {
          const active = f.slug === data.formulation.slug;
          return (
            <Link
              key={f.slug}
              to="/def/$defSlug/$formulationRef"
              params={{ defSlug, formulationRef: f.slug }}
              search={{ macros }}
              className={`px-3 py-1.5 text-sm rounded-t border border-b-0 ${
                active
                  ? 'bg-white border-gray-300 font-semibold -mb-px'
                  : 'bg-gray-50 border-transparent text-gray-500 hover:text-black'
              }`}
            >
              {f.slug}
              {f.isDefault && <span className="ml-1 text-xs text-gray-400">(default)</span>}
            </Link>
          );
        })}
      </div>

      {/* revision + macro controls */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-600">
        <details className="relative">
          <summary className="cursor-pointer select-none">
            r{data.revision.number} · published{' '}
            {new Date(data.revision.publishedAt).toLocaleDateString()}
          </summary>
          <ul className="absolute z-10 mt-1 rounded border border-gray-200 bg-white shadow px-3 py-2 space-y-1">
            {data.publishedRevisions.map((r) => (
              <li key={r.number}>
                <Link
                  to="/def/$defSlug/$formulationRef"
                  params={{
                    defSlug,
                    formulationRef: `${data.formulation.slug}@r${r.number}`,
                  }}
                  search={{ macros }}
                  className="text-blue-700 hover:underline whitespace-nowrap"
                >
                  r{r.number} — {new Date(r.publishedAt).toLocaleDateString()}
                  {r.number === latest && ' (latest)'}
                </Link>
              </li>
            ))}
          </ul>
        </details>

        <label className="flex items-center gap-2">
          Notation:
          <select
            className="border border-gray-300 rounded px-2 py-1"
            value={macros ?? ''}
            onChange={(e) => setMacros(e.target.value || undefined)}
          >
            <option value="">
              {data.macroSet && !macros ? `${data.macroSet.name} (default)` : 'plain (no macro set)'}
            </option>
            {macroSets.data?.map((s) => (
              <option key={s.uuid} value={s.uuid}>
                {s.name}
              </option>
            ))}
            {macroRef && !knownUuids.has(macroRef.uuid) && (
              <option value={macros}>
                {data.macroSet?.name ?? 'linked set'}
                {macroRef.hash ? ' (pinned)' : ''}
              </option>
            )}
            {macroRef && knownUuids.has(macroRef.uuid) && macroRef.hash && (
              <option value={macros}>{data.macroSet?.name} (pinned)</option>
            )}
          </select>
        </label>

        <button
          onClick={() => copy('link', window.location.href)}
          className="rounded border border-gray-300 px-2.5 py-1 hover:border-black"
        >
          {copied === 'link' ? 'Copied!' : 'Copy link'}
        </button>
        <button
          onClick={copyCitable}
          title="Immutable permalink: pinned revision and pinned macro snapshot — cite this in papers"
          className="rounded border border-gray-300 px-2.5 py-1 hover:border-black"
        >
          {copied === 'citable' ? 'Copied!' : 'Copy citable permalink'}
        </button>
      </div>

      {viewingOld && (
        <div className="rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          You are viewing r{data.revision.number}, pinned. The latest published revision is{' '}
          <Link
            to="/def/$defSlug/$formulationRef"
            params={{ defSlug, formulationRef: data.formulation.slug }}
            search={{ macros }}
            className="underline"
          >
            r{latest}
          </Link>
          .
        </div>
      )}

      {/* the definition itself */}
      <div className="rounded-lg border border-gray-300 bg-white p-6 shadow-sm">
        <LatexView body={data.revision.bodyLatex} macros={data.macros} />
      </div>

      {citation && (
        <p className="text-sm text-gray-600">
          Source: {citation}
          {data.formulation.citation.doi && (
            <>
              {' · '}
              <a
                className="text-blue-700 hover:underline"
                href={`https://doi.org/${data.formulation.citation.doi}`}
              >
                doi
              </a>
            </>
          )}
          {data.formulation.citation.eprint && (
            <>
              {' · '}
              <a
                className="text-blue-700 hover:underline"
                href={`https://eprint.iacr.org/${data.formulation.citation.eprint}`}
              >
                eprint
              </a>
            </>
          )}
        </p>
      )}

      {data.revision.commentaryMd && (
        <div className="prose prose-sm max-w-none border-t border-gray-200 pt-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Commentary
          </h2>
          <MarkdownRenderer content={data.revision.commentaryMd} macros={mergedMacros(data.macros)} />
        </div>
      )}
    </div>
  );
}
