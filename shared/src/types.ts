import type { Static } from '@sinclair/typebox';
import type * as S from './schemas.js';

export type Slug = Static<typeof S.Slug>;
export type MacroMap = Static<typeof S.MacroMap>;
export type MacroSetVisibility = Static<typeof S.MacroSetVisibility>;
export type RevisionStatus = Static<typeof S.RevisionStatus>;
export type Citation = Static<typeof S.Citation>;

export type ApiError = Static<typeof S.ApiError>;
export type MacroSetPublic = Static<typeof S.MacroSetPublic>;
export type MacroSetPin = Static<typeof S.MacroSetPin>;
export type FormulationMeta = Static<typeof S.FormulationMeta>;
export type RevisionMeta = Static<typeof S.RevisionMeta>;
export type DefinitionPage = Static<typeof S.DefinitionPage>;
export type DefinitionListItem = Static<typeof S.DefinitionListItem>;
export type Revision = Static<typeof S.Revision>;
export type FormulationEditor = Static<typeof S.FormulationEditor>;
export type DefinitionEditor = Static<typeof S.DefinitionEditor>;
export type CategoryList = Static<typeof S.CategoryList>;

export type CitationInput = Static<typeof S.CitationInput>;
export type CreateDefinitionBody = Static<typeof S.CreateDefinitionBody>;
export type UpdateDefinitionBody = Static<typeof S.UpdateDefinitionBody>;
export type CreateFormulationBody = Static<typeof S.CreateFormulationBody>;
export type UpdateFormulationBody = Static<typeof S.UpdateFormulationBody>;
export type CreateRevisionBody = Static<typeof S.CreateRevisionBody>;
export type UpdateRevisionBody = Static<typeof S.UpdateRevisionBody>;
export type CreateMacroSetBody = Static<typeof S.CreateMacroSetBody>;
export type UpdateMacroSetBody = Static<typeof S.UpdateMacroSetBody>;
export type ForkMacroSetBody = Static<typeof S.ForkMacroSetBody>;
export type ListDefinitionsQuery = Static<typeof S.ListDefinitionsQuery>;
export type PermalinkQuery = Static<typeof S.PermalinkQuery>;
