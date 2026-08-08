import { GoogleGenAI, Type, Schema } from '@google/genai';
import { z } from 'zod';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
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

const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          action: { type: Type.STRING, enum: ['navigate', 'click', 'fill', 'wait', 'assert'] },
          selector: { type: Type.STRING, nullable: true },
          value: { type: Type.STRING, nullable: true },
          description: { type: Type.STRING },
        },
        required: ['action', 'description'],
      }
    }
  },
  required: ['steps'],
};

export async function generateTestPlan(instruction: string, url: string): Promise<TestPlan> {
  const systemPrompt = `You are test-planner, an AI agent that converts developer instructions into a structured UI test plan.
You output strictly JSON. For accessibility tree / MCP interactions, use semantic roles or generic descriptions for 'selector'. Make sure to always start with a 'navigate' action to the provided url.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Instruction: ${instruction}\nURL: ${url}`,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: 'application/json',
      responseSchema: responseSchema,
    }
  });

  const plan = response.text;
  if (!plan) throw new Error('No JSON found in response');

  return TestPlanSchema.parse(JSON.parse(plan));
}
