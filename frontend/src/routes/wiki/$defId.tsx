import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import MarkdownRenderer from '../../components/MarkdownRenderer';
import { getDefinition } from '../../api/definitions';
import type { ConcreteDefinition } from '../../types/definition';

type DefSearch = {
  version?: string;
  macros?: string;
};

export const Route = createFileRoute('/wiki/$defId')({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): DefSearch => ({
    version: typeof search.version === 'string' ? search.version : undefined,
    macros: typeof search.macros === 'string' ? search.macros : undefined,
  }),
});

function RouteComponent() {
  const { defId } = Route.useParams();
  const { version, macros } = Route.useSearch();
  const [def, setDef] = useState<ConcreteDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDef(null);
    setError(null);
    getDefinition(defId, { version, macroSetId: macros })
      .then(setDef)
      .catch((e) => setError(e.message));
  }, [defId, version, macros]);

  if (error) {
    return <div className="p-4 text-red-600">Error: {error}</div>;
  }
  if (!def) {
    return <div className="p-4 text-gray-500">Loading…</div>;
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">{def.title}</h1>
      {def.categories.length > 0 && (
        <p className="text-sm text-gray-500">{def.categories.join(', ')}</p>
      )}

      {def.versions && def.versions.length > 1 && (
        <div className="mt-2 flex gap-2 text-sm">
          <span className="text-gray-500">Versions:</span>
          {def.versions.map((v) => (
            <Link
              key={v.slug}
              to="/wiki/$defId"
              params={{ defId }}
              search={{ version: v.slug, macros }}
              className={
                v.slug === def.versionSlug
                  ? 'font-bold'
                  : 'text-blue-600 underline hover:text-blue-800'
              }
            >
              {v.slug}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-4 border rounded p-4">
        <MarkdownRenderer content={def.bodyLatex} macros={def.macros} />
      </div>
    </div>
  );
}
