import { getRoleProvider } from './packages/llm-agents/providers/factory';
const diffProvider = getRoleProvider('diffAnalyzer');
console.log('Diff Provider Name:', diffProvider.name);

const testProvider = getRoleProvider('testPlanner');
console.log('Test Planner Provider Name:', testProvider.name);
