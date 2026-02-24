import express from "express";
import cors from "cors";
import 'dotenv/config'
import fetch from 'node-fetch';
import { Agent } from 'https';
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();

app.get("/ping", (req, res) => res.send("pong"));

app.use((req, res, next) => {
  console.log(`[DEBUG] Incoming Request: ${req.method} ${req.url}`);
  next();
});

const httpsAgent = new Agent({ rejectUnauthorized: false });

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import mongoose from 'mongoose';
import { Tool } from './models/Tool.js';
import vm from 'vm';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    await loadTools();
  })
  .catch(err => console.error('Could not connect to MongoDB', err));

let dynamicRoutes = {};
const registeredProxies = new Map();
const MARKETPLACE_TOOLS = [];

const USER_TOOLS_DIR = path.join(__dirname, 'user_tools');

if (!fs.existsSync(USER_TOOLS_DIR)) {
  fs.mkdirSync(USER_TOOLS_DIR);
}

const loadTools = async () => {
  try {
    const tools = await Tool.find({ status: 'approved' });

    tools.forEach(tool => {
      const routePath = `/tools/${tool.name}`;
      dynamicRoutes[routePath] = {
        price: tool.price,
        asset: "native",
        description: tool.description,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
        walletAddress: tool.walletAddress
      };

      if (tool.type === 'code') {
        const codePath = path.join(USER_TOOLS_DIR, `${tool.name}.js`);
        fs.writeFileSync(codePath, tool.code);
        registeredProxies.set(tool.name, {
          type: 'code',
          codePath: codePath,
          walletAddress: tool.walletAddress,
          trusted: tool.trusted
        });
      } else {
        registeredProxies.set(tool.name, {
          type: 'proxy',
          targetUrl: tool.targetUrl,
          method: "POST",
          walletAddress: tool.walletAddress
        });
      }

      const toolDef = {
        name: tool.name,
        description: tool.description.replace(/\s*COSTS:.*$/i, '').trim(),
        price: tool.price,
        parameters: tool.parameters
      };
      const existingIndex = MARKETPLACE_TOOLS.findIndex(t => t.name === tool.name);
      if (existingIndex >= 0) {
        MARKETPLACE_TOOLS[existingIndex] = toolDef;
      } else {
        MARKETPLACE_TOOLS.push(toolDef);
      }
    });
    console.log(`[Persistence] Loaded ${tools.length} custom tools from MongoDB.`);
  } catch (err) {
    console.error("[Persistence] Failed to load tools from DB:", err);
  }
};


app.use(express.json({ limit: '50mb' }));
app.use(cors({
  origin: ['http://localhost:5174', 'http://localhost:5173', "https://agent402-skale.vercel.app", "https://agent402-goodvibes.vercel.app"],
  credentials: true,
  exposedHeaders: ['X-Payment-Receipt']
}));

// Local RPC Proxy to bypass MetaMask's SSL/HTTP restrictions
app.post("/rpc", async (req, res) => {
  try {
    const upstream = "https://rpc-testnet.smartbch.org";
    const response = await fetch(upstream, {
      method: "POST",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      agent: httpsAgent
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("[RPC Proxy] Error forwarding request:", err.message);
    res.status(502).json({ error: "Upstream RPC Error" });
  }
});

app.post("/gemini/chat", async (req, res) => {
  try {
    const { history, message, tools } = req.body;

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: `You are an autonomous agent that can use MCP tools from a paid marketplace.
            
IMPORTANT RULES:
1. ALWAYS EXPLAIN YOUR PLAN: Before calling any tools, provide a short 1-sentence explanation of what you are about to do and why. This is CRITICAL.
2. PLAN AHEAD: If you need to call multiple tools that are independent, output ALL tool calls in a single turn.
3. CHAINING: If a tool output is needed for the next step, call the first tool, wait for the result, then call the next.
4. If multiple tools provide the same capability, ALWAYS choose the lowest-cost tool.
5. Only call a tool if it is absolutely necessary to answer the question.
6. Construct arguments exactly according to the tool parameter schema.
7. Be concise and helpful in your responses.

Each tool has a monetary cost stated in its description. Consider cost when selecting tools.`,
      tools: tools ? [{ functionDeclarations: tools }] : undefined
    });

    const cleanHistory = (history || []).map(turn => {
      if (turn.role === 'function') {
        return {
          role: 'function',
          parts: turn.parts.map(part => {
            if (part.functionResponse) {
              const { name, response } = part.functionResponse;
              return { functionResponse: { name, response: response || { result: "No content" } } };
            }
            return part;
          })
        };
      }
      return turn;
    });

    const chat = model.startChat({ history: cleanHistory });

    let cleanMessage = message;
    if (typeof message === 'object' && message.parts) {
      cleanMessage = {
        ...message,
        parts: message.parts.map(part => {
          if (part.functionResponse) {
            const { name, response } = part.functionResponse;
            return { functionResponse: { name, response: response || { result: "No content" } } };
          }
          return part;
        })
      };
    }

    const messageToSend = (cleanMessage && cleanMessage.parts) ? cleanMessage.parts : cleanMessage;
    const result = await chat.sendMessage(messageToSend);
    const response = await result.response;

    let text = "";
    try { text = response.text(); } catch (e) { }

    const functionCalls = response.functionCalls();
    const candidates = response.candidates;
    const parts = (candidates && candidates.length > 0 && candidates[0].content) ? candidates[0].content.parts : [];

    res.json({ success: true, text, functionCalls, parts });

  } catch (error) {
    console.error("Gemini API Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// BCH Chipnet (native BCH testnet) configuration
const CHIPNET_NETWORK = 'chipnet';
const CHIPNET_EXPLORER = 'https://chipnet.imaginary.cash/tx/';
const TOOL_PROVIDER_ADDR = process.env.TOOL_PROVIDER_ADDR || '';
// Default tool price in USD (tool.price in DB is USD)
const DEFAULT_TOOL_PRICE_USD = parseFloat(process.env.DEFAULT_TOOL_PRICE_USD || '0.05');
const BCH_FALLBACK_USD = 330;  // used if CoinGecko is unreachable

/**
 * Validate a BCH chipnet cashaddr.
 * Valid addresses start with 'bchtest:' or 'bitcoincash:' followed by >=20 base32 chars.
 * Rejects placeholders like 'bchtest:YOUR_BCH_ADDRESS_HERE'.
 */
const isValidBchAddr = (addr) => {
  if (!addr) return false;
  if (!/^(bchtest:|bitcoincash:)/i.test(addr)) return false;
  const payload = addr.split(':')[1] || '';
  // BCH base32 charset: q p z r y 9 x 8 g f 2 t v d w 0 s 3 j n 5 4 k h c e 6 m u a 7 l
  if (!/^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{20,}$/.test(payload)) return false;
  return true;
};

const PROVIDER_PAYMENT_ENABLED = isValidBchAddr(TOOL_PROVIDER_ADDR);
if (!PROVIDER_PAYMENT_ENABLED) {
  console.warn('⚠️  [Payment] TOOL_PROVIDER_ADDR is not set or invalid.');
  console.warn('   Tools will be served FOR FREE until you set a valid chipnet cashaddr in .env:');
  console.warn('   TOOL_PROVIDER_ADDR=bchtest:q...');
  console.warn('   Get tBCH from: https://tbch.googol.cash');
}

// ── BCH/USD price cache (fetched from CoinGecko, fallback $330) ─────────────
let _bchUsdPrice = BCH_FALLBACK_USD;
let _priceLastFetched = 0;
const PRICE_TTL_MS = 5 * 60 * 1000;  // 5 minutes

const fetchBchUsdPrice = async () => {
  const now = Date.now();
  if (now - _priceLastFetched < PRICE_TTL_MS) return _bchUsdPrice;
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd',
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) throw new Error('non-OK');
    const data = await res.json();
    const price = data?.['bitcoin-cash']?.usd;
    if (price && typeof price === 'number') {
      _bchUsdPrice = price;
      _priceLastFetched = now;
      console.log(`[PriceService] BCH = $${price} USD`);
    }
  } catch (e) {
    console.warn(`[PriceService] Using fallback $${BCH_FALLBACK_USD} (${e.message})`);
  }
  return _bchUsdPrice;
};

// Pre-fetch price on startup
fetchBchUsdPrice();

/**
 * Verify a BCH chipnet transaction using mainnet-js electrum.
 * Checks that the tx exists, has an output paying payToAddress at least priceSat satoshis.
 */
async function verifyBchPayment(txHash, payToAddress, priceSat) {
  const { TestNetWallet } = await import('mainnet-js');
  // Use a read-only wallet on chipnet to query the electrum network
  const wallet = await TestNetWallet.newRandom();

  // Retry up to 8 times (chipnet mempool propagation can take a few seconds)
  let txData = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      txData = await wallet.provider.getRawTransactionObject(txHash);
      if (txData) break;
    } catch (_) { }
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!txData) throw new Error(`BCH tx ${txHash} not found on chipnet after retries`);

  // Check outputs for matching cashaddr + amount
  const outputs = txData.vout || [];
  let totalPaidSat = 0;
  for (const out of outputs) {
    const outAddr = out.scriptPubKey?.addresses?.[0] || out.scriptPubKey?.address || '';
    // Normalise: compare without prefix
    const normalise = (a) => a.replace(/^bchtest:/, '').replace(/^bitcoincash:/, '');
    if (normalise(outAddr) === normalise(payToAddress)) {
      // vout value is in BCH, convert to satoshis
      totalPaidSat += Math.round((out.value || 0) * 1e8);
    }
  }

  if (totalPaidSat < priceSat) {
    throw new Error(`Insufficient BCH payment. Paid: ${totalPaidSat} sat, Required: ${priceSat} sat`);
  }

  return { totalPaidSat, txData };
}

// ── Execute-first / Pay-to-claim result cache ──────────────────────────────────
// Replaces SmartBCH escrow contract: tool runs before payment is required.
// If tool fails → no charge. If tool succeeds → client pays to unlock result.
const pendingResults = new Map();  // resultId → { result, timestamp, toolName, priceSat }
const RESULT_TTL_MS = 5 * 60 * 1000;  // 5-minute window to pay

// Auto-cleanup expired entries
setInterval(() => {
  const expire = Date.now() - RESULT_TTL_MS;
  for (const [id, entry] of pendingResults) {
    if (entry.timestamp < expire) {
      pendingResults.delete(id);
      console.log(`[x402-bch] Expired unclaimed result for ${entry.toolName} (${id.slice(0, 8)})`);
    }
  }
}, 60_000);

/**
 * Execute a tool by forwarding the request to its target URL.
 * Used for the execute-first model: run the tool before requiring payment.
 */
async function executeToolForward(toolName, specificRoute, body) {
  const { targetUrl } = specificRoute;
  if (!targetUrl) return null;  // code tools don't have a targetUrl

  const resp = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });

  const data = await resp.json();
  return { ok: resp.ok, status: resp.status, data };
}

// Deduplicate seen tx hashes to prevent double-spend replay
const seenTxHashes = new Set();

app.use("/tools", async (req, res, next) => {
  const toolName = req.path.split('/')[1];
  if (!toolName) return next();



  const fullPath = `/tools/${toolName}`;
  const specificRoute = dynamicRoutes[fullPath];

  if (!specificRoute) return next();

  const toolConfig = registeredProxies.get(toolName);

  // Skip payment entirely if TOOL_PROVIDER_ADDR is not configured with a real BCH address
  if (!PROVIDER_PAYMENT_ENABLED) {
    console.log(`[x402-bch] Payment skipped for "${toolName}" (TOOL_PROVIDER_ADDR not set — free mode)`);
    return next();
  }

  // Only use DB walletAddress if it's a valid BCH cashaddr (bchtest: or bitcoincash:)
  // Tools in the DB may have old EVM 0x addresses — we must not send BCH to those!
  const dbWalletAddr = toolConfig?.walletAddress || '';
  const toolProviderAddr = (isValidBchAddr(dbWalletAddr) ? dbWalletAddr : null) || TOOL_PROVIDER_ADDR;

  if (dbWalletAddr && !isValidBchAddr(dbWalletAddr)) {
    console.warn(`[x402-bch] Tool "${toolName}" has EVM walletAddress (${dbWalletAddr.slice(0, 10)}...) — using TOOL_PROVIDER_ADDR instead`);
  }

  // Final check: even resolved address must be valid
  if (!isValidBchAddr(toolProviderAddr)) {
    console.warn(`[x402-bch] No valid payment address for "${toolName}" — serving for free`);
    return next();
  }


  // tool.price is in USD — convert to BCH using live rate
  const bchRate = await fetchBchUsdPrice();
  const priceUSD = specificRoute.price ? parseFloat(specificRoute.price) : DEFAULT_TOOL_PRICE_USD;
  const priceBCH = priceUSD / bchRate;
  const priceSat = Math.ceil(priceBCH * 1e8);

  const xPaymentHeader = req.headers['x-payment'];
  const xPaymentTx = req.headers['x-payment-tx'];
  const xResultId = req.headers['x-result-id'] || null;
  const xPaymentChain = req.headers['x-payment-chain'] || '';

  // ── Pay-to-claim: client has already paid and sends the resultId ──────────
  if ((xPaymentTx || xPaymentHeader) && xResultId) {
    const cached = pendingResults.get(xResultId);
    if (!cached) {
      console.warn(`[x402-bch] Result ${xResultId.slice(0, 8)} not found or expired`);
      return res.status(410).json({
        error: 'Result expired or not found. Tool result window is 5 minutes. Please retry.',
        resultId: xResultId,
      });
    }

    // Verify BCH payment
    let txHash = xPaymentTx;
    if (xPaymentHeader) {
      try {
        const payload = JSON.parse(Buffer.from(xPaymentHeader, 'base64').toString('utf-8'));
        txHash = txHash || payload.txHash;
      } catch (e) { /* ignore */ }
    }

    try {
      const { totalPaidSat } = await verifyBchPayment(txHash, toolProviderAddr, cached.priceSat);
      pendingResults.delete(xResultId);
      console.log(`[x402-bch] ✅ Payment verified (${totalPaidSat} sat) for ${toolName} — delivering result`);
      return res.json(cached.result);
    } catch (e) {
      console.warn(`[x402-bch] Payment verification failed for ${toolName}:`, e.message);
      return res.status(402).json({ error: `Payment insufficient or not found: ${e.message}` });
    }
  }

  // ── Execute-first: no payment yet — run tool, cache result, issue 402 ────
  if (!xPaymentHeader && !xPaymentTx) {
    // Execute tool NOW before requiring payment
    let toolResult = null;
    try {
      toolResult = await executeToolForward(toolName, specificRoute, req.body);
    } catch (e) {
      console.warn(`[x402-bch] Tool "${toolName}" execution failed before payment:`, e.message);
      return res.status(500).json({ error: `Tool execution failed: ${e.message}`, message: 'No payment charged.' });
    }

    // Tool doesn't support pre-execution (code tools) → fall through to next()
    if (!toolResult) {
      console.log(`[x402-bch] Code tool "${toolName}" — using standard payment flow`);
      // For code tools: issue plain 402, payment verified then next() handles execution
      return res.status(402).json({
        accepts: [{
          scheme: 'x402-bch',
          payTo: toolProviderAddr,
          priceUSD,
          amount: priceBCH,
          maxAmountRequired: priceBCH,
          unit: 'BCH',
          satoshis: priceSat,
          bchUsdRate: bchRate,
          network: 'bch:chipnet',
          description: `Payment for ${toolName}: $${priceUSD.toFixed(2)} USD ≈ ${priceBCH.toFixed(6)} tBCH`,
        }]
      });
    }

    // Tool failed → return error, NO payment required
    if (!toolResult.ok) {
      console.log(`[x402-bch] Tool "${toolName}" returned ${toolResult.status} — no payment required`);
      return res.status(toolResult.status || 500).json({
        error: toolResult.data?.error || 'Tool execution failed',
        message: 'No payment charged — tool failed before payment.',
        noCost: true,
      });
    }

    // Tool succeeded → cache result, issue 402 with resultId
    const resultId = crypto.randomUUID();
    pendingResults.set(resultId, {
      result: toolResult.data,
      timestamp: Date.now(),
      toolName,
      priceSat,
    });

    console.log(`[x402-bch] ✅ Tool "${toolName}" executed OK → result cached (id: ${resultId.slice(0, 8)}) → issuing 402`);

    return res.status(402).json({
      accepts: [{
        scheme: 'x402-bch',
        payTo: toolProviderAddr,
        priceUSD,
        amount: priceBCH,
        maxAmountRequired: priceBCH,
        unit: 'BCH',
        satoshis: priceSat,
        bchUsdRate: bchRate,
        network: 'bch:chipnet',
        resultId,                         // ← client must include X-Result-Id to claim
        expiresAt: Date.now() + RESULT_TTL_MS,
        description: `Result ready! Pay $${priceUSD.toFixed(2)} USD ≈ ${priceBCH.toFixed(6)} tBCH to claim within 5 min`,
      }]
    });
  }


  // Parse payment header
  let txHash = xPaymentTx;
  let payerAddr = '';
  let claimedAmount = 0;

  if (xPaymentHeader) {
    try {
      const payload = JSON.parse(Buffer.from(xPaymentHeader, 'base64').toString('utf-8'));
      txHash = txHash || payload.txHash;
      payerAddr = payload.from || '';
      claimedAmount = payload.amount || 0;
    } catch (e) {
      console.warn('[x402-bch] Could not parse X-Payment header:', e.message);
    }
  }

  if (!txHash) {
    return res.status(400).json({ error: 'Missing BCH payment transaction hash' });
  }

  // Prevent replay attacks
  if (seenTxHashes.has(txHash)) {
    return res.status(403).json({ error: 'Payment tx already used (replay rejected)' });
  }

  console.log(`[x402-bch] Verifying BCH payment tx ${txHash} for ${toolName}...`);
  try {
    const { totalPaidSat } = await verifyBchPayment(txHash, toolProviderAddr, priceSat);

    // Mark tx as seen
    seenTxHashes.add(txHash);
    // Cleanup old seen hashes after 24h to prevent unbounded growth
    setTimeout(() => seenTxHashes.delete(txHash), 24 * 60 * 60 * 1000);

    console.log(`[x402-bch] ✓ Payment verified: ${totalPaidSat} sat from ${payerAddr || '?'} to ${toolProviderAddr}`);

    const serverReceipt = {
      verified: true,
      timestamp: new Date().toISOString(),
      txHash,
      payTo: toolProviderAddr,
      payer: payerAddr,
      satoshis: totalPaidSat,
      bch: (totalPaidSat / 1e8).toFixed(8),
      network: 'bch:chipnet',
      toolName,
      explorerUrl: `${CHIPNET_EXPLORER}${txHash}`,
      verifiedBy: 'x402-bch-chipnet',
    };

    // Attach receipt to response
    const originalJson = res.json.bind(res);
    res.json = async function (body) {
      res.set('X-Payment-Receipt', JSON.stringify(serverReceipt));
      if (typeof body === 'object' && body !== null) {
        body.escrowReceipt = serverReceipt;
      }
      return originalJson(body);
    };

    console.log(`[x402-bch] Payment verified → executing tool ${toolName}...`);
    next();

  } catch (verifyError) {
    console.error('[x402-bch] Verification failed:', verifyError.message);
    return res.status(402).json({ error: 'BCH payment verification failed', details: verifyError.message });
  }
});

app.get("/escrow-info", (req, res) => {
  res.json({
    network: 'bch:chipnet',
    toolProviderAddr: TOOL_PROVIDER_ADDR || 'NOT SET',
    defaultPriceBCH: DEFAULT_TOOL_PRICE_BCH,
    explorer: CHIPNET_EXPLORER,
    faucet: 'https://tbch.googol.cash',
    note: 'Native BCH chipnet — no EVM escrow contract needed'
  });
});


app.post("/tools/register", async (req, res) => {
  try {
    const { name, description, price, targetUrl, parameters, type, code, walletAddress } = req.body;
    const toolType = type || 'proxy';

    if (!name || !price) {
      return res.status(400).json({ success: false, error: "Missing required fields: name, price" });
    }
    if (toolType === 'proxy' && !targetUrl) {
      return res.status(400).json({ success: false, error: "Proxy tools require targetUrl" });
    }
    if (toolType === 'code' && !code) {
      return res.status(400).json({ success: false, error: "Code tools require code" });
    }

    const existingTool = await Tool.findOne({ name });
    if (existingTool) {
      return res.status(400).json({ success: false, error: "Tool with this name already exists" });
    }

    const newTool = new Tool({ name, description, price: String(price), targetUrl, parameters, type: toolType, code, walletAddress, status: 'pending' });
    await newTool.save();

    console.log(`[Registry] Registered new tool: ${name} (PENDING APPROVAL)`);
    res.json({ success: true, message: "Tool registered successfully. Status is PENDING approval.", tool: { name, description, price, parameters: parameters || { type: "object", properties: {} } } });

  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/tools/:name/approve", async (req, res) => {
  const { name } = req.params;
  try {
    const tool = await Tool.findOne({ name });
    if (!tool) return res.status(404).json({ success: false, error: "Tool not found" });
    if (tool.status === 'approved') return res.status(400).json({ success: false, error: "Tool already approved" });

    tool.status = 'approved';
    await tool.save();

    const routePath = `/tools/${tool.name}`;
    dynamicRoutes[routePath] = { price: tool.price, asset: "native", description: tool.description, mimeType: "application/json", maxTimeoutSeconds: 300, walletAddress: tool.walletAddress };

    if (tool.type === 'code') {
      const codePath = path.join(USER_TOOLS_DIR, `${tool.name}.js`);
      fs.writeFileSync(codePath, tool.code);
      registeredProxies.set(tool.name, { type: 'code', codePath, walletAddress: tool.walletAddress, trusted: tool.trusted });
    } else {
      registeredProxies.set(tool.name, { type: 'proxy', targetUrl: tool.targetUrl, method: "POST", walletAddress: tool.walletAddress });
    }

    const toolDef = { name: tool.name, description: tool.description, price: tool.price, parameters: tool.parameters };
    const existingIndex = MARKETPLACE_TOOLS.findIndex(t => t.name === tool.name);
    if (existingIndex >= 0) MARKETPLACE_TOOLS[existingIndex] = toolDef;
    else MARKETPLACE_TOOLS.push(toolDef);

    console.log(`[Approval] Approved and loaded tool: ${name}`);
    res.json({ success: true, message: "Tool approved and live" });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/tools/:toolName", async (req, res, next) => {
  const { toolName } = req.params;

  if (registeredProxies.has(toolName)) {
    console.log(`[Execution] Running dynamic tool: ${toolName}`);
    const toolConfig = registeredProxies.get(toolName);

    try {
      if (toolConfig.type === 'code') {
        const codePath = path.join(USER_TOOLS_DIR, `${toolName}.js`);

        if (toolConfig.trusted) {
          if (!fs.existsSync(codePath)) throw new Error(`Tool file not found at ${codePath}`);
          const module = await import(`${pathToFileURL(codePath).href}?t=${Date.now()}`);
          if (module.default && typeof module.default === 'function') {
            const result = await module.default(req.body);
            return res.json({ success: true, result: "Tool executed successfully", data: result });
          } else {
            throw new Error("Tool code does not export a default function");
          }
        } else {
          const code = fs.readFileSync(codePath, 'utf8');
          const sandbox = { console, fetch, URLSearchParams, Buffer, setTimeout, clearTimeout, exports: {} };
          vm.createContext(sandbox);
          const scriptCode = code.replace(/export\s+default\s+/, 'exports.default = ');
          try { vm.runInContext(scriptCode, sandbox, { timeout: 5000 }); } catch (e) { throw new Error("Sandbox compilation failed: " + e.message); }
          if (sandbox.exports.default && typeof sandbox.exports.default === 'function') {
            const result = await sandbox.exports.default(req.body);
            return res.json({ success: true, result: "Tool executed successfully (Sandboxed)", data: result });
          } else {
            throw new Error("Sandboxed code did not export a default function");
          }
        }
      } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(toolConfig.targetUrl, {
          method: toolConfig.method || "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
          signal: controller.signal,
          agent: httpsAgent
        });
        clearTimeout(timeoutId);
        const data = await response.json();
        res.status(response.status).json({ success: response.ok, result: response.ok ? "Tool call successful" : "Tool call failed upstream", data });
      }
    } catch (error) {
      console.error(`[Execution] Error calling ${toolName}:`, error);
      res.status(502).json({ success: false, result: "Tool execution failed", error: error.message });
    }
  } else {
    next();
  }
});



app.get("/tools", (req, res) => {
  console.log('[Server] Fetching marketplace tools list');
  res.json(MARKETPLACE_TOOLS);
});

app.get("/tools/info", (req, res) => res.json(MARKETPLACE_TOOLS));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "MCP Tool Server is running",
    network: CHIPNET_NETWORK,
    toolProviderAddr: TOOL_PROVIDER_ADDR || "NOT SET — set TOOL_PROVIDER_ADDR in .env",
    defaultPriceBCH: DEFAULT_TOOL_PRICE_BCH,
    explorer: CHIPNET_EXPLORER,
    faucet: "https://tbch.googol.cash"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BCH Agent402 Tool Server running on port ${PORT}`);
  console.log(`⛓  Network: BCH ${CHIPNET_NETWORK}`);
  console.log(`💸 Tool provider BCH addr: ${TOOL_PROVIDER_ADDR || 'NOT SET — set TOOL_PROVIDER_ADDR in .env'}`);
  console.log(`💰 Default tool price: $${DEFAULT_TOOL_PRICE_USD} USD (≈ BCH at live rate)`);
  console.log(`🔍 Explorer: ${CHIPNET_EXPLORER}`);
  console.log(`🚰 Faucet: https://tbch.googol.cash`);
});
