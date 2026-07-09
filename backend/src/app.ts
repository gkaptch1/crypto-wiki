import Fastify from 'fastify';
import type {
  FastifyBaseLogger,
  FastifyError,
  FastifyInstance,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import cors from '@fastify/cors';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { sendError } from './lib/errors';
import { authRoutes } from './routes/auth';
import { permalinkRoutes } from './routes/permalinks';
import { definitionRoutes } from './routes/definitions';
import { macroSetRoutes } from './routes/macro-sets';
import { invitationRoutes } from './routes/invitations';
import { meRoutes } from './routes/me';

export type AppInstance = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  TypeBoxTypeProvider
>;

export function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    ajv: {
      // keep additionalProperties violations as hard errors (the default
      // removeAdditional: true would silently drop e.g. invalid macro names)
      customOptions: { removeAdditional: false, coerceTypes: 'array', useDefaults: true },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  // reads stay public; writes are cookie-authenticated, so CORS must both
  // allow credentials and pin the origin (no wildcard/reflection).
  // methods must be explicit: @fastify/cors only preflights GET/HEAD/POST
  // by default, which silently breaks the editor's PATCH/DELETE calls
  app.register(cors, {
    origin: [process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.decorateRequest('sessionUser', null);

  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err.validation) {
      return sendError(reply, 400, 'VALIDATION', err.message);
    }
    request.log.error(err);
    return sendError(reply, 500, 'INTERNAL', 'Unexpected server error.');
  });

  app.setNotFoundHandler((request, reply) =>
    sendError(reply, 404, 'ROUTE_NOT_FOUND', `Route ${request.method} ${request.url} not found.`),
  );

  app.get('/', async () => ({ service: 'crypto-wiki api', status: 'ok' }));

  app.register(authRoutes);
  app.register(permalinkRoutes);
  app.register(definitionRoutes);
  app.register(macroSetRoutes);
  app.register(invitationRoutes);
  app.register(meRoutes);

  return app;
}
