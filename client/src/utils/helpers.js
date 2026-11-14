import {
  PassportStatus,
  ProviderStatus,
  RecordStatus,
  AccessStatus,
  ProviderTypes,
  RecordTypes,
  RecordScopes,
  ZERO_HASH,
} from './constants.js';

// ── Hashing / Bytes32 Utilities ───────────────────────────
export function normalizeHash(value) {
  if (!value) return '';
  return String(value).trim().replace(/^0x/i, '').toLowerCase();
}

export function isValidHash(value) {
  return /^[0-9a-fA-F]{64}$/.test(String(value || '').trim().replace(/^0x/i, ''));
}

export function randomHex32() {
  const bytes = new Uint8Array(32);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is unavailable. Use the app over HTTPS or localhost.');
  }
  const data = new TextEncoder().encode(String(input));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function generateIdentityHash(walletAddress, salt = '') {
  return sha256Hex(`${walletAddress}-${salt || Date.now()}`);
}

export async function generateLicenseHash(licenseStr) {
  return sha256Hex(licenseStr || `license-${Date.now()}`);
}

export function truncateBytes32(hex, chars = 8) {
  const value = normalizeHash(hex);
  if (!value || value === ZERO_HASH) return '—';
  return `${value.slice(0, chars)}...${value.slice(-chars)}`;
}

export function truncateAddress(address, chars = 6) {
  if (!address) return '—';
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
}

// ── Status Formatters ─────────────────────────────────────
export function getPassportStatusLabel(status) {
  return PassportStatus[status] ?? 'Unknown';
}
export function getProviderStatusLabel(status) {
  return ProviderStatus[status] ?? 'Unknown';
}
export function getRecordStatusLabel(status) {
  return RecordStatus[status] ?? 'Unknown';
}
export function getAccessStatusLabel(status) {
  return AccessStatus[status] ?? 'Unknown';
}

export function getProviderTypeLabel(type) {
  return ProviderTypes.find((t) => t.value === type)?.label ?? `Type ${type}`;
}
export function getRecordTypeLabel(type) {
  return RecordTypes.find((t) => t.value === type)?.label ?? `Type ${type}`;
}
export function getRecordScopeLabel(scope) {
  return RecordScopes.find((s) => s.value === scope)?.label ?? `Scope ${scope}`;
}

export function statusToBadgeClass(status, type = 'passport') {
  if (type === 'passport') {
    if (status === 0) return 'badge-green';
    if (status === 1) return 'badge-amber';
    return 'badge-red';
  }
  if (type === 'provider') {
    if (status === 1) return 'badge-green';
    if (status === 0) return 'badge-amber';
    return 'badge-red';
  }
  if (type === 'record') {
    if (status === 0) return 'badge-green';
    if (status === 1) return 'badge-cyan';
    return 'badge-red';
  }
  if (type === 'access') {
    if (status === 1) return 'badge-green';
    if (status === 0) return 'badge-amber';
    if (status === 2) return 'badge-red';
    return 'badge-gray';
  }
  return 'badge-gray';
}

// ── Date Utilities ────────────────────────────────────────
export function formatTimestamp(ts) {
  if (!ts) return '—';
  try {
    const n = typeof ts === 'bigint' ? Number(ts) : ts;
    if (n === 0) return '—';
    return new Date(n * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (_) {
    return '—';
  }
}

export function dateToTimestamp(dateStr) {
  if (!dateStr) return 0;
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

export function timestampToDateInput(ts) {
  if (!ts) return '';
  const n = typeof ts === 'bigint' ? Number(ts) : ts;
  return new Date(n * 1000).toISOString().slice(0, 16);
}

// ── Error Parsing ─────────────────────────────────────────
export function parseContractError(error) {
  if (!error) return 'An unknown error occurred';
  const msg = error?.reason || error?.message || String(error);
  if (/user rejected|user declined|denied|rejected by user/i.test(msg)) return 'Request rejected by user';
  if (/insufficient|balance|fee/i.test(msg)) return 'Insufficient balance to submit the transaction';
  if (/already registered/i.test(msg)) return 'This wallet is already registered';
  if (/not registered/i.test(msg)) return 'Wallet is not registered';
  if (/not active/i.test(msg)) return 'Passport or provider is not active';
  if (/not verified/i.test(msg)) return 'Provider is not verified';
  if (/access denied|unauthorized|not authorized/i.test(msg)) return 'Unauthorized: insufficient permissions';
  if (/expired/i.test(msg)) return 'This access grant has expired';
  if (/invalid address|invalid stellar/i.test(msg)) return 'Invalid Stellar address provided';
  if (/invalid|must be/i.test(msg)) return msg;
  if (msg.length > 140) return `${msg.slice(0, 140)}…`;
  return msg;
}

// ── Validation ────────────────────────────────────────────
export function isValidAddress(address) {
  return /^G[A-Z2-7]{55}$/.test(String(address || '').trim());
}

export function isValidContractId(contractId) {
  return /^C[A-Z2-7]{55}$/.test(String(contractId || '').trim());
}

export function isValidBytes32(hex) {
  return isValidHash(hex);
}

export function isZeroAddress(address) {
  return !address || String(address).trim() === '';
}

export function isZeroBytes32(hex) {
  const value = normalizeHash(hex);
  return !value || value === ZERO_HASH;
}
