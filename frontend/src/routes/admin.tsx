import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { InvitableRole } from '@crypto-wiki/shared';
import { createInvitation, deleteInvitation, getInvitations } from '../api/definitions';
import { ApiRequestError } from '../api/client';
import { useAuth } from '../lib/auth-client';

export const Route = createFileRoute('/admin')({
  component: AdminPage,
});

function AdminPage() {
  const { isAdmin, isPending } = useAuth();
  if (isPending) return <p className="text-gray-500">Loading…</p>;
  if (!isAdmin) {
    return <p className="text-gray-600">This page is for administrators.</p>;
  }
  return <Invitations />;
}

function Invitations() {
  const queryClient = useQueryClient();
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: getInvitations });

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('editor');
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['invitations'] });

  const invite = useMutation({
    mutationFn: () => createInvitation({ email, role }),
    onSuccess: () => {
      setEmail('');
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Invite failed.'),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => deleteInvitation(id),
    onSuccess: invalidate,
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : 'Revoke failed.'),
  });

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_20rem]">
      <div>
        <h1 className="text-xl font-bold mb-1">Invitations</h1>
        <p className="text-sm text-gray-600 mb-4">
          Invited emails get the chosen role when they first sign in (or immediately, if they
          already have an account). Revoking an accepted invitation does not change the account.
        </p>
        {invitations.isPending && <p className="text-gray-500">Loading…</p>}
        <table className="w-full text-sm border border-gray-200 rounded-lg">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Invited by</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {invitations.data?.map((inv) => (
              <tr key={inv.id} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-2 font-mono">{inv.email}</td>
                <td className="px-3 py-2">{inv.role}</td>
                <td className="px-3 py-2">
                  {inv.acceptedAt ? (
                    <span className="text-green-700">
                      accepted {new Date(inv.acceptedAt).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="text-amber-600">pending</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-500">{inv.invitedBy ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    className="text-gray-400 hover:text-red-600"
                    title="Revoke invitation"
                    onClick={() => revoke.mutate(inv.id)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {invitations.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-2 text-gray-500">
                  No invitations yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form
        className="space-y-3 border border-gray-200 rounded-lg p-4 h-fit"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          invite.mutate();
        }}
      >
        <h2 className="font-semibold">Invite</h2>
        <input
          className="w-full border border-gray-300 rounded px-2 py-1.5"
          type="email"
          placeholder="colleague@university.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <select
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
          value={role}
          onChange={(e) => setRole(e.target.value as InvitableRole)}
        >
          <option value="editor">editor — can write definitions</option>
          <option value="admin">admin — can also invite</option>
        </select>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={invite.isPending}
          className="bg-black text-white rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          Send invitation
        </button>
        <p className="text-xs text-gray-500">
          No email is sent (yet) — share the link out of band; the role applies on their first
          sign-in.
        </p>
      </form>
    </div>
  );
}
