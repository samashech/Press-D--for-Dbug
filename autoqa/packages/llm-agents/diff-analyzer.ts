import { z } from 'zod';
import { getRoleProvider } from './providers/factory';
import { Message } from './providers/types';

export const DiffAnalyzerSchema = z.object({
  featureName: z.string(),
  description: z.string(),
});

export type DiffAnalyzerOutput = z.infer<typeof DiffAnalyzerSchema> & {
  usage?: {
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
  }
};

export async function analyzeDiff(diffText: string): Promise<DiffAnalyzerOutput> {
  const systemPrompt = `You are diff-analyzer, an AI agent that analyzes git diffs to detect new features or changes.
You output strictly JSON. Write a short, clear 'featureName' and a plain English 'description' of the change that a developer would use to instruct a tester (e.g., 'test the new checkout flow').
If the diff contains minor fixes, describe what needs to be verified.`;

  const provider = getRoleProvider('diffAnalyzer');

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Git Diff:\n${diffText}` }
  ];

  // We convert the zod schema to json schema using zod-to-json-schema
  const { zodToJsonSchema } = require('zod-to-json-schema');
  const responseSchema = zodToJsonSchema(DiffAnalyzerSchema, "diffSchema").definitions.diffSchema;

  const response = await provider.generate({
    messages,
    responseSchema,
    validate: (res) => {
      const analysis = res.text;
      if (!analysis) throw new Error('No JSON found in response');

      let cleanAnalysis = analysis.trim();
      if (cleanAnalysis.startsWith('```json')) cleanAnalysis = cleanAnalysis.substring(7);
      if (cleanAnalysis.startsWith('```')) cleanAnalysis = cleanAnalysis.substring(3);
      if (cleanAnalysis.endsWith('```')) cleanAnalysis = cleanAnalysis.slice(0, -3);

      // This throws if parsing fails
      DiffAnalyzerSchema.parse(JSON.parse(cleanAnalysis.trim()));
    }
  });

  const analysis = response.text!;
  let cleanAnalysis = analysis.trim();
  if (cleanAnalysis.startsWith('```json')) cleanAnalysis = cleanAnalysis.substring(7);
  if (cleanAnalysis.startsWith('```')) cleanAnalysis = cleanAnalysis.substring(3);
  if (cleanAnalysis.endsWith('```')) cleanAnalysis = cleanAnalysis.slice(0, -3);

  const result = DiffAnalyzerSchema.parse(JSON.parse(cleanAnalysis.trim()));
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
