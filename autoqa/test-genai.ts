import 'dotenv/config';
import { GoogleGenAI, mcpToTool } from '@google/genai';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function run() {
  const ai = new GoogleGenAI({});
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "/home/samash/Documents/Localdev/autoqa/packages/test-executor/mcp-server.ts"] 
  });
  const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  
  const mcpTool = mcpToTool(client);
  console.log("mcpTool:", JSON.stringify(mcpTool, null, 2));
  
  await client.close();
}
run().catch(console.error);
