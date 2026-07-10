import { Type } from '@sinclair/typebox';
import { schemas } from '@crypto-wiki/shared';
import type { CitationInput } from '@crypto-wiki/shared';
import { prisma } from '../lib/prisma';
import { isP2002, sendError } from '../lib/errors';
import {
  serializeDefinitionEditor,
  serializeRevision,
} from '../lib/serialize';
import { requireEditor } from '../lib/session';
import type { AppInstance } from '../app';

// Editor API: full CRUD over definitions / formulations / revisions,
// including drafts. The invariant this file enforces everywhere:
// **published revisions are immutable** — no update, no delete, and nothing
// that would break an existing permalink (definition/formulation slugs
// freeze once anything under them is published).
//
// Access (Phase 2): the browse list and categories stay public; everything
// else here — drafts included — is the editor surface and needs the invited
// editor role. Public reads go through routes/permalinks.ts.

const AUTH_ERRORS = { 401: schemas.ApiError, 403: schemas.ApiError };

const DefParams = Type.Object({ defSlug: schemas.Slug });
const FormulationParams = Type.Object({ defSlug: schemas.Slug, fSlug: schemas.Slug });
const RevisionParams = Type.Object({
  defSlug: schemas.Slug,
  fSlug: schemas.Slug,
  revisionId: Type.Integer({ minimum: 1 }),
});

// map a CitationInput onto the flat cite* columns; null clears a field
function citationData(c?: CitationInput) {
  if (!c) return {};
  const out: Record<string, string | number | null> = {};
  if (c.paper !== undefined) out.citePaper = c.paper;
  if (c.authors !== undefined) out.citeAuthors = c.authors;
  if (c.venue !== undefined) out.citeVenue = c.venue;
  if (c.year !== undefined) out.citeYear = c.year;
  if (c.doi !== undefined) out.citeDoi = c.doi;
  if (c.eprint !== undefined) out.citeEprint = c.eprint;
  return out;
}

const editorInclude = {
  categories: true,
  formulations: {
    orderBy: { order: 'asc' },
    include: {
      defaultMacroSet: true,
      revisions: { orderBy: { createdAt: 'desc' } },
    },
  },
} as const;

export async function definitionRoutes(app: AppInstance) {
  // ------------------------------------------------------------------ list
  app.get(
    '/definitions',
    {
      schema: {
        querystring: schemas.ListDefinitionsQuery,
        response: { 200: schemas.DefinitionList },
      },
    },
    async (request) => {
      const { q, category } = request.query;
      const defs = await prisma.definition.findMany({
        where: {
          ...(q
            ? {
                OR: [
                  { title: { contains: q, mode: 'insensitive' } },
                  { slug: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
          ...(category ? { categories: { some: { name: category } } } : {}),
        },
        include: {
          categories: true,
          formulations: {
            include: { revisions: { where: { status: 'published' }, take: 1 } },
          },
        },
        orderBy: { title: 'asc' },
      });
      return defs.map((d) => ({
        slug: d.slug,
        title: d.title,
        categories: d.categories.map((c) => c.name).sort(),
        formulationCount: d.formulations.length,
        hasPublished: d.formulations.some((f) => f.revisions.length > 0),
        updatedAt: d.updatedAt.toISOString(),
      }));
    },
  );

  app.get(
    '/categories',
    { schema: { response: { 200: schemas.CategoryList } } },
    async () => {
      const cats = await prisma.category.findMany({
        include: { _count: { select: { definitions: true } } },
        orderBy: { name: 'asc' },
      });
      return cats.map((c) => ({ name: c.name, definitionCount: c._count.definitions }));
    },
  );

  // ---------------------------------------------------------------- create
  app.post(
    '/definitions',
    {
      preHandler: requireEditor,
      schema: {
        body: schemas.CreateDefinitionBody,
        response: { 201: schemas.DefinitionEditor, 409: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const { slug, title, categories = [], formulation } = request.body;
      const userId = request.sessionUser!.id;
      try {
        const def = await prisma.definition.create({
          data: {
            slug,
            title,
            createdById: userId,
            categories: {
              connectOrCreate: categories.map((name) => ({ where: { name }, create: { name } })),
            },
            ...(formulation
              ? {
                  formulations: {
                    create: {
                      slug: formulation.slug ?? 'default',
                      isDefault: true,
                      order: 0,
                      createdById: userId,
                      ...citationData(formulation.citation),
                      revisions: {
                        create: {
                          bodyLatex: formulation.bodyLatex ?? '',
                          commentaryMd: formulation.commentaryMd ?? '',
                          macros: formulation.macros ?? {},
                          localMacros: formulation.localMacros ?? {},
                          authorId: userId,
                        },
                      },
                    },
                  },
                }
              : {}),
          },
          include: editorInclude,
        });
        return reply
          .code(201)
          .send(serializeDefinitionEditor(def, def.formulations));
      } catch (err) {
        if (isP2002(err, 'slug')) {
          return sendError(reply, 409, 'SLUG_TAKEN', `A definition with slug "${slug}" already exists.`);
        }
        if (isP2002(err, 'title')) {
          return sendError(reply, 409, 'TITLE_TAKEN', `A definition titled "${title}" already exists.`);
        }
        throw err;
      }
    },
  );

  // ------------------------------------------------------------------ read
  app.get(
    '/definitions/:defSlug',
    {
      preHandler: requireEditor,
      schema: {
        params: DefParams,
        response: { 200: schemas.DefinitionEditor, 404: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const def = await prisma.definition.findUnique({
        where: { slug: request.params.defSlug },
        include: editorInclude,
      });
      if (!def) {
        return sendError(reply, 404, 'DEFINITION_NOT_FOUND', `Definition "${request.params.defSlug}" not found.`);
      }
      return serializeDefinitionEditor(def, def.formulations);
    },
  );

  // ---------------------------------------------------------------- update
  app.patch(
    '/definitions/:defSlug',
    {
      preHandler: requireEditor,
      schema: {
        params: DefParams,
        body: schemas.UpdateDefinitionBody,
        response: { 200: schemas.DefinitionEditor, 404: schemas.ApiError, 409: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const { title, categories } = request.body;
      try {
        const def = await prisma.definition.update({
          where: { slug: request.params.defSlug },
          data: {
            ...(title !== undefined ? { title } : {}),
            ...(categories !== undefined
              ? {
                  categories: {
                    set: [],
                    connectOrCreate: categories.map((name) => ({
                      where: { name },
                      create: { name },
                    })),
                  },
                }
              : {}),
          },
          include: editorInclude,
        });
        return serializeDefinitionEditor(def, def.formulations);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') {
          return sendError(reply, 404, 'DEFINITION_NOT_FOUND', `Definition "${request.params.defSlug}" not found.`);
        }
        if (isP2002(err, 'title')) {
          return sendError(reply, 409, 'TITLE_TAKEN', `A definition titled "${title}" already exists.`);
        }
        throw err;
      }
    },
  );

  // ---------------------------------------------------------------- delete
  app.delete(
    '/definitions/:defSlug',
    {
      preHandler: requireEditor,
      schema: {
        params: DefParams,
        response: { 204: Type.Null(), 404: schemas.ApiError, 409: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const def = await prisma.definition.findUnique({
        where: { slug: request.params.defSlug },
        select: { id: true },
      });
      if (!def) {
        return sendError(reply, 404, 'DEFINITION_NOT_FOUND', `Definition "${request.params.defSlug}" not found.`);
      }
      const publishedCount = await prisma.revision.count({
        where: { formulation: { definitionId: def.id }, status: 'published' },
      });
      if (publishedCount > 0) {
        return sendError(
          reply,
          409,
          'HAS_PUBLISHED',
          'This definition has published revisions; permalinks must keep working, so it cannot be deleted.',
        );
      }
      await prisma.$transaction([
        prisma.revision.deleteMany({ where: { formulation: { definitionId: def.id } } }),
        prisma.formulation.deleteMany({ where: { definitionId: def.id } }),
        prisma.definition.delete({ where: { id: def.id } }),
      ]);
      return reply.code(204).send(null);
    },
  );

  // ---------------------------------------------------------- formulations
  app.post(
    '/definitions/:defSlug/formulations',
    {
      preHandler: requireEditor,
      schema: {
        params: DefParams,
        body: schemas.CreateFormulationBody,
        response: {
          201: schemas.DefinitionEditor,
          404: schemas.ApiError,
          409: schemas.ApiError,
          ...AUTH_ERRORS,
        },
      },
    },
    async (request, reply) => {
      const { defSlug } = request.params;
      const { slug, citation, defaultMacroSetUuid, isDefault } = request.body;

      const def = await prisma.definition.findUnique({
        where: { slug: defSlug },
        include: { formulations: { select: { id: true, order: true } } },
      });
      if (!def) {
        return sendError(reply, 404, 'DEFINITION_NOT_FOUND', `Definition "${defSlug}" not found.`);
      }

      let macroSetId: number | null = null;
      if (defaultMacroSetUuid) {
        const set = await prisma.macroSet.findUnique({ where: { uuid: defaultMacroSetUuid } });
        if (!set) {
          return sendError(reply, 404, 'MACRO_SET_NOT_FOUND', `Macro set ${defaultMacroSetUuid} not found.`);
        }
        macroSetId = set.id;
      }

      // the first formulation is always the default one
      const makeDefault = isDefault === true || def.formulations.length === 0;
      const nextOrder = def.formulations.reduce((m, f) => Math.max(m, f.order + 1), 0);

      try {
        await prisma.$transaction(async (tx) => {
          if (makeDefault) {
            await tx.formulation.updateMany({
              where: { definitionId: def.id },
              data: { isDefault: false },
            });
          }
          await tx.formulation.create({
            data: {
              slug,
              definitionId: def.id,
              isDefault: makeDefault,
              order: nextOrder,
              defaultMacroSetId: macroSetId,
              createdById: request.sessionUser!.id,
              ...citationData(citation),
            },
          });
        });
      } catch (err) {
        if (isP2002(err, 'slug')) {
          return sendError(reply, 409, 'SLUG_TAKEN', `Formulation "${slug}" already exists on "${defSlug}".`);
        }
        if (isP2002(err, 'order')) {
          return sendError(reply, 409, 'CONCURRENT_WRITE', 'Concurrent formulation creation; please retry.');
        }
        throw err;
      }

      const updated = await prisma.definition.findUniqueOrThrow({
        where: { id: def.id },
        include: editorInclude,
      });
      return reply.code(201).send(serializeDefinitionEditor(updated, updated.formulations));
    },
  );

  app.patch(
    '/definitions/:defSlug/formulations/:fSlug',
    {
      preHandler: requireEditor,
      schema: {
        params: FormulationParams,
        body: schemas.UpdateFormulationBody,
        response: {
          200: schemas.DefinitionEditor,
          404: schemas.ApiError,
          409: schemas.ApiError,
          ...AUTH_ERRORS,
        },
      },
    },
    async (request, reply) => {
      const { defSlug, fSlug } = request.params;
      const { slug: newSlug, citation, defaultMacroSetUuid, isDefault } = request.body;

      const formulation = await prisma.formulation.findFirst({
        where: { slug: fSlug, definition: { slug: defSlug } },
        include: {
          _count: { select: { revisions: { where: { status: 'published' } } } },
        },
      });
      if (!formulation) {
        return sendError(reply, 404, 'FORMULATION_NOT_FOUND', `Definition "${defSlug}" has no formulation "${fSlug}".`);
      }

      if (newSlug !== undefined && newSlug !== fSlug && formulation._count.revisions > 0) {
        return sendError(
          reply,
          409,
          'FORMULATION_FROZEN',
          'This formulation has published revisions; its slug is part of citable permalinks and cannot change.',
        );
      }

      let macroSetPatch = {};
      if (defaultMacroSetUuid === null) {
        macroSetPatch = { defaultMacroSetId: null };
      } else if (defaultMacroSetUuid !== undefined) {
        const set = await prisma.macroSet.findUnique({ where: { uuid: defaultMacroSetUuid } });
        if (!set) {
          return sendError(reply, 404, 'MACRO_SET_NOT_FOUND', `Macro set ${defaultMacroSetUuid} not found.`);
        }
        macroSetPatch = { defaultMacroSetId: set.id };
      }

      try {
        await prisma.$transaction(async (tx) => {
          if (isDefault === true) {
            await tx.formulation.updateMany({
              where: { definitionId: formulation.definitionId },
              data: { isDefault: false },
            });
          }
          await tx.formulation.update({
            where: { id: formulation.id },
            data: {
              ...(newSlug !== undefined ? { slug: newSlug } : {}),
              ...(isDefault === true ? { isDefault: true } : {}),
              ...macroSetPatch,
              ...citationData(citation),
            },
          });
        });
      } catch (err) {
        if (isP2002(err, 'slug')) {
          return sendError(reply, 409, 'SLUG_TAKEN', `Formulation "${newSlug}" already exists on "${defSlug}".`);
        }
        throw err;
      }

      const updated = await prisma.definition.findUniqueOrThrow({
        where: { slug: defSlug },
        include: editorInclude,
      });
      return serializeDefinitionEditor(updated, updated.formulations);
    },
  );

  app.delete(
    '/definitions/:defSlug/formulations/:fSlug',
    {
      preHandler: requireEditor,
      schema: {
        params: FormulationParams,
        response: { 204: Type.Null(), 404: schemas.ApiError, 409: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const { defSlug, fSlug } = request.params;
      const formulation = await prisma.formulation.findFirst({
        where: { slug: fSlug, definition: { slug: defSlug } },
        include: {
          _count: { select: { revisions: { where: { status: 'published' } } } },
        },
      });
      if (!formulation) {
        return sendError(reply, 404, 'FORMULATION_NOT_FOUND', `Definition "${defSlug}" has no formulation "${fSlug}".`);
      }
      if (formulation._count.revisions > 0) {
        return sendError(
          reply,
          409,
          'HAS_PUBLISHED',
          'This formulation has published revisions; permalinks must keep working, so it cannot be deleted.',
        );
      }
      await prisma.$transaction(async (tx) => {
        await tx.revision.deleteMany({ where: { formulationId: formulation.id } });
        await tx.formulation.delete({ where: { id: formulation.id } });
        if (formulation.isDefault) {
          // promote the next formulation (lowest order) so a default always exists
          const next = await tx.formulation.findFirst({
            where: { definitionId: formulation.definitionId },
            orderBy: { order: 'asc' },
          });
          if (next) {
            await tx.formulation.update({ where: { id: next.id }, data: { isDefault: true } });
          }
        }
      });
      return reply.code(204).send(null);
    },
  );

  // ------------------------------------------------------------- revisions
  async function findFormulation(defSlug: string, fSlug: string) {
    return prisma.formulation.findFirst({
      where: { slug: fSlug, definition: { slug: defSlug } },
    });
  }

  app.get(
    '/definitions/:defSlug/formulations/:fSlug/revisions',
    {
      preHandler: requireEditor,
      schema: {
        params: FormulationParams,
        response: { 200: Type.Array(schemas.Revision), 404: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const { defSlug, fSlug } = request.params;
      const formulation = await findFormulation(defSlug, fSlug);
      if (!formulation) {
        return sendError(reply, 404, 'FORMULATION_NOT_FOUND', `Definition "${defSlug}" has no formulation "${fSlug}".`);
      }
      const revisions = await prisma.revision.findMany({
        where: { formulationId: formulation.id },
        orderBy: { createdAt: 'desc' },
      });
      return revisions.map(serializeRevision);
    },
  );

  app.post(
    '/definitions/:defSlug/formulations/:fSlug/revisions',
    {
      preHandler: requireEditor,
      schema: {
        params: FormulationParams,
        body: schemas.CreateRevisionBody,
        response: { 201: schemas.Revision, 404: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const { defSlug, fSlug } = request.params;
      const formulation = await findFormulation(defSlug, fSlug);
      if (!formulation) {
        return sendError(reply, 404, 'FORMULATION_NOT_FOUND', `Definition "${defSlug}" has no formulation "${fSlug}".`);
      }
      const revision = await prisma.revision.create({
        data: {
          formulationId: formulation.id,
          bodyLatex: request.body.bodyLatex,
          commentaryMd: request.body.commentaryMd ?? '',
          macros: request.body.macros ?? {},
          localMacros: request.body.localMacros ?? {},
          authorId: request.sessionUser!.id,
        },
      });
      return reply.code(201).send(serializeRevision(revision));
    },
  );

  // shared lookup: revision by id, scoped to its definition+formulation path
  async function findRevision(defSlug: string, fSlug: string, revisionId: number) {
    return prisma.revision.findFirst({
      where: {
        id: revisionId,
        formulation: { slug: fSlug, definition: { slug: defSlug } },
      },
    });
  }

  app.get(
    '/definitions/:defSlug/formulations/:fSlug/revisions/:revisionId',
    {
      preHandler: requireEditor,
      schema: {
        params: RevisionParams,
        response: { 200: schemas.Revision, 404: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const { defSlug, fSlug, revisionId } = request.params;
      const revision = await findRevision(defSlug, fSlug, revisionId);
      if (!revision) {
        return sendError(reply, 404, 'REVISION_NOT_FOUND', `No revision ${revisionId} under ${defSlug}/${fSlug}.`);
      }
      return serializeRevision(revision);
    },
  );

  app.patch(
    '/definitions/:defSlug/formulations/:fSlug/revisions/:revisionId',
    {
      preHandler: requireEditor,
      schema: {
        params: RevisionParams,
        body: schemas.UpdateRevisionBody,
        response: { 200: schemas.Revision, 404: schemas.ApiError, 409: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const { defSlug, fSlug, revisionId } = request.params;
      const revision = await findRevision(defSlug, fSlug, revisionId);
      if (!revision) {
        return sendError(reply, 404, 'REVISION_NOT_FOUND', `No revision ${revisionId} under ${defSlug}/${fSlug}.`);
      }
      if (revision.status === 'published') {
        return sendError(
          reply,
          409,
          'REVISION_IMMUTABLE',
          'Published revisions are immutable. Create a new revision instead.',
        );
      }
      const updated = await prisma.revision.update({
        where: { id: revision.id },
        data: {
          ...(request.body.bodyLatex !== undefined ? { bodyLatex: request.body.bodyLatex } : {}),
          ...(request.body.commentaryMd !== undefined
            ? { commentaryMd: request.body.commentaryMd }
            : {}),
          ...(request.body.macros !== undefined ? { macros: request.body.macros } : {}),
          ...(request.body.localMacros !== undefined
            ? { localMacros: request.body.localMacros }
            : {}),
        },
      });
      return serializeRevision(updated);
    },
  );

  app.post(
    '/definitions/:defSlug/formulations/:fSlug/revisions/:revisionId/publish',
    {
      preHandler: requireEditor,
      schema: {
        params: RevisionParams,
        response: {
          200: schemas.Revision,
          404: schemas.ApiError,
          409: schemas.ApiError,
          422: schemas.ApiError,
          ...AUTH_ERRORS,
        },
      },
    },
    async (request, reply) => {
      const { defSlug, fSlug, revisionId } = request.params;
      const revision = await findRevision(defSlug, fSlug, revisionId);
      if (!revision) {
        return sendError(reply, 404, 'REVISION_NOT_FOUND', `No revision ${revisionId} under ${defSlug}/${fSlug}.`);
      }
      if (revision.status === 'published') {
        return sendError(reply, 409, 'ALREADY_PUBLISHED', `Revision ${revisionId} is already published as r${revision.number}.`);
      }
      if (revision.bodyLatex.trim() === '') {
        return sendError(reply, 422, 'EMPTY_BODY', 'Cannot publish a revision with an empty LaTeX body.');
      }

      try {
        const published = await prisma.$transaction(async (tx) => {
          const max = await tx.revision.aggregate({
            where: { formulationId: revision.formulationId, status: 'published' },
            _max: { number: true },
          });
          return tx.revision.update({
            where: { id: revision.id },
            data: {
              status: 'published',
              number: (max._max.number ?? 0) + 1,
              publishedAt: new Date(),
            },
          });
        });
        return serializeRevision(published);
      } catch (err) {
        // unique [formulationId, number] lost a race with a concurrent publish
        if (isP2002(err)) {
          return sendError(reply, 409, 'CONCURRENT_WRITE', 'Concurrent publish; please retry.');
        }
        throw err;
      }
    },
  );

  app.delete(
    '/definitions/:defSlug/formulations/:fSlug/revisions/:revisionId',
    {
      preHandler: requireEditor,
      schema: {
        params: RevisionParams,
        response: { 204: Type.Null(), 404: schemas.ApiError, 409: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const { defSlug, fSlug, revisionId } = request.params;
      const revision = await findRevision(defSlug, fSlug, revisionId);
      if (!revision) {
        return sendError(reply, 404, 'REVISION_NOT_FOUND', `No revision ${revisionId} under ${defSlug}/${fSlug}.`);
      }
      if (revision.status === 'published') {
        return sendError(
          reply,
          409,
          'REVISION_IMMUTABLE',
          'Published revisions are citable and cannot be deleted.',
        );
      }
      await prisma.revision.delete({ where: { id: revision.id } });
      return reply.code(204).send(null);
    },
  );
}
