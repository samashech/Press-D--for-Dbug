import { executeTestAutonomous } from './packages/llm-agents/test-planner';
import { GeminiProvider, ClaudeProvider, OpenAIProvider, LocalProvider } from './packages/llm-agents/providers';
import chalk from 'chalk';

async function run() {
  const instruction = "Navigate to http://example.com, evaluate 'document.title' and screenshot.";
  const url = "http://example.com";

  const providers = [
    new GeminiProvider(),
    new ClaudeProvider({ model: 'claude-3-5-sonnet-20241022' }),
    new OpenAIProvider({ model: 'gpt-4o-mini' }),
    new LocalProvider({ baseURL: 'http://localhost:11434/v1', model: 'llama3.1' })
  ];

  for (const provider of providers) {
    console.log(chalk.magenta(`\n\n--- Testing ${provider.name} ---`));
    try {
      const result = await executeTestAutonomous(`smoke-${provider.name}`, instruction, url, provider);
      console.log(chalk.green(`✅ ${provider.name} completed successfully. Screenshot: ${result.screenshotPath}`));
    } catch (err: any) {
      console.error(chalk.red(`❌ ${provider.name} failed:`), err.message);
    }
  }
}

run().catch(console.error);
