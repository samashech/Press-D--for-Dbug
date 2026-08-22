import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { LLMProvider, Message, ToolDefinition, ToolCall } from './providers/types';
import { convertMcpTools } from './providers/mcp-converter';
import { getRoleProvider } from './providers/factory';
import { isElementSafe } from './guardrails';

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
      
      const configPath = path.join(process.cwd(), 'd-bug.config.json');
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

export async function executeFeatureAudit(
  testRunId: string, 
  feature: any, 
  url: string,
  provider?: LLMProvider
) {
  provider = provider || getRoleProvider('testPlanner');
  
  // Phase C: Safety Guardrails
  console.log(chalk.gray(`\nChecking safety guardrails for feature: ${feature.name}...`));
  const safeCheck = await isElementSafe({
    text: feature.name,
    selector: feature.selector || undefined
  });

  if (!safeCheck.isSafe) {
    console.log(chalk.yellow(`Skipped testing feature [${feature.name}]. Reason: ${safeCheck.reason}`));
    return { status: 'skipped', reason: safeCheck.reason, usages: [] };
  }

  // Phase D: Per-type test strategies
  let instruction = '';
  switch (feature.featureType) {
    case 'button':
      instruction = `Interact with the button at selector "${feature.selector}". First, observe the page state (URL, text). Click the button, and explicitly assert what changed (e.g., URL change, new element, or text update).`;
      break;
    case 'form':
      instruction = `Interact with the form at selector "${feature.selector}". Fill the form using SAFE, MOCK fixture data (do not use real PII or payment info). Submit it, and check for the expected success or validation behavior.`;
      break;
    case 'animation-candidate':
      instruction = `Test the animation for element "${feature.selector}". Use the 'playwright_check_animation' tool with durationMs: 500 to confirm its bounding box actually changes visibly.`;
      break;
    case 'api-endpoint':
      instruction = `Test the API endpoint "${feature.pageUrl}". Use the 'playwright_api_fetch' tool to call it directly. Verify that the response status code is 200 or appropriate.`;
      break;
    case 'llm-integration':
      instruction = `Exercise the LLM/AI integration at "${feature.selector}". Submit a benign prompt (e.g., "Hello") and verify that a response is returned within a reasonable time. Do not assert the output content, just that it functions.`;
      break;
    default:
      instruction = `Interact with the element "${feature.name}" at selector "${feature.selector}" and verify it functions correctly.`;
  }

  console.log(chalk.blue(`\nRunning Audit Test for [${feature.featureType}]: ${feature.name}`));
  console.log(chalk.gray(`Instruction: ${instruction}`));

  const result = await executeTestAutonomous(testRunId, instruction, feature.pageUrl || url, provider);
  return { ...result, status: 'verified' };
}

