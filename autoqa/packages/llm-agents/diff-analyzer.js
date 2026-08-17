"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiffAnalyzerSchema = void 0;
exports.analyzeDiff = analyzeDiff;
const genai_1 = require("@google/genai");
const zod_1 = require("zod");
const ai = new genai_1.GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});
exports.DiffAnalyzerSchema = zod_1.z.object({
    featureName: zod_1.z.string(),
    description: zod_1.z.string(),
});
const responseSchema = {
    type: genai_1.Type.OBJECT,
    properties: {
        featureName: { type: genai_1.Type.STRING },
        description: { type: genai_1.Type.STRING },
    },
    required: ['featureName', 'description'],
};
async function analyzeDiff(diffText) {
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
    if (!analysis)
        throw new Error('No JSON found in response');
    return exports.DiffAnalyzerSchema.parse(JSON.parse(analysis));
}
