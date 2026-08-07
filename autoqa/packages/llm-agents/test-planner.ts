import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
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
  const systemPrompt = `You are test-planner, an AI agent that converts developer instructions into a structured UI test plan.
You output strictly JSON conforming to this schema:
{
  "steps": [
    { "action": "navigate" | "click" | "fill" | "wait" | "assert", "selector": string, "value": string, "description": string }
  ]
}
For accessibility tree / MCP interactions, use semantic roles or generic descriptions for 'selector' since actual Playwright MCP will resolve them. Make sure to always start with a 'navigate' action to the provided url.`;

  const msg = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Instruction: ${instruction}\nURL: ${url}`
      }
    ],
  });

  const content = msg.content[0].type === 'text' ? msg.content[0].text : '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in response');

  return TestPlanSchema.parse(JSON.parse(jsonMatch[0]));
}
