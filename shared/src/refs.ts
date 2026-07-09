/**
 * Permalink reference parsing, shared so frontend routing and backend
 * resolution can never disagree.
 *
 * - Formulation ref: "game-based" or "game-based@r2" (pinned revision).
 * - Macro-set ref:   "<uuid>" or "<uuid>@<sha256-prefix>" (pinned snapshot).
 */

export interface FormulationRef {
  slug: string;
  /** Pinned revision number (the N in "@rN"), or null for latest published. */
  revision: number | null;
}

const FORMULATION_REF = /^([a-z0-9]+(?:-[a-z0-9]+)*)(?:@r([1-9][0-9]*))?$/;

export function parseFormulationRef(ref: string): FormulationRef | null {
  const m = FORMULATION_REF.exec(ref);
  if (!m) return null;
  return { slug: m[1], revision: m[2] ? Number(m[2]) : null };
}

export function formatFormulationRef(ref: FormulationRef): string {
  return ref.revision === null ? ref.slug : `${ref.slug}@r${ref.revision}`;
}

export interface MacroSetRefParts {
  uuid: string;
  /** Pinned snapshot hash prefix (≥ 12 hex chars), or null for the live set. */
  hash: string | null;
}

const MACRO_SET_REF =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:@([0-9a-f]{12,64}))?$/;

export function parseMacroSetRef(ref: string): MacroSetRefParts | null {
  const m = MACRO_SET_REF.exec(ref);
  if (!m) return null;
  return { uuid: m[1], hash: m[2] ?? null };
}

export function formatMacroSetRef(parts: MacroSetRefParts): string {
  return parts.hash === null ? parts.uuid : `${parts.uuid}@${parts.hash}`;
}

/** Length of the truncated snapshot hash used in ?macros= refs. */
export const PINNED_HASH_LENGTH = 16;
