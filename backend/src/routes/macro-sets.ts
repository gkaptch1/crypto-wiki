import { Type } from '@sinclair/typebox';
import { schemas, PINNED_HASH_LENGTH, formatMacroSetRef } from '@crypto-wiki/shared';
import type { MacroMap } from '@crypto-wiki/shared';
import { prisma } from '../lib/prisma';
import { sendError } from '../lib/errors';
import { macroHash } from '../lib/hash';
import { serializeMacroSet } from '../lib/serialize';
import { getSessionUser, requireSignIn, type SessionUser } from '../lib/session';
import type { AppInstance } from '../app';

const UuidParams = Type.Object({
  uuid: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  }),
});

const AUTH_ERRORS = { 401: schemas.ApiError, 403: schemas.ApiError };

// only the owner (or an admin) may modify a set; pre-auth sets have no owner
// and are admin-managed
function canManage(user: SessionUser, set: { ownerId: string | null }) {
  return user.role === 'admin' || (set.ownerId !== null && set.ownerId === user.id);
}

const ownerName = { owner: { select: { name: true } } } as const;

// Notation sets may only restyle registered names (PLAN.md "Layered macros").
// Write-time only — existing sets and pinned snapshots are never re-checked,
// so registry changes cannot alter what a published permalink renders.
// Returns the offending names, or null when the map is valid.
async function unregisteredNames(macros: MacroMap): Promise<string[] | null> {
  const names = Object.keys(macros);
  if (names.length === 0) return null;
  const known = await prisma.macroName.findMany({
    where: { name: { in: names } },
    select: { name: true },
  });
  const registered = new Set(known.map((n) => n.name));
  const unknown = names.filter((n) => !registered.has(n));
  return unknown.length > 0 ? unknown : null;
}

// Macro-set CRUD. Visibility rules (audited by test/anonymous-audit.test.ts):
//  - only `public` sets are ever enumerated; unlisted/anonymous are link-only
//  - anonymous sets are serialized without owner OR timestamps (serializeMacroSet)
//  - the response schemas hard-strip anything a serializer might leak
//  - de-anonymize = PATCH visibility; the uuid never changes, so links keep working
export async function macroSetRoutes(app: AppInstance) {
  app.get(
    '/macro-sets',
    { schema: { response: { 200: Type.Array(schemas.MacroSetPublic) } } },
    async () => {
      const sets = await prisma.macroSet.findMany({
        where: { visibility: 'public' },
        orderBy: { name: 'asc' },
        include: ownerName,
      });
      return sets.map(serializeMacroSet);
    },
  );

  app.get(
    '/macro-sets/:uuid',
    {
      schema: {
        params: UuidParams,
        response: { 200: schemas.MacroSetPublic, 404: schemas.ApiError },
      },
    },
    async (request, reply) => {
      const set = await prisma.macroSet.findUnique({
        where: { uuid: request.params.uuid },
        include: ownerName,
      });
      if (!set) {
        return sendError(reply, 404, 'MACRO_SET_NOT_FOUND', `Macro set ${request.params.uuid} not found.`);
      }
      // canEdit is a per-requester UI hint (owner/admin); it never identifies
      // the owner to anyone else, so it is safe on anonymous sets too
      const user = await getSessionUser(request);
      return { ...serializeMacroSet(set), canEdit: user !== null && canManage(user, set) };
    },
  );

  // any signed-in user can create macro sets (their own notation is the whole
  // point); wiki content is what needs the invited editor role
  app.post(
    '/macro-sets',
    {
      preHandler: requireSignIn,
      schema: {
        body: schemas.CreateMacroSetBody,
        response: { 201: schemas.MacroSetPublic, 422: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const { name, macros, visibility = 'public' } = request.body;
      const unknown = await unregisteredNames(macros);
      if (unknown) {
        return sendError(
          reply,
          422,
          'UNREGISTERED_NAMES',
          `Notation sets may only define registered macro names; not registered: ${unknown.join(', ')}. ` +
            'Register the name (with its meaning) first, or drop it from the set.',
        );
      }
      const set = await prisma.macroSet.create({
        data: { name, macros, visibility, ownerId: request.sessionUser!.id },
        include: ownerName,
      });
      return reply.code(201).send(serializeMacroSet(set));
    },
  );

  app.patch(
    '/macro-sets/:uuid',
    {
      preHandler: requireSignIn,
      schema: {
        params: UuidParams,
        body: schemas.UpdateMacroSetBody,
        response: {
          200: schemas.MacroSetPublic,
          404: schemas.ApiError,
          422: schemas.ApiError,
          ...AUTH_ERRORS,
        },
      },
    },
    async (request, reply) => {
      const existing = await prisma.macroSet.findUnique({ where: { uuid: request.params.uuid } });
      if (!existing) {
        return sendError(reply, 404, 'MACRO_SET_NOT_FOUND', `Macro set ${request.params.uuid} not found.`);
      }
      if (!canManage(request.sessionUser!, existing)) {
        return sendError(reply, 403, 'NOT_OWNER', 'Only the owner of a macro set can modify it.');
      }
      const { name, macros, visibility } = request.body;
      if (macros !== undefined) {
        const unknown = await unregisteredNames(macros);
        if (unknown) {
          return sendError(
            reply,
            422,
            'UNREGISTERED_NAMES',
            `Notation sets may only define registered macro names; not registered: ${unknown.join(', ')}. ` +
              'Register the name (with its meaning) first, or drop it from the set.',
          );
        }
      }
      const set = await prisma.macroSet.update({
        where: { id: existing.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(macros !== undefined ? { macros } : {}),
          ...(visibility !== undefined ? { visibility } : {}),
        },
        include: ownerName,
      });
      return serializeMacroSet(set);
    },
  );

  app.delete(
    '/macro-sets/:uuid',
    {
      preHandler: requireSignIn,
      schema: {
        params: UuidParams,
        response: { 204: Type.Null(), 404: schemas.ApiError, 409: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const set = await prisma.macroSet.findUnique({
        where: { uuid: request.params.uuid },
        include: { _count: { select: { snapshots: true } } },
      });
      if (!set) {
        return sendError(reply, 404, 'MACRO_SET_NOT_FOUND', `Macro set ${request.params.uuid} not found.`);
      }
      if (!canManage(request.sessionUser!, set)) {
        return sendError(reply, 403, 'NOT_OWNER', 'Only the owner of a macro set can delete it.');
      }
      if (set._count.snapshots > 0) {
        return sendError(
          reply,
          409,
          'MACRO_SET_PINNED',
          'This macro set has pinned snapshots referenced by permalinks and cannot be deleted.',
        );
      }
      await prisma.macroSet.delete({ where: { id: set.id } });
      return reply.code(204).send(null);
    },
  );

  // Freeze the current content as an immutable snapshot and return the
  // ?macros= ref papers should cite. Idempotent: same content → same hash.
  // Deliberately public: "copy citable permalink" on the definition page must
  // work for signed-out readers.
  app.post(
    '/macro-sets/:uuid/pin',
    {
      schema: {
        params: UuidParams,
        response: { 200: schemas.MacroSetPin, 404: schemas.ApiError },
      },
    },
    async (request, reply) => {
      const set = await prisma.macroSet.findUnique({ where: { uuid: request.params.uuid } });
      if (!set) {
        return sendError(reply, 404, 'MACRO_SET_NOT_FOUND', `Macro set ${request.params.uuid} not found.`);
      }
      const hash = macroHash(set.macros as MacroMap);
      await prisma.macroSetSnapshot.upsert({
        where: { macroSetId_hash: { macroSetId: set.id, hash } },
        create: { macroSetId: set.id, hash, macros: set.macros as MacroMap },
        update: {},
      });
      return {
        uuid: set.uuid,
        hash,
        ref: formatMacroSetRef({ uuid: set.uuid, hash: hash.slice(0, PINNED_HASH_LENGTH) }),
      };
    },
  );

  app.post(
    '/macro-sets/:uuid/fork',
    {
      preHandler: requireSignIn,
      schema: {
        params: UuidParams,
        body: schemas.ForkMacroSetBody,
        response: { 201: schemas.MacroSetPublic, 404: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const source = await prisma.macroSet.findUnique({ where: { uuid: request.params.uuid } });
      if (!source) {
        return sendError(reply, 404, 'MACRO_SET_NOT_FOUND', `Macro set ${request.params.uuid} not found.`);
      }
      const fork = await prisma.macroSet.create({
        data: {
          name: request.body.name ?? `${source.name} (fork)`,
          macros: source.macros as MacroMap,
          visibility: request.body.visibility ?? 'unlisted',
          ownerId: request.sessionUser!.id,
        },
        include: ownerName,
      });
      return reply.code(201).send(serializeMacroSet(fork));
    },
  );
}
