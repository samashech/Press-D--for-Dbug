"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResultAnalyzerSchema = void 0;
exports.analyzeResults = analyzeResults;
const genai_1 = require("@google/genai");
const zod_1 = require("zod");
const ai = new genai_1.GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});
exports.ResultAnalyzerSchema = zod_1.z.object({
    status: zod_1.z.enum(['pass', 'fail']),
    title: zod_1.z.string(),
    expected: zod_1.z.string(),
    actual: zod_1.z.string(),
    explanation: zod_1.z.string(),
    likelyCause: zod_1.z.string().optional(),
    reproSteps: zod_1.z.array(zod_1.z.string()).optional(),
    severity: zod_1.z.enum(['low', 'medium', 'high', 'critical']).optional(),
});
const responseSchema = {
    type: genai_1.Type.OBJECT,
    properties: {
        status: { type: genai_1.Type.STRING, enum: ['pass', 'fail'] },
        title: { type: genai_1.Type.STRING },
        expected: { type: genai_1.Type.STRING },
        actual: { type: genai_1.Type.STRING },
        explanation: { type: genai_1.Type.STRING },
        likelyCause: { type: genai_1.Type.STRING, nullable: true },
        reproSteps: {
            type: genai_1.Type.ARRAY,
            items: { type: genai_1.Type.STRING },
            nullable: true
        },
        severity: { type: genai_1.Type.STRING, enum: ['low', 'medium', 'high', 'critical'], nullable: true },
    },
    required: ['status', 'title', 'expected', 'actual', 'explanation'],
};
async function analyzeResults(artifacts) {
    const systemPrompt = `You are result-analyzer, an AI agent that analyzes UI test execution artifacts.
You output strictly JSON. Evaluate the provided console logs, network logs, and any execution errors to determine if the test passed or failed.
If the test fails, you must provide a detailed structured Bug Report including 'likelyCause', a step-by-step array of 'reproSteps', and a 'severity' level (low, medium, high, critical).`;
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
    if (!analysis)
        throw new Error('No JSON found in response');
    return exports.ResultAnalyzerSchema.parse(JSON.parse(analysis));
}
