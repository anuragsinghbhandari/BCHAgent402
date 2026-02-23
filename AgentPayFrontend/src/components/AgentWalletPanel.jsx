
import React, { useState, useEffect } from 'react';
import { getAgentAddress, getAgentBalances, fundAgentBCH, fundAgentWallet } from '../services/agentWallet';
import './AgentWalletPanel.css';

const AgentWalletPanel = () => {
    const [address, setAddress] = useState('');
    const [balances, setBalances] = useState({ bch: '0.000', token: '0.0' });
    const [status, setStatus] = useState({ type: '', message: '' });
    const [isFunding, setIsFunding] = useState(false);
    const [fundAmount, setFundAmount] = useState('10'); // Default token amount

    useEffect(() => {
        const loadWallet = async () => {
            try {
                const addr = getAgentAddress();
                setAddress(addr);
                await refreshBalances();
            } catch (error) {
                console.error("Failed to load agent wallet:", error);
            }
        };

        loadWallet();

        // Refresh every 10s
        const interval = setInterval(refreshBalances, 10000);
        return () => clearInterval(interval);
    }, []);

    const refreshBalances = async () => {
        try {
            const bals = await getAgentBalances();
            setBalances({
                bch: parseFloat(bals.bch).toFixed(4),
                token: parseFloat(bals.token).toFixed(2)
            });
        } catch (error) {
            console.error("Failed to refresh balances:", error);
        }
    };

    const handleCopyAddress = () => {
        navigator.clipboard.writeText(address);
        setStatus({ type: 'success', message: 'Address copied!' });
        setTimeout(() => setStatus({ type: '', message: '' }), 2000);
    };

    const handleFundBCH = async () => {
        setIsFunding(true);
        setStatus({ type: 'loading', message: 'Funding BCHT...' });
        try {
            await fundAgentBCH('0.005'); // Fixed amount for gas
            setStatus({ type: 'success', message: 'BCHT Funded!' });
            await refreshBalances();
        } catch (error) {
            console.error(error);
            setStatus({ type: 'error', message: 'Funding Failed' });
        } finally {
            setIsFunding(false);
            setTimeout(() => setStatus({ type: '', message: '' }), 3000);
        }
    };

    const handleFundToken = async () => {
        if (!fundAmount || isNaN(fundAmount)) return;

        setIsFunding(true);
        setStatus({ type: 'loading', message: `Funding ${fundAmount} TOKEN...` });
        try {
            await fundAgentWallet(null, fundAmount);
            setStatus({ type: 'success', message: 'TOKEN Funded!' });
            await refreshBalances();
        } catch (error) {
            console.error(error);
            setStatus({ type: 'error', message: 'Funding Failed' });
        } finally {
            setIsFunding(false);
            setTimeout(() => setStatus({ type: '', message: '' }), 3000);
        }
    };

    return (
        <div className="agent-wallet">
            <div className="agent-wallet-header">
                <div className="agent-wallet-label">
                    AGENT WALLET <span className="auto-badge">AUTO</span>
                </div>
                {address && (
                    <div
                        className="agent-wallet-address"
                        onClick={handleCopyAddress}
                        title="Click to copy agent address"
                    >
                        {address.slice(0, 6)}...{address.slice(-4)}
                    </div>
                )}
            </div>

            <div className="agent-wallet-balances">
                <div className="balance-item">
                    <span className="balance-label">BCHT (GAS)</span>
                    <span className={`balance-value ${parseFloat(balances.bch) < 0.002 ? 'low' : ''}`}>
                        {balances.bch}
                    </span>
                </div>
                <div className="balance-item">
                    <span className="balance-label">TOKEN</span>
                    <span className={`balance-value ${parseFloat(balances.token) < 5 ? 'low' : ''}`}>
                        {balances.token}
                    </span>
                </div>
            </div>

            <div className="agent-wallet-actions">
                <button
                    onClick={handleFundBCH}
                    disabled={isFunding}
                    title="Fund 0.01 BCHT for gas"
                >
                    + GAS
                </button>

                <div style={{ display: 'flex', flex: 2 }}>
                    <input
                        type="number"
                        className="fund-input"
                        value={fundAmount}
                        onChange={(e) => setFundAmount(e.target.value)}
                        placeholder="10"
                        min="1"
                    />
                    <button
                        className="fund-btn"
                        onClick={handleFundToken}
                        disabled={isFunding}
                    >
                        + TOKEN
                    </button>
                </div>
            </div>

            {status.message && (
                <div className={`agent-wallet-status ${status.type}`}>
                    {status.message}
                </div>
            )}
        </div>
    );
};

export default AgentWalletPanel;
