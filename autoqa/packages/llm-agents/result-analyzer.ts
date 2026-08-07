import OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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
You output strictly JSON. Evaluate the provided console logs, network logs, and any execution errors to determine if the test passed or failed.`;

  const response = await openai.beta.chat.completions.parse({
    model: 'gpt-4o', // or another compatible model
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Logs: ${artifacts.logs}\nNetwork: ${artifacts.network}\nError: ${artifacts.errorMessage || 'None'}` },
    ],
    response_format: zodResponseFormat(ResultAnalyzerSchema, "result_analysis"),
  });

  const analysis = response.choices[0].message.parsed;
  if (!analysis) throw new Error('No JSON found in response');

  return analysis;
}
