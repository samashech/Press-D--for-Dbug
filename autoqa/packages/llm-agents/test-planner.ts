import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { LLMProvider, Message } from './providers/types';
import { convertMcpTools } from './providers/mcp-converter';
import { getRoleProvider } from './providers/factory';

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
  throw new Error("generateTestPlan is deprecated. Use executeTestAutonomous.");
}

export async function executeTestAutonomous(
  testRunId: string, 
  instruction: string, 
  url: string,
  provider?: LLMProvider
): Promise<{ screenshotPath: string, usages?: any[] }> {
  console.log(`Starting autonomous execution for test run ${testRunId}...`);
  
  if (!provider) {
    provider = getRoleProvider('testPlanner');
  }
  console.log(`Using provider: ${provider.name}`);

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
  const tools = convertMcpTools(mcpToolsList);

  const systemPrompt = `You are an autonomous UI testing agent. Your task is to verify a feature by interacting with the browser.
Instruction: ${instruction}
Target URL: ${url}

Start by using 'playwright_navigate' to the target URL.
Then inspect the DOM, click, fill, or evaluate to accomplish the task.
You have a maximum of 10 actions.
Once you have verified the instruction or are absolutely stuck, call 'playwright_screenshot' as your FINAL step to take a screenshot and end the execution.`;

  const MAX_TURNS = 10;
  const TIMEOUT_MS = 60000;
  
  const startTime = Date.now();
  let currentTurn = 0;
  let isDone = false;
  let noProgressTurns = 0;
  const MAX_NO_PROGRESS = 2; // configurable number of turns
  
  const usageByProvider: Record<string, { provider: string, model: string, promptTokens: number, completionTokens: number }> = {};

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Begin task. Go to ${url}` }
  ];

  try {
    while (!isDone) {
      if (currentTurn >= MAX_TURNS) {
        throw new Error(`Max turns (${MAX_TURNS}) reached without taking a screenshot.`);
      }
      
      if (Date.now() - startTime > TIMEOUT_MS) {
        throw new Error(`Wall-clock timeout of ${TIMEOUT_MS}ms exceeded.`);
      }

      currentTurn++;
      
      const configPath = path.join(process.cwd(), 'autoqa.config.json');
      let escalateToCloud = false;
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          escalateToCloud = !!config.escalateToCloud;
        } catch(e) {}
      }

      let escalate = escalateToCloud && (noProgressTurns >= MAX_NO_PROGRESS);
      if (escalate) {
        console.log(chalk.yellow(`Agent stuck for ${noProgressTurns} turns. Escalating to cloud provider for this step...`));
      }

      console.log(`[Turn ${currentTurn}] Sending message to AI...`);
      
      let response;
      try {
        response = await provider.generate({ 
          messages, 
          tools, 
          forceFallback: escalate 
        });
      } catch (err: any) {
        if (err.message.includes('forceFallback requested but no fallback providers')) {
          // Escalation requested but no cloud provider configured. Just continue normally.
          console.log(chalk.yellow('Escalation requested but no fallback provider available. Continuing with primary...'));
          escalate = false;
          response = await provider.generate({ messages, tools });
        } else {
          throw err;
        }
      }
      
      const u = response.usage;
      const key = `${u.provider}-${u.model}`;
      if (!usageByProvider[key]) {
        usageByProvider[key] = { provider: u.provider || 'unknown', model: u.model || 'unknown', promptTokens: 0, completionTokens: 0 };
      }
      usageByProvider[key].promptTokens += u.promptTokens;
      usageByProvider[key].completionTokens += u.completionTokens;
      
      if (response.text) {
        console.log(`AI response: ${response.text}`);
      }

      messages.push({
        role: 'assistant',
        content: response.text || '',
        toolCalls: response.toolCalls
      });

      if (response.toolCalls && response.toolCalls.length > 0) {
        noProgressTurns = 0; // reset on progress
        for (const functionCall of response.toolCalls) {
          console.log(`AI called tool: ${functionCall.name} with args`, functionCall.args);
          
          let toolResultText = '';
          try {
            const result: any = await mcpClient.callTool({
              name: functionCall.name,
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
          }

          messages.push({
            role: 'tool',
            content: toolResultText,
            name: functionCall.name,
            toolCallId: functionCall.id
          });
        }
      } else {
        noProgressTurns++;
        if (noProgressTurns >= MAX_NO_PROGRESS && escalate) {
            // We already escalated and it still made no progress!
            console.log("Cloud provider also failed to make progress. Forcing screenshot to end.");
            await mcpClient.callTool({ name: 'playwright_screenshot', arguments: {} });
            isDone = true;
        } else {
            console.log(`AI stopped calling tools. (No progress turn ${noProgressTurns}/${MAX_NO_PROGRESS})`);
            messages.push({
              role: 'user',
              content: 'Please call a tool to make progress, or call playwright_screenshot if you have completed the instruction.'
            });
        }
      }
    }
  } finally {
    await mcpClient.close();
  }
  
  const artifactsDir = path.join(process.cwd(), 'artifacts', testRunId);
  
  const usageArray = Object.values(usageByProvider);

  return { 
    screenshotPath: path.join(artifactsDir, 'final.png'),
    logs: '',
    network: '',
    usages: usageArray
  };
}
