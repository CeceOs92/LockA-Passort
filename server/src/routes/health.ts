import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'locka-api',
    network: app.config.STELLAR_NETWORK,
    database: app.db ? 'configured' : 'not_configured',
    uptimeSeconds: Math.round(process.uptime()),
  }));
};
