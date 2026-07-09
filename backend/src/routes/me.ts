import { Type } from '@sinclair/typebox';
import { schemas } from '@crypto-wiki/shared';
import { prisma } from '../lib/prisma';
import { sendError } from '../lib/errors';
import { getSessionUser, requireSignIn } from '../lib/session';
import { serializeMacroSetOwned } from '../lib/serialize';
import type { AppInstance } from '../app';

export async function meRoutes(app: AppInstance) {
  // who am I (the SPA mostly uses better-auth's /api/auth/get-session; this
  // is the API-shaped equivalent, also handy for curl/tests)
  app.get(
    '/me',
    { schema: { response: { 200: schemas.SessionUserInfo, 401: schemas.ApiError } } },
    async (request, reply) => {
      const user = await getSessionUser(request);
      if (!user) return sendError(reply, 401, 'UNAUTHENTICATED', 'Not signed in.');
      return user;
    },
  );

  // the owner's own sets, every visibility included — this is the ONLY
  // endpoint that returns anonymous sets without knowing their uuid, and it
  // is strictly scoped to the authenticated owner
  app.get(
    '/me/macro-sets',
    {
      preHandler: requireSignIn,
      schema: {
        response: {
          200: Type.Array(schemas.MacroSetOwned),
          401: schemas.ApiError,
          403: schemas.ApiError,
        },
      },
    },
    async (request) => {
      const sets = await prisma.macroSet.findMany({
        where: { ownerId: request.sessionUser!.id },
        orderBy: { name: 'asc' },
        include: { _count: { select: { snapshots: true } } },
      });
      return sets.map(serializeMacroSetOwned);
    },
  );
}
