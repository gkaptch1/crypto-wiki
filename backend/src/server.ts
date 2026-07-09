import Fastify from 'fastify';
import cors from '@fastify/cors';
import { definitionRoutes } from './routes/definitions';

const fastify = Fastify({ logger: true });

// allow the Vite dev server (and any origin, while there is no auth) to call the API
fastify.register(cors, { origin: true });

// base endpoint
fastify.get('/', async (request, reply) => {
  reply.send({
    message: 'hello world',
  });
});

// Register definition routes
fastify.register(definitionRoutes);

// run server
fastify.listen({ port: 3000 }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
