import { Pool } from 'pg';
import type { AppConfig } from '../config.js';

export type Database = Pool;

export function createDatabase(config: AppConfig): Database | null {
  if (!config.DATABASE_URL) {
    return null;
  }

  return new Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
