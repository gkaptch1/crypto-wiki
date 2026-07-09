import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import type { Role } from '@crypto-wiki/shared';

// Talks to better-auth mounted at <backend>/api/auth; the session rides on a
// cross-origin cookie, hence credentials: 'include' here AND in api/client.ts.
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BACKEND_URL as string,
  plugins: [inferAdditionalFields({ user: { role: { type: 'string', input: false } } })],
  fetchOptions: { credentials: 'include' },
});

export const { useSession, signIn, signUp, signOut } = authClient;

/** Session + derived role flags, the shape most components actually want. */
export function useAuth() {
  const { data: session, isPending } = useSession();
  const role = (session?.user.role ?? null) as Role | null;
  return {
    session,
    user: session?.user ?? null,
    role,
    isPending,
    isSignedIn: session != null,
    isEditor: role === 'admin' || role === 'editor',
    isAdmin: role === 'admin',
  };
}
