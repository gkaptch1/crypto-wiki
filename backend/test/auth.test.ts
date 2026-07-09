import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authedInject, makeApp, resetDb, signUp, type TestApp } from './helpers';
import { prisma } from '../src/lib/prisma';

let app: TestApp;

beforeAll(async () => {
  await resetDb();
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('sessions and roles', () => {
  it('sign-up without an invitation yields a viewer', async () => {
    const { cookie } = await signUp(app);
    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().role).toBe('viewer');
  });

  it('/me without a session is 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });

  it('ADMIN_EMAILS bootstraps the first admin on sign-up', async () => {
    const { cookie, user } = await signUp(app, { email: 'root@admin.test' });
    expect(user.role).toBe('admin');
    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    expect(me.json().role).toBe('admin');
  });

  it('sign-out invalidates the session cookie', async () => {
    const { cookie } = await signUp(app);
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie },
      payload: {},
    });
    expect(out.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});

describe('write guards', () => {
  const payload = { slug: 'guarded', title: 'Guarded Definition' };

  it('wiki writes require a session', async () => {
    const res = await app.inject({ method: 'POST', url: '/definitions', payload });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHENTICATED');
  });

  it('viewers cannot write wiki content', async () => {
    const { cookie } = await signUp(app);
    const res = await app.inject({ method: 'POST', url: '/definitions', payload, headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('editors can write wiki content, and authorship is recorded', async () => {
    const { cookie, user } = await signUp(app, { role: 'editor' });
    const res = await app.inject({
      method: 'POST',
      url: '/definitions',
      payload: { ...payload, formulation: { bodyLatex: 'x' } },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(201);

    const def = await prisma.definition.findUniqueOrThrow({
      where: { slug: 'guarded' },
      include: { formulations: { include: { revisions: true } } },
    });
    expect(def.createdById).toBe(user.id);
    expect(def.formulations[0].createdById).toBe(user.id);
    expect(def.formulations[0].revisions[0].authorId).toBe(user.id);
  });

  it('the editor read surface (drafts) is not public', async () => {
    const anon = await app.inject({ method: 'GET', url: '/definitions/guarded' });
    expect(anon.statusCode).toBe(401);

    const { cookie } = await signUp(app); // viewer
    const viewer = await app.inject({ method: 'GET', url: '/definitions/guarded', headers: { cookie } });
    expect(viewer.statusCode).toBe(403);
  });

  it('browse, categories and permalinks stay public', async () => {
    const list = await app.inject({ method: 'GET', url: '/definitions' });
    expect(list.statusCode).toBe(200);
    const cats = await app.inject({ method: 'GET', url: '/categories' });
    expect(cats.statusCode).toBe(200);
  });

  it('CORS preflight allows credentialed PATCH/DELETE from the frontend origin', async () => {
    // @fastify/cors only allows GET/HEAD/POST unless methods is explicit —
    // this silently broke editor saves in the browser once
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/definitions/x/formulations/y/revisions/1',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PATCH',
      },
    });
    expect(res.headers['access-control-allow-methods']).toContain('PATCH');
    expect(res.headers['access-control-allow-methods']).toContain('DELETE');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('invitations', () => {
  let admin: TestApp['inject'];

  beforeAll(async () => {
    admin = authedInject(app, (await signUp(app, { role: 'admin' })).cookie);
  });

  it('only admins can manage invitations', async () => {
    const { cookie } = await signUp(app, { role: 'editor' });
    const res = await app.inject({ method: 'GET', url: '/invitations', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('an invited email becomes an editor on first sign-in', async () => {
    const invite = await admin({
      method: 'POST',
      url: '/invitations',
      payload: { email: 'Alice@Example.Test' },
    });
    expect(invite.statusCode).toBe(201);
    expect(invite.json().email).toBe('alice@example.test'); // normalized
    expect(invite.json().role).toBe('editor');
    expect(invite.json().acceptedAt).toBeNull();

    const { user } = await signUp(app, { email: 'alice@example.test' });
    expect(user.role).toBe('editor');

    const list = await admin({ method: 'GET', url: '/invitations' });
    const accepted = list.json().find((i: any) => i.email === 'alice@example.test');
    expect(accepted.acceptedAt).not.toBeNull();
  });

  it('inviting an existing viewer upgrades them immediately', async () => {
    const { user } = await signUp(app, { email: 'late@example.test' });
    expect(user.role).toBe('viewer');

    const invite = await admin({
      method: 'POST',
      url: '/invitations',
      payload: { email: 'late@example.test' },
    });
    expect(invite.statusCode).toBe(201);
    expect(invite.json().acceptedAt).not.toBeNull();

    const upgraded = await prisma.user.findUniqueOrThrow({ where: { email: 'late@example.test' } });
    expect(upgraded.role).toBe('editor');
  });

  it('inviting an existing admin as editor never demotes', async () => {
    const { user } = await signUp(app, { role: 'admin' });
    await admin({ method: 'POST', url: '/invitations', payload: { email: user.email, role: 'editor' } });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.role).toBe('admin');
  });

  it('duplicate invitations 409; revocation works', async () => {
    const dup = await admin({
      method: 'POST',
      url: '/invitations',
      payload: { email: 'alice@example.test' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('INVITATION_EXISTS');

    const fresh = await admin({
      method: 'POST',
      url: '/invitations',
      payload: { email: 'revoked@example.test' },
    });
    const del = await admin({ method: 'DELETE', url: `/invitations/${fresh.json().id}` });
    expect(del.statusCode).toBe(204);

    // with the invitation gone, sign-up falls back to viewer
    const { user } = await signUp(app, { email: 'revoked@example.test' });
    expect(user.role).toBe('viewer');
  });

  it('clients cannot grant themselves a role at sign-up', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: {
        email: 'sneaky@example.test',
        password: 'correct horse battery staple',
        name: 'Sneaky',
        role: 'admin',
      },
    });
    // better-auth ignores non-input fields; whatever the response, the stored
    // role must be viewer
    expect([200, 400, 422]).toContain(res.statusCode);
    const user = await prisma.user.findUnique({ where: { email: 'sneaky@example.test' } });
    if (user) expect(user.role).toBe('viewer');
  });
});
