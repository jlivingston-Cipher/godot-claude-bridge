/**
 * MCP-client config targets for `breakpoint-mcp init`. Each client launches the
 * server the same way — `npx -y breakpoint-mcp` over stdio — and differs only in
 * the config file location and the wrapper key (`mcpServers`, except VS Code's
 * `servers` which also needs an explicit `type: "stdio"`). Paths mirror the
 * README "Compatibility" table.
 */
import os from "node:os";
import path from "node:path";

export type ClientId = "claude-code" | "claude-desktop" | "cursor" | "windsurf" | "vscode";
export const CLIENT_IDS: ClientId[] = ["claude-code", "claude-desktop", "cursor", "windsurf", "vscode"];

export interface ClientInfo {
  id: ClientId;
  label: string;
  /** Absolute config file to merge into, or null for claude-code (a CLI command, no file). */
  configPath: string | null;
  key: "mcpServers" | "servers";
  /** VS Code entries carry an explicit transport type. */
  needsType: boolean;
}

/** Resolve a client id to its config location + shape, or null if unknown. */
export function clientInfo(id: string, projectPath: string): ClientInfo | null {
  const home = os.homedir();
  switch (id) {
    case "claude-code":
      return { id, label: "Claude Code", configPath: null, key: "mcpServers", needsType: false };
    case "claude-desktop": {
      let p: string;
      if (process.platform === "darwin") {
        p = path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      } else if (process.platform === "win32") {
        p = path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
      } else {
        p = path.join(home, ".config", "Claude", "claude_desktop_config.json");
      }
      return { id, label: "Claude Desktop", configPath: p, key: "mcpServers", needsType: false };
    }
    case "cursor":
      return { id, label: "Cursor", configPath: path.join(home, ".cursor", "mcp.json"), key: "mcpServers", needsType: false };
    case "windsurf":
      return { id, label: "Windsurf", configPath: path.join(home, ".codeium", "windsurf", "mcp_config.json"), key: "mcpServers", needsType: false };
    case "vscode":
      // Project-scoped, so it lands next to the project the user is initialising.
      return { id, label: "VS Code", configPath: path.join(projectPath, ".vscode", "mcp.json"), key: "servers", needsType: true };
    default:
      return null;
  }
}

/** The stdio server entry a client config needs. GODOT_BIN is included only when non-default. */
export function serverEntry(projectPath: string, godotBin: string, needsType: boolean): Record<string, unknown> {
  const env: Record<string, string> = { GODOT_PROJECT: projectPath };
  if (godotBin && godotBin !== "godot") env.GODOT_BIN = godotBin;
  const base: Record<string, unknown> = { command: "npx", args: ["-y", "breakpoint-mcp"], env };
  return needsType ? { type: "stdio", ...base } : base;
}

/**
 * Merge the server entry into an existing config's `key` object, preserving every
 * other server. Returns pretty JSON. Throws if `existing` is present but not valid
 * JSON, so the caller can refuse to clobber a file it can't parse.
 */
export function mergeClientConfig(
  existing: string | null,
  key: string,
  serverName: string,
  entry: Record<string, unknown>,
): string {
  let obj: Record<string, unknown> = {};
  if (existing && existing.trim()) {
    const parsed = JSON.parse(existing) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      obj = parsed as Record<string, unknown>;
    }
  }
  const existingSect = obj[key];
  const sect =
    existingSect && typeof existingSect === "object" && !Array.isArray(existingSect)
      ? (existingSect as Record<string, unknown>)
      : {};
  sect[serverName] = entry;
  obj[key] = sect;
  return JSON.stringify(obj, null, 2) + "\n";
}

/** A copy-pasteable single-server snippet for the "print, don't write" default. */
export function snippet(key: string, serverName: string, entry: Record<string, unknown>): string {
  return JSON.stringify({ [key]: { [serverName]: entry } }, null, 2);
}
