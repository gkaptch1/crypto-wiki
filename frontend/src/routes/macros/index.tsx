import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createMacroSet, getMacroSets } from '../../api/definitions';
import { ApiRequestError } from '../../api/client';

export const Route = createFileRoute('/macros/')({
  component: MacrosIndex,
});

function MacrosIndex() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sets = useQuery({ queryKey: ['macro-sets'], queryFn: getMacroSets });

  const [name, setName] = useState('');
  const [uuidInput, setUuidInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createMacroSet({ name, macros: {}, visibility: 'public' }),
    onSuccess: (set) => {
      queryClient.invalidateQueries({ queryKey: ['macro-sets'] });
      navigate({ to: '/macros/$uuid', params: { uuid: set.uuid } });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Create failed.'),
  });

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_20rem]">
      <div>
        <h1 className="text-xl font-bold mb-1">Macro sets</h1>
        <p className="text-sm text-gray-600 mb-4">
          A macro set maps semantic macro names (<code>\adv</code>, <code>\secpar</code>, …) to your
          paper's notation. Any definition can be rendered under any set via{' '}
          <code>?macros=&lt;uuid&gt;</code>. Unlisted and anonymous sets don't appear here — open
          them by UUID.
        </p>
        {sets.isPending && <p className="text-gray-500">Loading…</p>}
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {sets.data?.map((s) => (
            <li key={s.uuid}>
              <Link
                to="/macros/$uuid"
                params={{ uuid: s.uuid }}
                className="flex items-baseline justify-between px-4 py-2.5 hover:bg-gray-50"
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-sm text-gray-500">
                  {Object.keys(s.macros).length} macros
                </span>
              </Link>
            </li>
          ))}
          {sets.data?.length === 0 && (
            <li className="px-4 py-2.5 text-gray-500">No public macro sets yet.</li>
          )}
        </ul>
      </div>

      <div className="space-y-6">
        <form
          className="space-y-3 border border-gray-200 rounded-lg p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <h2 className="font-semibold">New macro set</h2>
          <input
            className="w-full border border-gray-300 rounded px-2 py-1.5"
            placeholder="Name (e.g. my-paper-notation)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={create.isPending}
            className="bg-black text-white rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            Create
          </button>
        </form>

        <form
          className="space-y-3 border border-gray-200 rounded-lg p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (uuidInput.trim()) {
              navigate({ to: '/macros/$uuid', params: { uuid: uuidInput.trim() } });
            }
          }}
        >
          <h2 className="font-semibold">Open by UUID</h2>
          <p className="text-xs text-gray-500">For unlisted or anonymous sets.</p>
          <input
            className="w-full border border-gray-300 rounded px-2 py-1.5 font-mono text-sm"
            placeholder="00000000-0000-…"
            value={uuidInput}
            onChange={(e) => setUuidInput(e.target.value)}
          />
          <button type="submit" className="border border-gray-300 rounded px-4 py-2 text-sm hover:border-black">
            Open
          </button>
        </form>
      </div>
    </div>
  );
}
