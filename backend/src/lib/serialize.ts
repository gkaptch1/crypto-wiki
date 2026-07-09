import type {
  Citation,
  DefinitionEditor,
  FormulationEditor,
  FormulationMeta,
  MacroMap,
  MacroSetPublic,
  Revision as RevisionDto,
} from '@crypto-wiki/shared';
import type {
  Category,
  Formulation,
  MacroSet,
  Revision,
} from '../../generated/prisma/client';

// Anonymous sets get zero public attribution: no owner (none exists yet, but
// Phase 2 must keep it that way) and no timestamps, since a createdAt can
// correlate with a submission date.
export function serializeMacroSet(set: MacroSet): MacroSetPublic {
  const base: MacroSetPublic = {
    uuid: set.uuid,
    name: set.name,
    macros: set.macros as MacroMap,
    visibility: set.visibility,
  };
  if (set.visibility === 'anonymous') return base;
  return {
    ...base,
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
