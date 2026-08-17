"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const genai_1 = require("@google/genai");
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
async function run() {
    const ai = new genai_1.GoogleGenAI({});
    const transport = new stdio_js_1.StdioClientTransport({
        command: "npx",
        args: ["tsx", "/home/samash/Documents/Localdev/autoqa/packages/test-executor/mcp-server.ts"]
    });
    const client = new index_js_1.Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    const mcpTool = (0, genai_1.mcpToTool)(client);
    console.log("mcpTool:", JSON.stringify(mcpTool, null, 2));
    await client.close();
}
run().catch(console.error);
