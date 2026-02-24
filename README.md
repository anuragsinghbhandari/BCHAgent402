# Agent402 — AI Agent Marketplace with x402 Payments on Bitcoin Cash

> **Machine-to-machine commerce powered by BCH chipnet.** AI agents autonomously discover, pay for, and execute tools using the x402 HTTP payment protocol — no wallets, no sign-in, no API keys needed from end users.

---

## 🎥 What Is This?

Agent402 is a full-stack application that lets an AI agent (powered by Gemini) autonomously:
1. **Discover** monetized tools from a decentralized marketplace
2. **Execute** tools — getting results before any payment is charged
3. **Pay** using native tBCH on BCH chipnet if the tool succeeded
4. **Verify** every transaction on the BCH chipnet block explorer

The system implements the **x402 protocol** — an open standard for HTTP 402 "Payment Required" flows — adapted for Bitcoin Cash chipnet (native BCH testnet).

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **Execute-First / Pay-to-Claim** | Tools run before payment. Failed tools = zero cost to the agent |
| **Native BCH Payments** | No EVM, no gas, no smart contracts. Direct tBCH transfer on chipnet |
| **Worker Wallet Pool** | 4 parallel worker wallets funded on-demand from the agent wallet |
| **Live USD Pricing** | Tool prices set in USD, converted to tBCH at live BCH/USD rate |
| **Gemini AI** | AI chat + tool selection powered by `gemini-2.5-flash` |
| **Groq TTS** | Audio tool generation via `canopylabs/orpheus-v1-english` |
| **On-chain Receipts** | Every paid call generates a BCH tx hash verifiable on chipnet |
| **Marketplace** | Register, browse, and monetize any API or JavaScript code as a tool |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENT PAY FRONTEND                         │
│   (Vite + React, runs in  browser)                           │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Agent       │  │  Gemini AI   │  │  BCH Wallet Layer    │ │
│  │ Interface   │→ │  geminiService│→ │                      │ │
│  │             │  │  (tool calls)│  │  AgentWallet         │ │
│  └─────────────┘  └──────────────┘  │  BchChannelManager   │ │
│                         │            │  WorkerPool (x4)     │ │
│                         ▼            └──────────────────────┘ │
│                   toolWorker.js              │                 │
│                   (Web Worker)               │                 │
└─────────────────────────────────────────────│─────────────────┘
                          │                   │
          HTTP POST /tools/<name>    tBCH payment (mainnet-js)
                          │                   │
┌─────────────────────────▼───────────────────▼─────────────────┐
│                    MARKETPLACE BACKEND                          │
│                    (Node.js + Express)                          │
│                                                                 │
│  1. Receives tool request                                       │
│  2. Executes tool (proxy URL or stored JS code)                 │
│  3. If success → caches result (5 min) + issues HTTP 402       │
│  4. If fail    → returns error, NO payment required            │
│  5. Client pays tBCH → sends tx hash + resultId               │
│  6. Backend verifies tx on BCH chipnet → delivers result       │
│                                                                 │
│  ┌────────────┐  ┌──────────┐  ┌─────────────┐               │
│  │  Express   │  │ MongoDB  │  │  Gemini API │               │
│  │  Routes    │  │ (Tools   │  │  /gemini/   │               │
│  │            │  │  DB)     │  │  chat       │               │
│  └────────────┘  └──────────┘  └─────────────┘               │
└─────────────────────────────────────────────────────────────────┘
                          │
              BCH Chipnet (native testnet)
              chipnet.imaginary.cash
```

---

## 💸 Payment Flow (Execute-First / Pay-to-Claim)

```
Agent                     Backend                    BCH Chipnet
  │                          │                            │
  │── POST /tools/get_weather─▶│                            │
  │                          │── Execute tool ──────────── │
  │                          │◀─ Tool result (OK) ──────── │
  │                          │── Cache result (5 min TTL)   │
  │◀── HTTP 402 (resultId + payment address + price) ───── │
  │                          │                            │
  │── Send tBCH ─────────────────────────────────────────▶│
  │◀─ txHash ────────────────────────────────────────────▶│
  │                          │                            │
  │── POST /tools/get_weather─▶│                            │
  │   X-Payment-Tx: txHash   │── Verify tx on chipnet ──▶ │
  │   X-Result-Id: resultId  │◀─ Confirmed ─────────────── │
  │                          │── Return cached result       │
  │◀── 200 OK + data ─────── │                            │
```

**Refund guarantee**: If the tool fails in step 2, the backend returns an error immediately and **no 402 is ever issued** — the agent is never charged.

---

## 📁 Project Structure

```
BCHAgent402/
├── AgentPayFrontend/              # React + Vite frontend
│   └── src/
│       ├── pages/
│       │   ├── Landing.jsx        # Landing page
│       │   ├── AgentInterface.jsx # Main chat + payment UI
│       │   ├── Marketplace.jsx    # Browse tools
│       │   └── AddTool.jsx        # Register new tool
│       ├── services/
│       │   ├── geminiService.js   # Gemini AI + tool orchestration
│       │   ├── BchChannelManager.js # Agent wallet + worker funding
│       │   ├── workerPool.js      # x402 payment execution
│       │   ├── agentWallet.js     # BCH HD wallet (mainnet-js)
│       │   └── priceService.js    # BCH/USD live rate (CoinGecko)
│       ├── workers/
│       │   └── toolWorker.js      # Web Worker for HTTP tool calls
│       └── config/
│           └── chipnet.js         # BCH chipnet thresholds & config
│
├── MarketplaceBackend/            # Node.js + Express backend
│   ├── market.js                  # Main server (x402 middleware + routes)
│   ├── models/Tool.js             # Mongoose tool schema
│   ├── user_tools/                # Stored JS code tools (auto-generated)
│   │   ├── get_weather.js
│   │   ├── get_audio.js           # Groq TTS (Orpheus)
│   │   ├── adzuna_search_jobs.js
│   │   └── ...
│   └── .env                       # Environment variables (see below)
│
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- MongoDB Atlas account (or local MongoDB)
- Gemini API key → [aistudio.google.com](https://aistudio.google.com/app/apikey)
- Groq API key (for audio tools) → [console.groq.com](https://console.groq.com)
- tBCH from faucet → [tbch.googol.cash](https://tbch.googol.cash)

---

### 1. Clone & Install

```bash
git clone https://github.com/anuragsinghbhandari/BCHAgent402.git
cd BCHAgent402

# Install backend dependencies
cd MarketplaceBackend && npm install

# Install frontend dependencies
cd ../AgentPayFrontend && npm install
```

---

### 2. Configure Backend Environment

Create `MarketplaceBackend/.env`:

```env
# MongoDB connection
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster0.mongodb.net/?retryWrites=true&w=majority

# AI keys
GEMINI_API_KEY=AIza...          # Required for AI chat
GROQ_API_KEY=gsk_...            # Required for get_audio tool (Orpheus TTS)

# BCH chipnet — payments go to this address
# Must be a valid bchtest: cashaddr. Get tBCH from https://tbch.googol.cash
TOOL_PROVIDER_ADDR=bchtest:q...

# Default tool price in USD (converted to tBCH at live rate)
DEFAULT_TOOL_PRICE_USD=0.05
```

> ⚠️ **`TOOL_PROVIDER_ADDR`** must be a valid BCH chipnet cashaddr (`bchtest:q...`). If left blank, tools run in **free mode** (no payment collected) — useful for testing.

---

### 3. Start the Backend

```bash
cd MarketplaceBackend
node market.js
```

Output:
```
🚀 BCH Agent402 Tool Server running on port 3000
⛓  Network: BCH chipnet
💸 Tool provider BCH addr: bchtest:q...
💰 Default tool price: $0.05 USD (≈ BCH at live rate)
🔍 Explorer: https://chipnet.imaginary.cash/tx/
[PriceService] BCH = $485.00 USD
Connected to MongoDB
[Persistence] Loaded 11 custom tools from MongoDB.
```

---

### 4. Start the Frontend

```bash
cd AgentPayFrontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

### 5. Fund the Agent Wallet & Start Using

1. Open the **Agent Interface** tab
2. Copy your **Agent Wallet address** (`bchtest:q...`) from the wallet panel
3. Send tBCH to it from the [faucet](https://tbch.googol.cash)
4. Wait for the 4 worker wallets to auto-prefund (~0.001 tBCH each)
5. Ask the AI anything — e.g. *"What's the weather in London?"*

---

## 🛠️ Available Tools (Default)

| Tool | Type | Description | Price |
|---|---|---|---|
| `get_weather` | Code | Current weather for a city | $0.01 USD |
| `get_weather1/2/3` | Code | Weather variants | $0.01 USD |
| `get_audio` | Code | TTS via Groq Orpheus v1 | $0.01 USD |
| `adzuna_search_jobs` | Code | Job search via Adzuna API | $0.05 USD |
| `adzuna_get_categories` | Code | Job categories by country | $0.05 USD |
| `adzuna_top_companies` | Code | Top hiring companies | $0.05 USD |
| `adzuna_salary_histogram` | Code | Salary distribution data | $0.05 USD |
| `adzuna_salary_history` | Code | Historical salary trends | $0.05 USD |
| `adzuna_geodata` | Code | Location/geo data | $0.05 USD |

### Registering a Custom Tool

Go to **Add Tool** in the UI, or `POST /tools/register`:

```json
{
  "name": "my_tool",
  "description": "What this tool does (shown to the AI)",
  "price": "0.05",
  "type": "code",
  "code": "export default async function({ query }) { return { result: 'Hello ' + query }; }",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "The input query" }
    },
    "required": ["query"]
  },
  "walletAddress": "bchtest:q..."
}
```

Or use `"type": "proxy"` with a `"targetUrl"` to proxy any existing REST API.

---

## ⚙️ BCH Chipnet Configuration

Edit `AgentPayFrontend/src/config/chipnet.js`:

| Setting | Default | Description |
|---|---|---|
| `WORKER_COUNT` | `4` | Number of parallel worker wallets |
| `WORKER_TOPUP_AMOUNT` | `0.001 BCH` | How much to fund each worker |
| `AGENT_MIN_RESERVE` | `0.001 BCH` | Minimum agent wallet balance to keep |
| `MIN_BCH_FOR_TOOLS` | `0.0005 BCH` | Minimum worker balance before refund |

---

## 🔍 Verify Transactions

Every successful paid tool call displays a **View on Chipnet** link in the Tool Executions panel:

```
Tx Hash:  🔍 View on Chipnet   abc123def456…ef6789   0.000104 tBCH
```

→ Opens `https://chipnet.imaginary.cash/tx/<txHash>`

---

## 🧠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, React Router 7 |
| AI | Google Gemini `gemini-2.5-flash` |
| Audio TTS | Groq `canopylabs/orpheus-v1-english` |
| BCH Wallet | `mainnet-js` (chipnet) |
| Payment Protocol | x402 (HTTP 402) |
| Backend | Node.js, Express 5 |
| Database | MongoDB + Mongoose |
| Price Feed | CoinGecko API (BCH/USD) |

---

## 🔧 API Reference

### Backend Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/tools` | List all registered tools |
| `POST` | `/tools/register` | Register a new tool |
| `POST` | `/tools/:name` | Call a tool (triggers x402 flow) |
| `POST` | `/gemini/chat` | AI chat with tool calling |
| `GET` | `/health` | Health check |

### x402 Payment Headers

When a client has payment ready (second request after paying):

```http
POST /tools/get_weather
Content-Type: application/json
X-Payment-Tx: <bch_txhash>
X-Payment: <base64_encoded_payment_payload>
X-Result-Id: <uuid_from_402_response>
```

---

## 🛡️ Refund Safety

Agent402 uses the **Execute-First / Pay-to-Claim** model:

```
Tool FAILS → Error returned → No 402 issued → Agent NOT charged ✓
Tool PASSES → Result cached → 402 issued → Agent pays → Result claimed ✓
Payment sent but result expires (>5 min) → Tool auto-retried for free ✓
```

This replaces traditional escrow smart contracts with a pure code-based guarantee — no on-chain contracts, no deployment cost.

---

## 🧪 Testing

```bash
# Test a tool call (no payment in free mode)
curl -X POST http://localhost:3000/tools/get_weather \
  -H "Content-Type: application/json" \
  -d '{"location": "London"}'

# Expected in free mode: { "success": true, "data": { "temperature": "...", ... } }
# Expected with payments: HTTP 402 with resultId and payTo
```

---

## 📝 Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `GEMINI_API_KEY` | ✅ | Google AI Studio key |
| `GROQ_API_KEY` | For audio | Groq console key (for get_audio tool) |
| `TOOL_PROVIDER_ADDR` | For payments | BCH chipnet cashaddr for receiving payments |
| `DEFAULT_TOOL_PRICE_USD` | Optional | Default tool price in USD (default: `0.05`) |

---

## 📄 License

MIT — see [LICENSE](./LICENSE)

---

## 🙏 Built With

- [x402 Protocol](https://x402.org) — HTTP 402 payment standard
- [mainnet-js](https://mainnet.cash) — BCH JavaScript SDK
- [BCH Chipnet](https://chipnet.imaginary.cash) — Bitcoin Cash testnet
- [Google Gemini](https://ai.google.dev) — AI inference
- [Groq](https://groq.com) — Ultra-fast LLM + audio inference
- [CoinGecko](https://coingecko.com) — BCH/USD live pricing
