import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { chromium, Page, Browser, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs';

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let testRunId = process.env.TEST_RUN_ID || 'default';

const server = new Server(
  { name: 'playwright-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

let networkInventory: { url: string, method: string, status: number }[] = [];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'playwright_navigate',
        description: 'Navigate to a URL',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string' } },
          required: ['url']
        }
      },
      {
        name: 'playwright_click',
        description: 'Click an element matching the selector',
        inputSchema: {
          type: 'object',
          properties: { selector: { type: 'string' } },
          required: ['selector']
        }
      },
      {
        name: 'playwright_fill',
        description: 'Fill an input element matching the selector with text',
        inputSchema: {
          type: 'object',
          properties: { selector: { type: 'string' }, text: { type: 'string' } },
          required: ['selector', 'text']
        }
      },
      {
        name: 'playwright_evaluate',
        description: 'Evaluate javascript in the page to extract information',
        inputSchema: {
          type: 'object',
          properties: { expression: { type: 'string', description: 'Javascript expression returning a string or serializable value' } },
          required: ['expression']
        }
      },
      {
        name: 'playwright_a11y_snapshot',
        description: 'Get the accessibility tree of the current page to find interactive elements',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'playwright_get_network_activity',
        description: 'Get list of network endpoints captured since the browser started',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'playwright_screenshot',
        description: 'Take a screenshot of the page. This finishes the tool execution process.',
        inputSchema: {
          type: 'object',
          properties: {},
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!browser || !page) {
    browser = await chromium.launch();
    context = await browser.newContext();
    page = await context.newPage();
    
    page.on('response', (response) => {
      const request = response.request();
      if (request.resourceType() === 'fetch' || request.resourceType() === 'xhr') {
        const url = request.url();
        const method = request.method();
        const status = response.status();
        
        // Ensure no exact duplicates
        if (!networkInventory.find(n => n.url === url && n.method === method)) {
          networkInventory.push({ url, method, status });
        }
      }
    });
  }

  const { name, arguments: args } = request.params;
  try {
    if (name === 'playwright_navigate') {
      await page.goto(args?.url as string);
      return { content: [{ type: 'text', text: `Navigated to ${args?.url}` }] };
    }
    
    if (name === 'playwright_click') {
      await page.click(args?.selector as string);
      return { content: [{ type: 'text', text: `Clicked ${args?.selector}` }] };
    }

    if (name === 'playwright_fill') {
      await page.fill(args?.selector as string, args?.text as string);
      return { content: [{ type: 'text', text: `Filled ${args?.selector} with text` }] };
    }

    if (name === 'playwright_evaluate') {
      const result = await page.evaluate(args?.expression as string);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    if (name === 'playwright_a11y_snapshot') {
      const snapshot = await page.evaluate(() => {
        const elements = document.querySelectorAll('button, a, input, select, textarea, form, [role="button"], [role="link"], [role="menuitem"], [role="switch"]');
        return Array.from(elements).map(el => {
          const rect = el.getBoundingClientRect();
          return {
            role: el.tagName.toLowerCase(),
            name: (el.getAttribute('aria-label') || el.textContent || '').trim().substring(0, 50),
            selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.split(' ').join('.') : ''),
            visible: rect.width > 0 && rect.height > 0
          };
        }).filter(e => e.visible);
      });
      return { content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }] };
    }

    if (name === 'playwright_get_network_activity') {
      return { content: [{ type: 'text', text: JSON.stringify(networkInventory, null, 2) }] };
    }

    if (name === 'playwright_screenshot') {
      const artifactsDir = path.join(process.cwd(), 'artifacts', testRunId);
      fs.mkdirSync(artifactsDir, { recursive: true });
      const screenshotPath = path.join(artifactsDir, 'final.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return { content: [{ type: 'text', text: `Screenshot saved to ${screenshotPath}` }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

run().catch(console.error);
