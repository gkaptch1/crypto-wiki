import { auth } from '../lib/auth';
import type { AppInstance } from '../app';

// Bridge better-auth's Web-standard handler onto Fastify. Everything under
// /api/auth/* (OAuth redirects, callbacks, get-session, sign-out) is handled
// by better-auth itself; our own routes only ever read the session cookie.
export async function authRoutes(app: AppInstance) {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
        else headers.append(key, String(value));
      }
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers,
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        }),
      );

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        // set-cookie must not be comma-joined (OAuth sets state + PKCE
        // cookies together); content-length is recomputed by Fastify
        if (key === 'set-cookie' || key === 'content-length') return;
        reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
    },
  });
}
