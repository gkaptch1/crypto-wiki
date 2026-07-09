import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';
import { UUID } from 'node:crypto';

// Prisma 7 driver adapters report the violated unique-constraint fields under
// meta.driverAdapterError, not meta.target like the classic engine did
function p2002Fields(err: any): string[] {
  const fields =
    err.meta?.driverAdapterError?.cause?.constraint?.fields ?? err.meta?.target ?? [];
  const list = Array.isArray(fields) ? fields : [fields];
  return list.map((f: unknown) => String(f).replace(/"/g, ''));
}

export async function definitionRoutes(fastify: FastifyInstance) {
  // get all default versions of definitions
  fastify.get('/definitions', async () => {
    const defs = await prisma.definition.findMany({
      include: {
        versions: {
          where: { isDefault: true },
          include: { defaultMacroSet: true },
        },
        categories: true,
      },
    });

    const cleanedDefs: ConcreteDefinition[] = defs.map((def) => {
      const defaultVersion = def.versions[0];
      return {
        title: def.title,
        categories: def.categories.map((category) => category.name),
        bodyLatex: defaultVersion?.bodyLatex || '',
        macros: (defaultVersion?.defaultMacroSet?.macros as Record<string, string>) || {},
        versionSlug: defaultVersion?.slug || '',
      };
    });

    return cleanedDefs;
  });

  // get a particular definition (e.g. prf)
  // can ask for a particular version or default version
  // can also ask for a particular macro set or default macro set
  fastify.get('/definitions/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { version: versionSlug, macroSetId: macroUUID } = request.query as {
      version: string;
      macroSetId: UUID;
    };

    // fetch definition by title (e.g. prf)
    const definition = await prisma.definition.findUnique({
      where: { title: slug },
      include: { categories: true },
    });

    if (!definition) {
      return reply.code(404).send({
        error: `Definition ${slug} not found`,
      });
    }

    const query = {
      where: {
        definitionId: definition.id,
        // if we're looking for a specific defn. version (e.g. version=alt), get that.
        // otherwise, get default version
        ...(versionSlug ? { slug: versionSlug } : { isDefault: true }),
      },
      include: {
        defaultMacroSet: true,
      },
    };

    // fetch one particular definition version (e.g. prf, version=alt)
    const definitionVersion = await prisma.definitionVersion.findFirst(query);

    if (!definitionVersion) {
      return reply.code(404).send({
        error: versionSlug
          ? `Version "${versionSlug}" not found for definition ${slug}`
          : `No default version found for definition ${slug}`,
      });
    }

    // also fetch all available versions for this definition
    const versionsMetadata = await prisma.definitionVersion.findMany({
      where: { definitionId: definition.id },
      select: { slug: true, order: true, isDefault: true },
      orderBy: { order: 'asc' },
    });

    let macroSet;
    if (macroUUID) {
      // a macroset is specified, try to find that one.
      macroSet = await prisma.macroSet.findUnique({ where: { uuid: macroUUID } });
      if (!macroSet) {
        return reply.code(404).send({
          error: `Macro set ${macroUUID} not found`,
        });
      }
    } else {
      // macroset is not specified, if this definitionversion has a defaultMacroSet use that.
      // otherwise, use no macros
      macroSet = definitionVersion.defaultMacroSet || { macros: {} };
    }

    const defResponse: ConcreteDefinition = {
      title: definition.title,
      categories: definition.categories.map((category) => category.name),
      versionSlug: definitionVersion.slug,
      bodyLatex: definitionVersion.bodyLatex,
      macros: (macroSet?.macros as Record<string, string>) || {},
      versions: versionsMetadata,
    };

    return defResponse;
  });

  // post a new type of definition (e.g. prf) and create a default DefinitionVersion
  // (e.g. prf, default version)
  fastify.post('/definitions', async (request, reply) => {
    const { title, categories, bodyLatex, macros, versionSlug } =
      request.body as ConcreteDefinition;

    // check if definition with given title already exists
    const existing = await prisma.definition.findUnique({
      where: { title },
    });

    if (existing) {
      return reply.code(409).send({
        error: `Definition with title ${title} already exists`,
      });
    }

    // set up a new definition, make it a default version
    // (since none of this type of definition exists yet)
    const newDefData = {
      title,
      categories: {
        connectOrCreate: categories.map((category) => ({
          where: { name: category },
          create: { name: category },
        })),
      },
      versions: {
        create: {
          slug: versionSlug || 'default',
          bodyLatex,
          isDefault: true, // default version of definition
          defaultMacroSet: {
            create: {
              macros, // creates row in MacroSet table
            },
          },
        },
      },
    };

    try {
      // try creating new definition + a default version
      const newDef = await prisma.definition.create({
        data: newDefData,
        include: {
          categories: true,
          versions: {
            include: { defaultMacroSet: true },
          },
        },
      });
      return newDef;
    } catch (err: any) {
      // handle prisma unique constraint errors (race condition)
      if (err.code === 'P2002' && p2002Fields(err).includes('title')) {
        return reply.code(409).send({
          error: `Definition with title "${title}" already exists.`,
        });
      }

      // Unexpected error
      fastify.log.error(err);
      return reply.code(500).send({
        error: 'Unexpected server error.',
      });
    }
  });

  // add a new version to an existing definition
  // (e.g. to prf, add prf v2)
  fastify.post('/definitions/:title', async (request, reply) => {
    // title of definition we are creating a new version for
    const { title } = request.params as { title: string };

    // extract definitionVersion's fields
    const { slug, bodyLatex, macros } = request.body as {
      // maybe make slug unique??
      slug: string;
      bodyLatex: string;
      macros?: Record<string, string>;
    };

    // check if definition exists
    const existing = await prisma.definition.findUnique({
      where: { title },
      include: {
        versions: true,
      },
    });

    if (!existing) {
      return reply.code(404).send({
        error: `Definition with title ${title} not found`,
      });
    }

    // this new version comes last; use max(order) + 1 rather than array length,
    // which produces duplicate orders once any version has been deleted
    const maxOrder = await prisma.definitionVersion.aggregate({
      where: { definitionId: existing.id },
      _max: { order: true },
    });
    const newOrder = (maxOrder._max.order ?? -1) + 1;

    const baseVersionData = {
      slug,
      bodyLatex,
      order: newOrder,
      isDefault: false,
      // get the id of the existing definition
      definition: {
        connect: { id: existing.id },
      },
    };

    // if there's macros, add those on to the data, o/w just send the base data
    const newVersionData = macros
      ? {
          ...baseVersionData,
          defaultMacroSet: {
            create: {
              macros,
            },
          },
        }
      : baseVersionData;

    try {
      const newVersion = await prisma.definitionVersion.create({
        data: newVersionData,
        include: {
          defaultMacroSet: true,
        },
      });
      return reply.code(201).send(newVersion);
    } catch (err: any) {
      // handle prisma unique constraint errors (race condition)
      // the uniques on DefinitionVersion are [definitionId, slug] and [definitionId, order]
      if (err.code === 'P2002' && p2002Fields(err).includes('slug')) {
        return reply.code(409).send({
          error: `Version "${slug}" already exists for definition "${title}".`,
        });
      }
      if (err.code === 'P2002' && p2002Fields(err).includes('order')) {
        return reply.code(409).send({
          error: `Concurrent version creation for "${title}", please retry.`,
        });
      }

      // Unexpected error
      fastify.log.error(err);
      return reply.code(500).send({
        error: 'Unexpected server error.',
      });
    }
  });

  // // PUT update
  // fastify.put('/definitions/:id', async (request, reply) => {
  //   // LATER: think abt how versioning history comes in here
  //   const { id } = request.params as { id: string };
  //   const { title, category, bodyLatex } = request.body as any;
  //   const updated = await prisma.definition.update({
  //     where: {
  //       id: Number(id),
  //     },
  //     data: { title, category, bodyLatex },
  //   });

  //   return updated;
  // });

  // // Delete definition
  // fastify.delete('/definitions/:id', async (request, reply) => {
  //   const { id } = request.params as { id: string };

  //   await prisma.definition.delete({
  //     where: {
  //       id: Number(id),
  //     },
  //   });

  //   return {
  //     message: 'Deleted successfully',
  //   };
  // });
  // TODO: Macro set CRUD as well
}
