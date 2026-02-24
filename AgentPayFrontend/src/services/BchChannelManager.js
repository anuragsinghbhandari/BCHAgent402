/**
 * BCH Channel Manager (mainnet-js based)
 *
 * Manages a pool of worker wallets for parallel tool execution on BCH chipnet.
 * Calibrated for small budgets (~$5 / ~0.0104 BCH at $480/BCH).
 *
 * Fund logic:
 *  - Workers are funded ON DEMAND when acquireChannel() is called
 *  - Background check runs every WORKER_FUND_INTERVAL_MS (5 min)
 *  - Agent wallet always keeps AGENT_MIN_RESERVE as a safety buffer
 *  - WORKER_TOPUP_AMOUNT = 0.001 BCH ≈ $0.48, covers ~9–10 tool calls at $0.05
 */
import { TestNetWallet } from 'mainnet-js';
import {
    WORKER_COUNT,
    MIN_BCH_FOR_GAS,
    MIN_BCH_FOR_TOOLS,
    WORKER_TOPUP_AMOUNT,
    WORKER_FUND_INTERVAL_MS,
    AGENT_MIN_RESERVE,
} from '../config/chipnet';
import { getAgentWallet } from './agentWallet';

const STORAGE_KEY = 'agent402_bch_workers';

const subscribers = new Set();
const notify = (channels) => subscribers.forEach(fn => fn([...channels]));

class BchChannelManager {
    constructor() {
        this.channels = [];
        this.initialized = false;
        this.isFunding = false;
        this.fundingInterval = null;
        this._initPromise = null;
    }

    async init() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._doInit();
        return this._initPromise;
    }

    async _doInit() {
        if (this.initialized) return;

        let keys = [];
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            keys = stored ? JSON.parse(stored) : [];
        } catch (_) { keys = []; }

        while (keys.length < WORKER_COUNT) {
            const w = await TestNetWallet.newRandom();
            keys.push(w.privateKeyWif);
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));

        this.channels = await Promise.all(
            keys.slice(0, WORKER_COUNT).map(async (wif, i) => {
                const wallet = await TestNetWallet.fromWIF(wif);
                return {
                    id: i,
                    wif,
                    wallet,
                    address: wallet.getDepositAddress(),
                    isBusy: false,
                    lastUsed: 0,
                    balance: { bch: '0.000000', satoshis: 0n },
                };
            })
        );

        this.initialized = true;
        console.log(`[BchChannelManager] ${this.channels.length} workers ready (topup: ${WORKER_TOPUP_AMOUNT} BCH)`);
        notify(this.channels);

        // Initial balance check
        this._refreshAllBalances();

        // Pre-fund workers if agent has enough headroom
        // Run in background so it doesn't block UI init
        setTimeout(() => this._prefundWorkersOnStartup(), 3000);

        // Background: periodic lightweight balance refresh + fund-if-needed
        this.fundingInterval = setInterval(
            () => this._checkAndFund(),
            WORKER_FUND_INTERVAL_MS
        );
    }

    /**
     * Pre-fund all unfunded workers once at startup.
     * Only runs if agent wallet has: AGENT_MIN_RESERVE + (WORKER_COUNT × WORKER_TOPUP_AMOUNT)
     */
    async _prefundWorkersOnStartup() {
        try {
            const agentWallet = await getAgentWallet();
            const agentBal = Number(await agentWallet.getBalance('bch'));
            const needed = AGENT_MIN_RESERVE + (WORKER_COUNT * WORKER_TOPUP_AMOUNT);

            if (agentBal < needed) {
                console.log(
                    `[BchChannelManager] Startup: agent has ${agentBal.toFixed(6)} BCH, ` +
                    `need ${needed.toFixed(6)} BCH to pre-fund all workers. Will fund on demand.`
                );
                return;
            }


            console.log(`[BchChannelManager] Startup: pre-funding ${WORKER_COUNT} workers with ${WORKER_TOPUP_AMOUNT} BCH each...`);
            for (const ch of this.channels) {
                await this._updateBalance(ch);
                if (parseFloat(ch.balance.bch) < WORKER_TOPUP_AMOUNT * 0.5) {
                    try {
                        await this._fundWorker(ch, WORKER_TOPUP_AMOUNT);
                        await new Promise(r => setTimeout(r, 1500));
                    } catch (e) {
                        console.warn(`[BchChannelManager] Startup fund failed for worker #${ch.id}:`, e.message);
                    }
                } else {
                    console.log(`[BchChannelManager] Worker #${ch.id} already funded (${ch.balance.bch} BCH), skipping`);
                }
            }

            // Final balance update
            await this._refreshAllBalances();
            console.log('[BchChannelManager] Startup pre-funding complete');
        } catch (e) {
            console.warn('[BchChannelManager] Startup pre-funding skipped:', e.message);
        }
    }

    subscribe(fn) {
        this.init();
        subscribers.add(fn);
        fn([...this.channels]);
        return () => subscribers.delete(fn);
    }

    async acquireChannel() {
        await this.init();

        const freeChannels = this.channels.filter(c => !c.isBusy);
        if (freeChannels.length === 0) throw new Error('All worker wallets are busy. Please wait.');

        // Prefer the longest-idle channel
        freeChannels.sort((a, b) => a.lastUsed - b.lastUsed);
        const ch = freeChannels[0];
        ch.isBusy = true;
        ch.lastUsed = Date.now();
        notify(this.channels);

        try {
            await this._ensureFunds(ch);
        } catch (e) {
            ch.isBusy = false;
            notify(this.channels);
            throw new Error(`Worker wallet funding failed: ${e.message}`);
        }

        console.log(`[BchChannelManager] Acquired worker #${ch.id}: ${ch.address.slice(0, 18)}...`);
        return ch;
    }

    releaseChannel(address) {
        const ch = this.channels.find(c => c.address === address);
        if (ch) {
            ch.isBusy = false;
            console.log(`[BchChannelManager] Released worker #${ch.id}`);
            notify(this.channels);
            this._updateBalance(ch);
        }
    }

    /**
     * Ensure the worker has enough BCH.
     * Minimum threshold = MIN_BCH_FOR_TOOLS (enough for 1+ tool call + fee).
     * If below threshold, top up with WORKER_TOPUP_AMOUNT from agent wallet.
     */
    async _ensureFunds(ch) {
        await this._updateBalance(ch);
        const bch = parseFloat(ch.balance.bch);

        if (bch >= MIN_BCH_FOR_TOOLS) {
            console.log(`[BchChannelManager] Worker #${ch.id} OK: ${bch.toFixed(6)} BCH`);
            return; // Already funded enough
        }

        console.log(`[BchChannelManager] Worker #${ch.id} low (${bch.toFixed(6)} BCH). Topping up...`);
        await this._fundWorker(ch, WORKER_TOPUP_AMOUNT);

        // Wait for propagation then recheck
        await new Promise(r => setTimeout(r, 3000));
        await this._updateBalance(ch);

        const after = parseFloat(ch.balance.bch);
        if (after < MIN_BCH_FOR_GAS) {
            throw new Error(
                `Worker #${ch.id} still insufficient after topup: ${after.toFixed(6)} BCH. ` +
                `Fund the agent wallet with more tBCH.`
            );
        }
    }

    /**
     * Send tBCH from the main agent wallet to a worker address.
     * Always checks that the agent keeps at least AGENT_MIN_RESERVE.
     */
    async _fundWorker(ch, amount) {
        if (this.isFunding) {
            // Queue: wait up to 15s for the current send to finish
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 500));
                if (!this.isFunding) break;
            }
            if (this.isFunding) throw new Error('Another funding operation is still pending');
        }

        this.isFunding = true;
        try {
            const agentWallet = await getAgentWallet();
            const agentBalBCH = Number(await agentWallet.getBalance('bch'));

            // Safety: keep at least AGENT_MIN_RESERVE in the agent wallet
            const available = agentBalBCH - AGENT_MIN_RESERVE;
            if (available <= 0) {
                throw new Error(
                    `Agent wallet too low to fund workers: ${agentBalBCH.toFixed(6)} BCH ` +
                    `(reserve: ${AGENT_MIN_RESERVE} BCH). Top up the agent wallet first.`
                );
            }


            // Cap topup at available funds
            const actualAmount = Math.min(amount, available - 0.0001); // leave buffer for fee
            if (actualAmount <= 0.0001) {
                throw new Error(`Insufficient agent balance after reserve: only ${available.toFixed(6)} BCH free`);
            }

            const result = await agentWallet.send([{
                cashaddr: ch.address,
                value: Math.round(actualAmount * 1e8),
                unit: 'sat',
            }]);

            console.log(
                `[BchChannelManager] Funded worker #${ch.id} with ${actualAmount.toFixed(6)} BCH | tx: ${result.txId}`
            );
        } finally {
            this.isFunding = false;
        }
    }

    async _updateBalance(ch) {
        try {
            // Always use Number() — mainnet-js may return BigInt on some versions
            const sat = Number(await ch.wallet.getBalance('sat'));
            ch.balance = {
                bch: (sat / 1e8).toFixed(6),
                satoshis: sat,
            };
            notify(this.channels);
        } catch (e) {
            console.warn(`[BchChannelManager] Balance check failed for worker #${ch.id}:`, e.message);
        }
    }

    async _refreshAllBalances() {
        for (const ch of this.channels) {
            await this._updateBalance(ch);
            await new Promise(r => setTimeout(r, 300));
        }
    }

    /**
     * Background check: top up idle workers that are below MIN_BCH_FOR_GAS.
     * Only runs if agent wallet has headroom above AGENT_MIN_RESERVE.
     */
    async _checkAndFund() {
        if (!this.initialized || this.isFunding) return;
        try {
            const agentWallet = await getAgentWallet();
            const agentBal = Number(await agentWallet.getBalance('bch'));
            const headroom = agentBal - AGENT_MIN_RESERVE;
            if (headroom <= 0.0002) return; // Not enough headroom, skip
        } catch (_) { return; }

        for (const ch of this.channels) {
            if (ch.isBusy || this.isFunding) continue;
            await this._updateBalance(ch);
            const bch = parseFloat(ch.balance.bch);
            if (bch < MIN_BCH_FOR_GAS) {
                try {
                    await this._fundWorker(ch, WORKER_TOPUP_AMOUNT);
                } catch (e) {
                    console.warn(`[BchChannelManager] Background fund failed for worker #${ch.id}:`, e.message);
                }
            }
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

export const bchChannelManager = new BchChannelManager();
export const bnbChannelManager = bchChannelManager;
export const skaleChannelManager = bchChannelManager;
