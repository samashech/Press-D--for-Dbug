import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, Message, ToolDefinition, ToolCall } from './types';

export class ClaudeProvider implements LLMProvider {
  name = 'claude';
  private client: Anthropic;
  private model: string;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    this.client = new Anthropic({
      apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.model = options.model || 'claude-3-5-sonnet-20241022';
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
    let system = systemMessages.map(m => m.content).join('\n');

    if (input.responseSchema) {
      // Claude prefers structured output instructions in the system prompt.
      // But we can also use tool-calling for structured output (tool_choice)
      // For simplicity, if a responseSchema is provided but no tools, we could inject a dummy tool.
      // Or just append it to the system prompt if we rely on it returning JSON text.
      // We will handle it by injecting a tool for the response schema.
    }

    const messages: Anthropic.MessageParam[] = [];
    
    // Anthropic doesn't support system messages in the messages array, they go into `system` top-level parameter.
    const nonSystem = input.messages.filter(m => m.role !== 'system');
    
    let currentRole: 'user' | 'assistant' = 'user';
    let currentContent: any[] = [];
    
    for (const msg of nonSystem) {
      if (msg.role === 'user') {
        if (currentRole !== 'user' && currentContent.length > 0) {
          messages.push({ role: 'assistant', content: currentContent as any });
          currentContent = [];
        }
        currentRole = 'user';
        currentContent.push({ type: 'text', text: msg.content });
      } else if (msg.role === 'assistant') {
        if (currentRole !== 'assistant' && currentContent.length > 0) {
          messages.push({ role: 'user', content: currentContent as any });
          currentContent = [];
        }
        currentRole = 'assistant';
        if (msg.content) {
          currentContent.push({ type: 'text', text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            currentContent.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.args
            });
          }
        }
      } else if (msg.role === 'tool') {
        if (currentRole !== 'user' && currentContent.length > 0) {
          messages.push({ role: 'assistant', content: currentContent as any });
          currentContent = [];
        }
        currentRole = 'user';
        currentContent.push({
          type: 'tool_result',
          tool_use_id: msg.toolCallId!,
          content: msg.content,
        });
      }
    }
    
    if (currentContent.length > 0) {
      messages.push({ role: currentRole, content: currentContent as any });
    }

    const tools: Anthropic.Tool[] = [];
    if (input.tools) {
      for (const t of input.tools) {
        tools.push({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        });
      }
    }
    
    let toolChoice: Anthropic.MessageCreateParams['tool_choice'];
    if (input.responseSchema && !input.tools) {
      // Force a tool call for structured output
      tools.push({
        name: 'output_json',
        description: 'Outputs the final JSON response',
        input_schema: input.responseSchema
      });
      toolChoice = { type: 'tool', name: 'output_json' };
    } else if (input.responseSchema && input.tools) {
      // It's ambiguous if they provide both, maybe just append instructions
      system += `\n\nYou MUST respond with JSON matching this schema:\n${JSON.stringify(input.responseSchema, null, 2)}`;
    }

    const payload: Anthropic.MessageCreateParams = {
      model: this.model,
      max_tokens: 4096,
      system: system.length > 0 ? system : undefined,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: toolChoice
    };

    const response = await this.client.messages.create(payload);

    let text = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        if (input.responseSchema && !input.tools && block.name === 'output_json') {
          // It's the forced structured output
          text = JSON.stringify(block.input);
        } else {
          toolCalls.push({
            id: block.id,
            name: block.name,
            args: block.input,
          });
        }
      }
    }

    return {
      text: text.trim() || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
      }
    };
  }
}
