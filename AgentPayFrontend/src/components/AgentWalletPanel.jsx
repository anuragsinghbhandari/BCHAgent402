import React, { useState, useEffect, useRef } from 'react';
import {
    getAgentAddress,
    getAgentBalance,
    importAgentWallet,
    resetAgentWallet,
    getAgentPrivateKey,
} from '../services/agentWallet';
import {
    connectWallet,
    disconnectWallet,
    requestFundingTx,
    subscribeWC,
    getConnectedAddress,
} from '../services/bchWalletConnect';
import './AgentWalletPanel.css';
import { getBchUsdPrice, bchToUsd } from '../services/priceService';

const AgentWalletPanel = () => {
    const [agentAddress, setAgentAddress] = useState('');
    const [balance, setBalance] = useState({ bch: '0.000000' });
    const [bchUsdRate, setBchUsdRate] = useState(330);
    const [status, setStatus] = useState({ type: '', message: '' });
    const [isLoading, setIsLoading] = useState(false);

    // WalletConnect state
    const [wcState, setWcState] = useState({ connected: false, address: null });
    const [showQR, setShowQR] = useState(false);
    const [wcUri, setWcUri] = useState('');
    const [fundAmount, setFundAmount] = useState('0.01');
    const [isFunding, setIsFunding] = useState(false);

    // Key management
    const [showImport, setShowImport] = useState(false);
    const [showKey, setShowKey] = useState(false);
    const [importKey, setImportKey] = useState('');
    const [copied, setCopied] = useState(false);

    // QR code canvas ref
    const qrCanvasRef = useRef(null);

    useEffect(() => {
        const load = async () => {
            try {
                const addr = await getAgentAddress();
                setAgentAddress(addr);
                await refreshBalance();
            } catch (e) {
                console.error('Wallet load error:', e);
            }
        };
        load();
        const interval = setInterval(refreshBalance, 20000);

        // Subscribe to WalletConnect state
        const unsubWC = subscribeWC(setWcState);

        // Fetch BCH/USD price
        getBchUsdPrice().then(rate => setBchUsdRate(rate));
        const priceTimer = setInterval(() => getBchUsdPrice().then(r => setBchUsdRate(r)), 5 * 60 * 1000);

        return () => {
            clearInterval(interval);
            clearInterval(priceTimer);
            unsubWC();
        };
    }, []);

    const refreshBalance = async () => {
        try {
            const bal = await getAgentBalance();
            setBalance(bal);
        } catch (_) { }
    };

    const handleCopyAddress = () => {
        if (!agentAddress) return;
        navigator.clipboard.writeText(agentAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const showStatus = (type, message, ms = 3000) => {
        setStatus({ type, message });
        if (ms > 0) setTimeout(() => setStatus({ type: '', message: '' }), ms);
    };

    // ── WalletConnect ──────────────────────────────────────────────────────
    const handleConnectWallet = async () => {
        setIsLoading(true);
        try {
            const { uri, awaitApproval } = await connectWallet();
            setWcUri(uri);
            setShowQR(true);
            showStatus('loading', 'Scan QR in Cashonize / Paytaca / Zapit...', 0);

            // Draw QR code if qrcode-js is available (we draw a simple link fallback)
            // Wait for wallet approval in background
            awaitApproval()
                .then((addr) => {
                    setShowQR(false);
                    showStatus('success', `Connected: ${addr.slice(0, 14)}...`);
                })
                .catch((e) => {
                    setShowQR(false);
                    showStatus('error', 'Connection rejected');
                });
        } catch (e) {
            showStatus('error', 'Connect failed: ' + e.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDisconnect = async () => {
        await disconnectWallet();
        showStatus('info', 'Wallet disconnected');
    };

    const handleFundAgent = async () => {
        const amount = parseFloat(fundAmount);
        if (isNaN(amount) || amount <= 0) return;
        if (!agentAddress) return;

        setIsFunding(true);
        showStatus('loading', `Requesting ${amount} tBCH from wallet...`, 0);
        try {
            const satoshis = Math.ceil(amount * 1e8);
            const txId = await requestFundingTx(agentAddress, satoshis);
            showStatus('success', `Funded! Tx: ${txId.slice(0, 16)}...`);
            setTimeout(refreshBalance, 5000);
        } catch (e) {
            showStatus('error', 'Funding failed: ' + e.message);
        } finally {
            setIsFunding(false);
        }
    };

    // ── Key Management ─────────────────────────────────────────────────────
    const handleImport = async () => {
        if (!importKey.trim()) return;
        try {
            const addr = await importAgentWallet(importKey.trim());
            setAgentAddress(addr);
            setImportKey('');
            setShowImport(false);
            showStatus('success', 'Wallet imported!');
            refreshBalance();
        } catch (e) {
            showStatus('error', e.message);
        }
    };

    const handleReset = () => {
        if (!window.confirm('This deletes the current agent wallet key. Save your WIF key first!')) return;
        resetAgentWallet();
        getAgentAddress().then(setAgentAddress);
        refreshBalance();
        showStatus('success', 'New wallet generated');
    };

    const bchLow = parseFloat(balance.bch) < 0.005;

    return (
        <div className="agent-wallet">
            {/* Header */}
            <div className="agent-wallet-header">
                <div className="agent-wallet-label">
                    AGENT WALLET <span className="network-badge">CHIPNET</span>
                </div>
                <button className="wallet-icon-btn" onClick={refreshBalance} title="Refresh">↻</button>
            </div>

            {/* Agent Address */}
            {agentAddress && (
                <div className="agent-addr-row" onClick={handleCopyAddress} title="Click to copy">
                    <span className="agent-addr-text">
                        {agentAddress.slice(0, 18)}...{agentAddress.slice(-6)}
                    </span>
                    <span className="copy-badge">{copied ? '✓' : 'Copy'}</span>
                </div>
            )}

            {/* Balance */}
            <div className="agent-wallet-balances">
                <div className="balance-item">
                    <span className="balance-label">tBCH (chipnet)</span>
                    <span className={`balance-value ${bchLow ? 'low' : ''}`}>
                        {balance.bch}
                    </span>
                    <span className="balance-usd">
                        ≈ {bchToUsd(balance.bch, bchUsdRate)}
                        <span className="rate-pill">${bchUsdRate.toFixed(0)}/BCH</span>
                    </span>
                </div>
            </div>

            {/* Low balance warning */}
            {bchLow && (
                <div className="fund-hint">
                    ⚠ Low tBCH — connect wallet below to fund, or send tBCH directly to the address above.
                    <a href="https://tbch.googol.cash" target="_blank" rel="noreferrer" className="faucet-link">
                        Chipnet Faucet ↗
                    </a>
                </div>
            )}

            {/* ── WalletConnect Section ── */}
            <div className="wc-section">
                {wcState.connected ? (
                    <div className="wc-connected">
                        <div className="wc-addr-row">
                            <span className="wc-dot" />
                            <span className="wc-addr">
                                {wcState.address?.slice(0, 16)}...{wcState.address?.slice(-6)}
                            </span>
                            <button className="wc-disconnect-btn" onClick={handleDisconnect}>✕</button>
                        </div>
                        <div className="wc-fund-row">
                            <input
                                type="number"
                                className="fund-input"
                                value={fundAmount}
                                onChange={e => setFundAmount(e.target.value)}
                                min="0.001"
                                step="0.001"
                                placeholder="tBCH"
                            />
                            <button
                                className="fund-btn"
                                onClick={handleFundAgent}
                                disabled={isFunding}
                            >
                                {isFunding ? 'Sending...' : `Fund Agent`}
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        className="wc-connect-btn"
                        onClick={handleConnectWallet}
                        disabled={isLoading}
                    >
                        <span className="wc-icon">⬡</span>
                        {isLoading ? 'Connecting...' : 'Connect BCH Wallet'}
                    </button>
                )}

                {/* WalletConnect QR */}
                {showQR && wcUri && (
                    <div className="wc-qr-box">
                        <div className="wc-qr-title">Scan with Cashonize / Paytaca / Zapit</div>
                        <div className="wc-qr-network">Chipnet (testnet) only</div>
                        <div className="wc-uri-text"
                            onClick={() => { navigator.clipboard.writeText(wcUri); showStatus('success', 'URI copied!'); }}
                            title="Click to copy WalletConnect URI"
                        >
                            {wcUri.slice(0, 40)}...
                        </div>
                        <button className="wc-cancel-btn" onClick={() => setShowQR(false)}>Cancel</button>
                    </div>
                )}
            </div>

            {/* ── Key Management ── */}
            <div className="key-mgmt-row">
                <button className="key-btn" onClick={() => { setShowImport(!showImport); setShowKey(false); }}>
                    Import WIF
                </button>
                <button className="key-btn danger" onClick={() => { setShowKey(!showKey); setShowImport(false); }}>
                    Export WIF
                </button>
                <button className="key-btn" onClick={handleReset}>New</button>
            </div>

            {showImport && (
                <div className="key-form">
                    <input
                        type="password"
                        className="key-input"
                        placeholder="WIF private key (L... or K... or 5...)"
                        value={importKey}
                        onChange={e => setImportKey(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleImport()}
                    />
                    <button className="key-btn primary" onClick={handleImport}>Import</button>
                </div>
            )}

            {showKey && (
                <div className="key-export">
                    <div className="key-warning">⚠ Keep this secret!</div>
                    <div
                        className="key-value"
                        onClick={() => { navigator.clipboard.writeText(getAgentPrivateKey() || ''); showStatus('success', 'WIF copied!'); }}
                        title="Click to copy WIF"
                    >
                        {getAgentPrivateKey()?.slice(0, 16)}...{getAgentPrivateKey()?.slice(-8)}
                    </div>
                </div>
            )}

            {/* Status */}
            {status.message && (
                <div className={`agent-wallet-status ${status.type}`}>{status.message}</div>
            )}
        </div>
    );
};

export default AgentWalletPanel;
