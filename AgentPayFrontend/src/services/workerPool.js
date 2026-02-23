/**
 * Worker Pool for parallel tool execution.
 *
 * Spawns a dedicated Web Worker per tool call, enabling true parallel
 * execution of x402 payment flows on SmartBCH Amber Testnet.
 * Uses BchChannelManager to assign a unique EVM wallet per worker
 * to prevent nonce collisions.
 */
import { BCH_CHAIN } from '../config/bch';
import { bchChannelManager } from './BchChannelManager';

let activeWorkers = [];
const subscribers = new Set();

const notify = () => subscribers.forEach(fn => fn([...activeWorkers]));

export const subscribeWorkers = (fn) => {
    subscribers.add(fn);
    fn([...activeWorkers]);
    return () => subscribers.delete(fn);
};

export const executeToolInWorker = (toolName, params, onProgress) => {
    return new Promise(async (resolve, reject) => {
        let channel = null;
        let worker = null;
        const callId = `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const workerEntry = { id: callId, toolName, status: 'starting', phase: 'intent', startedAt: Date.now() };

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
            updateWorker({ status: 'funding' });
            channel = await bchChannelManager.acquireChannel(0);
            updateWorker({ status: 'running', wallet: channel.address });

            worker = new Worker(
                new URL('../workers/toolWorker.js', import.meta.url),
                { type: 'module' }
            );

            worker.onmessage = (event) => {
                const msg = event.data;
                if (msg.id !== callId) return;

                if (msg.type === 'progress') {
                    let phase = workerEntry.phase;
                    if (msg.step === 'tool_selected') phase = 'intent';
                    else if (msg.step === 'payment_required') phase = 'authorization';
                    else if (msg.step === 'processing_payment') phase = 'settlement';
                    else if (msg.step === 'payment_confirmed') phase = 'delivery';

                    updateWorker({ status: 'running', phase, lastMessage: msg.message });
                    onProgress?.(msg);
                } else if (msg.type === 'result') {
                    updateWorker({
                        status: msg.success ? 'done' : 'failed',
                        phase: msg.success ? 'complete' : workerEntry.phase,
                        finishedAt: Date.now()
                    });
                    finish(msg);
                }
            };

            worker.onerror = (err) => {
                updateWorker({ status: 'failed', finishedAt: Date.now(), error: err.message });
                console.error('Worker error:', err);
                finish({ type: 'result', success: false, error: err.message, toolName });
            };

            worker.postMessage({
                id: callId,
                toolName,
                params,
                privateKey: channel.privateKey,
                rpcUrls: BCH_CHAIN.rpcUrls,
                chainId: BCH_CHAIN.id,
                explorerBase: BCH_CHAIN.blockExplorerUrls[0]
            });

        } catch (e) {
            console.error('Failed to start worker:', e);
            updateWorker({ status: 'failed', finishedAt: Date.now(), error: e.message });
            cleanup();
            resolve({ type: 'result', success: false, error: e.message, toolName });
        }
    });
};
