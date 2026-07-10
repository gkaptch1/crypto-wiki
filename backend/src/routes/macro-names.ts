import { schemas } from '@crypto-wiki/shared';
import { prisma } from '../lib/prisma';
import { isP2002, sendError } from '../lib/errors';
import { requireEditor } from '../lib/session';
import type { AppInstance } from '../app';

// The macro-name registry (PLAN.md "Layered macros"): the site's canonical
// vocabulary of macro names + meanings. Notation sets are validated against
// it at write time (routes/macro-sets.ts); it is never consulted at render
// time, so registering a name later can never change a published render.

export async function macroNameRoutes(app: AppInstance) {
  app.get(
    '/macro-names',
    { schema: { response: { 200: schemas.MacroNameList } } },
    async () => {
      const names = await prisma.macroName.findMany({ orderBy: { name: 'asc' } });
      return names.map((n) => ({ name: n.name, description: n.description }));
    },
  );

  app.post(
    '/macro-names',
    {
      preHandler: requireEditor,
      schema: {
        body: schemas.CreateMacroNameBody,
        response: {
          201: schemas.MacroName,
          409: schemas.ApiError,
          401: schemas.ApiError,
          403: schemas.ApiError,
        },
      },
    },
    async (request, reply) => {
      const { name, description } = request.body;
      try {
        const created = await prisma.macroName.create({
          data: { name, description, createdById: request.sessionUser!.id },
        });
        return reply.code(201).send({ name: created.name, description: created.description });
      } catch (err) {
        if (isP2002(err, 'name')) {
          return sendError(reply, 409, 'NAME_TAKEN', `"${name}" is already registered.`);
        }
        throw err;
      }
    },
  );
}
