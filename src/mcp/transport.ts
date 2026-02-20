/**
 * MCP transport options.
 *
 * Phase 4 supports:
 * - In-process (direct function calls, no transport overhead)
 * - stdio (subprocess, for true process isolation)
 *
 * Future:
 * - HTTP/SSE (Streamable HTTP transport, for webMCP browser clients)
 */

export type McpTransportType = 'in-process' | 'stdio' | 'http-sse';

export interface McpTransportConfig {
  type: McpTransportType;
  /** For stdio: path to the MCP server executable */
  command?: string;
  args?: string[];
  /** For http-sse: URL of the MCP server */
  url?: string;
}

/**
 * Currently we use in-process transport (direct calls to McpServer).
 * This file defines the interface for future transport options.
 *
 * The lift to subprocess isolation:
 * 1. McpServer writes JSON-RPC to stdout, reads from stdin
 * 2. Parent process spawns McpServer, pipes stdio
 * 3. Each provider (ASR, LLM, TTS) can run in its own subprocess
 * 4. Crash of one provider doesn't take down the server
 */
