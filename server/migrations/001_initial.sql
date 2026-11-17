CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stellar_address TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'patient'
    CHECK (role IN ('patient', 'provider', 'admin', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stellar_address TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_challenges_address_expiry_idx
  ON auth_challenges (stellar_address, expires_at DESC);

CREATE TABLE IF NOT EXISTS provider_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS provider_documents_provider_idx
  ON provider_documents (provider_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vault_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id TEXT NOT NULL,
  record_id TEXT,
  object_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  key_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vault_objects_passport_idx
  ON vault_objects (passport_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vault_objects_record_idx
  ON vault_objects (record_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_address TEXT,
  passport_id TEXT,
  provider_id TEXT,
  access_id BIGINT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_passport_idx
  ON audit_logs (passport_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_provider_idx
  ON audit_logs (provider_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_address TEXT NOT NULL,
  channel TEXT NOT NULL
    CHECK (channel IN ('email', 'sms', 'push', 'whatsapp')),
  template TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notifications_status_idx
  ON notifications (status, created_at);

CREATE TABLE IF NOT EXISTS ai_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id TEXT NOT NULL,
  provider_id TEXT,
  access_id BIGINT,
  model TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_summaries_passport_idx
  ON ai_summaries (passport_id, created_at DESC);

CREATE TABLE IF NOT EXISTS indexed_events (
  id BIGSERIAL PRIMARY KEY,
  contract_id TEXT NOT NULL,
  ledger BIGINT NOT NULL,
  tx_hash TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, tx_hash, event_index)
);

CREATE INDEX IF NOT EXISTS indexed_events_ledger_idx
  ON indexed_events (ledger, event_index);

CREATE TABLE IF NOT EXISTS passport_view (
  passport_id TEXT PRIMARY KEY,
  controller TEXT NOT NULL,
  status INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_view (
  provider_id TEXT PRIMARY KEY,
  operator TEXT NOT NULL,
  status INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consent_access_view (
  access_id BIGINT PRIMARY KEY,
  passport_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  record_scope INTEGER NOT NULL,
  status INTEGER NOT NULL,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS consent_access_passport_idx
  ON consent_access_view (passport_id, status);

CREATE TABLE IF NOT EXISTS record_view (
  record_id TEXT PRIMARY KEY,
  passport_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  record_type INTEGER NOT NULL,
  status INTEGER NOT NULL,
  encrypted_file_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS record_view_passport_idx
  ON record_view (passport_id, status);
