import { Type } from '@sinclair/typebox';
import { schemas, PINNED_HASH_LENGTH, formatMacroSetRef } from '@crypto-wiki/shared';
import type { MacroMap } from '@crypto-wiki/shared';
import { prisma } from '../lib/prisma';
import { sendError } from '../lib/errors';
import { macroHash } from '../lib/hash';
import { serializeMacroSet } from '../lib/serialize';
import type { AppInstance } from '../app';

const UuidParams = Type.Object({
  uuid: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  }),
});

// Macro-set CRUD. Visibility rules that must survive into Phase 2 unchanged:
//  - only `public` sets are ever enumerated; unlisted/anonymous are link-only
//  - anonymous sets are serialized without timestamps (serializeMacroSet)
//  - the response schemas hard-strip anything a serializer might leak
export async function macroSetRoutes(app: AppInstance) {
  app.get(
    '/macro-sets',
    { schema: { response: { 200: Type.Array(schemas.MacroSetPublic) } } },
    async () => {
      const sets = await prisma.macroSet.findMany({
        where: { visibility: 'public' },
        orderBy: { name: 'asc' },
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
      const set = await prisma.macroSet.findUnique({ where: { uuid: request.params.uuid } });
      if (!set) {
        return sendError(reply, 404, 'MACRO_SET_NOT_FOUND', `Macro set ${request.params.uuid} not found.`);
      }
      return serializeMacroSet(set);
    },
  );

  app.post(
    '/macro-sets',
    {
      schema: {
        body: schemas.CreateMacroSetBody,
        response: { 201: schemas.MacroSetPublic },
      },
    },
    async (request, reply) => {
      const { name, macros, visibility = 'public' } = request.body;
      const set = await prisma.macroSet.create({ data: { name, macros, visibility } });
      return reply.code(201).send(serializeMacroSet(set));
    },
  );

  app.patch(
    '/macro-sets/:uuid',
    {
      schema: {
        params: UuidParams,
        body: schemas.UpdateMacroSetBody,
        response: { 200: schemas.MacroSetPublic, 404: schemas.ApiError },
      },
    },
    async (request, reply) => {
      const { name, macros, visibility } = request.body;
      try {
        const set = await prisma.macroSet.update({
          where: { uuid: request.params.uuid },
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(macros !== undefined ? { macros } : {}),
            ...(visibility !== undefined ? { visibility } : {}),
          },
        });
        return serializeMacroSet(set);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') {
          return sendError(reply, 404, 'MACRO_SET_NOT_FOUND', `Macro set ${request.params.uuid} not found.`);
        }
        throw err;
      }
    },
  );

  app.delete(
    '/macro-sets/:uuid',
    {
      schema: {
        params: UuidParams,
        response: { 204: Type.Null(), 404: schemas.ApiError, 409: schemas.ApiError },
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
      schema: {
        params: UuidParams,
        body: schemas.ForkMacroSetBody,
        response: { 201: schemas.MacroSetPublic, 404: schemas.ApiError },
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
        },
      });
      return reply.code(201).send(serializeMacroSet(fork));
    },
  );
}
