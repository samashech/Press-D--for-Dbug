import fs from 'fs';
import path from 'path';
import { LLMProvider } from './types';
import { ClaudeProvider } from './claude';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';
import { LocalProvider } from './local';

export function getRoleProvider(role: 'diffAnalyzer' | 'testPlanner' | 'resultAnalyzer'): LLMProvider {
  const configPath = path.join(process.cwd(), 'autoqa.config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.llm && config.llm[role]) {
        const roleConfig = config.llm[role];
        
        let apiKey = roleConfig.apiKey;
        if (apiKey && apiKey.startsWith('env:')) {
          apiKey = process.env[apiKey.substring(4)] || '';
        }

        switch (roleConfig.provider) {
          case 'claude':
            return new ClaudeProvider({ model: roleConfig.model, apiKey });
          case 'openai':
            return new OpenAIProvider({ model: roleConfig.model, apiKey });
          case 'local':
            return new LocalProvider({ model: roleConfig.model, baseURL: roleConfig.baseUrl, apiKey });
          case 'gemini':
            return new GeminiProvider({ model: roleConfig.model, apiKey });
          default:
            console.warn(`Unknown provider ${roleConfig.provider} for role ${role}. Falling back to default.`);
        }
      }
    } catch (e) {
      console.warn(`Failed to parse autoqa.config.json for LLM config: ${(e as any).message}`);
    }
  }

  // Default fallback if no config found for role
  return new GeminiProvider();
}
