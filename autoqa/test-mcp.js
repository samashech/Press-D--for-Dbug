"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
async function run() {
    const transport = new stdio_js_1.StdioClientTransport({
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-playwright"]
    });
    const client = new index_js_1.Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    const tools = await client.listTools();
    console.log(tools);
    await client.close();
}
run();
