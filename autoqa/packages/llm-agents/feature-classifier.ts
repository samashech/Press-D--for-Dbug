import { z } from 'zod';
import { LLMProvider, Message } from './providers/types';
import zodToJsonSchema from 'zod-to-json-schema';

const FeatureClassifierSchema = z.object({
  features: z.array(z.object({
    name: z.string(),
    description: z.string(),
    featureType: z.enum(['button', 'form', 'nav-link', 'animation-candidate', 'api-endpoint', 'llm-integration']),
    selector: z.string().optional().describe("Playwright locator or accessibility role/name, e.g., button[name=\"Submit\"]"),
    pageUrl: z.string().optional()
  }))
});

export type FeatureClassifierOutput = z.infer<typeof FeatureClassifierSchema> & {
  usages?: any[];
};

export async function classifyFeatures(
  pageUrl: string, 
  a11ySnapshot: any, 
  endpoints: any[], 
  integrations: any[], 
  provider: LLMProvider
): Promise<FeatureClassifierOutput> {
  const systemPrompt = `You are feature-classifier, an AI agent that analyzes a page's accessibility tree, endpoints, and codebase integrations to identify and classify testable features.
Your goal is to extract distinct, interactive, or functional features and label them as one of: button, form, nav-link, animation-candidate, api-endpoint, or llm-integration.

Rules:
1. Provide a concise 'name' (e.g. "Login Form" or "Submit Button").
2. Provide a 'description' of what the feature does or how it's interacted with.
3. Provide a 'selector' that can be used by Playwright (like 'button[name="Submit"]') if applicable.
4. Set 'pageUrl' to the URL where this was found.`;

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Analyze the following data from URL: ${pageUrl}\n\nAccessibility Tree:\n${JSON.stringify(a11ySnapshot)}\n\nAPI Endpoints:\n${JSON.stringify(endpoints)}\n\nCode Integrations:\n${JSON.stringify(integrations)}` }
  ];

  const responseSchema = zodToJsonSchema(FeatureClassifierSchema, 'FeatureClassifierSchema');

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

      FeatureClassifierSchema.parse(JSON.parse(cleanAnalysis.trim()));
    }
  });

  const analysis = response.text!;
  let cleanAnalysis = analysis.trim();
  if (cleanAnalysis.startsWith('```json')) cleanAnalysis = cleanAnalysis.substring(7);
  if (cleanAnalysis.startsWith('```')) cleanAnalysis = cleanAnalysis.substring(3);
  if (cleanAnalysis.endsWith('```')) cleanAnalysis = cleanAnalysis.slice(0, -3);

  const result = FeatureClassifierSchema.parse(JSON.parse(cleanAnalysis.trim()));
  
  return {
    ...result,
    usages: response.usage ? [response.usage] : undefined
  };
}
