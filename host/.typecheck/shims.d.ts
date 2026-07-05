// Local type shims used ONLY for offline typechecking in this sandbox (the npm
// registry is unreachable here). They faithfully mirror the parts of the real
// packages this scaffold uses (MCP SDK 1.x McpServer.registerTool + zod 3.x),
// so tsc validates our call sites. On a real machine, `npm install` provides
// the genuine types and this folder is irrelevant (excluded from the build).

declare module "@modelcontextprotocol/sdk/server/mcp.js" {
  export interface ToolConfig {
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  }
  export interface ToolResult {
    content?: Array<Record<string, unknown>>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  }
  export interface ElicitResult {
    action: "accept" | "decline" | "cancel";
    content?: Record<string, unknown>;
  }
  export interface ResourceContents {
    contents: Array<{ uri: string; text?: string; mimeType?: string; blob?: string }>;
  }
  export interface ResourceMetadata {
    title?: string;
    description?: string;
    mimeType?: string;
  }
  export class ResourceTemplate {
    constructor(uriTemplate: string, options?: { list?: (() => any) | undefined });
  }
  export class McpServer {
    constructor(info: { name: string; version: string });
    server: {
      elicitInput(params: { message: string; requestedSchema: Record<string, unknown> }): Promise<ElicitResult>;
    };
    registerTool(
      name: string,
      config: ToolConfig,
      handler: (args: any, extra: any) => Promise<ToolResult> | ToolResult,
    ): void;
    registerResource(
      name: string,
      uri: string | ResourceTemplate,
      metadata: ResourceMetadata,
      handler: (uri: URL, vars?: any) => Promise<ResourceContents> | ResourceContents,
    ): void;
    connect(transport: unknown): Promise<void>;
  }
}

declare module "@modelcontextprotocol/sdk/server/stdio.js" {
  export class StdioServerTransport {}
}

declare module "zod" {
  export interface ZodType {
    optional(): ZodType;
    describe(description: string): ZodType;
    int(): ZodType;
    positive(): ZodType;
  }
  interface ZodNamespace {
    string(): ZodType;
    number(): ZodType;
    boolean(): ZodType;
    any(): ZodType;
    array(inner: ZodType): ZodType;
    enum(values: readonly string[]): ZodType;
    object(shape: Record<string, ZodType>): ZodType;
  }
  export const z: ZodNamespace;
}
