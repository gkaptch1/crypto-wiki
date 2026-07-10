import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authedInject, makeApp, resetDb, signUp, type TestApp } from './helpers';
import { prisma } from '../src/lib/prisma';

// PLAN.md "Layered macros": revision-scoped macro maps (shared + local),
// notation sets validated against the MacroName registry at write time,
// and the render merge that seals local macros from notation sets.

let app: TestApp;
let inject: TestApp['inject'];
let viewerInject: TestApp['inject'];

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
  inject = authedInject(app, (await signUp(app, { role: 'editor' })).cookie);
  viewerInject = authedInject(app, (await signUp(app, { role: 'viewer' })).cookie);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('macro-name registry', () => {
  it('lists the seeded core vocabulary publicly', async () => {
    const res = await app.inject({ method: 'GET', url: '/macro-names' });
    expect(res.statusCode).toBe(200);
    const names = res.json() as { name: string; description: string }[];
    const enc = names.find((n) => n.name === '\\enc');
    expect(enc?.description).toMatch(/[Ee]ncryption/);
    expect(names.find((n) => n.name === '\\encode')?.description).toMatch(/NOT encryption/);
  });

  it('registration is editor-gated', async () => {
    const anon = await app.inject({
      method: 'POST',
      url: '/macro-names',
      payload: { name: '\\newthing', description: 'A new thing' },
    });
    expect(anon.statusCode).toBe(401);
    const viewer = await viewerInject({
      method: 'POST',
      url: '/macro-names',
      payload: { name: '\\newthing', description: 'A new thing' },
    });
    expect(viewer.statusCode).toBe(403);
  });

  it('editors can register; duplicates 409', async () => {
    const created = await inject({
      method: 'POST',
      url: '/macro-names',
      payload: { name: '\\oprf', description: 'Oblivious PRF evaluation' },
    });
    expect(created.statusCode).toBe(201);
    const dup = await inject({
      method: 'POST',
      url: '/macro-names',
      payload: { name: '\\oprf', description: 'Something else' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('NAME_TAKEN');
  });
});

describe('notation-set validation against the registry', () => {
  it('rejects unregistered names on create with the offenders listed', async () => {
    const res = await inject({
      method: 'POST',
      url: '/macro-sets',
      payload: { name: 'bad set', macros: { '\\enc': 'E', '\\myweirdmacro': 'x' } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('UNREGISTERED_NAMES');
    expect(res.json().message).toContain('\\myweirdmacro');
    expect(res.json().message).not.toContain('\\enc,');
  });

  it('rejects unregistered names on update, accepts registered ones', async () => {
    const created = await inject({
      method: 'POST',
      url: '/macro-sets',
      payload: { name: 'good set', macros: { '\\enc': '\\mathsf{E}' } },
    });
    expect(created.statusCode).toBe(201);
    const uuid = created.json().uuid;

    const badPatch = await inject({
      method: 'PATCH',
      url: `/macro-sets/${uuid}`,
      payload: { macros: { '\\notregistered': 'x' } },
    });
    expect(badPatch.statusCode).toBe(422);

    const okPatch = await inject({
      method: 'PATCH',
      url: `/macro-sets/${uuid}`,
      payload: { macros: { '\\enc': '\\mathsf{Enc}', '\\adv': '\\mathcal{A}' } },
    });
    expect(okPatch.statusCode).toBe(200);
  });

  it('a freshly registered name becomes usable in sets', async () => {
    await inject({
      method: 'POST',
      url: '/macro-names',
      payload: { name: '\\stego', description: 'Steganographic embedding algorithm' },
    });
    const res = await inject({
      method: 'POST',
      url: '/macro-sets',
      payload: { name: 'stego set', macros: { '\\stego': '\\mathsf{Embed}' } },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('revision-scoped macros', () => {
  it('travel through create, patch, and the editor read; frozen at publish', async () => {
    const created = await inject({
      method: 'POST',
      url: '/definitions',
      payload: {
        slug: 'prc',
        title: 'Pseudorandom Code',
        formulation: {
          slug: 'standard',
          bodyLatex: 'A code with $\\encode$ and private $\\LDPC$.',
          macros: { '\\encode': '\\mathsf{Encode}' },
          localMacros: { '\\LDPC': '\\mathsf{LDPC}' },
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const rev = created.json().formulations[0].revisions[0];
    expect(rev.macros).toEqual({ '\\encode': '\\mathsf{Encode}' });
    expect(rev.localMacros).toEqual({ '\\LDPC': '\\mathsf{LDPC}' });

    const patched = await inject({
      method: 'PATCH',
      url: `/definitions/prc/formulations/standard/revisions/${rev.id}`,
      payload: { localMacros: { '\\LDPC': '\\mathsf{LDPC}', '\\Wt': '\\mathsf{wt}' } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().localMacros['\\Wt']).toBe('\\mathsf{wt}');

    const published = await inject({
      method: 'POST',
      url: `/definitions/prc/formulations/standard/revisions/${rev.id}/publish`,
    });
    expect(published.statusCode).toBe(200);

    const frozen = await inject({
      method: 'PATCH',
      url: `/definitions/prc/formulations/standard/revisions/${rev.id}`,
      payload: { macros: { '\\encode': 'CHANGED' } },
    });
    expect(frozen.statusCode).toBe(409);
    expect(frozen.json().code).toBe('REVISION_IMMUTABLE');
  });

  it('permalink page merges revision layers with no notation set', async () => {
    const page = await app.inject({ method: 'GET', url: '/def/prc' });
    expect(page.statusCode).toBe(200);
    expect(page.json().macros).toEqual({
      '\\encode': '\\mathsf{Encode}',
      '\\LDPC': '\\mathsf{LDPC}',
      '\\Wt': '\\mathsf{wt}',
    });
  });

  it('a notation set overrides shared symbols but never local macros', async () => {
    const set = await inject({
      method: 'POST',
      url: '/macro-sets',
      payload: { name: 'my notation', macros: { '\\encode': '\\mathsf{MyEnc}' } },
    });
    const uuid = set.json().uuid;

    const page = await app.inject({ method: 'GET', url: `/def/prc?macros=${uuid}` });
    expect(page.statusCode).toBe(200);
    const macros = page.json().macros;
    expect(macros['\\encode']).toBe('\\mathsf{MyEnc}'); // shared: overridden
    expect(macros['\\LDPC']).toBe('\\mathsf{LDPC}'); // local: sealed

    // defense in depth: even a legacy set that somehow contains a local name
    // (predates validation / direct DB write) cannot override it — merge
    // order puts locals last
    await prisma.macroSet.update({
      where: { uuid },
      data: { macros: { '\\encode': '\\mathsf{MyEnc}', '\\LDPC': 'CONTAMINATED' } },
    });
    const page2 = await app.inject({ method: 'GET', url: `/def/prc?macros=${uuid}` });
    expect(page2.json().macros['\\LDPC']).toBe('\\mathsf{LDPC}');
  });

  it('the formulation default set layers the same way', async () => {
    const set = await inject({
      method: 'POST',
      url: '/macro-sets',
      payload: { name: 'default notation', macros: { '\\encode': '\\mathsf{DefEnc}' } },
    });
    await inject({
      method: 'PATCH',
      url: '/definitions/prc/formulations/standard',
      payload: { defaultMacroSetUuid: set.json().uuid },
    });
    const page = await app.inject({ method: 'GET', url: '/def/prc' });
    expect(page.json().macros['\\encode']).toBe('\\mathsf{DefEnc}');
    expect(page.json().macros['\\LDPC']).toBe('\\mathsf{LDPC}');
  });
});
