import type { FastifyReply, FastifyRequest } from 'fastify';
import { auth } from './auth';
import { sendError } from './errors';
import type { Role } from '../../generated/prisma/client';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
};

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the require* preHandlers; null on unauthenticated requests. */
    sessionUser: SessionUser | null;
  }
}

/** Resolve the better-auth cookie session (hits the DB; call once per request). */
export async function getSessionUser(request: FastifyRequest): Promise<SessionUser | null> {
  const headers = new Headers();
  if (request.headers.cookie) headers.set('cookie', request.headers.cookie);
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const user = session.user as typeof session.user & { role?: Role };
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    role: user.role ?? 'viewer',
  };
}

/**
 * preHandler factory: 401 without a session, 403 without one of `roles`,
 * otherwise sets request.sessionUser and lets the route run.
 */
export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getSessionUser(request);
    if (!user) {
      return sendError(reply, 401, 'UNAUTHENTICATED', 'Sign in to do this.');
    }
    if (!roles.includes(user.role)) {
      return sendError(
        reply,
        403,
        'FORBIDDEN',
        `This action requires ${roles.filter((r) => r !== 'admin').join(' or ') || 'admin'} access.`,
      );
    }
    request.sessionUser = user;
  };
}

/** Any signed-in user (macro-set ownership doesn't need editor rights). */
export const requireSignIn = requireRole('admin', 'editor', 'viewer');
/** Wiki content writes: invited editors + admins. */
export const requireEditor = requireRole('admin', 'editor');
/** Invitations and other administration. */
export const requireAdmin = requireRole('admin');
