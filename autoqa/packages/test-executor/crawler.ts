import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { getRoleProvider } from '@autoqa/llm-agents/providers/factory';
import path from 'path';
import fs from 'fs';

export async function runCrawl(startUrl: string, repoPath: string) {
  // Phase A: Discovery crawler
  console.log(`Starting crawl at ${startUrl}...`);

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', path.join(process.cwd(), 'packages/test-executor/mcp-server.ts')],
    env: { ...process.env, TEST_RUN_ID: 'audit' }
  });

  const mcpClient = new Client({ name: 'crawler-client', version: '1.0.0' }, { capabilities: {} });
  await mcpClient.connect(transport);

  const visited = new Set<string>();
  const toVisit = [startUrl];
  
  let maxPages = 10;
  const configPath = path.join(process.cwd(), 'autoqa.config.json');
  if (fs.existsSync(configPath)) {
    const conf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    maxPages = conf.audit?.maxPages || 10;
  }

  const discoveredPages: any[] = [];

  try {
    while (toVisit.length > 0 && discoveredPages.length < maxPages) {
      const currentUrl = toVisit.shift()!;
      if (visited.has(currentUrl)) continue;
      
      visited.add(currentUrl);
      console.log(`Crawling: ${currentUrl}`);

      await mcpClient.callTool({ name: 'playwright_navigate', arguments: { url: currentUrl } });
      
      // Give it a moment to load
      await new Promise(r => setTimeout(r, 2000));

      const a11yResult: any = await mcpClient.callTool({ name: 'playwright_a11y_snapshot', arguments: {} });
      const snapshot = JSON.parse(a11yResult.content[0].text);

      const networkResult: any = await mcpClient.callTool({ name: 'playwright_get_network_activity', arguments: {} });
      const endpoints = JSON.parse(networkResult.content[0].text);

      // Extract internal links to follow
      const linksResult: any = await mcpClient.callTool({ 
        name: 'playwright_evaluate', 
        arguments: { 
          expression: `Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(h => h.startsWith(window.location.origin))`
        } 
      });
      const links = JSON.parse(linksResult.content[0].text);
      for (const link of links) {
        if (!visited.has(link) && !toVisit.includes(link)) {
          toVisit.push(link);
        }
      }

      discoveredPages.push({
        url: currentUrl,
        a11y: snapshot,
        endpoints
      });
    }
  } finally {
    await mcpClient.close();
  }

  // Statically scan repo for AI providers
  console.log('Scanning repo for AI SDKs...');
  const integrations = scanRepoForAI(repoPath);

  const featureMap = {
    pages: discoveredPages,
    integrations
  };

  const mapPath = path.join(process.cwd(), 'artifacts', 'feature-map.json');
  fs.mkdirSync(path.dirname(mapPath), { recursive: true });
  fs.writeFileSync(mapPath, JSON.stringify(featureMap, null, 2));
  console.log(`Crawl finished. Saved feature map to ${mapPath}`);

  return featureMap;
}

function scanRepoForAI(repoPath: string) {
  // A simple grep simulation to find files containing known SDKs
  const { execSync } = require('child_process');
  const integrations: any[] = [];
  
  const keywords = [
    '@anthropic-ai/sdk',
    'openai',
    '@google/genai',
    'api.openai.com',
    'api.anthropic.com',
    'generativelanguage.googleapis.com'
  ];

  for (const kw of keywords) {
    try {
      const result = execSync(`grep -rn "${kw}" ${repoPath} --exclude-dir=node_modules --exclude-dir=.git || true`).toString();
      if (result.trim()) {
        const lines = result.trim().split('\n').slice(0, 5); // limit output
        integrations.push({ keyword: kw, findings: lines });
      }
    } catch(e) {}
  }
  return integrations;
}
