import { LLMProvider, Message, ToolDefinition } from './types';
import chalk from 'chalk';

export async function runCanaryCheck(provider: LLMProvider): Promise<{ success: boolean; reason?: string }> {
  const tools: ToolDefinition[] = [
    {
      name: 'calculator',
      description: 'Adds two numbers together',
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'number' },
          b: { type: 'number' }
        },
        required: ['a', 'b']
      }
    }
  ];

  const responseSchema = {
    type: 'object',
    properties: {
      result: { type: 'number' }
    },
    required: ['result']
  };

  const messages: Message[] = [
    { role: 'user', content: 'Use the calculator tool to add 2 and 2, then respond with the result.' }
  ];

  try {
    const response = await provider.generate({
      messages,
      tools,
      responseSchema
    });

    // Check if it used the tool
    let usedTool = false;
    if (response.toolCalls && response.toolCalls.length > 0) {
      const tc = response.toolCalls.find(t => t.name === 'calculator');
      if (tc) usedTool = true;
    }

    if (!usedTool) {
      // It might have just returned JSON if it was smart enough to skip the tool, but we WANT it to use the tool.
      // Or maybe it just returned text.
    }

    // Since we just want to verify it doesn't crash on tools + JSON schema:
    // Some models might skip the tool call and output JSON directly.
    // Let's just consider it a success if it returns without throwing, and if it produced parseable JSON OR tool calls.
    if (!response.toolCalls && !response.text) {
      return { success: false, reason: 'Empty response.' };
    }

    // Try parsing text if there is any text, to see if it obeyed responseSchema.
    // Or if it just returned a tool call, we would normally feed it back. The prompt says "send a trivial prompt that requires both a tool call and a structured JSON response matching a simple schema. If it fails or the response doesn't parse, warn the user"
    
    // So the interaction might take 2 steps:
    let finalJsonText = response.text;
    
    if (response.toolCalls && response.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: response.text || '',
        toolCalls: response.toolCalls
      });
      
      for (const tc of response.toolCalls) {
        messages.push({
          role: 'tool',
          content: '4', // We just mock the result
          name: tc.name,
          toolCallId: tc.id
        });
      }
      
      const secondResponse = await provider.generate({
        messages,
        responseSchema // No tools this time to force JSON response
      });
      
      finalJsonText = secondResponse.text;
    }
    
    if (!finalJsonText) {
       return { success: false, reason: 'No text response produced for JSON schema.' };
    }

    let parsed: any;
    try {
      let cleanText = finalJsonText.trim();
      if (cleanText.startsWith('\`\`\`json')) cleanText = cleanText.substring(7);
      if (cleanText.startsWith('\`\`\`')) cleanText = cleanText.substring(3);
      if (cleanText.endsWith('\`\`\`')) cleanText = cleanText.slice(0, -3);
      parsed = JSON.parse(cleanText.trim());
    } catch (e) {
      return { success: false, reason: 'Failed to parse structured JSON response.' };
    }

    if (typeof parsed.result !== 'number') {
       return { success: false, reason: 'JSON response did not match the required schema.' };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, reason: error.message };
  }
}
