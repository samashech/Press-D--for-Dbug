import { GoogleGenAI, Type, Schema } from '@google/genai';
import { z } from 'zod';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export const ResultAnalyzerSchema = z.object({
  status: z.enum(['pass', 'fail']),
  title: z.string(),
  expected: z.string(),
  actual: z.string(),
  explanation: z.string(),
});

export type ResultAnalyzerOutput = z.infer<typeof ResultAnalyzerSchema>;

const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    status: { type: Type.STRING, enum: ['pass', 'fail'] },
    title: { type: Type.STRING },
    expected: { type: Type.STRING },
    actual: { type: Type.STRING },
    explanation: { type: Type.STRING },
  },
  required: ['status', 'title', 'expected', 'actual', 'explanation'],
};

export async function analyzeResults(artifacts: { logs: string, network: string, errorMessage?: string }): Promise<ResultAnalyzerOutput> {
  const systemPrompt = `You are result-analyzer, an AI agent that analyzes UI test execution artifacts.
You output strictly JSON. Evaluate the provided console logs, network logs, and any execution errors to determine if the test passed or failed.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Logs: ${artifacts.logs}\nNetwork: ${artifacts.network}\nError: ${artifacts.errorMessage || 'None'}`,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: 'application/json',
      responseSchema: responseSchema,
    }
  });

  const analysis = response.text;
  if (!analysis) throw new Error('No JSON found in response');

  return ResultAnalyzerSchema.parse(JSON.parse(analysis));
}
