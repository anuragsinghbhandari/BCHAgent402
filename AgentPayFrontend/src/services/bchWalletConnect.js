/**
 * BCH WalletConnect Service
 *
 * Provides a WalletConnect-compatible interface for connecting BCH wallets
 * (Cashonize, Paytaca, Zapit) to the agent panel.
 *
 * Since the full WalletConnect v2 SDK is heavyweight, this module uses
 * a lightweight "manual paste" flow as the primary connection method,
 * with a URI-based deep-link for mobile wallets as a secondary option.
 *
 * Exports required by AgentWalletPanel:
 *   connectWallet()          → { uri, awaitApproval() }
 *   disconnectWallet()
 *   requestFundingTx(addr, satoshis) → txId string
 *   subscribeWC(fn)         → unsubscribe fn
 *   getConnectedAddress()   → string | null
 */

// ── Internal State ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'agent402_wc_address';

let _connected = false;
let _address = localStorage.getItem(STORAGE_KEY) || null;
let _pendingResolve = null;
let _pendingReject = null;

/** @type {Set<(state: {connected: boolean, address: string|null}) => void>} */
const _subscribers = new Set();

if (_address) {
    _connected = true;
}

const _notify = () => {
    const state = { connected: _connected, address: _address };
    _subscribers.forEach(fn => {
        try { fn(state); } catch (_) { }
    });
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Subscribe to WalletConnect state changes.
 * Called immediately with the current state.
 * @param {(state: {connected: boolean, address: string|null}) => void} fn
 * @returns {() => void} unsubscribe
 */
export const subscribeWC = (fn) => {
    _subscribers.add(fn);
    fn({ connected: _connected, address: _address });
    return () => _subscribers.delete(fn);
};

/**
 * Get the currently connected BCH address, or null.
 */
export const getConnectedAddress = () => _address;

/**
 * Initiate a wallet connection.
 *
 * Returns:
 *   - uri: a WalletConnect-style URI string to display as QR / copyable link
 *   - awaitApproval(): Promise that resolves with the connected cashaddr when
 *     the user pastes their address (our manual-input flow), or rejects on cancel.
 *
 * The "uri" in our implementation is a bip21 payment request URI that prompts
 * the user to reveal their address. For a true WC flow, replace this with a
 * real WalletConnect v2 session URI.
 */
export const connectWallet = async () => {
    // Cancel any previous pending connection
    if (_pendingReject) {
        _pendingReject(new Error('New connection initiated'));
        _pendingReject = null;
        _pendingResolve = null;
    }

    // Generate a session token for display purposes
    const sessionToken = Math.random().toString(36).slice(2, 10).toUpperCase();

    // The "URI" shown in the QR box — for real WC this would be a wc:... URI.
    // We display it as an instruction URI. The UI shows it as a copyable string.
    const uri = `bch-connect:${sessionToken}@chipnet`;

    const awaitApproval = () =>
        new Promise((resolve, reject) => {
            _pendingResolve = resolve;
            _pendingReject = reject;

            // Auto-reject after 3 minutes
            setTimeout(() => {
                if (_pendingReject === reject) {
                    _pendingReject = null;
                    _pendingResolve = null;
                    reject(new Error('Connection timed out'));
                }
            }, 3 * 60 * 1000);
        });

    return { uri, awaitApproval };
};

/**
 * Complete a connection by providing a BCH cashaddr.
 * This is called from the UI when the user pastes their address.
 *
 * @param {string} cashaddr - BCH chipnet address (bchtest:q...)
 */
export const completeConnection = (cashaddr) => {
    const addr = cashaddr.trim();
    if (!addr) return;

    _address = addr;
    _connected = true;
    localStorage.setItem(STORAGE_KEY, addr);
    _notify();

    if (_pendingResolve) {
        _pendingResolve(addr);
        _pendingResolve = null;
        _pendingReject = null;
    }
};

/**
 * Disconnect the currently connected wallet.
 */
export const disconnectWallet = async () => {
    _connected = false;
    _address = null;
    localStorage.removeItem(STORAGE_KEY);

    if (_pendingReject) {
        _pendingReject(new Error('Wallet disconnected'));
        _pendingReject = null;
        _pendingResolve = null;
    }

    _notify();
};

/**
 * Request a BCH funding transaction from the connected wallet.
 *
 * In a true WalletConnect flow, this would sign a transaction via the wallet.
 * Here we build a BIP21 payment URI that the user can open in their BCH wallet
 * app (Cashonize, Paytaca, Zapit) to send funds to the agent address.
 *
 * Returns a "txId" placeholder — in production this would be the confirmed txid.
 *
 * @param {string} toAddress - cashaddr to fund (the agent wallet)
 * @param {number} satoshis  - amount in satoshis
 * @returns {Promise<string>} resolved tx id (or payment URI for manual flow)
 */
export const requestFundingTx = async (toAddress, satoshis) => {
    if (!_connected || !_address) {
        throw new Error('No wallet connected. Please connect your BCH wallet first.');
    }

    const bchAmount = (satoshis / 1e8).toFixed(8);

    // Build a BIP21 URI for the connected wallet app to handle
    const bip21 = `${toAddress}?amount=${bchAmount}&label=AgentPay%20Funding`;

    // Attempt to open the wallet via deep link (works on mobile / installed desktop wallets)
    try {
        window.open(bip21, '_blank');
    } catch (_) { }

    // For the UI, return the BIP21 URI so the user can copy/open it manually.
    // A real WC implementation would return the confirmed txId after signing.
    console.log(`[bchWalletConnect] Funding request: ${bchAmount} BCH → ${toAddress}`);
    console.log(`[bchWalletConnect] BIP21 URI: ${bip21}`);

    // Return the bip21 URI as the "txId" so the UI can display something useful.
    // The user will need to manually open this in their wallet.
    return bip21;
};
