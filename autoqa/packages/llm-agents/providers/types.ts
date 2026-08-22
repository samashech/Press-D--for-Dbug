export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string; // used for tool results
  toolCalls?: ToolCall[];
  toolCallId?: string; // used for tool results
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
}

export interface ToolCall {
  id: string;
  name: string;
  args: any;
}

export interface LLMProvider {
  name: string;
  generate(input: {
    messages: Message[];
    tools?: ToolDefinition[];
    responseSchema?: any; // JSON Schema for structured output
  }): Promise<{
    toolCalls?: ToolCall[];
    text?: string;
    usage: { 
      promptTokens: number; 
      completionTokens: number;
      provider?: string;
      model?: string;
    };
  }>;
}
