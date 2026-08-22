import { LLMProvider, Message, ToolDefinition, ToolCall } from './types';
import chalk from 'chalk';

export class FallbackProvider implements LLMProvider {
  name = 'fallback';
  private providers: LLMProvider[];

  constructor(providers: LLMProvider[]) {
    if (providers.length === 0) {
      throw new Error("FallbackProvider requires at least one provider");
    }
    this.providers = providers;
    this.name = providers[0].name; // By default expose primary name, or custom logic
  }

  async generate(input: {
    messages: Message[];
    tools?: ToolDefinition[];
    responseSchema?: any;
    forceFallback?: boolean;
    validate?: (response: any) => void;
  }): Promise<{
    toolCalls?: ToolCall[];
    text?: string;
    usage: { promptTokens: number; completionTokens: number; provider?: string; model?: string; };
  }> {
    let lastError: any;
    const startIndex = input.forceFallback ? 1 : 0;
    
    if (startIndex >= this.providers.length) {
      throw new Error('forceFallback requested but no fallback providers available.');
    }

    for (let i = startIndex; i < this.providers.length; i++) {
      const provider = this.providers[i];
      try {
        if (i > 0) {
          console.log(chalk.yellow(`Retrying with fallback provider: ${provider.name}`));
        }
        const res = await provider.generate(input);
        if (input.validate) {
           input.validate(res);
        }
        return res;
      } catch (err: any) {
        lastError = err;
        console.warn(chalk.yellow(`Provider ${provider.name} failed: ${err.message}`));
      }
    }

    throw new Error(`All providers in fallback chain failed. Last error: ${lastError?.message}`);
  }
}
