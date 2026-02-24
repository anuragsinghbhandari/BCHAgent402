/**
 * BCH Tool Worker (Web Worker) — Execute-First / Pay-to-Claim
 *
 * Refund-safe flow (BCH chipnet, no smart contract needed):
 * 1. Main → worker: { type: 'call', toolName, params, marketplaceUrl }
 *    → worker calls tool with no payment
 * 2. Backend executes tool first — if it FAILS it returns an error (no charge)
 *    If it SUCCEEDS it caches the result and returns 402 with a resultId
 * 3. Worker → main: { type: 'needs_payment', challenge (includes resultId) }
 *    → main pays BCH, gets txHash
 * 4. Main → worker: { type: 'payment_done', txHash, resultId, ... }
 *    → worker calls tool again with payment proof + resultId
 * 5. Backend verifies payment → returns cached result
 * 6. Worker → main: { type: 'result', success, data }
 *
 * Refund guarantee: tool is never charged if it fails.
 * The resultId links the payment to a specific successful execution.
 */

self.onmessage = async (event) => {
    const msg = event.data;
    if (msg.type === 'call') {
        await handleCall(msg);
    } else if (msg.type === 'payment_done') {
        await handleDelivery(msg);
    }
};

// Store pending state between messages
let pendingState = null;

async function handleCall({ id, toolName, params, marketplaceUrl }) {
    const toolUrl = `${marketplaceUrl}/tools/${toolName}`;

    self.postMessage({ id, type: 'progress', step: 'tool_selected', message: `Calling ${toolName}...` });

    try {
        const resp = await fetch(toolUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });

        // Free tool (PROVIDER_PAYMENT_ENABLED=false) or tool has no price
        if (resp.ok) {
            const data = await resp.json();
            self.postMessage({ id, type: 'progress', step: 'tool_success', message: `${toolName} completed (free)` });
            self.postMessage({ id, type: 'result', success: true, toolName, data, txHash: null, free: true });
            return;
        }

        // Tool failed before payment was required (happens in execute-first model)
        if (resp.status === 500 || resp.status === 503) {
            let errData = {};
            try { errData = await resp.json(); } catch (_) { }
            const errMsg = errData?.error || errData?.message || `Tool failed (HTTP ${resp.status}) — no payment charged`;
            self.postMessage({ id, type: 'result', success: false, toolName, error: errMsg, noCost: true });
            return;
        }

        // Unexpected non-402 error
        if (resp.status !== 402) {
            const txt = await resp.text();
            self.postMessage({ id, type: 'result', success: false, toolName, error: `HTTP ${resp.status}: ${txt}` });
            return;
        }

        // 402 — result is ready on the backend, payment required to claim
        const body = await resp.json();
        const req = body.accepts?.[0];

        if (!req) {
            self.postMessage({ id, type: 'result', success: false, toolName, error: 'No payment requirements in 402 challenge' });
            return;
        }

        // Store pending context for delivery phase
        pendingState = { id, toolName, params, toolUrl };

        // Tell main thread we need payment (include resultId for pay-to-claim)
        self.postMessage({
            id,
            type: 'needs_payment',
            toolName,
            challenge: {
                payTo: req.payTo,
                amount: req.amount || req.maxAmountRequired,
                satoshis: req.satoshis,
                priceUSD: req.priceUSD,
                unit: req.unit || 'BCH',
                network: req.network,
                description: req.description,
                resultId: req.resultId || null,  // ← pay-to-claim token
                expiresAt: req.expiresAt || null,
            },
        });

    } catch (err) {
        self.postMessage({ id, type: 'result', success: false, toolName, error: err.message });
    }
}

async function handleDelivery({ id, txHash, from, amount, satoshis, payTo, resultId }) {
    if (!pendingState || pendingState.id !== id) {
        self.postMessage({ id, type: 'result', success: false, error: 'No pending tool call for this payment' });
        return;
    }

    const { toolName, params, toolUrl } = pendingState;
    pendingState = null;

    self.postMessage({ id, type: 'progress', step: 'delivering', message: 'Claiming result with BCH payment proof...' });

    try {
        const paymentPayload = {
            scheme: 'x402-bch',
            txHash,
            from,
            to: payTo,
            amount,
            satoshis,
            resultId,           // ← links payment to pre-executed result
            network: 'bch:chipnet',
            timestamp: Date.now(),
        };

        const headers = {
            'Content-Type': 'application/json',
            'X-Payment': btoa(JSON.stringify(paymentPayload)),
            'X-Payment-Tx': txHash,
            'X-Payment-Chain': 'bch:chipnet',
        };

        // Include resultId as a header so backend can quickly look up cached result
        if (resultId) {
            headers['X-Result-Id'] = resultId;
        }

        const resp = await fetch(toolUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(params),
        });

        const data = await resp.json();

        if (!resp.ok) {
            // 410 Gone = result expired (backend cache TTL passed)
            if (resp.status === 410) {
                self.postMessage({
                    id, type: 'result', success: false, toolName,
                    error: 'Result expired (took too long to pay). Please try again — no charge was applied.',
                    expired: true,
                });
                return;
            }
            self.postMessage({ id, type: 'result', success: false, toolName, error: data?.error || `HTTP ${resp.status}`, data });
            return;
        }

        self.postMessage({ id, type: 'progress', step: 'tool_success', message: `${toolName} completed successfully` });
        self.postMessage({
            id,
            type: 'result',
            success: true,
            toolName,
            data,
            txHash,
            explorerUrl: `https://chipnet.imaginary.cash/tx/${txHash}`,
            amountBCH: amount,
        });

    } catch (err) {
        self.postMessage({ id, type: 'result', success: false, toolName, error: err.message });
    }
}
