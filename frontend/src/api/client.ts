import type { ApiError } from '@crypto-wiki/shared';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string;

export class ApiRequestError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(err: ApiError) {
    super(err.message);
    this.name = 'ApiRequestError';
    this.code = err.code;
    this.statusCode = err.statusCode;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiRequestError(
      body ?? {
        statusCode: res.status,
        error: 'Error',
        code: 'UNKNOWN',
        message: `Request failed with status ${res.status}`,
      },
    );
  }
  return body as T;
}

export const post = (payload: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(payload),
});

export const patch = (payload: unknown): RequestInit => ({
  method: 'PATCH',
  body: JSON.stringify(payload),
});

export const del = (): RequestInit => ({ method: 'DELETE' });
