import OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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
You output strictly JSON. For accessibility tree / MCP interactions, use semantic roles or generic descriptions for 'selector'. Make sure to always start with a 'navigate' action to the provided url.`;

  const response = await openai.beta.chat.completions.parse({
    model: 'gpt-4o', // or another compatible model
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Instruction: ${instruction}\nURL: ${url}` },
    ],
    response_format: zodResponseFormat(TestPlanSchema, "test_plan"),
  });

  const plan = response.choices[0].message.parsed;
  if (!plan) throw new Error('No JSON found in response');

  return plan;
}
