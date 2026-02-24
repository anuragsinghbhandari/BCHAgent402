/**
 * BCH Chipnet (Testnet) Configuration
 * Calibrated for a ~$5 USD budget (≈ 0.0104 BCH at $480/BCH).
 *
 * Budget math:
 *   $5 ÷ $480 ≈ 0.01042 BCH total
 *   Tool price: $0.05 ≈ 0.000104 BCH each
 *   Per-worker topup: 0.001 BCH ≈ 9–10 tool calls
 *   4 workers × 0.001 = 0.004 BCH used for workers
 *   Leftover in agent wallet: ≈ 0.006 BCH for future topups
 *   Total tool calls possible: ≈ 57 before exhausting $5
 */

export const CHIPNET = {
    network: 'chipnet',
    explorerUrl: 'https://chipnet.imaginary.cash',
    explorerTxUrl: (txHash) => `https://chipnet.imaginary.cash/tx/${txHash}`,
    explorerAddressUrl: (addr) => `https://chipnet.imaginary.cash/address/${addr}`,
    faucetUrl: 'https://tbch.googol.cash',
    electrumServers: [
        'wss://chipnet.imaginary.cash:50004',
        'wss://chipnet.bch.ninja:50004',
    ],
};

export const PAYMENT_UNIT = 'BCH';
export const SATOSHIS_PER_BCH = 100_000_000n;

// ── Budget-conscious thresholds (tuned for $5 / ~0.0104 BCH) ──────────────────
// Worker is topped up with this amount when it runs low
export const WORKER_TOPUP_AMOUNT = 0.001;   // 0.001 BCH ≈ $0.48 @ $480/BCH

// Worker must have at least this much BCH before accepting a job
export const MIN_BCH_FOR_TOOLS = 0.0002;  // 0.0002 BCH ≈ $0.10 (covers 1–2 tool calls + fees)

// Worker must have at least this much BCH for network fees alone
export const MIN_BCH_FOR_GAS = 0.0001;  // 0.0001 BCH ≈ $0.05 (a few sats for fee)

// Agent reserves: always keep this much in the main agent wallet
// so we can keep funding workers without hitting zero
export const AGENT_MIN_RESERVE = 0.001;   // 0.001 BCH ≈ $0.48 — never dip below this

// Number of parallel worker wallets
export const WORKER_COUNT = 4;

// How often to check/top up workers in background (ms)
// Set high so it doesn't needlessly drain funds; workers are topped up on-demand
export const WORKER_FUND_INTERVAL_MS = 5 * 60 * 1000;  // every 5 min (was 60s)

// WalletConnect project ID (get yours at https://cloud.walletconnect.com)
export const WALLETCONNECT_PROJECT_ID = '2f35b3c35a90b76f10be7adc24e44b9c';
export const WALLETCONNECT_METADATA = {
    name: 'Agent402',
    description: 'AI Agent with autonomous BCH payments on chipnet',
    url: 'http://localhost:5173',
    icons: ['https://avatars.githubusercontent.com/u/37784886'],
};
