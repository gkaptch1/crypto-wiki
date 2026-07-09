import { Type } from '@sinclair/typebox';
import { schemas } from '@crypto-wiki/shared';
import type { Invitation as InvitationDto } from '@crypto-wiki/shared';
import { prisma } from '../lib/prisma';
import { isP2002, sendError } from '../lib/errors';
import { requireAdmin } from '../lib/session';
import type { AppInstance } from '../app';
import type { Invitation, Role } from '../../generated/prisma/client';

// Invitation flow (PLAN.md "Auth"): admin invites an email; on first OAuth
// sign-in with that email the account gets the invited role (the check lives
// in lib/auth.ts's user.create hook). Inviting an email that already has an
// account applies the role immediately instead — but never demotes.

const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

const AUTH_ERRORS = { 401: schemas.ApiError, 403: schemas.ApiError };

function serializeInvitation(
  inv: Invitation & { invitedBy: { name: string } | null },
): InvitationDto {
  return {
    id: inv.id,
    email: inv.email,
    role: inv.role as InvitationDto['role'],
    createdAt: inv.createdAt.toISOString(),
    invitedBy: inv.invitedBy?.name ?? null,
    acceptedAt: inv.acceptedAt ? inv.acceptedAt.toISOString() : null,
  };
}

const invitedByName = { invitedBy: { select: { name: true } } } as const;

export async function invitationRoutes(app: AppInstance) {
  app.get(
    '/invitations',
    {
      preHandler: requireAdmin,
      schema: { response: { 200: schemas.InvitationList, ...AUTH_ERRORS } },
    },
    async () => {
      const invitations = await prisma.invitation.findMany({
        orderBy: { createdAt: 'desc' },
        include: invitedByName,
      });
      return invitations.map(serializeInvitation);
    },
  );

  app.post(
    '/invitations',
    {
      preHandler: requireAdmin,
      schema: {
        body: schemas.CreateInvitationBody,
        response: { 201: schemas.Invitation, 409: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      const email = request.body.email.toLowerCase();
      const role = request.body.role ?? 'editor';

      const existingUser = await prisma.user.findUnique({ where: { email } });
      try {
        const invitation = await prisma.invitation.create({
          data: {
            email,
            role,
            invitedById: request.sessionUser!.id,
            // an existing account accepts instantly; the role change follows below
            ...(existingUser ? { acceptedAt: new Date(), acceptedById: existingUser.id } : {}),
          },
          include: invitedByName,
        });
        if (existingUser && RANK[role] > RANK[existingUser.role]) {
          await prisma.user.update({ where: { id: existingUser.id }, data: { role } });
        }
        return reply.code(201).send(serializeInvitation(invitation));
      } catch (err) {
        if (isP2002(err, 'email')) {
          return sendError(reply, 409, 'INVITATION_EXISTS', `${email} has already been invited.`);
        }
        throw err;
      }
    },
  );

  app.delete(
    '/invitations/:id',
    {
      preHandler: requireAdmin,
      schema: {
        params: Type.Object({ id: Type.Integer({ minimum: 1 }) }),
        response: { 204: Type.Null(), 404: schemas.ApiError, ...AUTH_ERRORS },
      },
    },
    async (request, reply) => {
      // revoking an accepted invitation does not demote the account — role
      // changes are an explicit admin action, not a side effect of cleanup
      try {
        await prisma.invitation.delete({ where: { id: request.params.id } });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') {
          return sendError(reply, 404, 'INVITATION_NOT_FOUND', `No invitation ${request.params.id}.`);
        }
        throw err;
      }
      return reply.code(204).send(null);
    },
  );
}
