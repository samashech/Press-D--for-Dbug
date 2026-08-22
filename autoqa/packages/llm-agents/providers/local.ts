import { OpenAIProvider } from './openai';

export class LocalProvider extends OpenAIProvider {
  constructor(options: { baseURL: string; model: string; apiKey?: string }) {
    super({
      baseURL: options.baseURL,
      model: options.model,
      apiKey: options.apiKey || 'dummy',
    });
    this.name = 'local';
  }
}
