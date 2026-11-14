import React, { useState, useEffect } from 'react';
import {
  truncateAddress,
  truncateBytes32,
  getPassportStatusLabel,
  getProviderStatusLabel,
  statusToBadgeClass,
  isZeroBytes32,
  parseContractError,
} from '../utils/helpers.js';
import { getContractIds, hasConfiguredContracts, NETWORK_NAME } from '../utils/constants.js';

export function Dashboard({ account, walletType, contracts, onNavigate, toast, onConnect, onConnectDemo }) {
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState(null);
  const [passportId, setPassportId] = useState(null);
  const [passportStatus, setPassportStatus] = useState(null);
  const [providerId, setProviderId] = useState(null);
  const [providerStatus, setProviderStatus] = useState(null);
  const [recordCount, setRecordCount] = useState(0);
  const [pendingConsents, setPendingConsents] = useState(0);

  const contractIds = getContractIds();
  const contractsConfigured = hasConfiguredContracts(contractIds);

  useEffect(() => {
    if (!account) {
      setRole(null);
      setPassportId(null);
      setPassportStatus(null);
      setProviderId(null);
      setProviderStatus(null);
      setRecordCount(0);
      setPendingConsents(0);
      setLoading(false);
      return;
    }
    detectRole();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  async function detectRole() {
    setLoading(true);
    setPassportId(null);
    setPassportStatus(null);
    setProviderId(null);
    setProviderStatus(null);
    setRecordCount(0);
    setPendingConsents(0);
    try {
      let isPatient = false;
      let isProvider = false;

      try {
        isPatient = await contracts.isWalletRegistered(account);
        if (isPatient) {
          const pid = await contracts.getPassportIdByWallet(account);
          setPassportId(pid);
          setPassportStatus(Number(await contracts.getPassportStatus(pid)));
          try {
            setRecordCount((await contracts.getPatientRecordIds(pid)).length);
          } catch (_) {
            /* optional */
          }
          try {
            const aids = await contracts.getPatientAccessIds(pid);
            let pending = 0;
            for (const aid of aids.slice(0, 20)) {
              try {
                if (Number(await contracts.getAccessStatus(aid)) === 0) pending += 1;
              } catch (_) {
                /* optional */
              }
            }
            setPendingConsents(pending);
          } catch (_) {
            /* optional */
          }
        }
      } catch (err) {
        if (!/not configured|not registered/i.test(err?.message || '')) {
          toast.error(parseContractError(err));
        }
      }

      try {
        const pid = await contracts.getProviderIdByWallet(account);
        if (!isZeroBytes32(pid)) {
          isProvider = true;
          setProviderId(pid);
          setProviderStatus(Number(await contracts.getProviderStatus(pid)));
        }
      } catch (_) {
        /* not a provider */
      }

      if (isPatient && isProvider) setRole('both');
      else if (isPatient) setRole('patient');
      else if (isProvider) setRole('provider');
      else setRole('unregistered');
    } catch (err) {
      setRole('unregistered');
      if (!/not configured/i.test(err?.message || '')) toast.error(parseContractError(err));
    } finally {
      setLoading(false);
    }
  }

  const roleConfig = {
    patient: {
      label: 'Patient',
      color: '#10b981',
      bg: 'rgba(16,185,129,0.08)',
      icon: '♥',
      desc: 'Manage your health passport, records, and consent',
    },
    provider: {
      label: 'Healthcare Provider',
      color: '#3b82f6',
      bg: 'rgba(59,130,246,0.08)',
      icon: '✚',
      desc: 'Manage patient records and access requests',
    },
    both: {
      label: 'Patient & Provider',
      color: '#06b6d4',
      bg: 'rgba(6,182,212,0.08)',
      icon: '⊕',
      desc: 'Full access to patient and provider features',
    },
    unregistered: {
      label: 'Unregistered',
      color: '#94a3b8',
      bg: 'rgba(148,163,184,0.08)',
      icon: '○',
      desc: 'Register as a patient or provider to get started',
    },
  };
  const rc = role ? roleConfig[role] : null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 animate-fade-in">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">
            Medical Passport <span className="gradient-text">Dashboard</span>
          </h1>
          <p className="text-slate-400 text-sm">
            Patient-controlled health identity & records — {NETWORK_NAME}
          </p>
        </div>
        {account && (
          <div className="glass rounded-xl px-4 py-3 text-right">
            <div className="text-xs text-slate-500 mb-1">
              {walletType === 'demo' ? 'Demo Wallet' : 'Connected Wallet'}
            </div>
            <div className="font-mono text-sm text-blue-400">{truncateAddress(account, 8)}</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500 mt-1">
              {walletType === 'demo' ? 'No signing required' : 'Freighter · Stellar'}
            </div>
          </div>
        )}
      </div>

      {/* Config warning */}
      {!contractsConfigured && (
        <div className="mb-6 glass rounded-xl p-4 flex items-start gap-3" style={{ borderColor: 'rgba(245,158,11,0.3)' }}>
          <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <p className="text-amber-300 font-semibold text-sm">Soroban Contract IDs Not Configured</p>
            <p className="text-slate-400 text-xs mt-0.5">
              The interface is running on local demo data. Visit the{' '}
              <button onClick={() => onNavigate('admin')} className="text-blue-400 hover:underline">
                Admin Panel
              </button>{' '}
              to add the deployed Stellar Testnet contract IDs when they are ready.
            </p>
          </div>
        </div>
      )}

      {/* Not connected */}
      {!account && (
        <div className="glass rounded-2xl p-12 text-center glow-blue">
          <div
            className="w-20 h-20 rounded-2xl mx-auto mb-6 flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg,rgba(59,130,246,.2),rgba(6,182,212,.2))',
              border: '1px solid rgba(59,130,246,.3)',
            }}
          >
            <svg className="w-10 h-10 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 11c1.657 0 3-1.343 3-3S13.657 5 12 5 9 6.343 9 8s1.343 3 3 3zm0 0v2m-7 6h14a2 2 0 002-2v-1a5 5 0 00-5-5H10a5 5 0 00-5 5v1a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Connect Your Stellar Wallet</h2>
          <p className="text-slate-400 text-sm max-w-md mx-auto">
            Connect Freighter to access the LockA Medical Passport on Stellar Testnet, or use a local demo
            account while the Soroban contracts are being built.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3 flex-wrap">
            <button onClick={onConnect} className="btn-primary px-5 py-2.5 rounded-lg text-sm">
              Connect Freighter
            </button>
            <button onClick={onConnectDemo} className="btn-secondary px-5 py-2.5 rounded-lg text-sm">
              Continue with Demo Account
            </button>
          </div>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto text-left">
            {[
              { icon: '♥', title: 'Patient Portal', desc: 'Manage your health identity and medical records' },
              { icon: '✚', title: 'Provider Portal', desc: 'Register as a healthcare provider and issue records' },
              { icon: '⊞', title: 'Consent Control', desc: 'Control who accesses your medical data' },
            ].map((f) => (
              <div key={f.title} className="glass rounded-xl p-4">
                <div className="text-2xl mb-2">{f.icon}</div>
                <div className="text-sm font-semibold text-white mb-1">{f.title}</div>
                <div className="text-xs text-slate-400">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {account && loading && (
        <div className="glass rounded-2xl p-12 text-center">
          <div className="spinner mx-auto mb-4" style={{ width: 32, height: 32, borderWidth: 3 }} />
          <p className="text-slate-400">Detecting your role on the network…</p>
        </div>
      )}

      {/* Role detected */}
      {account && !loading && role && (
        <>
          {/* Role banner */}
          <div
            className="glass rounded-xl p-5 mb-6 flex items-center gap-4 flex-wrap"
            style={{ borderColor: `${rc.color}40`, background: rc.bg }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: `${rc.color}20`, border: `1px solid ${rc.color}40` }}
            >
              {rc.icon}
            </div>
            <div className="flex-1">
              <div className="text-xs text-slate-400 mb-0.5">Your Role</div>
              <div className="font-bold text-white text-lg">{rc.label}</div>
              <div className="text-sm text-slate-400">{rc.desc}</div>
            </div>
            <button onClick={detectRole} className="btn-secondary text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard
              label="Passport Status"
              value={passportId && !isZeroBytes32(passportId) ? getPassportStatusLabel(passportStatus) : '—'}
              badge={
                passportId && !isZeroBytes32(passportId) ? statusToBadgeClass(passportStatus, 'passport') : null
              }
              icon="♥"
              color="#10b981"
              sub={passportId && !isZeroBytes32(passportId) ? truncateBytes32(passportId) : 'Not registered'}
            />
            <StatCard
              label="Provider Status"
              value={providerId && !isZeroBytes32(providerId) ? getProviderStatusLabel(providerStatus) : '—'}
              badge={
                providerId && !isZeroBytes32(providerId) ? statusToBadgeClass(providerStatus, 'provider') : null
              }
              icon="✚"
              color="#3b82f6"
              sub={providerId && !isZeroBytes32(providerId) ? truncateBytes32(providerId) : 'Not registered'}
            />
            <StatCard label="Medical Records" value={String(recordCount)} icon="⊞" color="#06b6d4" sub="total records" />
            <StatCard
              label="Pending Consents"
              value={String(pendingConsents)}
              icon="⚑"
              color="#f59e0b"
              sub="awaiting your action"
              badge={pendingConsents > 0 ? 'badge-amber' : null}
            />
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { page: 'patient', icon: '♥', label: 'Patient Portal', desc: 'View passport & manage records', color: '#10b981' },
              { page: 'provider', icon: '✚', label: 'Provider Portal', desc: 'Register & manage provider account', color: '#3b82f6' },
              { page: 'records', icon: '⊞', label: 'Medical Records', desc: 'Add, lookup & verify records', color: '#06b6d4' },
              { page: 'admin', icon: '⚙', label: 'Admin Panel', desc: 'Configure contracts & verify providers', color: '#94a3b8' },
            ].map((item) => (
              <button
                key={item.page}
                onClick={() => onNavigate(item.page)}
                className="glass rounded-xl p-5 text-left hover:border-blue-500/40 transition-all group"
                style={{ borderColor: `${item.color}20` }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-xl mb-3"
                  style={{ background: `${item.color}15`, border: `1px solid ${item.color}30` }}
                >
                  {item.icon}
                </div>
                <div className="font-semibold text-white text-sm mb-1 group-hover:text-blue-300 transition-colors">
                  {item.label}
                </div>
                <div className="text-xs text-slate-500">{item.desc}</div>
              </button>
            ))}
          </div>

          {/* Unregistered CTA */}
          {role === 'unregistered' && (
            <div className="glass rounded-xl p-6" style={{ borderColor: 'rgba(59,130,246,0.2)' }}>
              <div className="section-header">Get Started</div>
              <p className="text-slate-400 text-sm mb-4">
                You&apos;re not yet registered. Choose a role to begin:
              </p>
              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={() => onNavigate('patient')}
                  className="btn-primary px-5 py-2.5 rounded-lg text-sm flex items-center gap-2"
                >
                  ♥ Register as Patient
                </button>
                <button
                  onClick={() => onNavigate('provider')}
                  className="btn-secondary px-5 py-2.5 rounded-lg text-sm flex items-center gap-2"
                >
                  ✚ Register as Provider
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, badge, icon, color, sub }) {
  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</div>
        <div className="text-lg" style={{ color }}>
          {icon}
        </div>
      </div>
      <div className="flex items-center gap-2 mb-1">
        <div className="text-xl font-bold text-white">{value}</div>
        {badge && <span className={`badge ${badge} text-xs`}>{value}</span>}
      </div>
      {sub && <div className="text-xs text-slate-500 font-mono truncate">{sub}</div>}
    </div>
  );
}
