// ============================================================
// STELLAR / SOROBAN NETWORK CONFIGURATION
// ============================================================
export const STELLAR_NETWORK = 'TESTNET';
export const NETWORK_NAME = 'Stellar Testnet';
export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
export const HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const SOROBAN_RPC_URL = 'https://soroban-testnet.stellar.org';
export const EXPLORER_URL = 'https://stellar.expert/explorer/testnet';
export const FRIENDBOT_URL = 'https://friendbot.stellar.org';

export function explorerTxUrl(hash) {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function explorerAccountUrl(address) {
  return `${EXPLORER_URL}/account/${address}`;
}

export function explorerContractUrl(contractId) {
  return `${EXPLORER_URL}/contract/${contractId}`;
}

// ============================================================
// SOROBAN CONTRACT IDS — configurable via Admin Panel / localStorage
// ============================================================
export const DEFAULT_CONTRACTS = {
  PatientIdentityRegistry: '',
  ProviderRegistry: '',
  ConsentAccessControl: '',
  RecordCommitmentRegistry: '',
};

export const CONTRACT_DOCS = {
  PatientIdentityRegistry: 'Registers patient passport identifiers, public keys, and recovery configuration',
  ProviderRegistry: 'Registers verified hospitals, clinics, labs, pharmacies, insurers, and staff accounts',
  ConsentAccessControl: 'Creates, approves, limits, expires, and revokes provider access permissions',
  RecordCommitmentRegistry: 'Stores hashes and commitments of encrypted records without exposing health data',
};

export const LS_KEY = 'locka_soroban_contracts';

export function getContractIds() {
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) return { ...DEFAULT_CONTRACTS, ...JSON.parse(stored) };
  } catch (_) {
    /* ignore corrupt storage */
  }
  return { ...DEFAULT_CONTRACTS };
}

export function saveContractIds(contracts) {
  localStorage.setItem(LS_KEY, JSON.stringify(contracts));
}

export function hasConfiguredContracts(contracts = getContractIds()) {
  return Object.values(contracts).some((value) => Boolean(value && value.trim()));
}

// ============================================================
// ENUMS
// ============================================================
export const PassportStatus = { 0: 'Active', 1: 'Suspended', 2: 'Revoked' };
export const ProviderStatus = { 0: 'Pending', 1: 'Verified', 2: 'Suspended', 3: 'Revoked' };
export const RecordStatus = { 0: 'Active', 1: 'Amended', 2: 'Revoked' };
export const AccessStatus = { 0: 'Pending', 1: 'Approved', 2: 'Rejected', 3: 'Revoked', 4: 'Expired' };

export const ProviderTypes = [
  { value: 0, label: 'Hospital' },
  { value: 1, label: 'Clinic' },
  { value: 2, label: 'Doctor' },
  { value: 3, label: 'Laboratory' },
  { value: 4, label: 'Pharmacy' },
  { value: 5, label: 'Insurance Company' },
  { value: 6, label: 'Public Health Agency' },
];

export const RecordTypes = [
  { value: 0, label: 'Lab Result' },
  { value: 1, label: 'Prescription' },
  { value: 2, label: 'Diagnosis' },
  { value: 3, label: 'Vaccination' },
  { value: 4, label: 'Surgery Report' },
  { value: 5, label: 'Allergy Record' },
  { value: 6, label: 'Insurance Record' },
  { value: 7, label: 'Medical Summary' },
];

export const RecordScopes = [
  { value: 0, label: 'All Records' },
  { value: 1, label: 'Lab Results Only' },
  { value: 2, label: 'Prescriptions Only' },
  { value: 3, label: 'Vaccination Records Only' },
  { value: 4, label: 'Emergency Summary Only' },
  { value: 5, label: 'Insurance Data Only' },
];

// ============================================================
// STELLAR DATA CONVENTIONS
// ============================================================
// Soroban contracts use BytesN<32> commitments and StrKey account addresses.
export const ZERO_HASH = '0'.repeat(64);

export const WALLET_STORAGE_KEY = 'locka_wallet';
export const DEMO_ACCOUNT_KEY = 'locka_demo_account';
