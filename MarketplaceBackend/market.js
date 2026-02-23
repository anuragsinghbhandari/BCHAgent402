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
  .then(() => console.log('Connected to MongoDB'))
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

const BCH_RPC = process.env.BCH_RPC || "https://moeing.tech:9545"; // Default backup if no env
const BCH_CHAIN_ID = 10001;
const TOKEN_CONTRACT_ADDR = "0x84b9B910527Ad5C03A9Ca831909E21e236EA7b06";
const TOKEN_DECIMALS = 18;

const ESCROW_CONTRACT_ADDR = process.env.ESCROW_CONTRACT_ADDRESS || "";

class NonceQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  async enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._process();
    });
  }

  async _process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const { fn, resolve, reject } = this.queue.shift();
      try { resolve(await fn()); } catch (err) { reject(err); }
    }
    this.processing = false;
  }
}

const escrowTxQueue = new NonceQueue();

app.use("/tools", async (req, res, next) => {
  const toolName = req.path.split('/')[1];
  if (!toolName) return next();

  const fullPath = `/tools/${toolName}`;
  const specificRoute = dynamicRoutes[fullPath];

  if (specificRoute) {
    const toolConfig = registeredProxies.get(toolName);
    const toolProviderWallet = toolConfig?.walletAddress || process.env.DEFAULT_EVM_WALLET || "";
    const escrowContractAddr = ESCROW_CONTRACT_ADDR;

    if (!escrowContractAddr) {
      console.error("[x402] ESCROW_CONTRACT_ADDRESS not set in .env!");
      return res.status(500).json({ error: "Escrow contract not configured. Set ESCROW_CONTRACT_ADDRESS in .env" });
    }

    const priceInUnits = specificRoute.price
      ? BigInt(Math.floor(Number(specificRoute.price) * (10 ** TOKEN_DECIMALS))).toString()
      : BigInt(1 * (10 ** TOKEN_DECIMALS)).toString();

    const xPaymentHeader = req.headers['x-payment'];
    const xPaymentTx = req.headers['x-payment-tx'];

    if (!xPaymentHeader && !xPaymentTx) {
      console.log(`[x402] No payment for ${toolName}. Issuing 402 → escrow: ${escrowContractAddr}`);
      return res.status(402).json({
        accepts: [
          {
            scheme: 'x402',
            payTo: escrowContractAddr,
            maxAmountRequired: priceInUnits,
            asset: TOKEN_CONTRACT_ADDR,
            network: `eip155:${BCH_CHAIN_ID}`,
            escrowContract: escrowContractAddr,
            toolProvider: toolProviderWallet,
            description: `Payment for ${toolName} (via custom escrow on SmartBCH Testnet)`,
            tokenDecimals: TOKEN_DECIMALS
          }
        ]
      });
    }

    console.log(`[x402] Verifying payment for ${toolName}...`);
    try {
      const { ethers } = await import("ethers");
      // Setup fallback provider for reliability
      const rpcList = process.env.BCH_RPC ? process.env.BCH_RPC.split(',') : [BCH_RPC];
      const providers = rpcList.map(url => new ethers.JsonRpcProvider(url.trim(), BCH_CHAIN_ID, { staticNetwork: true }));
      const provider = new ethers.FallbackProvider(providers, 1);

      let txHash = xPaymentTx;
      let payerAddress = "";
      let paidAmount = BigInt(0);

      if (xPaymentHeader) {
        try {
          const payloadStr = Buffer.from(xPaymentHeader, 'base64').toString('utf-8');
          const payload = JSON.parse(payloadStr);
          txHash = txHash || payload.txHash;
          payerAddress = payload.from || "";
          paidAmount = BigInt(payload.amount || 0);
        } catch (e) {
          console.warn("[x402] Could not parse X-Payment header:", e.message);
        }
      }

      if (!txHash) {
        return res.status(400).json({ error: "Missing payment transaction hash" });
      }

      let receipt = null;
      for (let i = 0; i < 5; i++) {
        receipt = await provider.getTransactionReceipt(txHash);
        if (receipt) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (!receipt) {
        return res.status(400).json({ error: "Transaction receipt not found on SmartBCH Testnet after retries" });
      }

      const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
      const transferLog = receipt.logs.find(log =>
        log.address.toLowerCase() === TOKEN_CONTRACT_ADDR.toLowerCase() &&
        log.topics[0] === TRANSFER_TOPIC
      );

      if (!transferLog) {
        return res.status(403).json({ error: "No token transfer found in transaction" });
      }

      const toAddress = ethers.getAddress("0x" + transferLog.topics[2].slice(26));
      const transferAmount = BigInt(transferLog.data);
      const fromAddress = ethers.getAddress("0x" + transferLog.topics[1].slice(26));

      if (toAddress.toLowerCase() !== escrowContractAddr.toLowerCase()) {
        return res.status(403).json({
          error: `Token sent to ${toAddress}, expected escrow contract ${escrowContractAddr}`
        });
      }

      if (transferAmount < BigInt(priceInUnits)) {
        return res.status(402).json({
          error: `Insufficient payment. Expected ${priceInUnits}, got ${transferAmount}`
        });
      }

      console.log(`[x402] ✓ Payment verified: ${ethers.formatUnits(transferAmount, TOKEN_DECIMALS)} TOKEN from ${fromAddress} to escrow`);

      const serverReceipt = {
        verified: true,
        timestamp: new Date().toISOString(),
        txHash,
        payTo: escrowContractAddr,
        toolProvider: toolProviderWallet,
        amount: priceInUnits,
        asset: TOKEN_CONTRACT_ADDR,
        chain: "bch-testnet",
        chainId: BCH_CHAIN_ID,
        toolName,
        verifiedBy: "x402-bch-escrow",
        payer: fromAddress,
        transferAmount: transferAmount.toString()
      };

      const originalJson = res.json.bind(res);
      let responseStatusCode = 200;

      const originalStatus = res.status.bind(res);
      res.status = function (code) {
        responseStatusCode = code;
        return originalStatus(code);
      };

      res.json = async function (body) {
        const toolSuccess = responseStatusCode >= 200 && responseStatusCode < 400 && body?.success !== false;
        const escrowKey = process.env.ESCROW_PRIVATE_KEY;

        if (toolSuccess) {
          console.log(`[x402] ✓ Tool ${toolName} succeeded → releasing escrow to ${toolProviderWallet}`);

          if (escrowKey && toolProviderWallet && escrowContractAddr) {
            try {
              const releaseTx = await escrowTxQueue.enqueue(async () => {
                const escrowWallet = new ethers.Wallet(escrowKey, provider);
                const escrowContract = new ethers.Contract(
                  escrowContractAddr,
                  ['function releasePaymentByTxHash(string calldata txHash, address toolProvider, uint256 amount) external'],
                  escrowWallet
                );
                const tx = await escrowContract.releasePaymentByTxHash(txHash, toolProviderWallet, transferAmount);
                await tx.wait();
                return tx;
              });
              serverReceipt.escrowRelease = { status: "released", releaseTxHash: releaseTx.hash, releasedTo: toolProviderWallet };
              console.log(`[x402] ✓ Escrow released to ${toolProviderWallet} (tx: ${releaseTx.hash})`);
            } catch (releaseErr) {
              console.warn(`[x402] Escrow release failed:`, releaseErr.message);
              serverReceipt.escrowRelease = { status: "release-failed", error: releaseErr.message };
            }
          } else {
            serverReceipt.escrowRelease = { status: "no-key", note: "ESCROW_PRIVATE_KEY not set" };
          }
        } else {
          console.log(`[x402] ✗ Tool ${toolName} failed → refunding escrow to ${fromAddress}`);

          if (escrowKey && fromAddress && escrowContractAddr) {
            try {
              const refundTx = await escrowTxQueue.enqueue(async () => {
                const escrowWallet = new ethers.Wallet(escrowKey, provider);
                const escrowContract = new ethers.Contract(
                  escrowContractAddr,
                  ['function refundPayment(string calldata txHash, address payer, uint256 amount) external'],
                  escrowWallet
                );
                const tx = await escrowContract.refundPayment(txHash, fromAddress, transferAmount);
                await tx.wait();
                return tx;
              });
              serverReceipt.escrowRelease = { status: "refunded", refundTxHash: refundTx.hash, refundedTo: fromAddress };
              console.log(`[x402] ↩ Escrow refunded to ${fromAddress} (tx: ${refundTx.hash})`);
            } catch (refundErr) {
              console.warn(`[x402] Escrow refund failed:`, refundErr.message);
              serverReceipt.escrowRelease = { status: "refund-failed", error: refundErr.message };
            }
          } else {
            serverReceipt.escrowRelease = { status: "no-key", note: "ESCROW_PRIVATE_KEY not set" };
          }
        }

        res.set('X-Payment-Receipt', JSON.stringify(serverReceipt));
        if (typeof body === 'object' && body !== null) {
          body.escrowReceipt = serverReceipt;
        }
        return originalJson(body);
      };

      console.log(`[x402] Payment verified → executing tool ${toolName}...`);
      next();

    } catch (chainError) {
      console.error("[x402] Verification Failed:", chainError);
      return res.status(502).json({ error: "Payment Verification Failed", details: chainError.message });
    }
  } else {
    next();
  }
});

app.get("/escrow-info", (req, res) => {
  res.json({
    escrowContract: ESCROW_CONTRACT_ADDR,
    tokenContract: TOKEN_CONTRACT_ADDR,
    tokenDecimals: TOKEN_DECIMALS,
    chain: "Smart Bitcoin Cash Testnet",
    chainId: BCH_CHAIN_ID,
    rpc: BCH_RPC,
    explorer: "https://testnet.bscscan.com"
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

loadTools();

app.get("/tools", (req, res) => {
  console.log('[Server] Fetching marketplace tools list');
  res.json(MARKETPLACE_TOOLS);
});

app.get("/tools/info", (req, res) => res.json(MARKETPLACE_TOOLS));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "MCP Tool Server is running",
    chain: "Smart Bitcoin Cash Testnet",
    chainId: BCH_CHAIN_ID,
    escrowContract: ESCROW_CONTRACT_ADDR || "NOT SET",
    tokenContract: TOKEN_CONTRACT_ADDR
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 MCP Tool Server running on port ${PORT}`);
  console.log(`🔗 Chain: Smart Bitcoin Cash Testnet (Chain ID: ${BCH_CHAIN_ID})`);
  console.log(`💰 Token: ${TOKEN_CONTRACT_ADDR}`);
  console.log(`🔒 Escrow Contract: ${ESCROW_CONTRACT_ADDR || "NOT SET — deploy via Remix and set ESCROW_CONTRACT_ADDRESS in .env"}`);
});
