import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { MacroSetVisibility } from '@crypto-wiki/shared';
import { createMacroSet, getMacroSets, getMyMacroSets } from '../../api/definitions';
import { ApiRequestError } from '../../api/client';
import { useAuth } from '../../lib/auth-client';

export const Route = createFileRoute('/macros/')({
  component: MacrosIndex,
});

const VISIBILITY_BADGES: Record<MacroSetVisibility, string> = {
  public: 'bg-green-100 text-green-800',
  unlisted: 'bg-blue-100 text-blue-800',
  anonymous: 'bg-gray-200 text-gray-700',
};

function VisibilityBadge({ visibility }: { visibility: MacroSetVisibility }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${VISIBILITY_BADGES[visibility]}`}>
      {visibility}
    </span>
  );
}

function MacrosIndex() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isSignedIn } = useAuth();
  const sets = useQuery({ queryKey: ['macro-sets'], queryFn: getMacroSets });
  const mySets = useQuery({
    queryKey: ['my-macro-sets'],
    queryFn: getMyMacroSets,
    enabled: isSignedIn,
  });

  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<MacroSetVisibility>('public');
  const [uuidInput, setUuidInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createMacroSet({ name, macros: {}, visibility }),
    onSuccess: (set) => {
      queryClient.invalidateQueries({ queryKey: ['macro-sets'] });
      queryClient.invalidateQueries({ queryKey: ['my-macro-sets'] });
      navigate({ to: '/macros/$uuid', params: { uuid: set.uuid } });
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Create failed.'),
  });

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_20rem]">
      <div className="space-y-8">
        {isSignedIn && (
          <div>
            <h1 className="text-xl font-bold mb-1">My macro sets</h1>
            <p className="text-sm text-gray-600 mb-4">
              All your sets, including unlisted and anonymous ones. Only you (and admins) can see
              this list.
            </p>
            {mySets.isPending && <p className="text-gray-500">Loading…</p>}
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {mySets.data?.map((s) => (
                <li key={s.uuid}>
                  <Link
                    to="/macros/$uuid"
                    params={{ uuid: s.uuid }}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-gray-50"
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className="flex items-center gap-2 text-sm text-gray-500">
                      <VisibilityBadge visibility={s.visibility} />
                      {Object.keys(s.macros).length} macros
                      {s.snapshotCount > 0 && (
                        <span title="Pinned snapshots referenced by permalinks">
                          · {s.snapshotCount} pinned
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
              {mySets.data?.length === 0 && (
                <li className="px-4 py-2.5 text-gray-500">You have no macro sets yet.</li>
              )}
            </ul>
          </div>
        )}

        <div>
          <h2 className={isSignedIn ? 'text-lg font-bold mb-1' : 'text-xl font-bold mb-1'}>
            Public directory
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            A macro set maps semantic macro names (<code>\adv</code>, <code>\secpar</code>, …) to
            your paper's notation. Any definition can be rendered under any set via{' '}
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
                    {s.owner ? `by ${s.owner} · ` : ''}
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
      </div>

      <div className="space-y-6">
        {isSignedIn ? (
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
            <select
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as MacroSetVisibility)}
            >
              <option value="public">public — listed, attributed</option>
              <option value="unlisted">unlisted — link-only</option>
              <option value="anonymous">anonymous — link-only, no attribution</option>
            </select>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={create.isPending}
              className="bg-black text-white rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              Create
            </button>
          </form>
        ) : (
          <div className="border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
            <Link to="/signin" className="text-blue-700 underline">
              Sign in
            </Link>{' '}
            to create and manage your own macro sets — including anonymous ones for double-blind
            submissions.
          </div>
        )}

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
