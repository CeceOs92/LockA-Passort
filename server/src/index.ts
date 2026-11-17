import { buildApp } from './app.js';

const app = await buildApp();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({
    host: app.config.HOST,
    port: app.config.PORT,
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
