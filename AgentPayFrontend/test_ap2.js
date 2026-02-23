import fetch from 'node-fetch';
import { AgentIdentity, PaymentMandate } from 'agentic-payments';

// Configuration
const BASE_URL = 'http://localhost:3000';
const PAY_TO = 'GDYY2EDLYNUOG7IKSBLXMFCZNANRY7U3YTDNFGO5PKV7QWO5EU2UDXPA';

async function runTest() {
    console.log("--- Starting AP2 Verification Test ---");

    // 0. Get a valid tool
    console.log("0. Fetching available tools...");
    let tools = [];
    try {
        const toolsRes = await fetch(`${BASE_URL}/tools`);
        tools = await toolsRes.json();
    } catch (e) {
        console.error("Failed to fetch tools. Backend might be down.", e);
        // Create a dummy tool obj manually to proceed if backend is up but empty
        tools = [];
    }

    let toolName = null;

    if (!tools || tools.length === 0) {
        console.log("⚠️ No tools available in marketplace. Registering a dummy tool...");
        // Register dummy tool
        const regRes = await fetch(`${BASE_URL}/tools/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'ap2test',
                description: 'AP2 Test Tool',
                price: '10',
                type: 'code',
                code: 'export default async function(args) { return { message: "Hello AP2" }; }',
                walletAddress: PAY_TO
            })
        });
        const regData = await regRes.json();
        console.log("Registered:", regData);

        // Auto-approve
        await fetch(`${BASE_URL}/tools/ap2test/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: 'admin' })
        });
        console.log("Approved tool 'ap2test'");
        toolName = 'ap2test';
    } else {
        toolName = tools[0].name;
    }

    const TOOL_URL = `${BASE_URL}/tools/${toolName}`;
    console.log(`Using Tool: ${toolName} at ${TOOL_URL}`);

    // 1. Initial Call (Expect 402)
    console.log("1. Calling tool without auth...");
    let res = await fetch(TOOL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: 'London' })
    });

    console.log(`Initial Status: ${res.status}`);

    if (res.status === 402) {
        console.log("✅ Received 402 Payment Required");
        const text = await res.text();
        // console.log("Response Text:", text); // Uncomment to debug HTML

        let challenge;
        try {
            challenge = JSON.parse(text);
        } catch (e) {
            console.error("❌ Failed to parse JSON response. Raw text:", text);
            process.exit(1);
        }
        console.log("Challenge:", JSON.stringify(challenge, null, 2));

        const ap2Req = challenge.accepts.find(r => r.scheme === 'ap2');
        if (!ap2Req) {
            console.error("❌ No AP2 scheme found in challenge!");
            process.exit(1);
        }
        console.log("✅ AP2 Scheme confirmed.");

        // 2. Generate Mandate
        console.log("2. Generating AP2 Mandate...");
        const agent = await AgentIdentity.generate();

        const mandate = new PaymentMandate({
            sourceId: agent.did(),
            type: 'stellar_tx',
            amount: ap2Req.maxAmountRequired || 10,
            currency: 'XLM',
            paymentMethod: 'stellar',
            // Adding a mock payment hash so backend check passes
        });

        await mandate.sign(agent);
        const mandateJson = JSON.stringify(mandate.toJSON());
        const ap2Header = Buffer.from(mandateJson).toString('base64');

        // 3. Retry with Mandate + Mock X-Payment
        console.log("3. Retrying with Mandate...");
        res = await fetch(TOOL_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ap2Header}`,
                'X-Payment': 'AAAA...MOCK_XDR...==' // Backend will try to verify this with facilitator, might fail there but passes AP2 check
            },
            body: JSON.stringify({ location: 'London' })
        });

        // We expect 402 (Settlement Failed) or 200 (Success) depending on X-Payment validity
        // But getting PAST the "Missing Authorization" check is the goal.

        if (res.status === 402) {
            const error = await res.json();
            if (error.error === "Settlement Failed") {
                console.log("✅ AP2 Mandate Verified! (Settlement failed as expected with mock XDR)");
            } else {
                console.log("⚠️ AP2 Check passed but other error:", error);
            }
        } else if (res.ok) {
            console.log("✅ Full Success!");
        } else {
            console.log(`❌ Unexpected Status: ${res.status}`);
            console.log(await res.text());
        }

    } else {
        console.error(`❌ Expected 402, got ${res.status}`);
        console.log(await res.text());
    }
}

runTest().catch(console.error);
