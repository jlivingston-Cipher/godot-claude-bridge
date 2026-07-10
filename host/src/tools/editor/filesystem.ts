import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gate } from "../../confirm.js";
import type { EditorCall } from "./common.js";

/** Project FileSystem dock ops: list / scan / move / mkdir. */
export function registerFilesystemTools(server: McpServer, call: EditorCall): void {
  server.registerTool(
    "filesystem_list",
    {
      title: "List project directory",
      description:
        "List the subdirectories and files of a directory in the project filesystem (hidden entries like .godot are skipped). Read-only.",
      inputSchema: { path: z.string().optional().describe("Directory res:// path (default res://)") },
    },
    async ({ path }) => call("filesystem.list", path !== undefined ? { path } : {}),
  );

  server.registerTool(
    "filesystem_scan",
    {
      title: "Rescan filesystem",
      description:
        "Trigger an editor rescan of the project filesystem so newly added or externally-changed files are picked up. Read-only side effect.",
      inputSchema: {},
    },
    async () => call("filesystem.scan"),
  );

  server.registerTool(
    "filesystem_move",
    {
      title: "Move / rename file",
      description:
        "Move or rename a file or directory within the project (carrying its .import sidecar), then rescan. DESTRUCTIVE (moves on disk; does NOT remap references in other resources) — gated by confirmation.",
      inputSchema: {
        from_path: z.string().describe("Source res:// path (file or directory)"),
        to_path: z.string().describe("Destination res:// path"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ from_path, to_path, confirm }) => {
      const blocked = await gate(server, confirm, `Move ${from_path} to ${to_path}`);
      if (blocked) return blocked;
      return call("filesystem.move", { from_path, to_path });
    },
  );

  server.registerTool(
    "filesystem_create_dir",
    {
      title: "Create directory",
      description: "Create a directory (recursively) in the project filesystem, then rescan. No-op if it already exists.",
      inputSchema: { path: z.string().describe("Directory res:// path to create") },
    },
    async ({ path }) => call("filesystem.create_dir", { path }),
  );
}
