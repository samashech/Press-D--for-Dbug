import OpenAI from 'openai';
import { LLMProvider, Message, ToolDefinition, ToolCall } from './types';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  protected client: OpenAI;
  protected model: string;

  constructor(options: { apiKey?: string; model?: string; baseURL?: string } = {}) {
    this.client = new OpenAI({
      apiKey: options.apiKey || process.env.OPENAI_API_KEY || 'dummy-key',
      baseURL: options.baseURL,
    });
    this.model = options.model || 'gpt-4o';
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
    const messages: OpenAI.ChatCompletionMessageParam[] = input.messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          content: m.content,
          tool_call_id: m.toolCallId!,
        };
      }
      if (m.role === 'assistant') {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls ? m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) }
          })) : undefined,
        };
      }
      return {
        role: m.role as 'user' | 'system',
        content: m.content,
      };
    });

    const tools: OpenAI.ChatCompletionTool[] = [];
    if (input.tools) {
      for (const t of input.tools) {
        tools.push({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          }
        });
      }
    }

    let responseFormat: OpenAI.ChatCompletionCreateParams['response_format'];
    if (input.responseSchema) {
      responseFormat = {
        type: 'json_schema',
        json_schema: {
          name: 'response_schema',
          strict: true,
          schema: input.responseSchema
        }
      };
    }

    const payload: OpenAI.ChatCompletionCreateParams = {
      model: this.model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      response_format: responseFormat,
    };

    const response = await this.client.chat.completions.create(payload);
    
    const choice = response.choices[0];
    const msg = choice.message;

    let toolCalls: ToolCall[] | undefined;
    if (msg.tool_calls) {
      toolCalls = msg.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments),
      }));
    }

    return {
      text: msg.content || undefined,
      toolCalls,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
      }
    };
  }
}
