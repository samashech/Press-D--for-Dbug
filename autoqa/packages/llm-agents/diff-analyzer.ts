import { GoogleGenAI, Type, Schema } from '@google/genai';
import { z } from 'zod';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export const DiffAnalyzerSchema = z.object({
  featureName: z.string(),
  description: z.string(),
});

export type DiffAnalyzerOutput = z.infer<typeof DiffAnalyzerSchema>;

const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    featureName: { type: Type.STRING },
    description: { type: Type.STRING },
  },
  required: ['featureName', 'description'],
};

export async function analyzeDiff(diffText: string): Promise<DiffAnalyzerOutput> {
  const systemPrompt = `You are diff-analyzer, an AI agent that analyzes git diffs to detect new features or changes.
You output strictly JSON. Write a short, clear 'featureName' and a plain English 'description' of the change that a developer would use to instruct a tester (e.g., 'test the new checkout flow').
If the diff contains minor fixes, describe what needs to be verified.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Git Diff:\n${diffText}`,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: 'application/json',
      responseSchema: responseSchema,
    }
  });

  const analysis = response.text;
  if (!analysis) throw new Error('No JSON found in response');

  return DiffAnalyzerSchema.parse(JSON.parse(analysis));
}
