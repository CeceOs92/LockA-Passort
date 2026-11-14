import React, { useState } from 'react';
import { truncateAddress } from '../utils/helpers.js';
import { NETWORK_NAME } from '../utils/constants.js';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: '⬡' },
  { id: 'patient', label: 'Patient Portal', icon: '♥' },
  { id: 'provider', label: 'Provider Portal', icon: '✚' },
  { id: 'records', label: 'Medical Records', icon: '⊞' },
  { id: 'admin', label: 'Admin', icon: '⚙' },
];

export function Navbar({
  account,
  walletType,
  isConnecting,
  isCorrectNetwork,
  onConnect,
  onConnectDemo,
  onDisconnect,
  onSwitchNetwork,
  currentPage,
  onNavigate,
  freighterAvailable,
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="glass-bright sticky top-0 z-40 border-b border-blue-900/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div
            className="flex items-center gap-3 cursor-pointer flex-shrink-0"
            onClick={() => onNavigate('dashboard')}
          >
            <img
              src="/locka-logo.png"
              alt="LockA Medical Passport logo"
              className="w-10 h-10 rounded-xl object-contain bg-white/95 p-0.5 shadow-lg"
            />
            <div className="flex flex-col leading-none">
              <div className="text-base font-bold tracking-tight">
                <span className="text-white">Lock</span>
                <span className="gradient-text">A</span>
              </div>
              <div className="text-xs uppercase tracking-widest text-slate-400 mt-0.5" style={{ fontSize: '0.6rem' }}>
                Medical Passport
              </div>
            </div>
          </div>

          {/* Desktop Nav */}
          <div className="hidden lg:flex items-center gap-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`nav-link ${currentPage === item.id ? 'active' : ''}`}
              >
                <span className="mr-1.5 opacity-70">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>

          {/* Wallet Controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {account ? (
              <>
                {!isCorrectNetwork && (
                  <button
                    onClick={onSwitchNetwork}
                    className="btn-amber text-xs px-3 py-1.5 rounded-lg hidden sm:flex items-center gap-1.5"
                    title="Freighter must be set to Stellar Testnet"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    Set Testnet in Freighter
                  </button>
                )}
                <div className="hidden sm:flex items-center gap-2 glass rounded-lg px-3 py-1.5">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      background: isCorrectNetwork ? '#10b981' : '#f59e0b',
                      animation: 'pulse 2s ease-in-out infinite',
                    }}
                  />
                  <span className="text-xs font-mono text-slate-300">{truncateAddress(account)}</span>
                  <span className={`badge text-[10px] ${walletType === 'demo' ? 'badge-amber' : 'badge-cyan'}`}>
                    {walletType === 'demo' ? 'Demo' : NETWORK_NAME}
                  </span>
                </div>
                <button onClick={onDisconnect} className="btn-secondary text-xs px-3 py-1.5 rounded-lg">
                  Disconnect
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={onConnect}
                  disabled={isConnecting}
                  className="btn-primary text-sm px-4 py-2 rounded-lg flex items-center gap-2"
                >
                  {isConnecting ? (
                    <>
                      <span className="spinner" style={{ width: 14, height: 14 }} />
                      Connecting…
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                        />
                      </svg>
                      Connect Freighter
                    </>
                  )}
                </button>
                <button
                  onClick={onConnectDemo}
                  className="btn-secondary text-xs px-3 py-2 rounded-lg hidden sm:block"
                  title={freighterAvailable ? 'Use a local demo account' : 'Freighter not detected — try the demo account'}
                >
                  Try Demo
                </button>
              </>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden btn-secondary p-2 rounded-lg"
              aria-label="Toggle navigation"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-blue-900/30 py-3 animate-fade-in">
            {account && !isCorrectNetwork && (
              <button
                onClick={() => {
                  onSwitchNetwork();
                  setMobileMenuOpen(false);
                }}
                className="btn-amber w-full text-sm px-4 py-2 rounded-lg mb-2 flex items-center justify-center gap-2"
              >
                Set Testnet in Freighter
              </button>
            )}
            {account && (
              <div className="flex items-center gap-2 px-2 py-2 mb-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: isCorrectNetwork ? '#10b981' : '#f59e0b' }}
                />
                <span className="text-xs font-mono text-slate-400">{truncateAddress(account)}</span>
                <span className={`badge text-[10px] ${walletType === 'demo' ? 'badge-amber' : 'badge-cyan'}`}>
                  {walletType === 'demo' ? 'Demo account' : NETWORK_NAME}
                </span>
              </div>
            )}
            {!account && (
              <button
                onClick={() => {
                  onConnectDemo();
                  setMobileMenuOpen(false);
                }}
                className="btn-secondary w-full text-sm px-4 py-2 rounded-lg mb-2"
              >
                Try Demo Account
              </button>
            )}
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`nav-link w-full text-left mb-1 ${currentPage === item.id ? 'active' : ''}`}
              >
                <span className="mr-2">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
