import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createDatabase } from './pool.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

async function migrate(): Promise<void> {
  const config = loadConfig();
  const db = createDatabase(config);

  if (!db) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const applied = await db.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [file],
      );

      if (applied.rowCount) {
        continue;
      }

      const sql = await readFile(`${migrationsDir}/${file}`, 'utf8');
      const client = await db.connect();

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await db.end();
  }
}

migrate().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
