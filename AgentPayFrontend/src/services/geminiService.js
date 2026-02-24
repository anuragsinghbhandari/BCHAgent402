import envConfig from '../config/env';


const toolDataMap = new Map();

export const wakeUpServices = async () => {
  const services = [
    envConfig.MARKETPLACE_URL
  ];

  console.log('[WakeUp] Pinging services to wake them up...');

  services.forEach(url => {
    fetch(url, { method: 'GET', mode: 'no-cors' })
      .then(() => console.log(`[WakeUp] Ping sent to ${url}`))
      .catch(err => console.warn(`[WakeUp] Failed to ping ${url}:`, err));
  });
};

const sanitizeParameters = (params) => {
  if (!params || typeof params !== 'object') {
    return {
      type: "object",
      properties: {},
      required: []
    };
  }

  const sanitized = {
    type: params.type || "object"
  };

  if (params.properties && typeof params.properties === 'object') {
    const cleanProperties = {};
    for (const [key, value] of Object.entries(params.properties)) {
      if (value && typeof value === 'object') {
        cleanProperties[key] = {
          type: value.type || "string",
          ...(value.description && { description: value.description }),
          ...(value.enum && Array.isArray(value.enum) && { enum: value.enum })
        };
      }
    }
    sanitized.properties = cleanProperties;
  } else {
    sanitized.properties = {};
  }

  if (params.required && Array.isArray(params.required)) {
    sanitized.required = params.required.filter(item => typeof item === 'string');
  }

  return sanitized;
};

export const fetchMarketplaceTools = async () => {
  try {
    const MARKETPLACE_TOOLS_URL = envConfig.MARKETPLACE_URL || "http://localhost:3000/";
    const response = await fetch(`${MARKETPLACE_TOOLS_URL}/tools`);
    if (!response.ok) {
      throw new Error(`Failed to fetch tools: ${response.status}`);
    }
    const tools = await response.json();

    console.log('Raw tools from marketplace:', tools);

    toolDataMap.clear();

    const functionDeclarations = tools.map(tool => {
      let extractedPrice = 0;
      if (tool.price !== undefined && tool.price !== null) {
        extractedPrice = parseFloat(tool.price);
      } else {
        const priceMatch = tool.description?.match(/COSTS?:\s*(\d+(?:\.\d+)?)\s*(?:USDC|XLM)/i)
          || tool.description?.match(/COSTS?:\s*(\d+(?:\.\d+)?)/i);
        extractedPrice = priceMatch ? parseFloat(priceMatch[1]) : 0;
      }

      toolDataMap.set(tool.name, {
        ...tool,
        price: extractedPrice
      });

      const llmDescription = `${tool.description.replace(/\[?Cost:.*?(SmartBCH|Testnet|TOKEN)[^\]]*\]?/gi, '').trim()} [Cost: $${extractedPrice} USD via BCH chipnet]`;

      const declaration = {
        type: "function",
        function: {
          name: tool.name,
          description: llmDescription,
          parameters: sanitizeParameters(tool.parameters)
        }
      };

      console.log(`Formatted tool: ${tool.name}, Price: ${extractedPrice} USDC`, declaration);
      return declaration;
    });

    console.log('Function declarations:', JSON.stringify(functionDeclarations, null, 2));
    return functionDeclarations;
  } catch (error) {
    console.error('Error fetching marketplace tools:', error);
    return [];
  }
};


export const callPaidTool = async (toolName, params) => {
  const { executeToolInWorker } = await import('./workerPool.js');
  const result = await executeToolInWorker(toolName, params);
  return {
    success: result.success,
    data: result.data,
    toolName,
    txHash: result.txHash,
    receipt: result.receipt,
    error: result.error,
  };
};

export const processQueryWithGemini = async (userQuery, availableTools, onProgress, chatHistory = []) => {
  try {
    onProgress?.({ step: 'analyzing', message: 'Analyzing your request with Gemini...' });

    const geminiTools = availableTools.map(t => t.function);

    const SERVER_URL = envConfig.MARKETPLACE_URL;
    const chatEndpoint = `${SERVER_URL}/gemini/chat`;

    let response = await fetch(chatEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: chatHistory,
        message: userQuery,
        tools: geminiTools
      })
    });

    if (!response.ok) {
      throw new Error(`Backend API Error: ${response.statusText}`);
    }

    let result = await response.json();


    let iterationCount = 0;
    const MAX_ITERATIONS = 5;
    const allToolsUsed = [];
    const allToolResponses = [];
    const executionDetails = [];
    let totalCost = 0;

    while (iterationCount < MAX_ITERATIONS) {

      const textResponse = result.text;
      const functionCalls = result.functionCalls;

      if (!functionCalls || functionCalls.length === 0) {
        return {
          success: true,
          finalResponse: textResponse,
          toolUsed: allToolsUsed.length > 0 ? allToolsUsed.join(', ') : null,
          toolResponses: allToolResponses,
          executionDetails: executionDetails,
          cost: totalCost
        };
      }


      console.log(`Iteration ${iterationCount + 1}: Received ${functionCalls.length} tool calls`);

      let geminiPlan = null;
      if (result.parts && result.parts.length > 0) {
        const textPart = result.parts.find(p => p.text && !p.functionCall);
        if (textPart) {
          geminiPlan = textPart.text;
        }
        const thoughtPart = result.parts.find(p => p.thought);
        if (thoughtPart) {
          geminiPlan = thoughtPart.thought;
        }
      }
      if (!geminiPlan && result.text) {
        geminiPlan = result.text;
      }

      if (geminiPlan) {
        onProgress?.({
          step: 'planning_complete',
          message: 'Plan established.',
          plan: geminiPlan,
          toolsParam: functionCalls.map(c => c.name)
        });
      }

      const { executeToolInWorker } = await import('./workerPool.js');

      const executionPromises = functionCalls.map(async (call, index) => {
        const functionName = call.name;
        const functionArgs = call.args;
        const reasoning = (index === 0) ? geminiPlan : null;

        allToolsUsed.push(functionName);

        const toolData = toolDataMap.get(functionName);
        const toolPrice = toolData?.price || 0;
        totalCost += parseFloat(toolPrice);

        const workerResult = await executeToolInWorker(
          functionName,
          functionArgs,
          (progress) => onProgress?.(progress)
        );

        const toolResponse = workerResult;

        // Use USD price from toolData for display; BCH amount is toolResponse.amountBCH
        let finalCost = toolPrice;  // USD price

        executionDetails.push({
          toolName: functionName,
          args: functionArgs,
          reasoning: reasoning,
          cost: finalCost,
          txHash: toolResponse.txHash || null,
          explorerUrl: toolResponse.txHash
            ? `https://chipnet.imaginary.cash/tx/${toolResponse.txHash}`
            : null,
          amountBCH: toolResponse.amountBCH || null,
          receipt: toolResponse.receipt,
          output: toolResponse.data || toolResponse.error,
          status: toolResponse.success ? 'success' : 'failed'
        });

        if (!toolResponse.success) {
          onProgress?.({
            step: 'tool_failed',
            message: `Tool ${functionName} failed: ${toolResponse.error}`,
            toolName: functionName,
            error: toolResponse.error
          });

          return {
            functionResponse: {
              name: functionName,
              response: {
                result: {
                  status: "failed",
                  error: toolResponse.error,
                  message: "This tool call failed. Do not retry unless parameters were wrong."
                }
              }
            }
          };
        }

        const toolOutput = toolResponse.data;

        if (toolOutput) {
          allToolResponses.push(toolOutput);
        }

        let responseForGemini = { result: toolOutput };
        if (toolOutput && toolOutput.type === 'audio') {
          responseForGemini = {
            result: {
              status: "success",
              message: "Audio generated successfully and is being played to the user."
            }
          };
        }

        return {
          functionResponse: {
            name: functionName,
            response: responseForGemini
          }
        };
      });

      const functionResponses = await Promise.all(executionPromises);

      onProgress?.({ step: 'generating_response', message: 'Sending tool outputs to AI...' });

      if (iterationCount === 0) {
        chatHistory.push({ role: 'user', parts: [{ text: userQuery }] });
      }

      const modelParts = result.parts || functionCalls.map(fc => ({
        functionCall: {
          name: fc.name,
          args: fc.args
        }
      }));

      chatHistory.push({
        role: 'model',
        parts: modelParts
      });

      chatHistory.push({
        role: 'function',
        parts: functionResponses.map(fr => ({
          functionResponse: {
            name: fr.functionResponse.name,
            response: fr.functionResponse.response
          }
        }))
      });

      const nextMessageParts = functionResponses.map(fr => ({
        functionResponse: {
          name: fr.functionResponse.name,
          response: fr.functionResponse.response
        }
      }));

      response = await fetch(chatEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: chatHistory,
          message: { parts: nextMessageParts },
          tools: geminiTools
        })
      });

      result = await response.json();

      iterationCount++;
    }

    let stopMsg = "\n\n(Stopped after maximum execution steps)";
    const pendingTools = result.functionCalls?.map(fc => fc.name).join(', ');
    if (pendingTools) {
      stopMsg += `\nPending tools not executed: ${pendingTools}`;
    }

    return {
      success: true,
      finalResponse: (result.text || "") + stopMsg,
      toolUsed: allToolsUsed.join(', '),
      toolResponses: allToolResponses,
      executionDetails: executionDetails,
      cost: totalCost
    };

  } catch (error) {
    console.error('Error processing query with Gemini:', error);
    return {
      success: false,
      finalResponse: error.message
    };
  }
};
