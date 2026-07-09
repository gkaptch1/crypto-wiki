import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { DefinitionEditor, FormulationEditor, Revision } from '@crypto-wiki/shared';
import {
  createFormulation,
  createRevision,
  deleteRevision,
  getDefinitionEditor,
  getMacroSet,
  getMacroSets,
  publishRevision,
  updateDefinition,
  updateFormulation,
  updateRevision,
} from '../../api/definitions';
import { ApiRequestError } from '../../api/client';
import LatexView from '../../components/LatexView';

export const Route = createFileRoute('/editor/$defSlug')({
  component: EditorPage,
});

function errMsg(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Request failed.';
}

function EditorPage() {
  const { defSlug } = Route.useParams();
  const queryClient = useQueryClient();
  const def = useQuery({
    queryKey: ['editor', defSlug],
    queryFn: () => getDefinitionEditor(defSlug),
  });

  const [selectedF, setSelectedF] = useState<string | null>(null);

  if (def.isPending) return <p className="text-gray-500">Loading…</p>;
  if (def.isError) return <p className="text-red-600">{errMsg(def.error)}</p>;

  const data = def.data;
  const formulation =
    data.formulations.find((f) => f.slug === selectedF) ??
    data.formulations.find((f) => f.isDefault) ??
    data.formulations[0];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['editor', defSlug] });

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">
          Editing: {data.title} <code className="text-sm text-gray-400">/def/{data.slug}</code>
        </h1>
        <Link to="/def/$defSlug" params={{ defSlug }} className="text-sm text-blue-700 hover:underline">
          View public page →
        </Link>
      </div>

      <MetadataForm data={data} onSaved={invalidate} />

      <div className="flex flex-wrap items-center gap-1 border-b border-gray-200">
        {data.formulations.map((f) => (
          <button
            key={f.slug}
            onClick={() => setSelectedF(f.slug)}
            className={`px-3 py-1.5 text-sm rounded-t border border-b-0 ${
              formulation?.slug === f.slug
                ? 'bg-white border-gray-300 font-semibold -mb-px'
                : 'bg-gray-50 border-transparent text-gray-500 hover:text-black'
            }`}
          >
            {f.slug}
            {f.isDefault && <span className="ml-1 text-xs text-gray-400">(default)</span>}
          </button>
        ))}
        <NewFormulationForm defSlug={defSlug} onCreated={(slug) => {
          invalidate();
          setSelectedF(slug);
        }} />
      </div>

      {formulation ? (
        <FormulationPanel
          key={formulation.slug}
          defSlug={defSlug}
          formulation={formulation}
          onChanged={invalidate}
        />
      ) : (
        <p className="text-gray-500">No formulations yet — add one above.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- metadata

function MetadataForm({ data, onSaved }: { data: DefinitionEditor; onSaved: () => void }) {
  const [title, setTitle] = useState(data.title);
  const [categories, setCategories] = useState(data.categories.join(', '));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setTitle(data.title);
    setCategories(data.categories.join(', '));
  }, [data.title, data.categories]);

  const save = useMutation({
    mutationFn: () =>
      updateDefinition(data.slug, {
        title,
        categories: categories.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean),
      }),
    onSuccess: onSaved,
    onError: (e) => setError(errMsg(e)),
  });

  return (
    <form
      className="flex flex-wrap items-end gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <label className="block">
        Title
        <input
          className="mt-1 block border border-gray-300 rounded px-2 py-1.5 w-64"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="block">
        Categories
        <input
          className="mt-1 block border border-gray-300 rounded px-2 py-1.5 w-64"
          value={categories}
          onChange={(e) => setCategories(e.target.value)}
        />
      </label>
      <button className="border border-gray-300 rounded px-3 py-1.5 hover:border-black" type="submit">
        Save metadata
      </button>
      {error && <span className="text-red-600">{error}</span>}
    </form>
  );
}

// ------------------------------------------------------------ formulations

function NewFormulationForm({
  defSlug,
  onCreated,
}: {
  defSlug: string;
  onCreated: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => createFormulation(defSlug, { slug }),
    onSuccess: () => {
      const s = slug;
      setSlug('');
      setOpen(false);
      onCreated(s);
    },
    onError: (e) => setError(errMsg(e)),
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="px-3 py-1.5 text-sm text-gray-500 hover:text-black">
        + formulation
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-2 px-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        create.mutate();
      }}
    >
      <input
        autoFocus
        className="border border-gray-300 rounded px-2 py-1 text-sm font-mono w-36"
        placeholder="game-based"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
      />
      <button type="submit" className="text-sm border border-gray-300 rounded px-2 py-1">
        Add
      </button>
      <button type="button" className="text-sm text-gray-400" onClick={() => setOpen(false)}>
        ✕
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}

function FormulationPanel({
  defSlug,
  formulation,
  onChanged,
}: {
  defSlug: string;
  formulation: FormulationEditor;
  onChanged: () => void;
}) {
  const [selectedRevId, setSelectedRevId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision =
    formulation.revisions.find((r) => r.id === selectedRevId) ?? formulation.revisions[0];

  const macroSets = useQuery({ queryKey: ['macro-sets'], queryFn: getMacroSets });
  // the formulation's default macro set, used for the live preview
  const previewSet = useQuery({
    queryKey: ['macro-set', formulation.defaultMacroSetUuid],
    queryFn: () => getMacroSet(formulation.defaultMacroSetUuid!),
    enabled: formulation.defaultMacroSetUuid !== null,
  });

  const patchFormulation = useMutation({
    mutationFn: (body: Parameters<typeof updateFormulation>[2]) =>
      updateFormulation(defSlug, formulation.slug, body),
    onSuccess: onChanged,
    onError: (e) => setError(errMsg(e)),
  });

  const newDraft = useMutation({
    mutationFn: () =>
      createRevision(defSlug, formulation.slug, {
        bodyLatex: revision?.bodyLatex ?? '',
        commentaryMd: revision?.commentaryMd ?? '',
      }),
    onSuccess: (rev) => {
      onChanged();
      setSelectedRevId(rev.id);
    },
    onError: (e) => setError(errMsg(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {!formulation.isDefault && (
          <button
            className="border border-gray-300 rounded px-2.5 py-1 hover:border-black"
            onClick={() => patchFormulation.mutate({ isDefault: true })}
          >
            Make default
          </button>
        )}
        <label className="flex items-center gap-2">
          Default macro set:
          <select
            className="border border-gray-300 rounded px-2 py-1"
            value={formulation.defaultMacroSetUuid ?? ''}
            onChange={(e) =>
              patchFormulation.mutate({ defaultMacroSetUuid: e.target.value || null })
            }
          >
            <option value="">none</option>
            {macroSets.data?.map((s) => (
              <option key={s.uuid} value={s.uuid}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <CitationForm formulation={formulation} onSave={(citation) => patchFormulation.mutate({ citation })} />
        {error && <span className="text-red-600">{error}</span>}
      </div>

      <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-600">Revisions</h3>
            <button
              className="text-sm border border-gray-300 rounded px-2 py-0.5 hover:border-black"
              onClick={() => newDraft.mutate()}
            >
              + draft
            </button>
          </div>
          <ul className="space-y-1">
            {formulation.revisions.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setSelectedRevId(r.id)}
                  className={`w-full text-left text-sm rounded px-2 py-1.5 border ${
                    revision?.id === r.id
                      ? 'border-gray-400 bg-gray-50'
                      : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  {r.status === 'published' ? (
                    <span className="font-medium">r{r.number}</span>
                  ) : (
                    <span className="text-amber-700 font-medium">draft</span>
                  )}
                  <span className="ml-2 text-gray-400">
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {revision ? (
          <RevisionEditor
            key={revision.id}
            defSlug={defSlug}
            fSlug={formulation.slug}
            revision={revision}
            previewMacros={previewSet.data?.macros ?? {}}
            onChanged={onChanged}
          />
        ) : (
          <p className="text-gray-500 text-sm">No revisions yet — create a draft.</p>
        )}
      </div>
    </div>
  );
}

function CitationForm({
  formulation,
  onSave,
}: {
  formulation: FormulationEditor;
  onSave: (citation: Record<string, string | number | null>) => void;
}) {
  const [open, setOpen] = useState(false);
  const c = formulation.citation;
  const [paper, setPaper] = useState(c.paper ?? '');
  const [authors, setAuthors] = useState(c.authors ?? '');
  const [venue, setVenue] = useState(c.venue ?? '');
  const [year, setYear] = useState(c.year?.toString() ?? '');
  const [doi, setDoi] = useState(c.doi ?? '');
  const [eprint, setEprint] = useState(c.eprint ?? '');

  if (!open) {
    return (
      <button
        className="border border-gray-300 rounded px-2.5 py-1 hover:border-black"
        onClick={() => setOpen(true)}
      >
        {c.paper || c.authors ? 'Edit citation' : 'Add citation'}
      </button>
    );
  }
  const field = (label: string, value: string, set: (v: string) => void, w = 'w-48') => (
    <label className="block text-xs text-gray-600">
      {label}
      <input
        className={`mt-0.5 block border border-gray-300 rounded px-2 py-1 text-sm ${w}`}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
  return (
    <div className="w-full flex flex-wrap items-end gap-2 border border-gray-200 rounded p-3">
      {field('Paper', paper, setPaper, 'w-72')}
      {field('Authors', authors, setAuthors, 'w-56')}
      {field('Venue', venue, setVenue, 'w-32')}
      {field('Year', year, setYear, 'w-20')}
      {field('DOI', doi, setDoi, 'w-40')}
      {field('ePrint (e.g. 2004/332)', eprint, setEprint, 'w-32')}
      <button
        className="border border-gray-300 rounded px-2.5 py-1 text-sm hover:border-black"
        onClick={() => {
          onSave({
            paper: paper || null,
            authors: authors || null,
            venue: venue || null,
            year: year ? Number(year) : null,
            doi: doi || null,
            eprint: eprint || null,
          });
          setOpen(false);
        }}
      >
        Save citation
      </button>
      <button className="text-sm text-gray-400 px-1" onClick={() => setOpen(false)}>
        ✕
      </button>
    </div>
  );
}

// --------------------------------------------------------------- revisions

function RevisionEditor({
  defSlug,
  fSlug,
  revision,
  previewMacros,
  onChanged,
}: {
  defSlug: string;
  fSlug: string;
  revision: Revision;
  previewMacros: Record<string, string>;
  onChanged: () => void;
}) {
  const [body, setBody] = useState(revision.bodyLatex);
  const [commentary, setCommentary] = useState(revision.commentaryMd);
  const [error, setError] = useState<string | null>(null);
  const isDraft = revision.status === 'draft';
  const dirty = body !== revision.bodyLatex || commentary !== revision.commentaryMd;

  const save = useMutation({
    mutationFn: () => updateRevision(defSlug, fSlug, revision.id, { bodyLatex: body, commentaryMd: commentary }),
    onSuccess: onChanged,
    onError: (e) => setError(errMsg(e)),
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (dirty) await updateRevision(defSlug, fSlug, revision.id, { bodyLatex: body, commentaryMd: commentary });
      return publishRevision(defSlug, fSlug, revision.id);
    },
    onSuccess: onChanged,
    onError: (e) => setError(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: () => deleteRevision(defSlug, fSlug, revision.id),
    onSuccess: onChanged,
    onError: (e) => setError(errMsg(e)),
  });

  const preview = useMemo(() => body, [body]);

  return (
    <div className="space-y-3">
      {isDraft ? (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded bg-amber-100 text-amber-800 px-2 py-0.5">draft</span>
            <button
              className="border border-gray-300 rounded px-2.5 py-1 hover:border-black disabled:opacity-50"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
            <button
              className="bg-black text-white rounded px-2.5 py-1 disabled:opacity-50"
              disabled={publish.isPending}
              onClick={() => publish.mutate()}
              title="Publishing freezes this revision forever and assigns it a number"
            >
              Publish
            </button>
            <button
              className="text-red-600 border border-gray-300 rounded px-2.5 py-1 hover:border-red-600"
              onClick={() => remove.mutate()}
            >
              Delete draft
            </button>
            {error && <span className="text-red-600">{error}</span>}
          </div>
          <label className="block text-sm text-gray-600">
            LaTeX body (pure LaTeX — compiles under real cryptocode)
            <textarea
              className="mt-1 w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm h-56"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="block text-sm text-gray-600">
            Commentary (Markdown: intuition, remarks, history)
            <textarea
              className="mt-1 w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm h-24"
              value={commentary}
              onChange={(e) => setCommentary(e.target.value)}
              spellCheck={false}
            />
          </label>
        </>
      ) : (
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded bg-green-100 text-green-800 px-2 py-0.5">
            r{revision.number} — published {new Date(revision.publishedAt!).toLocaleDateString()},
            immutable
          </span>
          <Link
            to="/def/$defSlug/$formulationRef"
            params={{ defSlug, formulationRef: `${fSlug}@r${revision.number}` }}
            className="text-blue-700 hover:underline"
          >
            permalink →
          </Link>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-gray-600 mb-1">
          Preview (KaTeX + cryptocode shim{previewMacros && Object.keys(previewMacros).length > 0 ? ' + default macro set' : ''})
        </h3>
        <div className="rounded-lg border border-gray-300 bg-white p-6">
          <LatexView body={isDraft ? preview : revision.bodyLatex} macros={previewMacros} />
        </div>
      </div>
    </div>
  );
}
