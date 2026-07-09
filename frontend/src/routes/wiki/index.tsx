import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { getDefaultDefinitions } from '../../api/definitions';
import type { ConcreteDefinition } from '../../types/definition';

export const Route = createFileRoute('/wiki/')({
  component: RouteComponent,
});

function RouteComponent() {
  const [defs, setDefs] = useState<ConcreteDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDefaultDefinitions()
      .then(setDefs)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return <div className="p-4 text-red-600">Error: {error}</div>;
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-2">Definitions</h1>
      <ul className="list-disc pl-6 space-y-1">
        {defs.map((def) => (
          <li key={def.title}>
            <Link
              to="/wiki/$defId"
              params={{ defId: def.title }}
              className="text-blue-600 underline hover:text-blue-800"
            >
              {def.title}
            </Link>
            {def.categories.length > 0 && (
              <span className="text-sm text-gray-500"> — {def.categories.join(', ')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
