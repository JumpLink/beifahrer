/**
 * A stand-in for McpServer that records registrations instead of serving them.
 *
 * Lets the tool catalogue, the read-only gate and what a tool ANSWERS be asserted on BOTH runtimes
 * without a transport or a client: the handler is kept, so a test can call a tool directly with a
 * bridge of its own.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** The parts of a tool config these tests care about. */
export interface RecordedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, { safeParse(value: unknown): { success: boolean } }>;
  /** What the tool promises to answer with — absent for a tool that declares none. */
  outputSchema?: { safeParse(value: unknown): { success: boolean } };
  annotations?: { readOnlyHint?: boolean; openWorldHint?: boolean };
  /** The handler, so a tool can be called without a transport. */
  handle?: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

export interface Recorder {
  server: McpServer;
  tools: RecordedTool[];
  names(): string[];
  find(name: string): RecordedTool | undefined;
  /** Run a registered tool's handler with the arguments a client would send. */
  invoke(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
}

export function createRecorder(): Recorder {
  const tools: RecordedTool[] = [];
  const server = {
    registerTool: (
      name: string,
      config: Omit<RecordedTool, 'name' | 'handle'>,
      handle?: RecordedTool['handle'],
    ) => {
      tools.push({ name, ...config, handle });
      return undefined;
    },
  } as unknown as McpServer;
  return {
    server,
    tools,
    names: () => tools.map((t) => t.name),
    find: (name) => tools.find((t) => t.name === name),
    invoke: async (name, args = {}) => {
      const tool = tools.find((t) => t.name === name);
      if (!tool?.handle) throw new Error(`no tool named ${name} is registered`);
      return tool.handle(args);
    },
  };
}
