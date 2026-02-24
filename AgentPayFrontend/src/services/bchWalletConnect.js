/**
 * BCH WalletConnect Service
 *
 * Connects to BCH wallets (Cashonize, Paytaca, Zapit) via WalletConnect v2.
 * Allows the connected user's wallet to fund the agent wallet directly.
 *
 * BCH WalletConnect namespace: "bch"
 * Chain: bch:chipnet (chipnet testnet)
 */
import SignClient from '@walletconnect/sign-client';
import { WALLETCONNECT_PROJECT_ID, WALLETCONNECT_METADATA } from '../config/chipnet';

const BCH_CHAIN = 'bch:chipnet';
const BCH_METHODS = ['bch_signTransaction', 'bch_getAccounts'];
const BCH_EVENTS = ['accountsChanged'];

let signClient = null;
let activeSession = null;
const listeners = new Set();

/** Notify all UI subscribers */
const notify = (state) => listeners.forEach(fn => fn(state));

/** Get current connection state */
export const getWCState = () => ({
    connected: !!activeSession,
    address: activeSession ? getAddressFromSession(activeSession) : null,
    topic: activeSession?.topic ?? null,
});

/**
 * Extract BCH cashaddr from a WalletConnect session.
 */
const getAddressFromSession = (session) => {
    const bchAccounts = session?.namespaces?.bch?.accounts ?? [];
    if (bchAccounts.length > 0) {
        // format: "bch:chipnet:bchtest:q..."
        const parts = bchAccounts[0].split(':');
        // Last two segments are the cashaddr (network:hash)
        return parts.slice(2).join(':');
    }
    return null;
};

/**
 * Get or create the WalletConnect SignClient
 */
const getSignClient = async () => {
    if (signClient) return signClient;

    signClient = await SignClient.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        metadata: WALLETCONNECT_METADATA,
    });

    // Handle incoming session proposals (shouldn't happen from dApp side, but safety)
    signClient.on('session_delete', ({ topic }) => {
        if (activeSession?.topic === topic) {
            activeSession = null;
            notify(getWCState());
        }
    });

    signClient.on('session_expire', ({ topic }) => {
        if (activeSession?.topic === topic) {
            activeSession = null;
            notify(getWCState());
        }
    });

    return signClient;
};

/**
 * Subscribe to WalletConnect state changes.
 * @param {function} fn  Called with current state whenever it changes
 * @returns {function}   Unsubscribe function
 */
export const subscribeWC = (fn) => {
    listeners.add(fn);
    fn(getWCState());
    return () => listeners.delete(fn);
};

/**
 * Connect a BCH wallet via WalletConnect.
 * Opens the WalletConnect QR modal for the user to scan with Cashonize/Paytaca/Zapit.
 *
 * @returns {Promise<{ uri: string, approval: function }>}
 *   uri: the WalletConnect URI to display as QR code
 *   approval: call this to await the user's wallet approval
 */
export const connectWallet = async () => {
    const client = await getSignClient();

    const { uri, approval } = await client.connect({
        requiredNamespaces: {
            bch: {
                methods: BCH_METHODS,
                chains: [BCH_CHAIN],
                events: BCH_EVENTS,
            },
        },
    });

    if (!uri) throw new Error('WalletConnect: failed to create connection URI');

    const awaitApproval = async () => {
        const session = await approval();
        activeSession = session;
        notify(getWCState());
        const addr = getAddressFromSession(session);
        console.log('[WalletConnect] Connected! BCH address:', addr);
        return addr;
    };

    return { uri, awaitApproval };
};

/**
 * Disconnect the current WalletConnect session.
 */
export const disconnectWallet = async () => {
    if (!activeSession || !signClient) return;
    try {
        await signClient.disconnect({
            topic: activeSession.topic,
            reason: { code: 6000, message: 'User disconnected' },
        });
    } catch (_) { }
    activeSession = null;
    notify(getWCState());
    console.log('[WalletConnect] Disconnected');
};

/**
 * Request a BCH transaction from the connected wallet.
 * This asks the user's wallet (Cashonize etc.) to sign and broadcast a tx
 * sending BCH to the agent wallet address.
 *
 * @param {string} toAddress   Agent's cashaddr
 * @param {number} satoshis    Amount in satoshis
 * @returns {Promise<string>}  Transaction ID
 */
export const requestFundingTx = async (toAddress, satoshis) => {
    if (!activeSession || !signClient) throw new Error('No wallet connected');

    const topic = activeSession.topic;
    const fromAddress = getAddressFromSession(activeSession);

    if (!fromAddress) throw new Error('Could not determine connected wallet address');

    // Build a simple P2PKH transaction request
    // BCH WalletConnect wallets accept this format (CAIP-25 / BCH signing)
    const txRequest = {
        transaction: {
            outputs: [
                {
                    to: toAddress,
                    amount: satoshis,
                    unit: 'sat',
                },
            ],
        },
        sourceOutputs: [],  // wallet fills UTXOs
        broadcast: true,
        userPrompt: `Fund Agent Wallet with ${(satoshis / 1e8).toFixed(4)} tBCH (chipnet)`,
    };

    try {
        const result = await signClient.request({
            topic,
            chainId: BCH_CHAIN,
            request: {
                method: 'bch_signTransaction',
                params: txRequest,
            },
        });

        const txId = result?.txId ?? result?.transactionId ?? result;
        console.log('[WalletConnect] Funding tx broadcast:', txId);
        return txId;
    } catch (e) {
        throw new Error('WalletConnect transaction rejected: ' + e.message);
    }
};

/** Get the connected wallet's BCH address */
export const getConnectedAddress = () => {
    if (!activeSession) return null;
    return getAddressFromSession(activeSession);
};
