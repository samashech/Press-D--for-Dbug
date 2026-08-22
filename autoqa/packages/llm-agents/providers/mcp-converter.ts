import { ToolDefinition } from './types';

export function convertMcpTools(mcpToolsList: any): ToolDefinition[] {
  return mcpToolsList.tools.map((tool: any) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}
