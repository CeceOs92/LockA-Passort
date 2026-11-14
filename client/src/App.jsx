import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar.jsx';
import { Dashboard } from './components/Dashboard.jsx';
import { PatientPortal } from './components/PatientPortal.jsx';
import { ProviderPortal } from './components/ProviderPortal.jsx';
import { MedicalRecords } from './components/MedicalRecords.jsx';
import { Toast, useToast } from './components/Toast.jsx';
import { useStellarWallet } from './hooks/useStellarWallet.js';
import { createLockaService, resetDemoState } from './services/lockaService.js';
import {
  CONTRACT_DOCS,
  DEFAULT_CONTRACTS,
  EXPLORER_URL,
  NETWORK_NAME,
  SOROBAN_RPC_URL,
  HORIZON_URL,
  getContractIds,
  saveContractIds,
} from './utils/constants.js';
import {
  getProviderStatusLabel,
  getProviderTypeLabel,
  parseContractError,
  statusToBadgeClass,
  truncateAddress,
} from './utils/helpers.js';

export default function App() {
  const [page, setPage] = useState('dashboard');
  const { toasts, toast, removeToast } = useToast();
  const wallet = useStellarWallet();
  const contracts = useMemo(() => createLockaService(wallet.account), [wallet.account]);

  const sharedProps = {
    account: wallet.account,
    walletType: wallet.walletType,
    contracts,
    toast,
  };

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg,#050810 0%,#0a0f1e 50%,#050c1a 100%)' }}>
      <Navbar
        account={wallet.account}
        walletType={wallet.walletType}
        isConnecting={wallet.isConnecting}
        isCorrectNetwork={wallet.isCorrectNetwork}
        freighterAvailable={wallet.freighterAvailable}
        onConnect={wallet.connect}
        onConnectDemo={wallet.connectDemo}
        onDisconnect={wallet.disconnect}
        onSwitchNetwork={wallet.switchNetwork}
        currentPage={page}
        onNavigate={setPage}
      />
      <main className="pb-16">
        {page === 'dashboard' && (
          <Dashboard
            {...sharedProps}
            onNavigate={setPage}
            onConnect={wallet.connect}
            onConnectDemo={wallet.connectDemo}
          />
        )}
        {page === 'patient' && <PatientPortal {...sharedProps} />}
        {page === 'provider' && <ProviderPortal {...sharedProps} />}
        {page === 'records' && <MedicalRecords {...sharedProps} />}
        {page === 'admin' && <AdminPanel {...sharedProps} />}
      </main>
      <Toast toasts={toasts} removeToast={removeToast} />
    </div>
  );
}

function AdminPanel({ account, walletType, contracts, toast }) {
  const [contractIds, setContractIds] = useState(() => getContractIds());
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState([]);
  const [stats, setStats] = useState(null);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [actionLoading, setActionLoading] = useState({});

  const loadProviders = useCallback(async () => {
    setLoadingProviders(true);
    try {
      const [list, globalStats] = await Promise.all([contracts.getAllProviders(), contracts.getGlobalStats()]);
      setProviders(list);
      setStats(globalStats);
    } catch (err) {
      toast.error(parseContractError(err));
    } finally {
      setLoadingProviders(false);
    }
  }, [contracts, toast]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  function handleSave() {
    const invalid = Object.entries(contractIds).find(
      ([, value]) => value && value.trim() && !/^C[A-Z2-7]{55}$/.test(value.trim()),
    );
    if (invalid) {
      toast.error(`${invalid[0]} must be a valid Soroban contract ID (starts with C, 56 characters)`);
      return;
    }
    setSaving(true);
    try {
      saveContractIds(contractIds);
      toast.success('Contract IDs saved! Reload the page for changes to take effect.', {
        title: 'Saved',
        duration: 6000,
      });
    } catch {
      toast.error('Failed to save contract IDs');
    } finally {
      setSaving(false);
    }
  }

  function handleResetContracts() {
    const blank = Object.fromEntries(Object.keys(DEFAULT_CONTRACTS).map((key) => [key, '']));
    setContractIds(blank);
    saveContractIds(blank);
    toast.info('Contract IDs cleared');
  }

  async function handleProviderAction(providerId, action) {
    setActionLoading((prev) => ({ ...prev, [providerId]: action }));
    try {
      if (action === 'verify') await contracts.verifyProvider(providerId);
      if (action === 'suspend') await contracts.suspendProvider(providerId);
      if (action === 'reactivate') await contracts.reactivateProvider(providerId);
      toast.success(`Provider ${action === 'verify' ? 'verified' : action === 'suspend' ? 'suspended' : 'reactivated'}`);
      await loadProviders();
    } catch (err) {
      toast.error(parseContractError(err));
    } finally {
      setActionLoading((prev) => ({ ...prev, [providerId]: null }));
    }
  }

  function handleResetDemoData() {
    if (!window.confirm('Clear all locally stored demo passports, providers, records, and consent grants?')) return;
    resetDemoState();
    toast.info('Demo data cleared. Reloading…');
    setTimeout(() => window.location.reload(), 600);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Admin Panel</h1>
        <p className="text-slate-400 text-sm">
          Configure Soroban contracts and review provider registrations — stored in browser localStorage
        </p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          {[
            { label: 'Patients', value: stats.patients },
            { label: 'Providers', value: stats.providers },
            { label: 'Pending', value: stats.pendingProviders },
            { label: 'Records', value: stats.records },
            { label: 'Access requests', value: stats.pendingAccess },
          ].map((item) => (
            <div key={item.label} className="glass rounded-xl p-4">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                {item.label}
              </div>
              <div className="text-2xl font-bold text-white">{item.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="glass rounded-xl p-6 mb-6">
        <div className="section-header">Soroban Contract IDs</div>
        <div className="space-y-5 mt-4">
          {Object.keys(DEFAULT_CONTRACTS).map((key) => (
            <div key={key}>
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-1 block">{key}</label>
              <p className="text-xs text-slate-500 mb-2">{CONTRACT_DOCS[key]}</p>
              <input
                type="text"
                className="input-field font-mono text-sm"
                placeholder="C... Stellar Testnet contract ID"
                value={contractIds[key] || ''}
                spellCheck={false}
                onChange={(e) => setContractIds((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-3 mt-6 flex-wrap">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary px-5 py-2.5 rounded-lg text-sm flex items-center gap-2"
          >
            {saving ? (
              <>
                <span className="spinner" />
                Saving…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Save Contract IDs
              </>
            )}
          </button>
          <button onClick={handleResetContracts} className="btn-secondary px-5 py-2.5 rounded-lg text-sm">
            Clear IDs
          </button>
        </div>
      </div>

      <div className="glass rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="section-header mb-0">Provider Verification Queue</div>
          <button onClick={loadProviders} disabled={loadingProviders} className="btn-secondary text-xs px-3 py-1.5 rounded-lg">
            {loadingProviders ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {providers.length === 0 ? (
          <p className="text-slate-400 text-sm">No providers registered yet.</p>
        ) : (
          <div className="space-y-3">
            {providers.map((provider) => (
              <div key={provider.providerId} className="rounded-xl p-4" style={{ background: 'rgba(5,8,16,0.4)' }}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500 mb-1">Provider ID</div>
                    <div className="font-mono text-xs text-slate-300 truncate">{provider.providerId}</div>
                    <div className="text-xs text-slate-400 mt-2">
                      {getProviderTypeLabel(provider.providerType)} · {provider.country}
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-1">{truncateAddress(provider.wallet, 8)}</div>
                  </div>
                  <span className={`badge ${statusToBadgeClass(provider.status, 'provider')}`}>
                    {getProviderStatusLabel(provider.status)}
                  </span>
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  {provider.status !== 1 && (
                    <button
                      onClick={() => handleProviderAction(provider.providerId, 'verify')}
                      disabled={!!actionLoading[provider.providerId]}
                      className="btn-green text-xs px-3 py-1.5 rounded-lg"
                    >
                      ✓ Verify
                    </button>
                  )}
                  {provider.status === 1 && (
                    <button
                      onClick={() => handleProviderAction(provider.providerId, 'suspend')}
                      disabled={!!actionLoading[provider.providerId]}
                      className="btn-amber text-xs px-3 py-1.5 rounded-lg"
                    >
                      Suspend
                    </button>
                  )}
                  {provider.status === 2 && (
                    <button
                      onClick={() => handleProviderAction(provider.providerId, 'reactivate')}
                      disabled={!!actionLoading[provider.providerId]}
                      className="btn-secondary text-xs px-3 py-1.5 rounded-lg"
                    >
                      Reactivate
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass rounded-xl p-5 mb-6">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="text-blue-300 font-semibold text-sm mb-2">How to connect the Stellar contracts</p>
            <ol className="text-slate-400 text-xs space-y-1 list-decimal list-inside">
              <li>Build and deploy the Soroban contracts to Stellar Testnet with the Stellar CLI.</li>
              <li>Copy each deployed contract ID from the deployment output.</li>
              <li>Paste the contract IDs above and click Save.</li>
              <li>Reload the page — this client is then ready to call the real contracts.</li>
            </ol>
            <div className="text-[11px] text-slate-500 mt-3 space-y-0.5 font-mono break-all">
              <div>Network: {NETWORK_NAME}</div>
              <div>RPC: {SOROBAN_RPC_URL}</div>
              <div>Horizon: {HORIZON_URL}</div>
            </div>
            <a
              href={EXPLORER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 text-xs hover:text-blue-300 mt-2 inline-block"
            >
              Open Stellar Expert Testnet Explorer ↗
            </a>
          </div>
        </div>
      </div>

      <div className="glass rounded-xl p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-white">Demo data</p>
            <p className="text-xs text-slate-500 mt-1">
              {account
                ? `Currently using a ${walletType === 'demo' ? 'demo' : 'Freighter'} account. Local demo records are stored only in this browser.`
                : 'Connect a wallet to test the registration, record, and consent flows.'}
            </p>
          </div>
          <button onClick={handleResetDemoData} className="btn-danger text-xs px-4 py-2 rounded-lg">
            Reset Demo Data
          </button>
        </div>
      </div>
    </div>
  );
}
