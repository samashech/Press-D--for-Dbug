import { GoogleGenAI, Type, Schema } from '@google/genai';
import { LLMProvider, Message, ToolDefinition, ToolCall } from './types';

export class GeminiProvider implements LLMProvider {
  name = 'gemini';
  private ai: GoogleGenAI;
  private model: string;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    this.ai = new GoogleGenAI({
      apiKey: options.apiKey || process.env.GEMINI_API_KEY,
    });
    this.model = options.model || 'gemini-2.5-flash';
  }

  async generate(input: {
    messages: Message[];
    tools?: ToolDefinition[];
    responseSchema?: any;
  }): Promise<{
    toolCalls?: ToolCall[];
    text?: string;
    usage: { promptTokens: number; completionTokens: number };
  }> {
    const systemMessages = input.messages.filter(m => m.role === 'system');
    let systemInstruction = systemMessages.map(m => m.content).join('\n');
    if (!systemInstruction) systemInstruction = undefined as any;

    const contents = [];
    for (const msg of input.messages.filter(m => m.role !== 'system')) {
      if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        const parts: any[] = [];
        if (msg.content) parts.push({ text: msg.content });
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.args
              }
            });
          }
        }
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        contents.push({
          role: 'user', // For gemini, tool responses are from user with functionResponse part
          parts: [{
            functionResponse: {
              name: msg.name!,
              response: { result: msg.content }
            }
          }]
        });
      }
    }

    const tools: any[] = [];
    if (input.tools) {
      tools.push({
        functionDeclarations: input.tools.map(t => ({
          name: t.name,
          description: t.description,
          parametersJsonSchema: t.inputSchema, // Note: Google Gen AI uses Type enum for Schema, but it might accept plain JSON schema or requires translation.
        }))
      });
    }

    const config: any = {
      systemInstruction,
    };
    if (tools.length > 0) {
      config.tools = tools;
    }

    if (input.responseSchema) {
      config.responseMimeType = 'application/json';
      // GenAI typically uses its own Schema type with enums, but let's try passing the JSON schema directly or just rely on MimeType.
      // Alternatively, we convert standard JSON schema to Gemini Schema.
      config.responseSchema = input.responseSchema; 
    }

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents,
      config,
    });

    let text = response.text || undefined;
    const toolCalls: ToolCall[] = [];
    
    if (response.functionCalls) {
      for (const fc of response.functionCalls) {
        toolCalls.push({
          id: Math.random().toString(36).substring(7), // Gemini doesn't return tool call IDs
          name: fc.name,
          args: fc.args,
        });
      }
    }

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount || 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount || 0,
        provider: this.name,
        model: this.model
      }
    };
  }
}
