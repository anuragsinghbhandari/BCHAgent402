/**
 * Legacy compatibility shim — re-exports BCH chain config under old SKALE names.
 * This file exists so any code that still imports from 'config/skale' continues to work.
 */
export { BCH_CHAIN as SKALE_CHAIN, TOKEN_ADDRESS as USDC_ADDRESS } from './bch.js';
