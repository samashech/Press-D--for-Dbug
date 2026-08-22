import { runCanaryCheck } from './packages/llm-agents/providers/canary';
import { getRoleProvider } from './packages/llm-agents/providers/factory';

async function run() {
  const provider = getRoleProvider('diffAnalyzer'); // which is local
  console.log(`Testing canary for ${provider.name}...`);
  const result = await runCanaryCheck(provider);
  console.log(result);
}
run();
