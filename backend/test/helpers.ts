import { buildApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import type { Role } from '../generated/prisma/client';

export async function makeApp() {
  const app = buildApp({ logger: false });
  await app.ready();
  return app;
}

export type TestApp = Awaited<ReturnType<typeof makeApp>>;

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Revision", "Formulation", "Definition", "MacroSetSnapshot", "MacroSet", "Category", "Invitation", "Session", "Account", "Verification", "User" RESTART IDENTITY CASCADE',
  );
}

let userCounter = 0;

/**
 * Create a user through better-auth's password strategy (enabled in tests via
 * AUTH_PASSWORD_SIGNIN) and return their session cookie. Roles are granted by
 * the invitation/admin-email hooks on sign-up; the `role` option force-sets
 * one directly in the DB for tests that just need a ready-made editor/admin.
 */
export async function signUp(
  app: TestApp,
  opts: { email?: string; name?: string; role?: Role } = {},
) {
  userCounter += 1;
  const email = opts.email ?? `user-${userCounter}@example.test`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'correct horse battery staple', name: opts.name ?? `User ${userCounter}` },
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed (${res.statusCode}): ${res.body}`);
  const setCookie = res.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie])
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!cookie.includes('session_token')) throw new Error(`sign-up returned no session cookie: ${cookie}`);
  if (opts.role && opts.role !== 'viewer') {
    await prisma.user.update({ where: { email }, data: { role: opts.role } });
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookie, user };
}

/** Bind a session cookie onto app.inject (extra headers still win). */
export function authedInject(app: TestApp, cookie: string): TestApp['inject'] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inject is overloaded
  return ((opts: any) =>
    app.inject({ ...opts, headers: { cookie, ...(opts.headers ?? {}) } })) as TestApp['inject'];
}

/** Create a definition with one formulation and a published r1 via the API. */
export async function publishDefinition(
  inject: TestApp['inject'],
  {
    slug,
    title,
    fSlug = 'standard',
    body = `\\textbf{Definition (${title}).} Let $x$ be arbitrary.`,
  }: { slug: string; title: string; fSlug?: string; body?: string },
) {
  const created = await inject({
    method: 'POST',
    url: '/definitions',
    payload: { slug, title, formulation: { slug: fSlug, bodyLatex: body } },
  });
  if (created.statusCode !== 201) throw new Error(`create failed: ${created.body}`);
  const draftId = created.json().formulations[0].revisions[0].id as number;
  const published = await inject({
    method: 'POST',
    url: `/definitions/${slug}/formulations/${fSlug}/revisions/${draftId}/publish`,
  });
  if (published.statusCode !== 200) throw new Error(`publish failed: ${published.body}`);
  return { draftId, revision: published.json() };
}
