/**
 * MCP Server initialization and tool registration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest
} from '@modelcontextprotocol/sdk/types.js';
import { deviceTools } from './tools/device.js';
import { appTools } from './tools/app.js';
import { fileTools } from './tools/file.js';
import { flashTools } from './tools/flash.js';
import { interactionTools } from './tools/interaction.js';

/**
 * Create and configure MCP server with all tools
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: 'android-debug-mcp-server',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Collect all tools
  const allTools = {
    ...deviceTools,
    ...appTools,
    ...fileTools,
    ...flashTools,
    ...interactionTools
  };

  // Note: readOnlyHint annotations would go here if SDK supported them in tool metadata

  // Handle tools/list request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const toolsList = Object.entries(allTools).map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));

    return { tools: toolsList };
  });

  // Handle tools/call requests
  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const toolName = request.params.name;
    const tool = allTools[toolName as keyof typeof allTools];

    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    try {
      const result = await tool.handler(request.params.arguments as any || {});
      return {
        content: [
          {
            type: 'text',
            text: result
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`
          }
        ],
        isError: true
      };
    }
  });

  return server;
}

/**
 * Start the MCP server
 */
export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error('Android Debug MCP Server running on stdio');
  console.error('Available tools: 35 (device: 7, app: 6, file: 6, flash: 10, interaction: 6)');
  console.error('Safety mode: Expert (includes destructive operations with confirmation tokens)');
}
