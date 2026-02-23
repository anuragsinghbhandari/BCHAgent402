/**
 * BCH Channel Manager
 *
 * Manages a pool of "worker wallets" (channels) for parallel execution
 * on Smart Bitcoin Cash Testnet. Each channel is a distinct EVM address
 * derived from a random private key.
 *
 * Features:
 * - Generates & persists channel keys in localStorage
 * - Funds channels from the Main Agent Wallet (BCH + Token)
 * - Locks/Unlocks channels to prevent nonce collisions
 * - Exposes channel state via subscription for UI
 * - Auto-funds idle workers periodically
 *
 * Chain: Smart Bitcoin Cash Testnet (Chain ID: 10001)
 * Token: 0x84b9B910527Ad5C03A9Ca831909E21e236EA7b06 (18 decimals)
 */
import { ethers } from 'ethers';
import { BCH_CHAIN, TOKEN_ADDRESS, TOKEN_DECIMALS } from '../config/bch';
import { getAgentWallet } from './agentWallet';

const STORAGE_KEY = 'agent402_bch_channels';
const CHANNEL_COUNT = 4;
const MIN_BCH = 0.001;
const TARGET_BCH = 0.002;
const MIN_TOKEN_THRESHOLD = 3.0;
const TOPUP_TOKEN = 3.0;
const AUTO_FUND_INTERVAL = 30000;

const subscribers = new Set();
const notify = (channels) => subscribers.forEach(fn => fn([...channels]));

class BchChannelManager {
    constructor() {
        this.channels = [];
        this.initialized = false;

        // Create an array of providers from our RPC URLs
        const providers = BCH_CHAIN.rpcUrls.map((url, i) => {
            return new ethers.JsonRpcProvider(url, BCH_CHAIN.id, {
                staticNetwork: true,
                batchMaxCount: 1, // Minimize batching to avoid rate limits
            });
        });

        this.provider = new ethers.FallbackProvider(providers, 1);
        this.isFunding = false;
        this.fundingInterval = null;
    }

    init() {
        if (this.initialized) return;

        let stored = localStorage.getItem(STORAGE_KEY);
        let keys = stored ? JSON.parse(stored) : [];

        if (keys.length < CHANNEL_COUNT) {
            console.log(`[BchChannelManager] Generating ${CHANNEL_COUNT - keys.length} new worker wallets...`);
            for (let i = keys.length; i < CHANNEL_COUNT; i++) {
                const wallet = ethers.Wallet.createRandom();
                keys.push(wallet.privateKey);
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
        }

        this.channels = keys.map(pk => ({
            privateKey: pk,
            address: new ethers.Wallet(pk).address,
            isBusy: false,
            lastUsed: 0,
            balance: { bch: '?', token: '?', sfuel: '?', usdc: '?' }
        }));

        this.initialized = true;
        console.log(`[BchChannelManager] Initialized with ${this.channels.length} worker wallets.`);
        notify(this.channels);

        this.checkBalancesAndFund();
        this.fundingInterval = setInterval(() => this.checkBalancesAndFund(), AUTO_FUND_INTERVAL);
    }

    subscribe(fn) {
        if (!this.initialized) this.init();
        subscribers.add(fn);
        fn([...this.channels]);
        return () => subscribers.delete(fn);
    }

    async acquireChannel(requiredToken = 0) {
        if (!this.initialized) this.init();

        const freeChannels = this.channels.filter(c => !c.isBusy);
        if (freeChannels.length === 0) throw new Error('All worker wallets are busy. Please wait.');

        freeChannels.sort((a, b) => a.lastUsed - b.lastUsed);
        const channel = freeChannels[0];

        channel.isBusy = true;
        channel.lastUsed = Date.now();
        notify(this.channels);
        console.log(`[BchChannelManager] Locked worker: ${channel.address.slice(0, 6)}...`);

        try {
            await this.ensureFunds(channel, requiredToken);
        } catch (e) {
            channel.isBusy = false;
            notify(this.channels);
            console.error(`[BchChannelManager] Funding failed for ${channel.address}:`, e);
            throw new Error(`Worker wallet funding failed: ${e.message}`);
        }

        console.log(`[BchChannelManager] Acquired worker: ${channel.address.slice(0, 6)}...`);
        return channel;
    }

    releaseChannel(address) {
        const channel = this.channels.find(c => c.address === address);
        if (channel) {
            channel.isBusy = false;
            console.log(`[BchChannelManager] Released worker: ${address.slice(0, 6)}...`);
            notify(this.channels);
            this.updateChannelBalance(channel);
        }
    }

    async ensureFunds(channel, requiredToken) {
        const [bchBal, tokenBal] = await Promise.all([
            this.provider.getBalance(channel.address),
            this.getTokenBalance(channel.address)
        ]);

        const bch = parseFloat(ethers.formatEther(bchBal));
        const token = parseFloat(ethers.formatUnits(tokenBal, TOKEN_DECIMALS));

        channel.balance = { bch: bch.toFixed(6), token: token.toFixed(6), sfuel: bch.toFixed(6), usdc: token.toFixed(6) };
        notify(this.channels);

        const needsBCH = bch < MIN_BCH;
        const strictRequirement = parseFloat(requiredToken) + 0.1;
        const triggerThreshold = Math.max(MIN_TOKEN_THRESHOLD, strictRequirement);
        const needsToken = token < triggerThreshold;

        let tokenToAdd = 0;
        if (needsToken) {
            tokenToAdd = TOPUP_TOKEN;
            if ((token + tokenToAdd) < strictRequirement) tokenToAdd = strictRequirement - token + 1.0;
        }

        if (needsBCH || needsToken) {
            console.log(`[BchChannelManager] Funding ${channel.address.slice(0, 6)}... (Have: ${token} TOKEN, Need: ${triggerThreshold}. Adding: ${tokenToAdd})`);
            await this.fundWorker(channel.address, needsBCH ? TARGET_BCH : 0, needsToken ? tokenToAdd : 0);
            await this.updateChannelBalance(channel);

            if (needsToken) {
                const newToken = parseFloat(channel.balance.token);
                if (newToken < strictRequirement) {
                    await new Promise(r => setTimeout(r, 2000));
                    await this.updateChannelBalance(channel);
                    const finalToken = parseFloat(channel.balance.token);
                    if (finalToken < strictRequirement) {
                        throw new Error(`Funding appeared successful but balance is still low (${finalToken} < ${strictRequirement}).`);
                    }
                }
            }
        }
    }

    async getTokenBalance(address) {
        const token = new ethers.Contract(
            TOKEN_ADDRESS,
            ['function balanceOf(address) view returns (uint256)'],
            this.provider
        );
        return token.balanceOf(address);
    }

    async updateChannelBalance(channel) {
        try {
            const [bchBal, tokenBal] = await Promise.all([
                this.provider.getBalance(channel.address),
                this.getTokenBalance(channel.address)
            ]);
            const bch = parseFloat(ethers.formatEther(bchBal)).toFixed(6);
            const token = parseFloat(ethers.formatUnits(tokenBal, TOKEN_DECIMALS)).toFixed(6);
            channel.balance = { bch, token, sfuel: bch, usdc: token };
            notify(this.channels);
        } catch (e) {
            console.warn(`Failed to update balance for ${channel.address}`, e);
        }
    }

    async fundWorker(workerAddress, bchAmount, tokenAmount) {
        if (this.isFunding) {
            let attempts = 0;
            while (this.isFunding && attempts < 20) {
                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }
            if (this.isFunding) throw new Error('Funding timeout: Main wallet is busy.');
        }
        this.isFunding = true;

        try {
            const mainWallet = getAgentWallet();
            const mainBCHBal = await this.provider.getBalance(mainWallet.address);
            const mainTokenBal = await this.getTokenBalance(mainWallet.address);
            const mainBCH = parseFloat(ethers.formatEther(mainBCHBal));
            const mainToken = parseFloat(ethers.formatUnits(mainTokenBal, TOKEN_DECIMALS));

            console.log(`[BchChannelManager] Main Wallet: ${mainWallet.address} | BCH: ${mainBCH} | TOKEN: ${mainToken}`);

            if (bchAmount > 0) {
                const gasBuffer = 0.0005;
                if (mainBCH < (bchAmount + gasBuffer)) {
                    throw new Error(`Main Agent Wallet low on BCH (${mainBCH}). Needed: ${bchAmount} + gas. Please fund it via Agent Wallet panel.`);
                }
            }
            if (tokenAmount > 0 && mainToken < tokenAmount) throw new Error(`Main Agent Wallet low on TOKEN (${mainToken}). Please fund it.`);

            if (bchAmount > 0) {
                const tx = await mainWallet.sendTransaction({ to: workerAddress, value: ethers.parseEther(bchAmount.toString()) });
                await tx.wait();
                console.log(`[BchChannelManager] BCH funded: ${bchAmount} to ${workerAddress}`);
            }

            if (tokenAmount > 0) {
                const tokenContract = new ethers.Contract(
                    TOKEN_ADDRESS,
                    ['function transfer(address to, uint256 amount) returns (bool)'],
                    mainWallet
                );
                const units = ethers.parseUnits(tokenAmount.toString(), TOKEN_DECIMALS);
                const tx = await tokenContract.transfer(workerAddress, units);
                await tx.wait();
                console.log(`[BchChannelManager] TOKEN funded: ${tokenAmount} to ${workerAddress}`);
            }
        } catch (e) {
            console.error('[BchChannelManager] Funding failed:', e);
            throw e;
        } finally {
            this.isFunding = false;
        }
    }

    async checkBalancesAndFund() {
        if (!this.initialized) return;
        for (const ch of this.channels) {
            if (!ch.isBusy && !this.isFunding) {
                try { await this.ensureFunds(ch, 0); } catch (e) { /* ignore in background */ }
            } else {
                await this.updateChannelBalance(ch);
            }
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

export const bchChannelManager = new BchChannelManager();

// Legacy alias for backward compatibility
export const bnbChannelManager = bchChannelManager;
export const skaleChannelManager = bchChannelManager;
