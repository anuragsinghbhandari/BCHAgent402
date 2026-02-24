# Agent402 — AI Agent Marketplace with x402 Payments on Bitcoin Cash

Machine-to-machine commerce powered by BCH chipnet. AI agents autonomously discover, pay for, and execute tools using the x402 HTTP payment protocol — no wallets, no sign-in, no API keys needed from end users.

---

## What Is This?

Agent402 is a full-stack application that lets an AI agent (powered by Gemini) autonomously:

1. **Discover** monetized tools from a decentralized marketplace
2. **Execute** tools — getting results before any payment is charged
3. **Pay** using native tBCH on BCH chipnet if the tool succeeded
4. **Verify** every transaction on the BCH chipnet block explorer

The system implements the **x402 protocol** — an open standard for HTTP 402 "Payment Required" flows — adapted for Bitcoin Cash chipnet (native BCH testnet).

---

## Key Features

| Feature | Description |
|---|---|
| Execute-First / Pay-to-Claim | Tools run before payment. Failed tools = zero cost to the agent |
| Native BCH Payments | No EVM, no gas, no smart contracts. Direct tBCH transfer on chipnet |
| Worker Wallet Pool | 4 parallel worker wallets funded on-demand from the agent wallet |
| Live USD Pricing | Tool prices set in USD, converted to tBCH at live BCH/USD rate |
| Gemini AI | AI chat and tool selection powered by `gemini-2.5-flash` |
| Groq TTS | Audio generation via `canopylabs/orpheus-v1-english` |
| On-chain Receipts | Every paid call generates a BCH tx hash verifiable on chipnet |
| Marketplace | Register, browse, and monetize any API or JavaScript code as a tool |

---

## Architecture

```
+-----------------------------------------------------------+
|                    AGENT PAY FRONTEND                     |
|   (Vite + React, runs in browser)                         |
|                                                           |
|  AgentInterface  -->  geminiService  -->  BchChannelMgr   |
|                        (tool calls)       AgentWallet     |
|                             |             WorkerPool (x4) |
|                        toolWorker.js            |         |
+---------------------------------------------|------------+
                       |                       |
       HTTP POST /tools/<name>         tBCH payment
                       |                       |
+---------------------------MARKETPLACE BACKEND-------------+
|  1. Receive tool request                                  |
|  2. Execute tool (proxy URL or stored JS code)            |
|  3. Success -> cache result (5 min) + issue HTTP 402      |
|  4. Failure -> return error, no payment required          |
|  5. Client pays tBCH -> sends tx hash + resultId          |
|  6. Backend verifies tx on BCH chipnet -> deliver result  |
+-----------------------------------------------------------+
                       |
            BCH Chipnet (native testnet)
            chipnet.imaginary.cash
```

---

## Payment Flow (Execute-First / Pay-to-Claim)

```
Agent                       Backend                  BCH Chipnet
  |                            |                         |
  |-- POST /tools/get_weather ->|                         |
  |                            |-- Execute tool -------> |
  |                            |<- Tool result (OK) ---- |
  |                            |-- Cache result (5 min)  |
  |<-- HTTP 402 (resultId + payTo + price) ------------- |
  |                            |                         |
  |-- Send tBCH --------------------------------------------->|
  |<-- txHash ------------------------------------------------ |
  |                            |                         |
  |-- POST /tools/get_weather ->|                         |
  |   X-Payment-Tx: txHash     |-- Verify tx ----------->|
  |   X-Result-Id: resultId    |<- Confirmed ------------|
  |                            |-- Return cached result  |
  |<-- 200 OK + data --------- |                         |
```

**Refund guarantee**: If the tool fails in step 2, the backend returns an error and no 402 is ever issued — the agent is never charged.

---

## Project Structure

```
BCHAgent402/
|-- AgentPayFrontend/
|   `-- src/
|       |-- pages/
|       |   |-- Landing.jsx              Landing page
|       |   |-- AgentInterface.jsx       Main chat + payment UI
|       |   |-- Marketplace.jsx          Browse tools
|       |   `-- AddTool.jsx              Register new tool
|       |-- services/
|       |   |-- geminiService.js         Gemini AI + tool orchestration
|       |   |-- BchChannelManager.js     Agent wallet + worker funding
|       |   |-- workerPool.js            x402 payment execution
|       |   |-- agentWallet.js           BCH HD wallet (mainnet-js)
|       |   `-- priceService.js          BCH/USD live rate (CoinGecko)
|       |-- workers/
|       |   `-- toolWorker.js            Web Worker for HTTP tool calls
|       `-- config/
|           `-- chipnet.js               BCH chipnet thresholds and config
|
`-- MarketplaceBackend/
    |-- market.js                        Main server (x402 middleware + routes)
    |-- models/Tool.js                   Mongoose tool schema
    |-- user_tools/                      Stored JS code tools (auto-generated)
    |   |-- get_weather.js
    |   |-- get_audio.js                 Groq TTS (Orpheus)
    |   |-- adzuna_search_jobs.js
    |   `-- ...
    `-- .env                             Environment variables
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB Atlas account (or local MongoDB)
- Gemini API key: https://aistudio.google.com/app/apikey
- Groq API key (for audio tools): https://console.groq.com
- tBCH from faucet: https://tbch.googol.cash

### 1. Clone and Install

```bash
git clone https://github.com/anuragsinghbhandari/BCHAgent402.git
cd BCHAgent402

cd MarketplaceBackend && npm install
cd ../AgentPayFrontend && npm install
```

### 2. Configure Backend

Create `MarketplaceBackend/.env`:

```env
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster0.mongodb.net/?retryWrites=true&w=majority

GEMINI_API_KEY=AIza...
GROQ_API_KEY=gsk_...

# BCH chipnet cashaddr — payments sent here
# Leave blank to run in free mode (no payment collected)
TOOL_PROVIDER_ADDR=bchtest:q...

# Default tool price in USD (converted to tBCH at live rate)
DEFAULT_TOOL_PRICE_USD=0.05
```

### 3. Start the Backend

```bash
cd MarketplaceBackend
node market.js
```

### 4. Start the Frontend

```bash
cd AgentPayFrontend
npm run dev
```

Open http://localhost:5173

### 5. Fund the Agent Wallet

1. Open the Agent Interface tab
2. Copy your Agent Wallet address (`bchtest:q...`) from the wallet panel
3. Send tBCH from the faucet: https://tbch.googol.cash
4. Worker wallets auto-prefund (~0.001 tBCH each)
5. Ask the AI anything — e.g. "What is the weather in London?"

---

## Available Tools

| Tool | Description | Price |
|---|---|---|
| `get_weather` | Current weather for a city | $0.01 USD |
| `get_audio` | Text-to-speech via Groq Orpheus | $0.01 USD |
| `adzuna_search_jobs` | Job search via Adzuna API | $0.05 USD |
| `adzuna_get_categories` | Job categories by country | $0.05 USD |
| `adzuna_top_companies` | Top hiring companies | $0.05 USD |
| `adzuna_salary_histogram` | Salary distribution data | $0.05 USD |
| `adzuna_salary_history` | Historical salary trends | $0.05 USD |
| `adzuna_geodata` | Location and geo data | $0.05 USD |

### Register a Custom Tool

```bash
curl -X POST http://localhost:3000/tools/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my_tool",
    "description": "What this tool does (shown to the AI)",
    "price": "0.05",
    "type": "code",
    "code": "export default async function({ query }) { return { result: '\''Hello '\'' + query }; }",
    "parameters": {
      "type": "object",
      "properties": {
        "query": { "type": "string", "description": "The input query" }
      },
      "required": ["query"]
    },
    "walletAddress": "bchtest:q..."
  }'
```

Use `"type": "proxy"` with `"targetUrl"` to proxy an existing REST API.

---

## BCH Configuration

Edit `AgentPayFrontend/src/config/chipnet.js`:

| Setting | Default | Description |
|---|---|---|
| `WORKER_COUNT` | `4` | Number of parallel worker wallets |
| `WORKER_TOPUP_AMOUNT` | `0.001 BCH` | Amount to fund each worker |
| `AGENT_MIN_RESERVE` | `0.001 BCH` | Minimum agent wallet balance to keep |
| `MIN_BCH_FOR_TOOLS` | `0.0005 BCH` | Minimum worker balance before refund |

---

## API Reference

### Backend Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/tools` | List all registered tools |
| `POST` | `/tools/register` | Register a new tool |
| `POST` | `/tools/:name` | Call a tool (triggers x402 flow) |
| `POST` | `/gemini/chat` | AI chat with tool calling |
| `GET` | `/health` | Health check |

### x402 Payment Headers (second request after paying)

```http
POST /tools/get_weather
Content-Type: application/json
X-Payment-Tx: <bch_txhash>
X-Result-Id: <uuid_from_402_response>
```

---

## Verify Transactions

Every successful paid tool call shows a transaction link in the Tool Executions panel:

```
Tx Hash:  [View on Chipnet]   abc123def456...ef6789   0.000104 tBCH
```

Links to: `https://chipnet.imaginary.cash/tx/<txHash>`

---

## Refund Safety

```
Tool FAILS  ->  Error returned  ->  No 402 issued  ->  Agent NOT charged
Tool PASSES ->  Result cached   ->  402 issued     ->  Agent pays -> Result claimed
Result expires (> 5 min) -> Tool retried for free
```

No smart contracts. No escrow. Just code.

---

## Tech Stack

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

## Notes on get_audio Tool

The audio tool requires:
1. A valid `GROQ_API_KEY` in `.env`
2. Terms acceptance for the Orpheus model at:
   `https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english`

---

## License

MIT — see LICENSE
