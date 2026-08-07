import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const ResultAnalyzerSchema = z.object({
  status: z.enum(['pass', 'fail']),
  title: z.string(),
  expected: z.string(),
  actual: z.string(),
  explanation: z.string(),
});

export type ResultAnalyzerOutput = z.infer<typeof ResultAnalyzerSchema>;

export async function analyzeResults(artifacts: { logs: string, network: string, errorMessage?: string }): Promise<ResultAnalyzerOutput> {
  const systemPrompt = `You are result-analyzer, an AI agent that analyzes UI test execution artifacts.
You output strictly JSON conforming to this schema:
{
  "status": "pass" | "fail",
  "title": string,
  "expected": string,
  "actual": string,
  "explanation": string
}
Evaluate the provided console logs, network logs, and any execution errors to determine if the test passed or failed.`;

  const msg = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Logs: ${artifacts.logs}\nNetwork: ${artifacts.network}\nError: ${artifacts.errorMessage || 'None'}`
      }
    ],
  });

  const content = msg.content[0].type === 'text' ? msg.content[0].text : '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in response');

  return ResultAnalyzerSchema.parse(JSON.parse(jsonMatch[0]));
}
