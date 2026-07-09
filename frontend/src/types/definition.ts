export interface VersionMetadata {
  slug: string;
  order: number;
  isDefault: boolean;
}

// shape returned by GET /definitions and GET /definitions/:slug
export interface ConcreteDefinition {
  title: string;
  categories: string[];
  bodyLatex: string;
  macros: Record<string, string>;
  versionSlug: string;
  versions?: VersionMetadata[];
}
