/**
 * BCH Agent Wallet — mainnet-js based
 *
 * Manages a local BCH wallet (chipnet testnet) for the AI agent.
 * Key is stored in localStorage as WIF format.
 * Uses mainnet-js TestNetWallet for all BCH operations.
 */
import { TestNetWallet } from 'mainnet-js';
import { CHIPNET, SATOSHIS_PER_BCH } from '../config/chipnet';

const STORAGE_KEY = 'agent402_bch_wif';
let _wallet = null;

/**
 * Get or create the agent's BCH wallet (chipnet).
 * @returns {Promise<TestNetWallet>}
 */
export const getAgentWallet = async () => {
    if (_wallet) return _wallet;

    let wif = localStorage.getItem(STORAGE_KEY);
    if (wif) {
        _wallet = await TestNetWallet.fromWIF(wif);
        console.log('[AgentWallet] Loaded BCH wallet:', _wallet.getDepositAddress());
    } else {
        _wallet = await TestNetWallet.newRandom();
        const newWif = _wallet.privateKeyWif;
        localStorage.setItem(STORAGE_KEY, newWif);
        console.log('[AgentWallet] Generated new BCH wallet:', _wallet.getDepositAddress());
    }

    return _wallet;
};

/** Cash address of the agent wallet (cashaddr format: bchtest:q...) */
export const getAgentAddress = async () => {
    const w = await getAgentWallet();
    return w.getDepositAddress();
};

/** Get WIF key of the agent wallet */
export const getAgentWIF = () => localStorage.getItem(STORAGE_KEY);

/** Check if a wallet key is stored */
export const hasAgentWallet = () => !!localStorage.getItem(STORAGE_KEY);

/**
 * Get BCH balance of the agent wallet
 * @returns {{ bch: string, satoshis: bigint }}
 */
export const getAgentBalance = async () => {
    const w = await getAgentWallet();
    const bal = await w.getBalance('sat');
    const satoshis = BigInt(bal);
    const bch = (Number(satoshis) / 1e8).toFixed(6);
    return { bch, satoshis };
};

/**
 * Send BCH from the agent wallet to a destination address.
 * @param {string} toAddress cashaddr destination
 * @param {bigint} satoshis amount in satoshis
 * @returns {{ txId: string }}
 */
export const sendFromAgent = async (toAddress, satoshis) => {
    const w = await getAgentWallet();
    const result = await w.send([{ cashaddr: toAddress, value: Number(satoshis), unit: 'sat' }]);
    console.log('[AgentWallet] Sent', satoshis, 'sat to', toAddress, '| tx:', result.txId);
    return { txId: result.txId };
};

/**
 * Import an existing WIF private key as the agent wallet.
 * @param {string} wif  WIF-encoded private key
 * @returns {Promise<string>} the cashaddr address of the imported wallet
 */
export const importAgentWallet = async (wif) => {
    try {
        const w = await TestNetWallet.fromWIF(wif.trim());
        localStorage.setItem(STORAGE_KEY, wif.trim());
        _wallet = w;
        const addr = w.getDepositAddress();
        console.log('[AgentWallet] Imported wallet:', addr);
        return addr;
    } catch (e) {
        throw new Error('Invalid WIF key: ' + e.message);
    }
};

/** Reset — generate a new wallet */
export const resetAgentWallet = () => {
    localStorage.removeItem(STORAGE_KEY);
    _wallet = null;
    console.log('[AgentWallet] Wallet reset');
};

// Legacy compat stubs
export const getAgentPrivateKey = () => localStorage.getItem(STORAGE_KEY);
export const getAgentBalances = async () => {
    const b = await getAgentBalance();
    return { bch: b.bch, token: b.bch, bchRaw: b.satoshis };
};
