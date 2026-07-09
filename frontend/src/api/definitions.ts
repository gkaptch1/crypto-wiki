import { api, post, patch, del } from './client';
import type {
  CategoryList,
  CreateDefinitionBody,
  CreateFormulationBody,
  CreateInvitationBody,
  CreateMacroSetBody,
  CreateRevisionBody,
  DefinitionEditor,
  DefinitionListItem,
  DefinitionPage,
  ForkMacroSetBody,
  ImportScanBody,
  ImportScanResult,
  Invitation,
  MacroSetOwned,
  MacroSetPin,
  MacroSetPublic,
  Revision,
  SessionUserInfo,
  UpdateDefinitionBody,
  UpdateFormulationBody,
  UpdateMacroSetBody,
  UpdateRevisionBody,
} from '@crypto-wiki/shared';

// ---------------------------------------------------------------- public read

export function getDefinitions(q?: string, category?: string) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  const qs = params.size ? `?${params}` : '';
  return api<DefinitionListItem[]>(`/definitions${qs}`);
}

export function getCategories() {
  return api<CategoryList>('/categories');
}

/** Resolve a permalink: /def/prf, /def/prf/game-based@r2, ?macros=uuid[@hash]. */
export function getDefinitionPage(defSlug: string, formulationRef?: string, macros?: string) {
  const path = formulationRef
    ? `/def/${encodeURIComponent(defSlug)}/${encodeURIComponent(formulationRef)}`
    : `/def/${encodeURIComponent(defSlug)}`;
  const qs = macros ? `?macros=${encodeURIComponent(macros)}` : '';
  return api<DefinitionPage>(`${path}${qs}`);
}

// --------------------------------------------------------------------- editor

export const getDefinitionEditor = (slug: string) =>
  api<DefinitionEditor>(`/definitions/${encodeURIComponent(slug)}`);

export const createDefinition = (body: CreateDefinitionBody) =>
  api<DefinitionEditor>('/definitions', post(body));

export const updateDefinition = (slug: string, body: UpdateDefinitionBody) =>
  api<DefinitionEditor>(`/definitions/${encodeURIComponent(slug)}`, patch(body));

export const deleteDefinition = (slug: string) =>
  api<void>(`/definitions/${encodeURIComponent(slug)}`, del());

export const createFormulation = (defSlug: string, body: CreateFormulationBody) =>
  api<DefinitionEditor>(`/definitions/${encodeURIComponent(defSlug)}/formulations`, post(body));

export const updateFormulation = (defSlug: string, fSlug: string, body: UpdateFormulationBody) =>
  api<DefinitionEditor>(
    `/definitions/${encodeURIComponent(defSlug)}/formulations/${encodeURIComponent(fSlug)}`,
    patch(body),
  );

export const deleteFormulation = (defSlug: string, fSlug: string) =>
  api<void>(
    `/definitions/${encodeURIComponent(defSlug)}/formulations/${encodeURIComponent(fSlug)}`,
    del(),
  );

const revisionsBase = (defSlug: string, fSlug: string) =>
  `/definitions/${encodeURIComponent(defSlug)}/formulations/${encodeURIComponent(fSlug)}/revisions`;

export const createRevision = (defSlug: string, fSlug: string, body: CreateRevisionBody) =>
  api<Revision>(revisionsBase(defSlug, fSlug), post(body));

export const updateRevision = (
  defSlug: string,
  fSlug: string,
  id: number,
  body: UpdateRevisionBody,
) => api<Revision>(`${revisionsBase(defSlug, fSlug)}/${id}`, patch(body));

export const publishRevision = (defSlug: string, fSlug: string, id: number) =>
  api<Revision>(`${revisionsBase(defSlug, fSlug)}/${id}/publish`, post({}));

export const deleteRevision = (defSlug: string, fSlug: string, id: number) =>
  api<void>(`${revisionsBase(defSlug, fSlug)}/${id}`, del());

// ----------------------------------------------------------------- macro sets

export const getMacroSets = () => api<MacroSetPublic[]>('/macro-sets');

export const getMacroSet = (uuid: string) => api<MacroSetPublic>(`/macro-sets/${uuid}`);

export const createMacroSet = (body: CreateMacroSetBody) =>
  api<MacroSetPublic>('/macro-sets', post(body));

export const updateMacroSet = (uuid: string, body: UpdateMacroSetBody) =>
  api<MacroSetPublic>(`/macro-sets/${uuid}`, patch(body));

export const deleteMacroSet = (uuid: string) => api<void>(`/macro-sets/${uuid}`, del());

export const pinMacroSet = (uuid: string) => api<MacroSetPin>(`/macro-sets/${uuid}/pin`, post({}));

export const forkMacroSet = (uuid: string, body: ForkMacroSetBody = {}) =>
  api<MacroSetPublic>(`/macro-sets/${uuid}/fork`, post(body));

// ------------------------------------------------------------- paper import

/** Step 1 of scan-then-select: extraction only, creates nothing. */
export const importScan = (body: ImportScanBody) =>
  api<ImportScanResult>('/import/scan', post(body));

// -------------------------------------------------------- session-scoped (me)

export const getMe = () => api<SessionUserInfo>('/me');

export const getMyMacroSets = () => api<MacroSetOwned[]>('/me/macro-sets');

// ------------------------------------------------------- invitations (admin)

export const getInvitations = () => api<Invitation[]>('/invitations');

export const createInvitation = (body: CreateInvitationBody) =>
  api<Invitation>('/invitations', post(body));

export const deleteInvitation = (id: number) => api<void>(`/invitations/${id}`, del());
