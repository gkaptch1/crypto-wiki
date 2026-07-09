import { createRootRoute, Link, Outlet, useNavigate } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { signOut, useAuth } from '../lib/auth-client';

const navLink =
  'text-gray-600 hover:text-black [&.active]:font-semibold [&.active]:text-black';

const ROLE_STYLES: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-800',
  editor: 'bg-green-100 text-green-800',
  viewer: 'bg-gray-100 text-gray-600',
};

function SessionControls() {
  const { user, role, isPending } = useAuth();
  const navigate = useNavigate();

  if (isPending) return <span className="text-sm text-gray-400">…</span>;

  if (!user) {
    return (
      <Link to="/signin" className="text-sm border border-gray-300 rounded px-3 py-1.5 hover:border-black">
        Sign in
      </Link>
    );
  }

  return (
    <span className="flex items-center gap-2 text-sm">
      {user.image && <img src={user.image} alt="" className="h-6 w-6 rounded-full" />}
      <span className="font-medium">{user.name}</span>
      {role && (
        <span className={`rounded px-1.5 py-0.5 text-xs ${ROLE_STYLES[role] ?? ''}`}>{role}</span>
      )}
      <button
        className="text-gray-500 hover:text-black underline"
        onClick={() => signOut().then(() => navigate({ to: '/' }))}
      >
        Sign out
      </button>
    </span>
  );
}

function RootLayout() {
  const { isEditor, isAdmin } = useAuth();
  return (
    <>
      <header className="border-b border-gray-200 bg-white">
        <nav className="mx-auto max-w-5xl px-4 py-3 flex items-baseline gap-6">
          <Link to="/" className="font-bold text-lg">
            Crypto Wiki
          </Link>
          <Link to="/wiki" className={navLink}>
            Browse
          </Link>
          {isEditor && (
            <Link to="/editor" className={navLink}>
              Editor
            </Link>
          )}
          <Link to="/macros" className={navLink}>
            Macro sets
          </Link>
          {isAdmin && (
            <Link to="/admin" className={navLink}>
              Admin
            </Link>
          )}
          <span className="ml-auto">
            <SessionControls />
          </span>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
      <TanStackRouterDevtools />
    </>
  );
}

export const Route = createRootRoute({ component: RootLayout });
