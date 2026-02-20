import type { McpMessage } from '../types.js';
import type { RouteContext } from '../router.js';

/**
 * Handle MCP sub-protocol messages from the device.
 *
 * MCP messages within the WebSocket carry JSON-RPC 2.0 payloads.
 * They can be:
 * 1. Responses to tool calls we made (results from device tools)
 * 2. Requests from the device (e.g., tools/list, tools/call)
 */
export async function handleMcp(
  message: McpMessage,
  ctx: RouteContext,
): Promise<void> {
  const { session, logger } = ctx;

  logger.info({
    sessionId: session.id,
    method: message.method,
    id: message.id,
  }, 'MCP message received');

  // If this has a result or error, it's a response to a tool call we made
  if (message.result !== undefined || message.error !== undefined) {
    // The McpClient will handle this via its pending request map
    // This will be wired up when McpClient is integrated into the session
    logger.info({ id: message.id }, 'MCP response received');
    return;
  }

  // Otherwise it's a request from the device
  // For now, respond with method not found for unimplemented methods
  await ctx.transport.sendText(JSON.stringify({
    type: 'mcp',
    id: message.id,
    error: { code: -32601, message: `Method not yet implemented: ${message.method}` },
  }));
}
