import type { ConcreteDefinition } from '../types/definition';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

export async function getDefaultDefinitions(): Promise<ConcreteDefinition[]> {
  return handle(await fetch(`${BACKEND_URL}/definitions`));
}

export async function getDefinition(
  slug: string,
  opts: { version?: string; macroSetId?: string } = {}
): Promise<ConcreteDefinition> {
  const params = new URLSearchParams();
  if (opts.version) params.set('version', opts.version);
  if (opts.macroSetId) params.set('macroSetId', opts.macroSetId);
  const qs = params.size ? `?${params}` : '';
  return handle(await fetch(`${BACKEND_URL}/definitions/${encodeURIComponent(slug)}${qs}`));
}

export async function createDefinition(def: {
  title: string;
  categories: string[];
  bodyLatex: string;
  macros: Record<string, string>;
  versionSlug?: string;
}): Promise<unknown> {
  return handle(
    await fetch(`${BACKEND_URL}/definitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(def),
    })
  );
}
