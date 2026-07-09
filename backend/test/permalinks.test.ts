import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, publishDefinition, resetDb } from './helpers';
import { prisma } from '../src/lib/prisma';

let app: Awaited<ReturnType<typeof makeApp>>;

beforeAll(async () => {
  await resetDb();
  app = await makeApp();

  await publishDefinition(app, { slug: 'prf', title: 'Pseudorandom Function', fSlug: 'standard', body: 'PRF r1 body.' });
  // publish an r2 on the same formulation
  const draft = await app.inject({
    method: 'POST',
    url: '/definitions/prf/formulations/standard/revisions',
    payload: { bodyLatex: 'PRF r2 body.' },
  });
  await app.inject({
    method: 'POST',
    url: `/definitions/prf/formulations/standard/revisions/${draft.json().id}/publish`,
  });
  // a second, non-default formulation with one published revision
  await app.inject({
    method: 'POST',
    url: '/definitions/prf/formulations',
    payload: { slug: 'concrete' },
  });
  const cDraft = await app.inject({
    method: 'POST',
    url: '/definitions/prf/formulations/concrete/revisions',
    payload: { bodyLatex: 'PRF concrete body.' },
  });
  await app.inject({
    method: 'POST',
    url: `/definitions/prf/formulations/concrete/revisions/${cDraft.json().id}/publish`,
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('permalink resolution', () => {
  it('/def/:slug returns the default formulation at its latest published revision', async () => {
    const res = await app.inject({ method: 'GET', url: '/def/prf' });
    expect(res.statusCode).toBe(200);
    const page = res.json();
    expect(page.formulation.slug).toBe('standard');
    expect(page.revision.number).toBe(2);
    expect(page.revision.pinned).toBe(false);
    expect(page.revision.bodyLatex).toBe('PRF r2 body.');
    expect(page.formulations.map((f: any) => f.slug)).toEqual(['standard', 'concrete']);
    expect(page.publishedRevisions.map((r: any) => r.number)).toEqual([2, 1]);
  });

  it('/def/:slug/:formulation selects that formulation', async () => {
    const res = await app.inject({ method: 'GET', url: '/def/prf/concrete' });
    expect(res.statusCode).toBe(200);
    expect(res.json().revision.bodyLatex).toBe('PRF concrete body.');
  });

  it('/def/:slug/:formulation@rN pins a revision immutably', async () => {
    const res = await app.inject({ method: 'GET', url: '/def/prf/standard@r1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().revision.number).toBe(1);
    expect(res.json().revision.pinned).toBe(true);
    expect(res.json().revision.bodyLatex).toBe('PRF r1 body.');
  });

  it('missing pieces 404 with specific codes', async () => {
    const noDef = await app.inject({ method: 'GET', url: '/def/nope' });
    expect(noDef.json().code).toBe('DEFINITION_NOT_FOUND');

    const noForm = await app.inject({ method: 'GET', url: '/def/prf/nope' });
    expect(noForm.json().code).toBe('FORMULATION_NOT_FOUND');

    const noRev = await app.inject({ method: 'GET', url: '/def/prf/standard@r99' });
    expect(noRev.json().code).toBe('REVISION_NOT_FOUND');
  });

  it('rejects malformed formulation refs', async () => {
    const res = await app.inject({ method: 'GET', url: '/def/prf/standard@rev2' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_FORMULATION_REF');
  });

  it('falls back to a published formulation when the default has none', async () => {
    // new definition: default formulation stays draft, second formulation published
    await app.inject({
      method: 'POST',
      url: '/definitions',
      payload: { slug: 'owf', title: 'One-Way Function', formulation: { slug: 'main', bodyLatex: 'draft only' } },
    });
    await app.inject({
      method: 'POST',
      url: '/definitions/owf/formulations',
      payload: { slug: 'alt' },
    });
    const draft = await app.inject({
      method: 'POST',
      url: '/definitions/owf/formulations/alt/revisions',
      payload: { bodyLatex: 'OWF alt body.' },
    });
    await app.inject({
      method: 'POST',
      url: `/definitions/owf/formulations/alt/revisions/${draft.json().id}/publish`,
    });

    const res = await app.inject({ method: 'GET', url: '/def/owf' });
    expect(res.statusCode).toBe(200);
    expect(res.json().formulation.slug).toBe('alt');
    // the draft-only formulation must not appear in the public tab list
    expect(res.json().formulations.map((f: any) => f.slug)).toEqual(['alt']);
  });
});
