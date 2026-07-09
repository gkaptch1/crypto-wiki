import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

function Index() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  return (
    <div className="flex flex-col items-center gap-6 py-24">
      <h1 className="text-3xl font-bold">Crypto Wiki</h1>
      <p className="text-gray-600 max-w-xl text-center">
        Formal cryptographic definitions that render exactly as in papers, with citable
        permalinks and per-viewer notation via macro sets.
      </p>
      <form
        className="flex gap-2 w-full max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ to: '/wiki', search: { q: q || undefined } });
        }}
      >
        <input
          className="flex-1 border border-gray-300 rounded px-3 py-2"
          placeholder="Search definitions (e.g. PRF, IND-CPA)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="bg-black text-white rounded px-4 py-2">
          Search
        </button>
      </form>
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: Index,
});
