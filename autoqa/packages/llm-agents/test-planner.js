"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestPlanSchema = void 0;
exports.generateTestPlan = generateTestPlan;
const genai_1 = require("@google/genai");
const zod_1 = require("zod");
const ai = new genai_1.GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});
exports.TestPlanSchema = zod_1.z.object({
    steps: zod_1.z.array(zod_1.z.object({
        action: zod_1.z.enum(['navigate', 'click', 'fill', 'wait', 'assert']),
        selector: zod_1.z.string().optional(),
        value: zod_1.z.string().optional(),
        description: zod_1.z.string(),
    })),
});
const responseSchema = {
    type: genai_1.Type.OBJECT,
    properties: {
        steps: {
            type: genai_1.Type.ARRAY,
            items: {
                type: genai_1.Type.OBJECT,
                properties: {
                    action: { type: genai_1.Type.STRING, enum: ['navigate', 'click', 'fill', 'wait', 'assert'] },
                    selector: { type: genai_1.Type.STRING, nullable: true },
                    value: { type: genai_1.Type.STRING, nullable: true },
                    description: { type: genai_1.Type.STRING },
                },
                required: ['action', 'description'],
            }
        }
    },
    required: ['steps'],
};
async function generateTestPlan(instruction, url) {
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
    if (!plan)
        throw new Error('No JSON found in response');
    return exports.TestPlanSchema.parse(JSON.parse(plan));
}
