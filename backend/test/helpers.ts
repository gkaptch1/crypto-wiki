import { buildApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

export async function makeApp() {
  const app = buildApp({ logger: false });
  await app.ready();
  return app;
}

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Revision", "Formulation", "Definition", "MacroSetSnapshot", "MacroSet", "Category" RESTART IDENTITY CASCADE',
  );
}

/** Create a definition with one formulation and a published r1 via the API. */
export async function publishDefinition(
  app: Awaited<ReturnType<typeof makeApp>>,
  {
    slug,
    title,
    fSlug = 'standard',
    body = `\\textbf{Definition (${title}).} Let $x$ be arbitrary.`,
  }: { slug: string; title: string; fSlug?: string; body?: string },
) {
  const created = await app.inject({
    method: 'POST',
    url: '/definitions',
    payload: { slug, title, formulation: { slug: fSlug, bodyLatex: body } },
  });
  if (created.statusCode !== 201) throw new Error(`create failed: ${created.body}`);
  const draftId = created.json().formulations[0].revisions[0].id as number;
  const published = await app.inject({
    method: 'POST',
    url: `/definitions/${slug}/formulations/${fSlug}/revisions/${draftId}/publish`,
  });
  if (published.statusCode !== 200) throw new Error(`publish failed: ${published.body}`);
  return { draftId, revision: published.json() };
}
