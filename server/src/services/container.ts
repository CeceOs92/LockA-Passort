import type { AppConfig } from '../config.js';
import type { Database } from '../db/pool.js';
import { StubSummaryService } from './ai/summary-service.js';
import { PostgresAuditService } from './audit/audit-service.js';
import { ChallengeStore } from './auth/challenge-store.js';
import { LocalKms } from './keys/local-kms.js';
import { ConsoleNotificationService } from './notifications/notification-service.js';
import { LocalObjectStore } from './vault/local-object-store.js';
import { VaultService } from './vault/vault-service.js';

export interface AppServices {
  challenges: ChallengeStore;
  keyProvider: LocalKms;
  vault: VaultService;
  notifications: ConsoleNotificationService;
  audit: PostgresAuditService;
  ai: StubSummaryService;
}

export function buildServices(config: AppConfig, db: Database | null): AppServices {
  const keyProvider = new LocalKms(config.VAULT_MASTER_KEY);
  const objectStore = new LocalObjectStore(config.VAULT_LOCAL_PATH);

  return {
    challenges: new ChallengeStore(),
    keyProvider,
    vault: new VaultService(keyProvider, objectStore),
    notifications: new ConsoleNotificationService(),
    audit: new PostgresAuditService(db),
    ai: new StubSummaryService(),
  };
}
