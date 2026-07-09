import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createDefinition, getDefinitions } from '../../api/definitions';
import { ApiRequestError } from '../../api/client';
import RequireEditor from '../../components/RequireEditor';

export const Route = createFileRoute('/editor/')({
  component: () => (
    <RequireEditor>
      <EditorIndex />
    </RequireEditor>
  ),
});

function EditorIndex() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const defs = useQuery({ queryKey: ['definitions', '', ''], queryFn: () => getDefinitions() });

  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [categories, setCategories] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createDefinition({
        slug,
        title,
        categories: categories
          .split(',')
          .map((c) => c.trim().toLowerCase())
          .filter(Boolean),
        formulation: { slug: 'standard', bodyLatex: '' },
      }),
    onSuccess: (def) => {
      queryClient.invalidateQueries({ queryKey: ['definitions'] });
      navigate({ to: '/editor/$defSlug', params: { defSlug: def.slug } });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Create failed.'),
  });

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_20rem]">
      <div>
        <h1 className="text-xl font-bold mb-4">Definitions</h1>
        {defs.isPending && <p className="text-gray-500">Loading…</p>}
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {defs.data?.map((def) => (
            <li key={def.slug}>
              <Link
                to="/editor/$defSlug"
                params={{ defSlug: def.slug }}
                className="flex items-baseline justify-between px-4 py-2.5 hover:bg-gray-50"
              >
                <span className="font-medium">{def.title}</span>
                <span className="text-sm text-gray-500">
                  {def.formulationCount} formulation{def.formulationCount === 1 ? '' : 's'}
                  {!def.hasPublished && <span className="ml-2 text-amber-600">unpublished</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <form
        className="space-y-3 border border-gray-200 rounded-lg p-4 h-fit"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          create.mutate();
        }}
      >
        <h2 className="font-semibold">New definition</h2>
        <label className="block text-sm">
          URL slug (permanent once published)
          <input
            className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 font-mono"
            placeholder="prf"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          Title
          <input
            className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5"
            placeholder="Pseudorandom Function"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          Categories (comma-separated)
          <input
            className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5"
            placeholder="symmetric, foundations"
            value={categories}
            onChange={(e) => setCategories(e.target.value)}
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={create.isPending}
          className="bg-black text-white rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          Create (as draft)
        </button>
      </form>
    </div>
  );
}
