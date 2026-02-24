/**
 * Worker Pool — BCH chipnet version
 *
 * Orchestrates tool execution + x402-bch payment flow.
 * - HTTP calls run in a Web Worker (toolWorker.js)
 * - BCH payments are made in the MAIN THREAD using mainnet-js
 *   (mainnet-js uses IndexedDB which is only available in main thread)
 *
 * Two-phase protocol:
 *  1. Worker calls tool → gets 402 → posts 'needs_payment'
 *  2. Main thread pays BCH using worker wallet → posts 'payment_done' → Worker delivers
 */
import { TestNetWallet } from 'mainnet-js';
import { bchChannelManager } from './BchChannelManager';
import envConfig from '../config/env';

const MARKETPLACE_URL = envConfig.MARKETPLACE_URL || 'http://localhost:3000';

let activeWorkers = [];
const subscribers = new Set();
const notify = () => subscribers.forEach(fn => fn([...activeWorkers]));

export const subscribeWorkers = (fn) => {
    subscribers.add(fn);
    fn([...activeWorkers]);
    return () => subscribers.delete(fn);
};

export const executeToolInWorker = (toolName, params, onProgress) => {
    return new Promise(async (resolve) => {
        let channel = null;
        let worker = null;
        const callId = `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        const workerEntry = {
            id: callId,
            toolName,
            status: 'starting',
            phase: 'intent',
            startedAt: Date.now(),
        };

        activeWorkers.push(workerEntry);
        notify();

        const updateWorker = (updates) => {
            Object.assign(workerEntry, updates);
            notify();
        };

        const cleanup = () => {
            if (channel) {
                bchChannelManager.releaseChannel(channel.address);
                updateWorker({ wallet: null });
            }
            if (worker) worker.terminate();
        };

        const finish = (result) => {
            setTimeout(() => {
                activeWorkers = activeWorkers.filter(w => w.id !== callId);
                notify();
            }, 3000);
            cleanup();
            resolve(result);
        };

        try {
            // Acquire a BCH worker channel (funded from agent wallet)
            updateWorker({ status: 'funding' });
            channel = await bchChannelManager.acquireChannel(0);
            updateWorker({ status: 'running', wallet: channel.address });

            // Restore wallet from WIF for payment
            const workerWallet = await TestNetWallet.fromWIF(channel.wif);

            // Launch the HTTP worker
            worker = new Worker(
                new URL('../workers/toolWorker.js', import.meta.url),
                { type: 'module' }
            );

            worker.onmessage = async (event) => {
                const msg = event.data;
                if (msg.id !== callId) return;

                // ── Progress update ──────────────────────────────────────────────
                if (msg.type === 'progress') {
                    let phase = workerEntry.phase;
                    if (msg.step === 'tool_selected') phase = 'intent';
                    else if (msg.step === 'payment_required') phase = 'authorization';
                    else if (msg.step === 'processing_payment') phase = 'settlement';
                    else if (msg.step === 'payment_confirmed') phase = 'delivery';
                    else if (msg.step === 'delivering') phase = 'delivery';

                    updateWorker({ status: 'running', phase, lastMessage: msg.message });
                    onProgress?.(msg);
                    return;
                }

                // ── 402 — BCH payment required ───────────────────────────────────
                if (msg.type === 'needs_payment') {
                    const { challenge } = msg;
                    updateWorker({ phase: 'authorization' });

                    const priceDisplay = challenge.priceUSD
                        ? `$${parseFloat(challenge.priceUSD).toFixed(2)} USD`
                        : `${challenge.amount} tBCH`;

                    onProgress?.({
                        step: 'payment_required',
                        message: `Paying ${priceDisplay} → ${challenge.payTo?.slice(0, 18)}...`,
                        amount: challenge.priceUSD || challenge.amount,  // USD amount for display
                        amountBCH: challenge.amount,                      // BCH amount
                        toolName,
                    });

                    try {
                        // Always convert to Number — mainnet-js may return BigInt on some versions
                        const balSat = Number(await workerWallet.getBalance('sat'));
                        const priceSat = Number(challenge.satoshis ?? Math.ceil(parseFloat(challenge.amount) * 1e8));

                        if (balSat < priceSat + 2000) {
                            throw new Error(
                                `Insufficient tBCH. Have: ${(balSat / 1e8).toFixed(6)}, Need: ${(priceSat / 1e8).toFixed(6)} + fees`
                            );
                        }

                        updateWorker({ phase: 'settlement' });
                        onProgress?.({ step: 'processing_payment', message: `Sending ${priceDisplay}...` });

                        // Pay in main thread using mainnet-js
                        const sendResult = await workerWallet.send([{
                            cashaddr: challenge.payTo,
                            value: priceSat,
                            unit: 'sat',
                        }]);

                        const txId = sendResult.txId;

                        updateWorker({ phase: 'delivery' });
                        onProgress?.({
                            step: 'payment_confirmed',
                            message: `Payment confirmed: ${txId.slice(0, 16)}...`,
                            txHash: txId,
                            explorerUrl: `https://chipnet.imaginary.cash/tx/${txId}`,
                            amount: challenge.priceUSD || challenge.amount,  // USD for display
                            amountBCH: challenge.amount,                      // BCH amount
                            toolName,
                        });

                        // Wait for chipnet propagation
                        await new Promise(r => setTimeout(r, 2500));

                        // Tell worker payment is done — include resultId for pay-to-claim
                        worker.postMessage({
                            id: callId,
                            type: 'payment_done',
                            txHash: txId,
                            from: channel.address,
                            to: challenge.payTo,
                            payTo: challenge.payTo,
                            amount: challenge.amount,
                            satoshis: priceSat,
                            resultId: challenge.resultId || null,  // ← links payment to cached result
                        });

                    } catch (payErr) {
                        console.error('[workerPool] BCH payment failed:', payErr.message);
                        updateWorker({ status: 'failed', phase: 'settlement', finishedAt: Date.now() });
                        finish({
                            type: 'result',
                            success: false,
                            toolName,
                            error: `BCH payment failed: ${payErr.message}`,
                        });
                    }
                    return;
                }

                // ── Final result ─────────────────────────────────────────────────
                if (msg.type === 'result') {
                    updateWorker({
                        status: msg.success ? 'done' : 'failed',
                        phase: msg.success ? 'complete' : workerEntry.phase,
                        finishedAt: Date.now(),
                    });
                    finish(msg);
                }
            };

            worker.onerror = (err) => {
                console.error('[workerPool] Worker error:', err);
                updateWorker({ status: 'failed', finishedAt: Date.now(), error: err.message });
                finish({ type: 'result', success: false, error: err.message, toolName });
            };

            // Kick off the tool call
            worker.postMessage({
                id: callId,
                type: 'call',
                toolName,
                params,
                marketplaceUrl: MARKETPLACE_URL,
            });

        } catch (e) {
            console.error('[workerPool] Setup error:', e.message);
            updateWorker({ status: 'failed', finishedAt: Date.now(), error: e.message });
            cleanup();
            resolve({ type: 'result', success: false, error: e.message, toolName });
        }
    });
};
