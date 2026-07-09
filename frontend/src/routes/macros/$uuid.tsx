import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { MacroSetVisibility } from '@crypto-wiki/shared';
import {
  deleteMacroSet,
  forkMacroSet,
  getMacroSet,
  pinMacroSet,
  updateMacroSet,
} from '../../api/definitions';
import { ApiRequestError } from '../../api/client';

export const Route = createFileRoute('/macros/$uuid')({
  component: MacroSetEditor,
});

interface Row {
  key: string;
  value: string;
}

function errMsg(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Request failed.';
}

function MacroSetEditor() {
  const { uuid } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const set = useQuery({ queryKey: ['macro-set', uuid], queryFn: () => getMacroSet(uuid) });

  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<MacroSetVisibility>('public');
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pinnedRef, setPinnedRef] = useState<string | null>(null);

  useEffect(() => {
    if (set.data) {
      setName(set.data.name);
      setVisibility(set.data.visibility);
      setRows(Object.entries(set.data.macros).map(([key, value]) => ({ key, value })));
    }
  }, [set.data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['macro-set', uuid] });
    queryClient.invalidateQueries({ queryKey: ['macro-sets'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const macros: Record<string, string> = {};
      for (const { key, value } of rows) {
        const k = key.trim();
        if (!k) continue;
        if (!/^\\[a-zA-Z]+$/.test(k)) {
          throw new Error(`"${k}" is not a valid macro name (expected \\letters)`);
        }
        macros[k] = value;
      }
      return updateMacroSet(uuid, { name, visibility, macros });
    },
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof Error ? e.message : 'Save failed.'),
  });

  const pin = useMutation({
    mutationFn: () => pinMacroSet(uuid),
    onSuccess: (p) => setPinnedRef(p.ref),
    onError: (e) => setError(errMsg(e)),
  });

  const fork = useMutation({
    mutationFn: () => forkMacroSet(uuid),
    onSuccess: (f) => navigate({ to: '/macros/$uuid', params: { uuid: f.uuid } }),
    onError: (e) => setError(errMsg(e)),
  });

  const remove = useMutation({
    mutationFn: () => deleteMacroSet(uuid),
    onSuccess: () => {
      invalidate();
      navigate({ to: '/macros' });
    },
    onError: (e) => setError(errMsg(e)),
  });

  if (set.isPending) return <p className="text-gray-500">Loading…</p>;
  if (set.isError) return <p className="text-red-600">{errMsg(set.error)}</p>;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="text-xl font-bold border-b border-transparent focus:border-gray-300 outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="border border-gray-300 rounded px-2 py-1 text-sm"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as MacroSetVisibility)}
        >
          <option value="public">public — listed, attributed</option>
          <option value="unlisted">unlisted — link-only</option>
          <option value="anonymous">anonymous — link-only, no attribution (double-blind)</option>
        </select>
      </div>
      <p className="text-xs text-gray-400 font-mono">?macros={uuid}</p>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="py-1 pr-2 w-48 font-medium">Macro</th>
            <th className="py-1 font-medium">Expansion</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1 font-mono"
                  placeholder="\adv"
                  value={row.key}
                  onChange={(e) =>
                    setRows(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))
                  }
                />
              </td>
              <td className="py-1">
                <input
                  className="w-full border border-gray-300 rounded px-2 py-1 font-mono"
                  placeholder="\mathcal{A}"
                  value={row.value}
                  onChange={(e) =>
                    setRows(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
                  }
                />
              </td>
              <td className="text-center">
                <button
                  className="text-gray-400 hover:text-red-600"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="text-sm border border-gray-300 rounded px-2.5 py-1 hover:border-black"
        onClick={() => setRows([...rows, { key: '', value: '' }])}
      >
        + macro
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {pinnedRef && (
        <div className="rounded border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">
          Pinned. Citable ref:{' '}
          <button
            className="font-mono underline"
            onClick={() => navigator.clipboard.writeText(pinnedRef)}
            title="Copy"
          >
            ?macros={pinnedRef}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        <button
          className="bg-black text-white rounded px-4 py-2 disabled:opacity-50"
          disabled={save.isPending}
          onClick={() => {
            setError(null);
            save.mutate();
          }}
        >
          Save
        </button>
        <button
          className="border border-gray-300 rounded px-3 py-2 hover:border-black"
          onClick={() => pin.mutate()}
          title="Freeze the current content as an immutable snapshot for citation"
        >
          Pin current content
        </button>
        <button
          className="border border-gray-300 rounded px-3 py-2 hover:border-black"
          onClick={() => fork.mutate()}
        >
          Fork
        </button>
        <button
          className="border border-gray-300 rounded px-3 py-2 text-red-600 hover:border-red-600"
          onClick={() => remove.mutate()}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
