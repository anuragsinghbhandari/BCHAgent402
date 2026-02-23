import { Horizon, Keypair } from '@stellar/stellar-sdk';
import 'dotenv/config';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const server = new Horizon.Server(HORIZON_URL);

async function checkBalance(publicKey, label) {
    try {
        const acc = await server.loadAccount(publicKey);
        const xlm = acc.balances.find(b => b.asset_type === "native");
        console.log(`${label} [${publicKey.slice(0, 5)}...]: ${xlm ? xlm.balance : '0'} XLM (Seq: ${acc.sequence})`);
    } catch (e) {
        if (e.message && e.message.includes('404')) {
            console.log(`${label} [${publicKey.slice(0, 5)}...]: 0 XLM (NOT FOUND / 404)`);
        } else {
            console.error(`${label} [${publicKey.slice(0, 5)}...]: Error - ${e.message}`);
        }
    }
}

async function main() {
    console.log("--- Stellar Account Verification ---");

    const secret = process.env.STELLAR_SECRET_KEY || process.env.VITE_STELLAR_SECRET_KEY;
    console.log(`Checking Main Account from .env...`);

    if (secret) {
        try {
            const kp = Keypair.fromSecret(secret);
            await checkBalance(kp.publicKey(), "MAIN ACCOUNT");
        } catch (e) {
            console.error("Invalid Secret Key in env:", e.message);
        }
    } else {
        console.log("No STELLAR_SECRET_KEY found in env.");
    }
}

main();
