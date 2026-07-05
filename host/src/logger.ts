/**
 * All diagnostic logging MUST go to stderr. stdout is reserved for the MCP
 * stdio transport (JSON-RPC frames); writing anything else there corrupts it.
 */
export function log(...args: unknown[]): void {
  const line = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  process.stderr.write(`[godot-claude-bridge] ${line}\n`);
}
