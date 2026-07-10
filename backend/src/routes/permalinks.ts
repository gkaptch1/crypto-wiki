import { Type } from '@sinclair/typebox';
import { schemas, parseFormulationRef, parseMacroSetRef } from '@crypto-wiki/shared';
import type { MacroMap, MacroSetPublic } from '@crypto-wiki/shared';
import type { FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { sendError } from '../lib/errors';
import { citationOf, serializeFormulationMeta, serializeMacroSet } from '../lib/serialize';
import type { AppInstance } from '../app';

// Public permalink resolution — what papers cite:
//   /def/prf                    default formulation, latest published revision
//   /def/prf/game-based         that formulation, latest published revision
//   /def/prf/game-based@r2      pinned revision (immutable)
//   ?macros=<uuid>              rendered under a macro set (live content)
//   ?macros=<uuid>@<hash>       rendered under a pinned macro-set snapshot
//
// Only published revisions are ever visible here; drafts live behind the
// editor endpoints in routes/definitions.ts.
export async function permalinkRoutes(app: AppInstance) {
  const responses = {
    200: schemas.DefinitionPage,
    400: schemas.ApiError,
    404: schemas.ApiError,
  };

  app.get(
    '/def/:defSlug',
    {
      schema: {
        params: Type.Object({ defSlug: schemas.Slug }),
        querystring: schemas.PermalinkQuery,
        response: responses,
      },
    },
    async (request, reply) =>
      resolvePage(reply, request.params.defSlug, null, request.query.macros ?? null),
  );

  app.get(
    '/def/:defSlug/:formulationRef',
    {
      schema: {
        params: Type.Object({
          defSlug: schemas.Slug,
          formulationRef: Type.String({ maxLength: 80 }),
        }),
        querystring: schemas.PermalinkQuery,
        response: responses,
      },
    },
    async (request, reply) =>
      resolvePage(
        reply,
        request.params.defSlug,
        request.params.formulationRef,
        request.query.macros ?? null,
      ),
  );
}

async function resolvePage(
  reply: FastifyReply,
  defSlug: string,
  formulationRef: string | null,
  macrosRef: string | null,
) {
  const ref = formulationRef === null ? null : parseFormulationRef(formulationRef);
  if (formulationRef !== null && ref === null) {
    return sendError(
      reply,
      400,
      'BAD_FORMULATION_REF',
      `"${formulationRef}" is not a valid formulation reference (expected "slug" or "slug@rN").`,
    );
  }

  const definition = await prisma.definition.findUnique({
    where: { slug: defSlug },
    include: {
      categories: true,
      formulations: {
        orderBy: { order: 'asc' },
        include: {
          defaultMacroSet: { include: { owner: { select: { name: true } } } },
          revisions: {
            where: { status: 'published' },
            orderBy: { number: 'desc' },
          },
        },
      },
    },
  });
  if (!definition) {
    return sendError(reply, 404, 'DEFINITION_NOT_FOUND', `Definition "${defSlug}" not found.`);
  }

  const published = definition.formulations.filter((f) => f.revisions.length > 0);

  let formulation;
  if (ref) {
    formulation = definition.formulations.find((f) => f.slug === ref.slug);
    if (!formulation) {
      return sendError(
        reply,
        404,
        'FORMULATION_NOT_FOUND',
        `Definition "${defSlug}" has no formulation "${ref.slug}".`,
      );
    }
  } else {
    // default formulation; if it has nothing published yet, fall back to the
    // first (by order) formulation that does
    formulation = published.find((f) => f.isDefault) ?? published[0];
    if (!formulation) {
      return sendError(
        reply,
        404,
        'NOT_PUBLISHED',
        `Definition "${defSlug}" has no published revision yet.`,
      );
    }
  }

  const revision = ref?.revision
    ? formulation.revisions.find((r) => r.number === ref.revision)
    : formulation.revisions[0];
  if (!revision) {
    return sendError(
      reply,
      404,
      ref?.revision
        ? 'REVISION_NOT_FOUND'
        : 'NOT_PUBLISHED',
      ref?.revision
        ? `Formulation "${formulation.slug}" of "${defSlug}" has no published revision r${ref.revision}.`
        : `Formulation "${formulation.slug}" of "${defSlug}" has no published revision yet.`,
    );
  }

  // resolve the notation set: explicit ?macros= (live or pinned snapshot)
  // beats the formulation's default macro set; no set at all applies {}
  let macroSet: MacroSetPublic | null = null;
  let setMacros: MacroMap = {};
  let pinnedMacroHash: string | null = null;

  if (macrosRef !== null) {
    const parts = parseMacroSetRef(macrosRef);
    if (!parts) {
      return sendError(reply, 400, 'BAD_MACRO_REF', `"${macrosRef}" is not a valid macro-set reference.`);
    }
    const set = await prisma.macroSet.findUnique({
      where: { uuid: parts.uuid },
      include: {
        owner: { select: { name: true } },
        ...(parts.hash ? { snapshots: { where: { hash: { startsWith: parts.hash } } } } : {}),
      },
    });
    if (!set) {
      return sendError(reply, 404, 'MACRO_SET_NOT_FOUND', `Macro set ${parts.uuid} not found.`);
    }
    macroSet = serializeMacroSet(set);
    if (parts.hash) {
      const snapshots = (set as typeof set & { snapshots: { hash: string; macros: unknown }[] })
        .snapshots;
      const snapshot =
        snapshots.find((s) => s.hash === parts.hash) ??
        (snapshots.length === 1 ? snapshots[0] : undefined);
      if (!snapshot) {
        return sendError(
          reply,
          404,
          'MACRO_SNAPSHOT_NOT_FOUND',
          `Macro set ${parts.uuid} has no pinned snapshot matching "${parts.hash}".`,
        );
      }
      setMacros = snapshot.macros as MacroMap;
      pinnedMacroHash = snapshot.hash;
    } else {
      setMacros = set.macros as MacroMap;
    }
  } else if (formulation.defaultMacroSet) {
    macroSet = serializeMacroSet(formulation.defaultMacroSet);
    setMacros = formulation.defaultMacroSet.macros as MacroMap;
  }

  // layered render map (PLAN.md "Layered macros"): the revision's shared
  // symbols under the notation set, its local macros LAST — locals are
  // sealed, no notation set can restyle them. The frontend spreads the shim
  // base underneath.
  const macros: MacroMap = {
    ...(revision.macros as MacroMap),
    ...setMacros,
    ...(revision.localMacros as MacroMap),
  };

  return reply.send({
    definition: {
      slug: definition.slug,
      title: definition.title,
      categories: definition.categories.map((c) => c.name).sort(),
    },
    formulation: serializeFormulationMeta(formulation, true),
    // the public page only lists formulations with published content
    formulations: published.map((f) => serializeFormulationMeta(f, true)),
    revision: {
      number: revision.number!,
      bodyLatex: revision.bodyLatex,
      commentaryMd: revision.commentaryMd,
      publishedAt: revision.publishedAt!.toISOString(),
      pinned: ref?.revision != null,
    },
    publishedRevisions: formulation.revisions.map((r) => ({
      number: r.number!,
      publishedAt: r.publishedAt!.toISOString(),
    })),
    macroSet,
    macros,
    pinnedMacroHash,
  });
}
