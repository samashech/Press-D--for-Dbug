import { GoogleGenAI, Type, Schema } from '@google/genai';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from 'zod';
import path from 'path';
import fs from 'fs';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export const TestPlanSchema = z.object({
  steps: z.array(z.object({
    action: z.enum(['navigate', 'click', 'fill', 'wait', 'assert']),
    selector: z.string().optional(),
    value: z.string().optional(),
    description: z.string(),
  })),
});

export type TestPlan = z.infer<typeof TestPlanSchema>;

export async function generateTestPlan(instruction: string, url: string): Promise<TestPlan> {
  // Legacy method for compatibility if needed.
  throw new Error("generateTestPlan is deprecated. Use executeTestAutonomous.");
}

export async function executeTestAutonomous(testRunId: string, instruction: string, url: string): Promise<{ screenshotPath: string }> {
  console.log(`Starting autonomous execution for test run ${testRunId}...`);
  
  // 1. Initialize MCP Client
  const mcpServerPath = path.join(__dirname, '..', 'test-executor', 'mcp-server.ts');
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", mcpServerPath],
    env: {
      ...process.env,
      TEST_RUN_ID: testRunId
    }
  });
  
  const mcpClient = new Client({ name: "autoqa-agent", version: "1.0.0" }, { capabilities: {} });
  await mcpClient.connect(transport);
  
  const mcpToolsList = await mcpClient.listTools();
  
  const functionDeclarations = mcpToolsList.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.inputSchema as any,
  }));

  const systemPrompt = `You are an autonomous UI testing agent. Your task is to verify a feature by interacting with the browser.
Instruction: ${instruction}
Target URL: ${url}

Start by using 'playwright_navigate' to the target URL.
Then inspect the DOM, click, fill, or evaluate to accomplish the task.
You have a maximum of 10 actions.
Once you have verified the instruction or are absolutely stuck, call 'playwright_screenshot' as your FINAL step to take a screenshot and end the execution.`;

  const chat = ai.chats.create({
    model: 'gemini-3.6-flash',
    config: {
      systemInstruction: systemPrompt,
      tools: [{ functionDeclarations }],
      temperature: 0.1,
    }
  });

  const MAX_TURNS = 10;
  const TIMEOUT_MS = 60000; // 60 seconds wall-clock timeout

  const startTime = Date.now();
  let currentTurn = 0;
  let isDone = false;
  
  let currentMessage: any = `Begin task. Go to ${url}`;

  try {
    while (!isDone) {
      if (currentTurn >= MAX_TURNS) {
        throw new Error(`Max turns (${MAX_TURNS}) reached without taking a screenshot.`);
      }
      
      if (Date.now() - startTime > TIMEOUT_MS) {
        throw new Error(`Wall-clock timeout of ${TIMEOUT_MS}ms exceeded.`);
      }

      currentTurn++;
      console.log(`[Turn ${currentTurn}] Sending message to AI...`);
      
      const response = await chat.sendMessage({ message: currentMessage });
      
      if (response.functionCalls && response.functionCalls.length > 0) {
        const functionCall = response.functionCalls[0];
        console.log(`AI called tool: ${functionCall.name} with args`, functionCall.args);
        
        let toolResultText = '';
        try {
          const result: any = await mcpClient.callTool({
            name: functionCall.name!,
            arguments: functionCall.args as any
          });
          toolResultText = result.content[0].text;
          console.log(`Tool Result: ${toolResultText}`);
        } catch (err: any) {
          toolResultText = `Error executing tool: ${err.message}`;
          console.log(toolResultText);
        }
        
        if (functionCall.name === 'playwright_screenshot') {
          isDone = true;
          break;
        }

        currentMessage = [{
          functionResponse: {
            name: functionCall.name,
            response: { result: toolResultText }
          }
        }];
      } else {
        console.log(`AI response: ${response.text}`);
        // If the AI didn't call a tool, we force it to call screenshot to end.
        console.log("AI stopped calling tools. Forcing screenshot to end.");
        await mcpClient.callTool({ name: 'playwright_screenshot', arguments: {} });
        isDone = true;
      }
    }
  } finally {
    await mcpClient.close();
  }
  
  const artifactsDir = path.join(process.cwd(), 'artifacts', testRunId);
  return { 
    screenshotPath: path.join(artifactsDir, 'final.png'),
    logs: '',
    network: '' 
  };
}
