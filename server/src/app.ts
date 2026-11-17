import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { corsOrigins, loadConfig, type AppConfig } from './config.js';
import { createDatabase } from './db/pool.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { buildServices } from './services/container.js';

export async function buildApp(config: AppConfig = loadConfig()): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.NODE_ENV === 'test' ? 'silent' : 'info' },
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024,
  });
  const db = createDatabase(config);

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('services', buildServices(config, db));

  await app.register(cors, {
    origin: corsOrigins(config),
    credentials: true,
  });
  await app.register(helmet);
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
  });
  await app.register(jwt, { secret: config.JWT_SECRET });

  app.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: 'not_found' });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'request failed');
    const statusCode =
      error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.code(statusCode).send({
      error: statusCode >= 500 ? 'internal_error' : 'request_error',
    });
  });

  app.addHook('onClose', async () => {
    if (db) {
      await db.end();
    }
  });

  return app;
}
