# LockA Soroban Contracts

Core trust layer for LockA Medical Passport on Stellar.

This workspace intentionally contains only the four contracts needed for the MVP:

| Contract | Responsibility |
| --- | --- |
| `patient-passport-registry` | Stable passport IDs, controller wallet binding, recovery address, passport status |
| `provider-registry` | Verified healthcare provider allowlist and operator wallet binding |
| `consent-access-manager` | Patient-approved, scoped, expiring, revocable provider access |
| `medical-record-registry` | Tamper-evident commitments for encrypted off-chain records |

The ZK credential verifier is intentionally deferred. ZK should be added only for a concrete selective-disclosure claim after the off-chain credential flow exists.

## Design Rules

- No raw medical data, encryption keys, provider documents, or PII on-chain.
- Stable business IDs are `BytesN<32>`: `passport_id`, `provider_id`, `record_id`.
- Wallet addresses are controllers/operators, not the business IDs.
- Consent and record writes cross-check the registries.
- Access is scoped, time-limited, and revocable.
- On-chain events are the audit source; an off-chain indexer materializes them.
- Persistent entries are TTL-extended for long-lived passport data.

## Build And Test

```bash
cd smart-contracts
cargo test
cargo build --target wasm32v1-none --release
```

## Contract Dependency Direction

```text
patient-passport-registry ─┐
                           ├──> consent-access-manager
provider-registry ─────────┤
                           └──> medical-record-registry
```

The registries do not depend on consent or records, so there are no contract call cycles.

## Deploy Order

1. `patient-passport-registry`
2. `provider-registry`
3. `consent-access-manager` with the two registry contract IDs
4. `medical-record-registry` with the two registry contract IDs

## Off-Chain Components

The off-chain services live in `../server` as the `locka-api` service and are not part of this Rust workspace.

| Path | Responsibility |
| --- | --- |
| `server/src/routes` | Fastify HTTP routes and wallet-authenticated API entrypoints |
| `server/src/services/auth` | Stellar challenge/response authentication |
| `server/src/services/vault` | Encrypted object storage boundary |
| `server/src/services/keys` | Envelope-encryption key provider; local dev KMS now, cloud KMS/HSM later |
| `server/src/services/indexer` | Soroban RPC event indexing interfaces |
| `server/src/services/notifications` | Email/SMS/push/WhatsApp adapters |
| `server/src/services/audit` | Off-chain read/decrypt audit logging |
| `server/src/services/ai` | Consent-gated AI summaries |
| `server/migrations` | PostgreSQL schema for metadata, projections, and audit logs |
