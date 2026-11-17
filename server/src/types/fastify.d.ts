import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/pool.js';
import type { AppServices } from '../services/container.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: Database | null;
    services: AppServices;
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}
