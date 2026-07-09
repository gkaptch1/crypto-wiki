import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useAuth } from '../lib/auth-client';

/**
 * Gate for the editor surface. Purely cosmetic — the API enforces the editor
 * role on every write and on draft reads; this just replaces guaranteed 401/403
 * screens with an explanation.
 */
export default function RequireEditor({ children }: { children: ReactNode }) {
  const { isPending, isSignedIn, isEditor } = useAuth();

  if (isPending) return <p className="text-gray-500">Loading…</p>;

  if (!isSignedIn) {
    return (
      <div className="max-w-md space-y-2">
        <h1 className="text-xl font-bold">Editor</h1>
        <p className="text-gray-600">
          Editing requires an invited account.{' '}
          <Link to="/signin" className="text-blue-700 underline">
            Sign in
          </Link>{' '}
          to continue.
        </p>
      </div>
    );
  }

  if (!isEditor) {
    return (
      <div className="max-w-md space-y-2">
        <h1 className="text-xl font-bold">Editor</h1>
        <p className="text-gray-600">
          Your account can read everything and manage macro sets, but writing definitions is
          invite-only. Ask an administrator to invite your email address.
        </p>
      </div>
    );
  }

  return children;
}
