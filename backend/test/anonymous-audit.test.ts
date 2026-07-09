import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authedInject, makeApp, publishDefinition, resetDb, signUp, type TestApp } from './helpers';
import { prisma } from '../src/lib/prisma';

// PLAN.md Phase 2: "audit that no public response ever serializes owner or
// timestamps for anonymous sets and that no endpoint enumerates them".
// This file IS that audit — every public surface that can carry a macro set
// is checked against the raw response body.

let app: TestApp;
let owner: TestApp['inject'];
let ownerUser: Awaited<ReturnType<typeof signUp>>['user'];

const macros = { '\\adv': '\\mathcal{A}' };

// name/email are deliberately distinctive so a leak anywhere in a payload is
// caught by a plain substring scan
const OWNER_NAME = 'Zebra Q. Ostrichfeather';

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  const s = await signUp(app, { name: OWNER_NAME, email: 'zebra@ostrich.test', role: 'editor' });
  owner = authedInject(app, s.cookie);
  ownerUser = s.user;
  await publishDefinition(owner, { slug: 'prf', title: 'Pseudorandom Function' });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function createSet(visibility: 'public' | 'unlisted' | 'anonymous', name: string) {
  const res = await owner({
    method: 'POST',
    url: '/macro-sets',
    payload: { name, macros, visibility },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

/** Assert a public payload carries zero attribution for an anonymous set. */
function expectNoAttribution(rawBody: string) {
  expect(rawBody).not.toContain(OWNER_NAME);
  expect(rawBody).not.toContain('zebra@ostrich.test');
  expect(rawBody).not.toContain(ownerUser.id);
  expect(rawBody).not.toContain('ownerId');
}

describe('ownership of macro sets', () => {
  it('the creator owns the set; owner attribution appears on public sets', async () => {
    const set = await createSet('public', 'attributed');
    expect(set.owner).toBe(OWNER_NAME);

    const fetched = await app.inject({ method: 'GET', url: `/macro-sets/${set.uuid}` });
    expect(fetched.json().owner).toBe(OWNER_NAME);
  });

  it('non-owners cannot modify or delete a set; admins can', async () => {
    const set = await createSet('public', 'contested');

    const rando = authedInject(app, (await signUp(app)).cookie);
    const patch = await rando({
      method: 'PATCH',
      url: `/macro-sets/${set.uuid}`,
      payload: { name: 'stolen' },
    });
    expect(patch.statusCode).toBe(403);
    expect(patch.json().code).toBe('NOT_OWNER');
    const del = await rando({ method: 'DELETE', url: `/macro-sets/${set.uuid}` });
    expect(del.statusCode).toBe(403);

    const admin = authedInject(app, (await signUp(app, { role: 'admin' })).cookie);
    const adminPatch = await admin({
      method: 'PATCH',
      url: `/macro-sets/${set.uuid}`,
      payload: { name: 'moderated' },
    });
    expect(adminPatch.statusCode).toBe(200);
  });

  it('pre-auth (ownerless) sets are admin-managed', async () => {
    const legacy = await prisma.macroSet.create({
      data: { name: 'legacy', macros, visibility: 'public' },
    });
    const patch = await owner({
      method: 'PATCH',
      url: `/macro-sets/${legacy.uuid}`,
      payload: { name: 'grabbed' },
    });
    expect(patch.statusCode).toBe(403);

    const admin = authedInject(app, (await signUp(app, { role: 'admin' })).cookie);
    const adminPatch = await admin({
      method: 'PATCH',
      url: `/macro-sets/${legacy.uuid}`,
      payload: { name: 'legacy-renamed' },
    });
    expect(adminPatch.statusCode).toBe(200);
    expect(adminPatch.json().owner).toBeNull(); // still unowned, just renamed
  });

  it('creating and forking require a session; pinning does not (citation flow)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/macro-sets',
      payload: { name: 'nope', macros },
    });
    expect(create.statusCode).toBe(401);

    const set = await createSet('public', 'pin-target');
    const pin = await app.inject({ method: 'POST', url: `/macro-sets/${set.uuid}/pin` });
    expect(pin.statusCode).toBe(200);

    const anonFork = await app.inject({
      method: 'POST',
      url: `/macro-sets/${set.uuid}/fork`,
      payload: {},
    });
    expect(anonFork.statusCode).toBe(401);

    const forker = await signUp(app, { name: 'Forker McForkface' });
    const fork = await authedInject(app, forker.cookie)({
      method: 'POST',
      url: `/macro-sets/${set.uuid}/fork`,
      payload: {},
    });
    expect(fork.statusCode).toBe(201);
    expect(fork.json().owner).toBe('Forker McForkface');
  });

  it('/me/macro-sets lists only my sets, all visibilities included', async () => {
    await createSet('anonymous', 'my-secret-notation');
    const mine = await owner({ method: 'GET', url: '/me/macro-sets' });
    expect(mine.statusCode).toBe(200);
    const names = mine.json().map((s: any) => s.name);
    expect(names).toContain('my-secret-notation');
    // the owner's own view does include timestamps, even for anonymous sets
    const secret = mine.json().find((s: any) => s.name === 'my-secret-notation');
    expect(secret.createdAt).toBeDefined();

    const other = authedInject(app, (await signUp(app)).cookie);
    const theirs = await other({ method: 'GET', url: '/me/macro-sets' });
    expect(theirs.json()).toEqual([]);

    const anon = await app.inject({ method: 'GET', url: '/me/macro-sets' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('anonymous sets: the audit', () => {
  it('GET /macro-sets/:uuid never carries owner or timestamps', async () => {
    const set = await createSet('anonymous', 'double-blind');
    const res = await app.inject({ method: 'GET', url: `/macro-sets/${set.uuid}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.owner).toBeUndefined();
    expect(body.createdAt).toBeUndefined();
    expect(body.updatedAt).toBeUndefined();
    expectNoAttribution(res.body);
  });

  it('no endpoint enumerates anonymous (or unlisted) sets', async () => {
    await createSet('anonymous', 'unfindable');
    await createSet('unlisted', 'linky');
    const list = await app.inject({ method: 'GET', url: '/macro-sets' });
    const names = list.json().map((s: any) => s.name);
    expect(names).not.toContain('unfindable');
    expect(names).not.toContain('linky');
  });

  it('permalink pages render anonymous sets without attribution', async () => {
    const set = await createSet('anonymous', 'submission-notation');

    // live ?macros=
    const live = await app.inject({ method: 'GET', url: `/def/prf?macros=${set.uuid}` });
    expect(live.statusCode).toBe(200);
    expect(live.json().macroSet.name).toBe('submission-notation');
    expect(live.json().macroSet.owner).toBeUndefined();
    expect(live.json().macroSet.createdAt).toBeUndefined();
    expectNoAttribution(live.body);

    // pinned snapshot ?macros=uuid@hash
    const pin = await app.inject({ method: 'POST', url: `/macro-sets/${set.uuid}/pin` });
    const pinned = await app.inject({ method: 'GET', url: `/def/prf?macros=${pin.json().ref}` });
    expect(pinned.statusCode).toBe(200);
    expectNoAttribution(pinned.body);

    // as a formulation's default macro set
    await owner({
      method: 'PATCH',
      url: '/definitions/prf/formulations/standard',
      payload: { defaultMacroSetUuid: set.uuid },
    });
    const viaDefault = await app.inject({ method: 'GET', url: '/def/prf' });
    expect(viaDefault.statusCode).toBe(200);
    expect(viaDefault.json().macroSet.name).toBe('submission-notation');
    expectNoAttribution(viaDefault.body);
    await owner({
      method: 'PATCH',
      url: '/definitions/prf/formulations/standard',
      payload: { defaultMacroSetUuid: null },
    });
  });

  it('de-anonymize: flipping visibility restores attribution at the same uuid', async () => {
    const set = await createSet('anonymous', 'camera-ready');
    const flip = await owner({
      method: 'PATCH',
      url: `/macro-sets/${set.uuid}`,
      payload: { visibility: 'unlisted' },
    });
    expect(flip.statusCode).toBe(200);
    expect(flip.json().uuid).toBe(set.uuid); // links in the paper keep working
    expect(flip.json().owner).toBe(OWNER_NAME);
    expect(flip.json().createdAt).toBeDefined();

    // and the public read agrees
    const res = await app.inject({ method: 'GET', url: `/macro-sets/${set.uuid}` });
    expect(res.json().owner).toBe(OWNER_NAME);

    // flipping back re-anonymizes
    await owner({
      method: 'PATCH',
      url: `/macro-sets/${set.uuid}`,
      payload: { visibility: 'anonymous' },
    });
    const again = await app.inject({ method: 'GET', url: `/macro-sets/${set.uuid}` });
    expect(again.json().owner).toBeUndefined();
    expectNoAttribution(again.body);
  });
});
