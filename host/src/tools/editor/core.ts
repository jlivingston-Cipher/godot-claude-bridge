import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gate } from "../../confirm.js";
import type { EditorCall } from "./common.js";

/** Editor session + core project settings (editor_* / project get/set). */
export function registerCoreTools(server: McpServer, call: EditorCall): void {
  server.registerTool(
    "editor_ping",
    { title: "Ping editor bridge", description: "Check that the editor is running with the Breakpoint MCP plugin enabled.", inputSchema: {} },
    async () => call("ping"),
  );

  server.registerTool(
    "editor_get_state",
    { title: "Editor state", description: "Return the currently edited scene, its root type/path, and the current node selection.", inputSchema: {} },
    async () => call("editor.get_state"),
  );

  server.registerTool(
    "editor_undo",
    {
      title: "Undo last edit",
      description:
        "Undo the most recent edit in the editor's undo history (like Ctrl-Z). Defaults to the edited scene's history; pass scope='global' for the editor-wide history. Returns whether an action was undone, its name, and the remaining undo/redo depth.",
      inputSchema: {
        scope: z
          .enum(["scene", "global"])
          .optional()
          .describe("Which history to step: 'scene' (default, the edited scene) or 'global' (editor-wide)"),
      },
    },
    async ({ scope }) => call("edit.undo", scope ? { scope } : {}),
  );

  server.registerTool(
    "editor_redo",
    {
      title: "Redo last undone edit",
      description:
        "Re-apply the most recently undone edit in the editor's undo history (like Ctrl-Shift-Z). Defaults to the edited scene's history; pass scope='global' for the editor-wide history.",
      inputSchema: {
        scope: z
          .enum(["scene", "global"])
          .optional()
          .describe("Which history to step: 'scene' (default, the edited scene) or 'global' (editor-wide)"),
      },
    },
    async ({ scope }) => call("edit.redo", scope ? { scope } : {}),
  );

  server.registerTool(
    "project_get_info",
    { title: "Project info", description: "Return project name, main scene, project root path, Godot version, and feature tags.", inputSchema: {} },
    async () => call("project.get_info"),
  );

  server.registerTool(
    "project_get_setting",
    {
      title: "Get project setting",
      description: "Read a single ProjectSettings value by dotted key (e.g. application/config/name).",
      inputSchema: { name: z.string().describe("ProjectSettings key") },
    },
    async ({ name }) => call("project.get_setting", { name }),
  );

  server.registerTool(
    "project_set_setting",
    {
      title: "Set project setting",
      description: "Write a ProjectSettings value. Set save=true to persist to project.godot. DESTRUCTIVE — gated by confirmation.",
      inputSchema: {
        name: z.string().describe("ProjectSettings key"),
        value: z.any().describe("New value; rich types use the {\"__type__\":...} tagging convention"),
        save: z.boolean().optional().describe("Persist to disk (default false)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ name, value, save, confirm }) => {
      const blocked = await gate(server, confirm, `Set project setting "${name}"${save ? " and save project.godot" : ""}`);
      if (blocked) return blocked;
      return call("project.set_setting", { name, value, save: save ?? false });
    },
  );
}
