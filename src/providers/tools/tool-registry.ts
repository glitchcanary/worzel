import type pino from 'pino';

/**
 * Function calling tool registry.
 * Maps tool names to their implementations for LLM function calling.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  constructor(private readonly logger: pino.Logger) {}

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    this.logger.info({ tool: tool.name }, 'Tool registered');
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): { name: string; description: string; parameters: Record<string, unknown> }[] {
    return Array.from(this.tools.values()).map(({ name, description, parameters }) => ({
      name, description, parameters,
    }));
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    const start = Date.now();
    try {
      const result = await tool.handler(args);
      this.logger.info({ tool: name, durationMs: Date.now() - start }, 'Tool call completed');
      return result;
    } catch (err) {
      this.logger.error({ err, tool: name, durationMs: Date.now() - start }, 'Tool call failed');
      throw err;
    }
  }
}
