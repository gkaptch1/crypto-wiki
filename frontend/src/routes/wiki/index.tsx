import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { getCategories, getDefinitions } from '../../api/definitions';

interface WikiSearch {
  q?: string;
  category?: string;
}

export const Route = createFileRoute('/wiki/')({
  validateSearch: (search): WikiSearch => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    category: typeof search.category === 'string' ? search.category : undefined,
  }),
  component: WikiIndex,
});

function WikiIndex() {
  const { q, category } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [input, setInput] = useState(q ?? '');

  const defs = useQuery({
    queryKey: ['definitions', q ?? '', category ?? ''],
    queryFn: () => getDefinitions(q, category),
  });
  const categories = useQuery({ queryKey: ['categories'], queryFn: getCategories });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            navigate({ search: { q: input || undefined, category }, replace: true });
          }}
        >
          <input
            className="border border-gray-300 rounded px-3 py-1.5 w-64"
            placeholder="Search definitions…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="bg-black text-white rounded px-3 py-1.5 text-sm">
            Search
          </button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {categories.data?.map((c) => (
            <button
              key={c.name}
              onClick={() =>
                navigate({
                  search: { q, category: category === c.name ? undefined : c.name },
                  replace: true,
                })
              }
              className={`text-xs rounded-full px-2.5 py-1 border ${
                category === c.name
                  ? 'bg-black text-white border-black'
                  : 'border-gray-300 text-gray-600 hover:border-black'
              }`}
            >
              {c.name} ({c.definitionCount})
            </button>
          ))}
        </div>
      </div>

      {defs.isPending && <p className="text-gray-500">Loading…</p>}
      {defs.isError && <p className="text-red-600">Error: {(defs.error as Error).message}</p>}

      <ul className="grid gap-3 sm:grid-cols-2">
        {defs.data?.map((def) => (
          <li key={def.slug} className="border border-gray-200 rounded-lg p-4 hover:border-gray-400">
            <Link to="/def/$defSlug" params={{ defSlug: def.slug }} className="block">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{def.title}</span>
                <code className="text-xs text-gray-400">/def/{def.slug}</code>
              </div>
              <div className="mt-1 text-sm text-gray-500 flex flex-wrap gap-x-3">
                <span>
                  {def.formulationCount} formulation{def.formulationCount === 1 ? '' : 's'}
                </span>
                {!def.hasPublished && <span className="text-amber-600">unpublished</span>}
                {def.categories.length > 0 && <span>{def.categories.join(', ')}</span>}
              </div>
            </Link>
          </li>
        ))}
        {defs.data?.length === 0 && <p className="text-gray-500">No definitions match.</p>}
      </ul>
    </div>
  );
}
