import { ZERO_HASH } from '../utils/constants.js';
import { normalizeHash, randomHex32 } from '../utils/helpers.js';

const STORAGE_KEY = 'locka_demo_state_v1';

function emptyState() {
  return {
    version: 1,
    patients: {},
    providers: {},
    records: {},
    patientRecords: {},
    providerRecords: {},
    access: {},
    patientAccess: {},
    providerAccess: {},
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return { ...emptyState(), ...parsed };
  } catch (_) {
    return emptyState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetDemoState() {
  localStorage.removeItem(STORAGE_KEY);
}

function effectiveAccessStatus(access) {
  if (!access) return undefined;
  if (access.status === 1 && Number(access.expiresAt) * 1000 <= Date.now()) return 4;
  return access.status;
}

function patientByPassportId(state, passportId) {
  return Object.values(state.patients).find((p) => p.passportId === passportId);
}

function providerByProviderId(state, providerId) {
  return Object.values(state.providers).find((p) => p.providerId === providerId);
}

/**
 * Browser-side data adapter for LockA.
 *
 * The deployed app will trade this adapter for generated Soroban client
 * bindings. Every method mirrors the contract surface defined in the
 * LockA README so the UI wiring does not need to change later.
 */
export function createLockaService(account) {
  const wallet = account || '';

  // ── PatientIdentityRegistry ──────────────────────────────
  async function registerPatient(publicIdentityHash, recoveryAddress) {
    const state = loadState();
    if (!wallet) throw new Error('Connect a wallet before registering');
    if (state.patients[wallet]) throw new Error('This wallet is already registered');
    if (!normalizeHash(publicIdentityHash)) throw new Error('Invalid identity commitment');

    const passportId = randomHex32();
    state.patients[wallet] = {
      passportId,
      wallet,
      identityHash: normalizeHash(publicIdentityHash),
      recoveryAddress,
      status: 0,
      createdAt: Date.now(),
    };
    saveState(state);
    return {};
  }

  async function getPassportIdByWallet(address) {
    const state = loadState();
    return state.patients[address]?.passportId || ZERO_HASH;
  }

  async function isPassportActive(passportId) {
    const state = loadState();
    const patient = patientByPassportId(state, passportId);
    return Boolean(patient && patient.status === 0);
  }

  async function getPassportStatus(passportId) {
    const state = loadState();
    const patient = patientByPassportId(state, passportId);
    if (!patient) throw new Error('Passport is not registered');
    return patient.status;
  }

  async function isWalletRegistered(address) {
    const state = loadState();
    return Boolean(state.patients[address]);
  }

  async function updateRecoveryAddress(passportId, newRecoveryAddress) {
    const state = loadState();
    const patient = state.patients[wallet];
    if (!patient || patient.passportId !== passportId) {
      throw new Error('Unauthorized: only the passport owner can update recovery');
    }
    patient.recoveryAddress = newRecoveryAddress;
    saveState(state);
    return {};
  }

  async function suspendPassport(passportId) {
    const state = loadState();
    const patient = state.patients[wallet];
    if (!patient || patient.passportId !== passportId) {
      throw new Error('Unauthorized: only the passport owner can suspend it');
    }
    patient.status = 1;
    saveState(state);
    return {};
  }

  async function reactivatePassport(passportId) {
    const state = loadState();
    const patient = state.patients[wallet];
    if (!patient || patient.passportId !== passportId) {
      throw new Error('Unauthorized: only the passport owner can reactivate it');
    }
    patient.status = 0;
    saveState(state);
    return {};
  }

  // ── ProviderRegistry ─────────────────────────────────────
  async function registerProvider(providerType, licenseHash, country) {
    const state = loadState();
    if (!wallet) throw new Error('Connect a wallet before registering');
    if (state.providers[wallet]) throw new Error('This wallet is already registered');
    if (!normalizeHash(licenseHash)) throw new Error('Invalid license commitment');
    if (!String(country || '').trim()) throw new Error('Country is required');

    const providerId = randomHex32();
    state.providers[wallet] = {
      providerId,
      wallet,
      providerType: Number(providerType),
      licenseHash: normalizeHash(licenseHash),
      country: String(country).trim(),
      status: 0,
      createdAt: Date.now(),
    };
    saveState(state);
    return {};
  }

  async function getProviderIdByWallet(address) {
    const state = loadState();
    return state.providers[address]?.providerId || ZERO_HASH;
  }

  async function isProviderVerified(providerId) {
    const state = loadState();
    const provider = providerByProviderId(state, providerId);
    return Boolean(provider && provider.status === 1);
  }

  async function getProviderStatus(providerId) {
    const state = loadState();
    const provider = providerByProviderId(state, providerId);
    if (!provider) throw new Error('Provider is not registered');
    return provider.status;
  }

  async function isWalletVerifiedProvider(address) {
    const state = loadState();
    return Boolean(state.providers[address] && state.providers[address].status === 1);
  }

  async function verifyProvider(providerId) {
    const state = loadState();
    const provider = providerByProviderId(state, providerId);
    if (!provider) throw new Error('Provider is not registered');
    provider.status = 1;
    saveState(state);
    return {};
  }

  async function suspendProvider(providerId) {
    const state = loadState();
    const provider = providerByProviderId(state, providerId);
    if (!provider) throw new Error('Provider is not registered');
    provider.status = 2;
    saveState(state);
    return {};
  }

  async function reactivateProvider(providerId) {
    const state = loadState();
    const provider = providerByProviderId(state, providerId);
    if (!provider) throw new Error('Provider is not registered');
    provider.status = 1;
    saveState(state);
    return {};
  }

  async function getAllProviders() {
    const state = loadState();
    return Object.values(state.providers).sort((a, b) => b.createdAt - a.createdAt);
  }

  async function getAllPatients() {
    const state = loadState();
    return Object.values(state.patients).sort((a, b) => b.createdAt - a.createdAt);
  }

  async function getGlobalStats() {
    const state = loadState();
    return {
      patients: Object.keys(state.patients).length,
      providers: Object.keys(state.providers).length,
      pendingProviders: Object.values(state.providers).filter((p) => p.status === 0).length,
      records: Object.keys(state.records).length,
      pendingAccess: Object.values(state.access).filter((a) => effectiveAccessStatus(a) === 0).length,
    };
  }

  // ── RecordCommitmentRegistry ─────────────────────────────
  async function addRecord(passportId, providerId, recordType, encryptedFileHash, storagePointerHash) {
    const state = loadState();
    const provider = state.providers[wallet];
    if (!provider) throw new Error('Only registered providers can add records');
    if (provider.providerId !== providerId) {
      throw new Error('Unauthorized: provider wallet does not own this provider ID');
    }
    if (provider.status !== 1) throw new Error('Provider is not verified');

    const patient = patientByPassportId(state, passportId);
    if (!patient) throw new Error('Passport is not registered');
    if (patient.status !== 0) throw new Error('Passport is not active');

    const recordId = randomHex32();
    state.records[recordId] = {
      recordId,
      passportId,
      providerId,
      providerWallet: wallet,
      recordType: Number(recordType),
      encryptedFileHash: normalizeHash(encryptedFileHash),
      storagePointerHash: normalizeHash(storagePointerHash),
      status: 0,
      createdAt: Date.now(),
    };
    state.patientRecords[passportId] = [...(state.patientRecords[passportId] || []), recordId];
    state.providerRecords[providerId] = [...(state.providerRecords[providerId] || []), recordId];
    saveState(state);
    return {};
  }

  async function getPatientRecordIds(passportId) {
    const state = loadState();
    return state.patientRecords[passportId] || [];
  }

  async function getProviderRecordIds(providerId) {
    const state = loadState();
    return state.providerRecords[providerId] || [];
  }

  async function getRecordStatus(recordId) {
    const state = loadState();
    const record = state.records[recordId];
    if (!record) throw new Error('Record not found');
    return record.status;
  }

  async function getRecordPassportId(recordId) {
    const state = loadState();
    const record = state.records[recordId];
    if (!record) throw new Error('Record not found');
    return record.passportId;
  }

  async function getRecordProviderId(recordId) {
    const state = loadState();
    const record = state.records[recordId];
    if (!record) throw new Error('Record not found');
    return record.providerId;
  }

  async function isRecordValid(recordId) {
    const state = loadState();
    return Boolean(state.records[recordId] && state.records[recordId].status === 0);
  }

  async function verifyRecordHash(recordId, fileHash) {
    const state = loadState();
    const record = state.records[recordId];
    if (!record) throw new Error('Record not found');
    return record.encryptedFileHash === normalizeHash(fileHash);
  }

  async function updateRecordStatus(recordId, newStatus) {
    const state = loadState();
    const record = state.records[recordId];
    if (!record) throw new Error('Record not found');
    if (record.providerWallet !== wallet) {
      throw new Error('Unauthorized: only the issuing provider can update this record');
    }
    record.status = Number(newStatus);
    saveState(state);
    return {};
  }

  // ── ConsentAccessControl ─────────────────────────────────
  async function requestAccess(passportId, providerId, patientWallet, recordScope, expiresAt) {
    const state = loadState();
    const provider = state.providers[wallet];
    if (!provider) throw new Error('Only registered providers can request access');
    if (provider.providerId !== providerId) {
      throw new Error('Unauthorized: provider wallet does not own this provider ID');
    }
    if (provider.status !== 1) throw new Error('Provider is not verified');

    const patient = patientByPassportId(state, passportId);
    if (!patient) throw new Error('Passport is not registered');
    if (patient.status !== 0) throw new Error('Passport is not active');
    if (patient.wallet !== patientWallet) throw new Error('Patient wallet does not match passport');
    if (Number(expiresAt) * 1000 <= Date.now()) throw new Error('Access expiry must be in the future');

    const accessId = randomHex32();
    state.access[accessId] = {
      accessId,
      passportId,
      providerId,
      patientWallet,
      providerWallet: wallet,
      recordScope: Number(recordScope),
      expiresAt: Number(expiresAt),
      status: 0,
      createdAt: Date.now(),
    };
    state.patientAccess[passportId] = [...(state.patientAccess[passportId] || []), accessId];
    state.providerAccess[providerId] = [...(state.providerAccess[providerId] || []), accessId];
    saveState(state);
    return {};
  }

  function setAccessStatus(accessId, status, allowedWallets) {
    const state = loadState();
    const access = state.access[accessId];
    if (!access) throw new Error('Access request not found');
    if (!allowedWallets.includes(wallet)) {
      throw new Error('Unauthorized: you cannot change this access request');
    }
    access.status = status;
    saveState(state);
    return {};
  }

  async function approveAccess(accessId) {
    const state = loadState();
    const access = state.access[accessId];
    if (!access) throw new Error('Access request not found');
    return setAccessStatus(accessId, 1, [access.patientWallet]);
  }

  async function rejectAccess(accessId) {
    const state = loadState();
    const access = state.access[accessId];
    if (!access) throw new Error('Access request not found');
    return setAccessStatus(accessId, 2, [access.patientWallet]);
  }

  async function revokeAccess(accessId) {
    const state = loadState();
    const access = state.access[accessId];
    if (!access) throw new Error('Access request not found');
    return setAccessStatus(accessId, 3, [access.patientWallet, access.providerWallet]);
  }

  async function getPatientAccessIds(passportId) {
    const state = loadState();
    return state.patientAccess[passportId] || [];
  }

  async function getProviderAccessIds(providerId) {
    const state = loadState();
    return state.providerAccess[providerId] || [];
  }

  async function getAccessStatus(accessId) {
    const state = loadState();
    return effectiveAccessStatus(state.access[accessId]);
  }

  async function hasActiveAccess(passportId, providerId) {
    const state = loadState();
    return Object.values(state.access).some(
      (access) =>
        access.passportId === passportId &&
        access.providerId === providerId &&
        effectiveAccessStatus(access) === 1,
    );
  }

  async function getAccessDetails(accessId) {
    const state = loadState();
    const access = state.access[accessId];
    if (!access) return null;
    return { ...access, status: effectiveAccessStatus(access) };
  }

  return {
    account: wallet,
    // PatientIdentityRegistry
    registerPatient,
    getPassportIdByWallet,
    isPassportActive,
    getPassportStatus,
    isWalletRegistered,
    updateRecoveryAddress,
    suspendPassport,
    reactivatePassport,
    // ProviderRegistry
    registerProvider,
    getProviderIdByWallet,
    isProviderVerified,
    getProviderStatus,
    isWalletVerifiedProvider,
    verifyProvider,
    suspendProvider,
    reactivateProvider,
    getAllProviders,
    getAllPatients,
    getGlobalStats,
    // RecordCommitmentRegistry
    addRecord,
    getPatientRecordIds,
    getProviderRecordIds,
    getRecordStatus,
    getRecordPassportId,
    getRecordProviderId,
    isRecordValid,
    verifyRecordHash,
    updateRecordStatus,
    // ConsentAccessControl
    requestAccess,
    approveAccess,
    rejectAccess,
    revokeAccess,
    getPatientAccessIds,
    getProviderAccessIds,
    getAccessStatus,
    hasActiveAccess,
    getAccessDetails,
  };
}
