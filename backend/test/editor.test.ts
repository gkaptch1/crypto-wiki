import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, publishDefinition, resetDb } from './helpers';
import { prisma } from '../src/lib/prisma';

let app: Awaited<ReturnType<typeof makeApp>>;

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('definition lifecycle', () => {
  it('creates a definition with an initial formulation and draft', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/definitions',
      payload: {
        slug: 'prf',
        title: 'Pseudorandom Function',
        categories: ['foundations'],
        formulation: { slug: 'game-based', bodyLatex: '\\textbf{Definition.} PRF v1.' },
      },
    });
    expect(res.statusCode).toBe(201);
    const def = res.json();
    expect(def.slug).toBe('prf');
    expect(def.formulations).toHaveLength(1);
    expect(def.formulations[0].isDefault).toBe(true);
    expect(def.formulations[0].revisions[0].status).toBe('draft');
    expect(def.formulations[0].revisions[0].number).toBeNull();
  });

  it('rejects duplicate slug and title with 409', async () => {
    const dupSlug = await app.inject({
      method: 'POST',
      url: '/definitions',
      payload: { slug: 'prf', title: 'Something Else' },
    });
    expect(dupSlug.statusCode).toBe(409);
    expect(dupSlug.json().code).toBe('SLUG_TAKEN');

    const dupTitle = await app.inject({
      method: 'POST',
      url: '/definitions',
      payload: { slug: 'prf2', title: 'Pseudorandom Function' },
    });
    expect(dupTitle.statusCode).toBe(409);
    expect(dupTitle.json().code).toBe('TITLE_TAKEN');
  });

  it('rejects malformed slugs with a validation error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/definitions',
      payload: { slug: 'Not A Slug!', title: 'Bad' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION');
  });

  it('a definition with only drafts is not published', async () => {
    const res = await app.inject({ method: 'GET', url: '/def/prf' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_PUBLISHED');
  });
});

describe('revision lifecycle and immutability', () => {
  let draftId: number;

  it('publishes a draft as r1', async () => {
    const editor = await app.inject({ method: 'GET', url: '/definitions/prf' });
    draftId = editor.json().formulations[0].revisions[0].id;

    const res = await app.inject({
      method: 'POST',
      url: `/definitions/prf/formulations/game-based/revisions/${draftId}/publish`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('published');
    expect(res.json().number).toBe(1);
    expect(res.json().publishedAt).not.toBeNull();
  });

  it('published revisions cannot be edited, re-published, or deleted', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: `/definitions/prf/formulations/game-based/revisions/${draftId}`,
      payload: { bodyLatex: 'sneaky edit' },
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().code).toBe('REVISION_IMMUTABLE');

    const republish = await app.inject({
      method: 'POST',
      url: `/definitions/prf/formulations/game-based/revisions/${draftId}/publish`,
    });
    expect(republish.statusCode).toBe(409);
    expect(republish.json().code).toBe('ALREADY_PUBLISHED');

    const del = await app.inject({
      method: 'DELETE',
      url: `/definitions/prf/formulations/game-based/revisions/${draftId}`,
    });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe('REVISION_IMMUTABLE');
  });

  it('a second published revision gets r2 and drafts stay editable', async () => {
    const draft = await app.inject({
      method: 'POST',
      url: '/definitions/prf/formulations/game-based/revisions',
      payload: { bodyLatex: '\\textbf{Definition.} PRF v2.' },
    });
    expect(draft.statusCode).toBe(201);
    const id = draft.json().id;

    const edit = await app.inject({
      method: 'PATCH',
      url: `/definitions/prf/formulations/game-based/revisions/${id}`,
      payload: { commentaryMd: 'now with commentary' },
    });
    expect(edit.statusCode).toBe(200);

    const pub = await app.inject({
      method: 'POST',
      url: `/definitions/prf/formulations/game-based/revisions/${id}/publish`,
    });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().number).toBe(2);
  });

  it('refuses to publish an empty body', async () => {
    const draft = await app.inject({
      method: 'POST',
      url: '/definitions/prf/formulations/game-based/revisions',
      payload: { bodyLatex: '   ' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/definitions/prf/formulations/game-based/revisions/${draft.json().id}/publish`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('EMPTY_BODY');
  });
});

describe('permalink freezing of slugs', () => {
  it('formulation slugs freeze once published', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/definitions/prf/formulations/game-based',
      payload: { slug: 'renamed' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('FORMULATION_FROZEN');
  });

  it('draft-only formulations can still be renamed and deleted', async () => {
    await app.inject({
      method: 'POST',
      url: '/definitions/prf/formulations',
      payload: { slug: 'scratch' },
    });
    const rename = await app.inject({
      method: 'PATCH',
      url: '/definitions/prf/formulations/scratch',
      payload: { slug: 'scratch-two' },
    });
    expect(rename.statusCode).toBe(200);

    const del = await app.inject({
      method: 'DELETE',
      url: '/definitions/prf/formulations/scratch-two',
    });
    expect(del.statusCode).toBe(204);
  });

  it('definitions with published content cannot be deleted', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/definitions/prf' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('HAS_PUBLISHED');
  });

  it('draft-only definitions can be deleted', async () => {
    await app.inject({
      method: 'POST',
      url: '/definitions',
      payload: { slug: 'scratch-def', title: 'Scratch', formulation: { bodyLatex: 'x' } },
    });
    const res = await app.inject({ method: 'DELETE', url: '/definitions/scratch-def' });
    expect(res.statusCode).toBe(204);
    const gone = await app.inject({ method: 'GET', url: '/definitions/scratch-def' });
    expect(gone.statusCode).toBe(404);
  });
});

describe('default formulation handling', () => {
  it('setting a new default unsets the old one', async () => {
    await app.inject({
      method: 'POST',
      url: '/definitions/prf/formulations',
      payload: { slug: 'concrete' },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/definitions/prf/formulations/concrete',
      payload: { isDefault: true },
    });
    expect(res.statusCode).toBe(200);
    const forms = res.json().formulations;
    expect(forms.find((f: any) => f.slug === 'concrete').isDefault).toBe(true);
    expect(forms.find((f: any) => f.slug === 'game-based').isDefault).toBe(false);

    // restore for later suites
    await app.inject({
      method: 'PATCH',
      url: '/definitions/prf/formulations/game-based',
      payload: { isDefault: true },
    });
  });
});

describe('search and browse', () => {
  it('filters by q and category', async () => {
    await publishDefinition(app, { slug: 'ind-cpa', title: 'IND-CPA Security' });
    await app.inject({
      method: 'PATCH',
      url: '/definitions/ind-cpa',
      payload: { categories: ['encryption'] },
    });

    const byQ = await app.inject({ method: 'GET', url: '/definitions?q=cpa' });
    expect(byQ.json().map((d: any) => d.slug)).toEqual(['ind-cpa']);

    const byCat = await app.inject({ method: 'GET', url: '/definitions?category=encryption' });
    expect(byCat.json().map((d: any) => d.slug)).toEqual(['ind-cpa']);

    const all = await app.inject({ method: 'GET', url: '/definitions' });
    expect(all.json().length).toBeGreaterThanOrEqual(2);
    const prf = all.json().find((d: any) => d.slug === 'prf');
    expect(prf.hasPublished).toBe(true);
  });
});
