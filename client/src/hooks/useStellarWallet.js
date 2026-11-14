import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isConnected as freighterIsConnected,
  requestAccess as freighterRequestAccess,
  getAddress as freighterGetAddress,
  getNetwork as freighterGetNetwork,
  WatchWalletChanges,
} from '@stellar/freighter-api';
import { DEMO_ACCOUNT_KEY, NETWORK_NAME, STELLAR_NETWORK } from '../utils/constants.js';
import { isValidAddress } from '../utils/helpers.js';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function makeDemoAddress() {
  const bytes = new Uint8Array(55);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let address = 'G';
  for (let i = 0; i < 55; i += 1) address += BASE32[bytes[i] % 32];
  return address;
}

export function useStellarWallet() {
  const [account, setAccount] = useState(null);
  const [walletType, setWalletType] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(true);
  const [network, setNetwork] = useState(STELLAR_NETWORK);
  const [freighterAvailable, setFreighterAvailable] = useState(false);
  const [error, setError] = useState(null);
  const watcherRef = useRef(null);

  const applyNetwork = useCallback((networkPassphrase) => {
    if (!networkPassphrase) return;
    const testnet = networkPassphrase.includes('Test SDF Network');
    setIsCorrectNetwork(testnet);
    setNetwork(testnet ? STELLAR_NETWORK : 'PUBLIC');
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const status = await freighterIsConnected();
      if (!status?.isConnected) {
        throw new Error('Freighter wallet not detected. Install Freighter or continue with a demo account.');
      }

      const access = await freighterRequestAccess();
      if (access?.error) throw new Error(access.error.message || 'Freighter access was not granted');

      const address = access?.address || (await freighterGetAddress())?.address;
      if (!isValidAddress(address)) throw new Error('Freighter did not return a valid Stellar account');

      const networkInfo = await freighterGetNetwork();
      applyNetwork(networkInfo?.networkPassphrase);
      setAccount(address);
      setWalletType('freighter');
      localStorage.removeItem(DEMO_ACCOUNT_KEY);
    } catch (err) {
      setError(err?.message || 'Failed to connect Freighter');
    } finally {
      setIsConnecting(false);
    }
  }, [applyNetwork]);

  const connectDemo = useCallback(() => {
    let address = localStorage.getItem(DEMO_ACCOUNT_KEY);
    if (!isValidAddress(address)) {
      address = makeDemoAddress();
      localStorage.setItem(DEMO_ACCOUNT_KEY, address);
    }
    setAccount(address);
    setWalletType('demo');
    setNetwork(STELLAR_NETWORK);
    setIsCorrectNetwork(true);
    setError(null);
  }, []);

  const disconnect = useCallback(() => {
    setAccount(null);
    setWalletType(null);
    setError(null);
    localStorage.removeItem(DEMO_ACCOUNT_KEY);
  }, []);

  const switchNetwork = useCallback(async () => {
    if (walletType !== 'freighter') return;
    try {
      const networkInfo = await freighterGetNetwork();
      applyNetwork(networkInfo?.networkPassphrase);
      if (!networkInfo?.networkPassphrase?.includes('Test SDF Network')) {
        setError('Open Freighter and switch the network to Testnet.');
      } else {
        setError(null);
      }
    } catch (_) {
      setError('Open Freighter and switch the network to Testnet.');
    }
  }, [applyNetwork, walletType]);

  // Detect Freighter availability and restore a previous session.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const status = await freighterIsConnected();
        if (cancelled) return;
        setFreighterAvailable(Boolean(status?.isConnected));
        if (status?.isConnected) {
          const address = (await freighterGetAddress())?.address;
          if (!cancelled && isValidAddress(address)) {
            const networkInfo = await freighterGetNetwork();
            if (cancelled) return;
            applyNetwork(networkInfo?.networkPassphrase);
            setAccount(address);
            setWalletType('freighter');
            return;
          }
        }
      } catch (_) {
        /* Freighter not available */
      }

      if (cancelled) return;
      const demo = localStorage.getItem(DEMO_ACCOUNT_KEY);
      if (isValidAddress(demo)) {
        setAccount(demo);
        setWalletType('demo');
        setNetwork(STELLAR_NETWORK);
        setIsCorrectNetwork(true);
      }
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, [applyNetwork]);

  // Watch Freighter for account and network changes.
  useEffect(() => {
    if (walletType !== 'freighter') return undefined;

    const watcher = new WatchWalletChanges(2000);
    watcherRef.current = watcher;
    watcher.watch(({ address, error: watchError }) => {
      if (watchError) return;
      if (isValidAddress(address)) {
        setAccount(address);
      }
    });

    return () => {
      try {
        watcher.stop();
      } catch (_) {
        /* ignore */
      }
      watcherRef.current = null;
    };
  }, [walletType]);

  return {
    account,
    walletType,
    isConnecting,
    isCorrectNetwork,
    network,
    freighterAvailable,
    error,
    connect,
    connectDemo,
    disconnect,
    switchNetwork,
    networkName: NETWORK_NAME,
  };
}
