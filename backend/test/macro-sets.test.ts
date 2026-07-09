import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, publishDefinition, resetDb } from './helpers';
import { prisma } from '../src/lib/prisma';

let app: Awaited<ReturnType<typeof makeApp>>;

const macros = { '\\adv': '\\mathcal{A}', '\\secpar': '\\lambda' };
const altMacros = { '\\adv': 'D', '\\secpar': 'n' };

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  await publishDefinition(app, { slug: 'prf', title: 'Pseudorandom Function' });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function createSet(payload: Record<string, unknown>) {
  const res = await app.inject({ method: 'POST', url: '/macro-sets', payload });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe('macro-set CRUD and visibility', () => {
  it('creates and updates macro sets', async () => {
    const set = await createSet({ name: 'standard', macros });
    expect(set.visibility).toBe('public');
    expect(set.macros).toEqual(macros);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/macro-sets/${set.uuid}`,
      payload: { name: 'standard-notation' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().name).toBe('standard-notation');
  });

  it('rejects invalid macro names', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/macro-sets',
      payload: { name: 'bad', macros: { 'not-a-macro': 'x' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION');
  });

  it('only lists public sets', async () => {
    await createSet({ name: 'linky', macros, visibility: 'unlisted' });
    await createSet({ name: 'sneaky', macros, visibility: 'anonymous' });

    const res = await app.inject({ method: 'GET', url: '/macro-sets' });
    const names = res.json().map((s: any) => s.name);
    expect(names).toContain('standard-notation');
    expect(names).not.toContain('linky');
    expect(names).not.toContain('sneaky');
  });

  it('anonymous sets are reachable by uuid but carry no timestamps', async () => {
    const anon = await createSet({ name: 'anon', macros, visibility: 'anonymous' });
    expect(anon.createdAt).toBeUndefined();
    expect(anon.updatedAt).toBeUndefined();

    const res = await app.inject({ method: 'GET', url: `/macro-sets/${anon.uuid}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('anon');
    expect(res.json().createdAt).toBeUndefined();
    expect(res.json().updatedAt).toBeUndefined();
  });

  it('public sets do carry timestamps', async () => {
    const set = await createSet({ name: 'timestamped', macros });
    expect(set.createdAt).toBeDefined();
  });

  it('forking copies the macros into a new set', async () => {
    const src = await createSet({ name: 'origin', macros });
    const res = await app.inject({ method: 'POST', url: `/macro-sets/${src.uuid}/fork`, payload: {} });
    expect(res.statusCode).toBe(201);
    expect(res.json().uuid).not.toBe(src.uuid);
    expect(res.json().macros).toEqual(macros);
    expect(res.json().name).toBe('origin (fork)');
    expect(res.json().visibility).toBe('unlisted');
  });
});

describe('macro rendering and pinning on permalinks', () => {
  it('?macros=<uuid> renders under the live set', async () => {
    const set = await createSet({ name: 'render-live', macros });
    const res = await app.inject({ method: 'GET', url: `/def/prf?macros=${set.uuid}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().macros).toEqual(macros);
    expect(res.json().pinnedMacroHash).toBeNull();
  });

  it('a pinned snapshot survives edits to the live set', async () => {
    const set = await createSet({ name: 'render-pinned', macros });
    const pin = await app.inject({ method: 'POST', url: `/macro-sets/${set.uuid}/pin` });
    expect(pin.statusCode).toBe(200);
    const { ref, hash } = pin.json();
    expect(ref).toBe(`${set.uuid}@${hash.slice(0, 16)}`);

    // mutate the live set — the permalink pinned to the snapshot must not move
    await app.inject({ method: 'PATCH', url: `/macro-sets/${set.uuid}`, payload: { macros: altMacros } });

    const pinned = await app.inject({ method: 'GET', url: `/def/prf?macros=${ref}` });
    expect(pinned.statusCode).toBe(200);
    expect(pinned.json().macros).toEqual(macros);
    expect(pinned.json().pinnedMacroHash).toBe(hash);

    const live = await app.inject({ method: 'GET', url: `/def/prf?macros=${set.uuid}` });
    expect(live.json().macros).toEqual(altMacros);
  });

  it('pinning is idempotent per content', async () => {
    const set = await createSet({ name: 'idem', macros });
    const first = await app.inject({ method: 'POST', url: `/macro-sets/${set.uuid}/pin` });
    const second = await app.inject({ method: 'POST', url: `/macro-sets/${set.uuid}/pin` });
    expect(first.json().hash).toBe(second.json().hash);
    const count = await prisma.macroSetSnapshot.count({
      where: { macroSet: { uuid: set.uuid } },
    });
    expect(count).toBe(1);
  });

  it('unknown snapshot hashes 404', async () => {
    const set = await createSet({ name: 'nohash', macros });
    const res = await app.inject({
      method: 'GET',
      url: `/def/prf?macros=${set.uuid}@deadbeefdeadbeef`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('MACRO_SNAPSHOT_NOT_FOUND');
  });

  it('pinned sets cannot be deleted; unpinned ones can', async () => {
    const pinnedSet = await createSet({ name: 'keep-me', macros });
    await app.inject({ method: 'POST', url: `/macro-sets/${pinnedSet.uuid}/pin` });
    const delPinned = await app.inject({ method: 'DELETE', url: `/macro-sets/${pinnedSet.uuid}` });
    expect(delPinned.statusCode).toBe(409);
    expect(delPinned.json().code).toBe('MACRO_SET_PINNED');

    const freeSet = await createSet({ name: 'free', macros });
    const delFree = await app.inject({ method: 'DELETE', url: `/macro-sets/${freeSet.uuid}` });
    expect(delFree.statusCode).toBe(204);
  });

  it("a formulation's default macro set applies when ?macros= is absent", async () => {
    const set = await createSet({ name: 'default-set', macros });
    await app.inject({
      method: 'PATCH',
      url: '/definitions/prf/formulations/standard',
      payload: { defaultMacroSetUuid: set.uuid },
    });
    const res = await app.inject({ method: 'GET', url: '/def/prf' });
    expect(res.json().macroSet.name).toBe('default-set');
    expect(res.json().macros).toEqual(macros);
  });
});
