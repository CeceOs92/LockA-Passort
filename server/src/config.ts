import 'dotenv/config';
import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: optionalString,
  JWT_SECRET: z
    .string()
    .min(32)
    .default('dev-only-secret-change-me-please-32chars'),

  STELLAR_NETWORK: z.enum(['testnet', 'mainnet', 'futurenet']).default('testnet'),
  STELLAR_RPC_URL: z.string().url().default('https://soroban-testnet.stellar.org'),
  STELLAR_NETWORK_PASSPHRASE: z
    .string()
    .default('Test SDF Network ; September 2015'),

  CONTRACT_PATIENT_REGISTRY: optionalString,
  CONTRACT_PROVIDER_REGISTRY: optionalString,
  CONTRACT_CONSENT_MANAGER: optionalString,
  CONTRACT_MEDICAL_RECORDS: optionalString,

  AUTH_CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  VAULT_LOCAL_PATH: z.string().default('./.data/vault'),
  VAULT_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .default('0'.repeat(64)),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(source);
}

export function corsOrigins(config: AppConfig): string[] {
  return config.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
