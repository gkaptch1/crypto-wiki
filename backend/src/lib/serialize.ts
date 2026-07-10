import type {
  Citation,
  DefinitionEditor,
  FormulationEditor,
  FormulationMeta,
  MacroMap,
  MacroSetOwned,
  MacroSetPublic,
  Revision as RevisionDto,
} from '@crypto-wiki/shared';
import type {
  Category,
  Formulation,
  MacroSet,
  Revision,
} from '../../generated/prisma/client';

/** Callers that want owner attribution must `include: { owner: { select: { name: true } } }`. */
export type MacroSetWithOwner = MacroSet & { owner?: { name: string } | null };

// Anonymous sets get ZERO public attribution: no owner and no timestamps
// (either can deanonymize a double-blind submission — a createdAt correlates
// with a submission date). Public/unlisted sets are attributed by display
// name only; the owner's id/email never leaves the server.
export function serializeMacroSet(set: MacroSetWithOwner): MacroSetPublic {
  const base: MacroSetPublic = {
    uuid: set.uuid,
    name: set.name,
    macros: set.macros as MacroMap,
    visibility: set.visibility,
  };
  if (set.visibility === 'anonymous') return base;
  return {
    ...base,
    owner: set.owner?.name ?? null,
    createdAt: set.createdAt.toISOString(),
    updatedAt: set.updatedAt.toISOString(),
  };
}

// The owner's own view ("my macro sets") — authenticated and owner-scoped,
// so timestamps are safe to include even for anonymous sets.
export function serializeMacroSetOwned(
  set: MacroSet & { _count: { snapshots: number } },
): MacroSetOwned {
  return {
    uuid: set.uuid,
    name: set.name,
    macros: set.macros as MacroMap,
    visibility: set.visibility,
    snapshotCount: set._count.snapshots,
    createdAt: set.createdAt.toISOString(),
    updatedAt: set.updatedAt.toISOString(),
  };
}

export function citationOf(f: Formulation): Citation {
  return {
    paper: f.citePaper,
    authors: f.citeAuthors,
    venue: f.citeVenue,
    year: f.citeYear,
    doi: f.citeDoi,
    eprint: f.citeEprint,
    url: f.citeUrl,
  };
}

export function serializeFormulationMeta(
  f: Formulation,
  hasPublished: boolean,
): FormulationMeta {
  return {
    slug: f.slug,
    isDefault: f.isDefault,
    order: f.order,
    citation: citationOf(f),
    hasPublished,
  };
}

export function serializeRevision(r: Revision): RevisionDto {
  return {
    id: r.id,
    status: r.status,
    number: r.number,
    bodyLatex: r.bodyLatex,
    commentaryMd: r.commentaryMd,
    macros: r.macros as MacroMap,
    localMacros: r.localMacros as MacroMap,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
  };
}

export function serializeFormulationEditor(
  f: Formulation & { revisions: Revision[]; defaultMacroSet: MacroSet | null },
): FormulationEditor {
  return {
    slug: f.slug,
    isDefault: f.isDefault,
    order: f.order,
    citation: citationOf(f),
    defaultMacroSetUuid: f.defaultMacroSet?.uuid ?? null,
    revisions: f.revisions.map(serializeRevision),
  };
}

export function serializeDefinitionEditor(
  def: {
    slug: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    categories: Category[];
  },
  formulations: (Formulation & { revisions: Revision[]; defaultMacroSet: MacroSet | null })[],
): DefinitionEditor {
  return {
    slug: def.slug,
    title: def.title,
    categories: def.categories.map((c) => c.name).sort(),
    createdAt: def.createdAt.toISOString(),
    updatedAt: def.updatedAt.toISOString(),
    formulations: formulations.map(serializeFormulationEditor),
  };
}
