import { createRootRoute, Link, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';

function RootLayout() {
  return (
    <>
      <header className="border-b border-gray-200 bg-white">
        <nav className="mx-auto max-w-5xl px-4 py-3 flex items-baseline gap-6">
          <Link to="/" className="font-bold text-lg">
            Crypto Wiki
          </Link>
          <Link to="/wiki" className="text-gray-600 hover:text-black [&.active]:font-semibold [&.active]:text-black">
            Browse
          </Link>
          <Link to="/editor" className="text-gray-600 hover:text-black [&.active]:font-semibold [&.active]:text-black">
            Editor
          </Link>
          <Link to="/macros" className="text-gray-600 hover:text-black [&.active]:font-semibold [&.active]:text-black">
            Macro sets
          </Link>
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
