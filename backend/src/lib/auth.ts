import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from './prisma';
import type { Role } from '../../generated/prisma/client';

// Roles (PLAN.md "Auth"): admin / editor (invited, can write) / viewer
// (default; read needs no login). Assignment happens exactly once, when
// better-auth first creates the user row:
//   1. email listed in ADMIN_EMAILS            → admin (bootstrap)
//   2. an admin invited this email             → the invited role
//   3. otherwise                               → viewer
// Inviting an email that already has an account is handled by the
// invitations route (immediate upgrade), not here.

const adminEmails = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

async function roleForNewUser(email: string): Promise<Role> {
  const normalized = email.toLowerCase();
  if (adminEmails.includes(normalized)) return 'admin';
  const invitation = await prisma.invitation.findUnique({ where: { email: normalized } });
  if (invitation && invitation.acceptedAt === null) return invitation.role;
  return 'viewer';
}

// OAuth providers are enabled only when their credentials are configured, so
// a fresh dev checkout still boots. The password strategy exists for tests
// and credential-less dev environments — NEVER set AUTH_PASSWORD_SIGNIN in
// production; the product sign-in is Google/GitHub OAuth.
const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  };
}
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  };
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'],
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  socialProviders,
  emailAndPassword: { enabled: process.env.AUTH_PASSWORD_SIGNIN === '1' },
  user: {
    additionalFields: {
      // input: false — clients can never set their own role
      role: { type: 'string', required: false, defaultValue: 'viewer', input: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: { ...user, role: await roleForNewUser(user.email) },
        }),
        after: async (user) => {
          await prisma.invitation.updateMany({
            where: { email: user.email.toLowerCase(), acceptedAt: null },
            data: { acceptedAt: new Date(), acceptedById: user.id },
          });
        },
      },
    },
  },
});
