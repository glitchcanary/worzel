import type { McpClient } from '../../mcp/client.js';
import type { ToolRegistry } from './tool-registry.js';
import type pino from 'pino';

/**
 * Bridge between device MCP tools and LLM function calling.
 *
 * When a device connects and reports its tools (via IoT descriptors or
 * MCP tools/list), this bridge registers them in the ToolRegistry so
 * the LLM can call them via function calling.
 */
export class McpBridge {
  constructor(
    private readonly mcpClient: McpClient,
    private readonly toolRegistry: ToolRegistry,
    private readonly logger: pino.Logger,
  ) {}

  /**
   * Discover and register device tools.
   * Called after a device connects and sends its IoT descriptors.
   */
  async discoverTools(): Promise<void> {
    try {
      const result = await this.mcpClient.listTools() as {
        tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
      };

      for (const tool of result.tools ?? []) {
        this.toolRegistry.register({
          name: `device:${tool.name}`,
          description: tool.description ?? `Device tool: ${tool.name}`,
          parameters: tool.inputSchema ?? {},
          handler: async (args) => {
            return this.mcpClient.callTool(tool.name, args);
          },
        });
      }

      this.logger.info({
        toolCount: result.tools?.length ?? 0,
      }, 'Device tools discovered and registered');
    } catch (err) {
      this.logger.warn({ err }, 'Failed to discover device tools');
    }
  }

  /**
   * Register IoT device methods as tools.
   * Called when the device sends IoT descriptors directly.
   */
  registerIotMethods(descriptors: {
    name: string;
    description?: string;
    methods?: { name: string; description?: string; parameters?: Record<string, unknown> }[];
  }[]): void {
    for (const descriptor of descriptors) {
      for (const method of descriptor.methods ?? []) {
        this.toolRegistry.register({
          name: `iot:${descriptor.name}:${method.name}`,
          description: method.description ?? `IoT ${descriptor.name}.${method.name}`,
          parameters: method.parameters ?? {},
          handler: async (args) => {
            return this.mcpClient.callTool(`${descriptor.name}.${method.name}`, args);
          },
        });
      }
    }
  }
}
