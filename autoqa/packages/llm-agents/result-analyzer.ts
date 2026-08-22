import { z } from 'zod';
import { getRoleProvider } from './providers/factory';
import { Message } from './providers/types';

export const ResultAnalyzerSchema = z.object({
  status: z.enum(['pass', 'fail']),
  title: z.string(),
  expected: z.string(),
  actual: z.string(),
  explanation: z.string(),
  likelyCause: z.string().nullable().optional(),
  reproSteps: z.array(z.string()).nullable().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(),
});

export type ResultAnalyzerOutput = z.infer<typeof ResultAnalyzerSchema> & {
  usage?: {
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
  }
};

export async function analyzeResults(artifacts: { logs: string, network: string, errorMessage?: string }): Promise<ResultAnalyzerOutput> {
  const systemPrompt = `You are result-analyzer, an AI agent that analyzes UI test execution artifacts.
You output strictly JSON. Evaluate the provided console logs, network logs, and any execution errors to determine if the test passed or failed.
If the test fails, you must provide a detailed structured Bug Report including 'likelyCause', a step-by-step array of 'reproSteps', and a 'severity' level (low, medium, high, critical).`;

  const provider = getRoleProvider('resultAnalyzer');

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Logs: ${artifacts.logs}\nNetwork: ${artifacts.network}\nError: ${artifacts.errorMessage || 'None'}` }
  ];

  const { zodToJsonSchema } = require('zod-to-json-schema');
  const responseSchema = zodToJsonSchema(ResultAnalyzerSchema, "resultSchema").definitions.resultSchema;

  const response = await provider.generate({
    messages,
    responseSchema,
  });

  const analysis = response.text;
  if (!analysis) throw new Error('No JSON found in response');

  let cleanAnalysis = analysis.trim();
  if (cleanAnalysis.startsWith('```json')) {
    cleanAnalysis = cleanAnalysis.substring(7);
  }
  if (cleanAnalysis.startsWith('```')) {
    cleanAnalysis = cleanAnalysis.substring(3);
  }
  if (cleanAnalysis.endsWith('```')) {
    cleanAnalysis = cleanAnalysis.slice(0, -3);
  }

  const result = ResultAnalyzerSchema.parse(JSON.parse(cleanAnalysis.trim()));
  return {
    ...result,
    usage: {
      provider: provider.name,
      model: (provider as any).model || 'unknown',
      promptTokens: response.usage?.promptTokens || 0,
      completionTokens: response.usage?.completionTokens || 0
    }
  };
}
