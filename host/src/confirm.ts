import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Gate a destructive action behind MCP elicitation (a client-side confirmation
 * prompt). Returns `null` when the action may proceed, or a blocking tool result
 * when it must not.
 *
 * Degradation: if the caller passed `confirm: true`, we skip the prompt. If the
 * client does not support elicitation (elicitInput throws), we block and tell
 * the user to re-run with `confirm: true` — so a destructive op is never
 * executed silently on a client that can't ask.
 */
export async function gate(
  server: McpServer,
  confirm: boolean | undefined,
  summary: string,
): Promise<ToolResult | null> {
  if (confirm === true) return null;
  try {
    const res = await server.server.elicitInput({
      message: `Destructive action — confirm to proceed:\n${summary}`,
      requestedSchema: {
        type: "object",
        properties: {
          proceed: { type: "boolean", title: "Proceed with this action?", description: summary },
        },
        required: ["proceed"],
      },
    });
    if (res.action === "accept" && res.content?.proceed === true) return null;
    return {
      isError: true,
      content: [{ type: "text", text: `Cancelled — user did not approve: ${summary}` }],
    };
  } catch {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            `This is a destructive action (${summary}) and interactive confirmation ` +
            `isn't available on this client. Re-run the tool with confirm: true to proceed.`,
        },
      ],
    };
  }
}
