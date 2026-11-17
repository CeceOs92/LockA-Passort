import type { Database } from '../../db/pool.js';

export interface AuditEventInput {
  actorAddress?: string;
  passportId?: string;
  providerId?: string;
  accessId?: number;
  action: string;
  resourceType: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditService {
  record(input: AuditEventInput): Promise<void>;
}

export class PostgresAuditService implements AuditService {
  constructor(private readonly db: Database | null) {}

  async record(input: AuditEventInput): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.db.query(
      `
        INSERT INTO audit_logs (
          actor_address,
          passport_id,
          provider_id,
          access_id,
          action,
          resource_type,
          resource_id,
          ip_address,
          user_agent,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
      `,
      [
        input.actorAddress ?? null,
        input.passportId ?? null,
        input.providerId ?? null,
        input.accessId ?? null,
        input.action,
        input.resourceType,
        input.resourceId ?? null,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }
}
