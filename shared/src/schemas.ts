import { Type } from '@sinclair/typebox';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** URL slugs: lowercase kebab-case, e.g. "prf", "game-based". */
export const Slug = Type.String({
  pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
  minLength: 1,
  maxLength: 64,
});

/** Macro map: { "\\adv": "\\mathcal{A}", ... } — keys are LaTeX control sequences. */
export const MacroMap = Type.Record(
  Type.String({ pattern: '^\\\\[a-zA-Z]+$' }),
  Type.String({ maxLength: 2000 }),
  // keys not matching the pattern must be a hard error, not silently ignored
  { maxProperties: 500, additionalProperties: false },
);

export const MacroSetVisibility = Type.Union([
  Type.Literal('public'),
  Type.Literal('unlisted'),
  Type.Literal('anonymous'),
]);

export const RevisionStatus = Type.Union([Type.Literal('draft'), Type.Literal('published')]);

export const Role = Type.Union([
  Type.Literal('admin'),
  Type.Literal('editor'),
  Type.Literal('viewer'),
]);

/** Roles an invitation can grant (inviting a "viewer" would be a no-op). */
export const InvitableRole = Type.Union([Type.Literal('admin'), Type.Literal('editor')]);

/** MacroSet UUID, optionally pinned to a content snapshot: "<uuid>" or "<uuid>@<sha256-prefix>". */
export const MacroSetRef = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(@[0-9a-f]{12,64})?$',
});

const Uuid = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
});

/** Citation metadata on a formulation (which paper it comes from). */
export const Citation = Type.Object({
  paper: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
  authors: Type.Union([Type.String({ maxLength: 500 }), Type.Null()]),
  venue: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  year: Type.Union([Type.Integer({ minimum: 1900, maximum: 2200 }), Type.Null()]),
  doi: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  eprint: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
});

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export const ApiError = Type.Object({
  statusCode: Type.Integer(),
  error: Type.String(),
  code: Type.String(),
  message: Type.String(),
});

/**
 * Public serialization of a macro set. For anonymous sets, `owner`,
 * `createdAt` and `updatedAt` are ALWAYS omitted (attribution and timestamps
 * can deanonymize a double-blind submission). Never includes the owner's
 * id/email or the internal numeric id for any visibility.
 */
export const MacroSetPublic = Type.Object({
  uuid: Uuid,
  name: Type.String(),
  macros: MacroMap,
  visibility: MacroSetVisibility,
  /** Owner display name; null for pre-auth sets, omitted for anonymous ones. */
  owner: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  createdAt: Type.Optional(Type.String()),
  updatedAt: Type.Optional(Type.String()),
  /**
   * Whether the requesting session may modify this set (owner or admin).
   * Purely a UI hint, computed per request — enforcement is server-side.
   */
  canEdit: Type.Optional(Type.Boolean()),
});

/** A macro set as its owner sees it ("my macro sets"); timestamps always present. */
export const MacroSetOwned = Type.Object({
  uuid: Uuid,
  name: Type.String(),
  macros: MacroMap,
  visibility: MacroSetVisibility,
  snapshotCount: Type.Integer(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export const SessionUserInfo = Type.Object({
  id: Type.String(),
  name: Type.String(),
  email: Type.String(),
  image: Type.Union([Type.String(), Type.Null()]),
  role: Role,
});

export const Invitation = Type.Object({
  id: Type.Integer(),
  email: Type.String(),
  role: InvitableRole,
  createdAt: Type.String(),
  invitedBy: Type.Union([Type.String(), Type.Null()]),
  acceptedAt: Type.Union([Type.String(), Type.Null()]),
});

export const InvitationList = Type.Array(Invitation);

export const MacroSetPin = Type.Object({
  uuid: Uuid,
  hash: Type.String(),
  /** Ready-to-use value for the ?macros= query param. */
  ref: Type.String(),
});

export const FormulationMeta = Type.Object({
  slug: Slug,
  isDefault: Type.Boolean(),
  order: Type.Integer(),
  citation: Citation,
  hasPublished: Type.Boolean(),
});

export const RevisionMeta = Type.Object({
  number: Type.Integer(),
  publishedAt: Type.String(),
});

/** GET /def/:defSlug[/:formulationRef] — the public permalink page. */
export const DefinitionPage = Type.Object({
  definition: Type.Object({
    slug: Slug,
    title: Type.String(),
    categories: Type.Array(Type.String()),
  }),
  formulation: FormulationMeta,
  formulations: Type.Array(FormulationMeta),
  revision: Type.Object({
    number: Type.Integer(),
    bodyLatex: Type.String(),
    commentaryMd: Type.String(),
    publishedAt: Type.String(),
    /** True when the URL pinned an explicit @rN revision. */
    pinned: Type.Boolean(),
  }),
  publishedRevisions: Type.Array(RevisionMeta),
  /** The macro set used for this render (null = none). */
  macroSet: Type.Union([MacroSetPublic, Type.Null()]),
  /** The actual macro map to render with (from the set, its pinned snapshot, or empty). */
  macros: MacroMap,
  /** Set when ?macros=<uuid>@<hash> resolved to a snapshot. */
  pinnedMacroHash: Type.Union([Type.String(), Type.Null()]),
});

export const DefinitionListItem = Type.Object({
  slug: Slug,
  title: Type.String(),
  categories: Type.Array(Type.String()),
  formulationCount: Type.Integer(),
  hasPublished: Type.Boolean(),
  updatedAt: Type.String(),
});

export const DefinitionList = Type.Array(DefinitionListItem);

/** A revision as seen in the editor (drafts included). */
export const Revision = Type.Object({
  id: Type.Integer(),
  status: RevisionStatus,
  number: Type.Union([Type.Integer(), Type.Null()]),
  bodyLatex: Type.String(),
  commentaryMd: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  publishedAt: Type.Union([Type.String(), Type.Null()]),
});

export const FormulationEditor = Type.Object({
  slug: Slug,
  isDefault: Type.Boolean(),
  order: Type.Integer(),
  citation: Citation,
  defaultMacroSetUuid: Type.Union([Uuid, Type.Null()]),
  revisions: Type.Array(Revision),
});

/** GET /definitions/:defSlug — the editor view (includes drafts). */
export const DefinitionEditor = Type.Object({
  slug: Slug,
  title: Type.String(),
  categories: Type.Array(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  formulations: Type.Array(FormulationEditor),
});

export const CategoryList = Type.Array(
  Type.Object({ name: Type.String(), definitionCount: Type.Integer() }),
);

// ---------------------------------------------------------------------------
// Request shapes
// ---------------------------------------------------------------------------

/** Citation input: all fields optional; null clears a field. */
export const CitationInput = Type.Partial(Citation);

export const CreateDefinitionBody = Type.Object({
  slug: Slug,
  title: Type.String({ minLength: 1, maxLength: 200 }),
  categories: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }))),
  /** Optionally create a first (default) formulation with a draft revision. */
  formulation: Type.Optional(
    Type.Object({
      slug: Type.Optional(Slug),
      bodyLatex: Type.Optional(Type.String({ maxLength: 100_000 })),
      commentaryMd: Type.Optional(Type.String({ maxLength: 100_000 })),
      citation: Type.Optional(CitationInput),
    }),
  ),
});

export const UpdateDefinitionBody = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  categories: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }))),
});

export const CreateFormulationBody = Type.Object({
  slug: Slug,
  citation: Type.Optional(CitationInput),
  defaultMacroSetUuid: Type.Optional(Type.Union([Uuid, Type.Null()])),
  isDefault: Type.Optional(Type.Boolean()),
});

export const UpdateFormulationBody = Type.Object({
  /** Renaming is only allowed while the formulation has no published revision. */
  slug: Type.Optional(Slug),
  citation: Type.Optional(CitationInput),
  defaultMacroSetUuid: Type.Optional(Type.Union([Uuid, Type.Null()])),
  isDefault: Type.Optional(Type.Literal(true)),
});

export const CreateRevisionBody = Type.Object({
  bodyLatex: Type.String({ maxLength: 100_000 }),
  commentaryMd: Type.Optional(Type.String({ maxLength: 100_000 })),
});

export const UpdateRevisionBody = Type.Object({
  bodyLatex: Type.Optional(Type.String({ maxLength: 100_000 })),
  commentaryMd: Type.Optional(Type.String({ maxLength: 100_000 })),
});

export const CreateMacroSetBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  macros: MacroMap,
  visibility: Type.Optional(MacroSetVisibility),
});

export const UpdateMacroSetBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  macros: Type.Optional(MacroMap),
  visibility: Type.Optional(MacroSetVisibility),
});

export const ForkMacroSetBody = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  visibility: Type.Optional(MacroSetVisibility),
});

export const CreateInvitationBody = Type.Object({
  // a light shape check, not RFC 5322 (format: 'email' needs ajv-formats)
  email: Type.String({ pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxLength: 320 }),
  role: Type.Optional(InvitableRole),
});

export const ListDefinitionsQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 200 })),
  category: Type.Optional(Type.String({ maxLength: 64 })),
});

export const PermalinkQuery = Type.Object({
  macros: Type.Optional(MacroSetRef),
});
