import { BITE } from '@skalenetwork/bite';
import { ethers } from 'ethers';

// Default to Skale BITE V2 Sandbox
const SKALE_ENDPOINT = process.env.SKALE_ENDPOINT || "https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox";

const bite = new BITE(SKALE_ENDPOINT);

/**
 * Encrypts a JSON payload using BITE threshold encryption.
 * The data is only decryptable after consensus processes the transaction.
 * @param {object} payload - JSON payload to encrypt (e.g. { tool, params })
 * @returns {Promise<string>} Encrypted hex string
 */
export async function encryptIntent(payload) {
    try {
        const jsonStr = JSON.stringify(payload);
        const hexData = ethers.hexlify(ethers.toUtf8Bytes(jsonStr));
        console.log(`[BITE] Encrypting intent (${jsonStr.length} bytes)...`);

        const encrypted = await bite.encryptMessage(hexData);
        console.log(`[BITE] Intent encrypted: ${encrypted.slice(0, 40)}...`);
        return encrypted;
    } catch (error) {
        console.error("[BITE] Encryption Error:", error);
        throw error;
    }
}

/**
 * Decrypts transaction data from a SKALE transaction hash using BITE.
 * @param {string} txHash 
 * @returns {Promise<object>} { payloadStr, to, data }
 */
export async function retrieveBitePayload(txHash) {
    try {
        console.log(`[BITE] Retrieving decrypted data for ${txHash}...`);

        const decrypted = await bite.getDecryptedTransactionData(txHash);

        if (!decrypted || !decrypted.data) {
            throw new Error("No decrypted data found in transaction receipt");
        }

        // Convert Hex to UTF-8
        let utf8String = "";
        try {
            utf8String = ethers.toUtf8String(decrypted.data);
        } catch (e) {
            console.log("Data is not UTF-8 string, returning raw hex");
        }

        return {
            payloadStr: utf8String,
            to: decrypted.to,
            data: decrypted.data
        };

    } catch (error) {
        console.error("[BITE] Decryption Error:", error);
        throw error;
    }
}

/**
 * Conditional decrypt — only decrypts if the USDC payment to escrow is verified.
 * @param {string} txHash - Transaction hash containing encrypted intent + USDC transfer
 * @param {string} escrowAddress - Expected escrow wallet address
 * @param {string} usdcContract - USDC contract address
 * @returns {Promise<object>} { intent, transferAmount, from }
 */
export async function conditionalDecrypt(txHash, escrowAddress, usdcContract) {
    const provider = new ethers.JsonRpcProvider(SKALE_ENDPOINT);

    // Step 1: Verify USDC transfer to escrow
    console.log(`[BITE Escrow] Verifying payment to escrow ${escrowAddress}...`);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
        throw new Error("Transaction receipt not found");
    }

    const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
    const transferLog = receipt.logs.find(log =>
        log.address.toLowerCase() === usdcContract.toLowerCase() &&
        log.topics[0] === TRANSFER_TOPIC
    );

    let transferAmount = BigInt(0);
    let fromAddress = "";

    if (transferLog) {
        const toAddress = ethers.getAddress("0x" + transferLog.topics[2].slice(26));
        if (toAddress.toLowerCase() !== escrowAddress.toLowerCase()) {
            throw new Error(`Payment went to ${toAddress}, not escrow ${escrowAddress}`);
        }
        transferAmount = BigInt(transferLog.data);
        fromAddress = ethers.getAddress("0x" + transferLog.topics[1].slice(26));
        console.log(`[BITE Escrow] USDC verified: ${transferAmount} from ${fromAddress} to escrow`);
    } else {
        throw new Error("No USDC transfer found in transaction");
    }

    // Step 2: Condition met — decrypt the intent
    console.log(`[BITE Escrow] Condition met → Decrypting intent...`);
    let intent = null;
    try {
        const decrypted = await bite.getDecryptedTransactionData(txHash);
        if (decrypted && decrypted.data) {
            const utf8 = ethers.toUtf8String(decrypted.data);
            intent = JSON.parse(utf8);
            console.log(`[BITE Escrow] Decrypted intent:`, intent);
        }
    } catch (e) {
        console.warn(`[BITE Escrow] BITE decryption returned error (expected for non-BITE tx):`, e.message);
        // Intent may be in the regular tx data field instead
    }

    return {
        intent,
        transferAmount: transferAmount.toString(),
        from: fromAddress,
        verified: true
    };
}
