import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gate } from "../../confirm.js";
import type { EditorCall } from "./common.js";

/** InputMap, extended project config (autoloads / export presets / main scene / settings), editor settings, and test-framework detection. */
export function registerProjectInputTestTools(server: McpServer, call: EditorCall): void {
  server.registerTool(
    "inputmap_add_action",
    {
      title: "Add input action",
      description:
        "Define a project input action (ProjectSettings input/<name>) with an empty event list and a deadzone. Set save=true to persist to project.godot. DESTRUCTIVE (project-wide input map) — gated by confirmation.",
      inputSchema: {
        name: z.string().describe("Action name (without the input/ prefix)"),
        deadzone: z.number().optional().describe("Analog deadzone 0..1 (default 0.5)"),
        save: z.boolean().optional().describe("Persist to project.godot (default false)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ name, deadzone, save, confirm }) => {
      const blocked = await gate(server, confirm, `Add input action "${name}"${save ? " and save project.godot" : ""}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { name };
      if (deadzone !== undefined) params.deadzone = deadzone;
      if (save !== undefined) params.save = save;
      return call("inputmap.add_action", params);
    },
  );

  server.registerTool(
    "inputmap_add_event",
    {
      title: "Add input event to action",
      description:
        "Append an input event to an existing project input action. 'event' is { type: key|mouse_button|joy_button|joy_motion, ... } — key: keycode or physical_keycode as a name like \"A\"/\"Space\" or an int; mouse_button/joy_button: button_index; joy_motion: axis + axis_value. Set save=true to persist. DESTRUCTIVE — gated by confirmation.",
      inputSchema: {
        name: z.string().describe("Existing action name (without the input/ prefix)"),
        event: z
          .object({
            type: z.enum(["key", "mouse_button", "joy_button", "joy_motion"]).describe("Event type"),
            keycode: z.union([z.string(), z.number()]).optional().describe("Key name or code (type=key)"),
            physical_keycode: z.union([z.string(), z.number()]).optional().describe("Physical key name or code (type=key)"),
            button_index: z.number().optional().describe("Button index (mouse_button/joy_button)"),
            axis: z.number().optional().describe("Joypad axis (joy_motion)"),
            axis_value: z.number().optional().describe("Joypad axis value (joy_motion)"),
          })
          .describe("Input event descriptor"),
        save: z.boolean().optional().describe("Persist to project.godot (default false)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ name, event, save, confirm }) => {
      const blocked = await gate(server, confirm, `Add input event to "${name}"`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { name, event };
      if (save !== undefined) params.save = save;
      return call("inputmap.add_event", params);
    },
  );

  server.registerTool(
    "inputmap_list",
    {
      title: "List input actions",
      description:
        "List all project-defined input actions (ProjectSettings input/*) with their deadzone and events (class + human-readable text). Read-only.",
      inputSchema: {},
    },
    async () => call("inputmap.list"),
  );

  server.registerTool(
    "inputmap_erase_action",
    {
      title: "Erase input action",
      description:
        "Remove a project input action (ProjectSettings input/<name>). Set save=true to persist to project.godot. DESTRUCTIVE — gated by confirmation.",
      inputSchema: {
        name: z.string().describe("Action name (without the input/ prefix)"),
        save: z.boolean().optional().describe("Persist to project.godot (default false)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ name, save, confirm }) => {
      const blocked = await gate(server, confirm, `Erase input action "${name}"${save ? " and save project.godot" : ""}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { name };
      if (save !== undefined) params.save = save;
      return call("inputmap.erase_action", params);
    },
  );

  server.registerTool(
    "project_add_autoload",
    {
      title: "Add autoload singleton",
      description:
        "Register an autoload (ProjectSettings autoload/<name>) pointing at a res:// script or scene, enabled as a global singleton by default. Set save=true to persist to project.godot. DESTRUCTIVE — gated by confirmation.",
      inputSchema: {
        name: z.string().describe("Autoload / singleton name"),
        path: z.string().describe("res:// path to a .gd script or .tscn scene"),
        enabled: z.boolean().optional().describe("Enable as a global singleton (default true)"),
        save: z.boolean().optional().describe("Persist to project.godot (default false)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ name, path, enabled, save, confirm }) => {
      const blocked = await gate(server, confirm, `Add autoload "${name}" -> ${path}${save ? " and save project.godot" : ""}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { name, path };
      if (enabled !== undefined) params.enabled = enabled;
      if (save !== undefined) params.save = save;
      return call("project.add_autoload", params);
    },
  );

  server.registerTool(
    "project_remove_autoload",
    {
      title: "Remove autoload singleton",
      description:
        "Remove an autoload (ProjectSettings autoload/<name>). Set save=true to persist to project.godot. DESTRUCTIVE — gated by confirmation.",
      inputSchema: {
        name: z.string().describe("Autoload / singleton name"),
        save: z.boolean().optional().describe("Persist to project.godot (default false)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ name, save, confirm }) => {
      const blocked = await gate(server, confirm, `Remove autoload "${name}"${save ? " and save project.godot" : ""}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { name };
      if (save !== undefined) params.save = save;
      return call("project.remove_autoload", params);
    },
  );

  server.registerTool(
    "project_add_export_preset",
    {
      title: "Add export preset",
      description:
        "Append an export preset to res://export_presets.cfg for a platform (e.g. \"Windows Desktop\", \"Web\", \"Linux/X11\", \"macOS\"). Returns the preset's index. DESTRUCTIVE (writes export_presets.cfg) — gated by confirmation.",
      inputSchema: {
        name: z.string().describe("Preset display name"),
        platform: z.string().describe("Export platform name as shown in the editor"),
        runnable: z.boolean().optional().describe("Mark the preset runnable (default true)"),
        export_path: z.string().optional().describe("Default export output path"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ name, platform, runnable, export_path, confirm }) => {
      const blocked = await gate(server, confirm, `Add export preset "${name}" (${platform})`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { name, platform };
      if (runnable !== undefined) params.runnable = runnable;
      if (export_path !== undefined) params.export_path = export_path;
      return call("project.add_export_preset", params);
    },
  );

  server.registerTool(
    "project_set_main_scene",
    {
      title: "Set main scene",
      description:
        "Set the project's main scene (ProjectSettings application/run/main_scene) to an existing res:// .tscn/.scn. Set save=true to persist to project.godot. DESTRUCTIVE — gated by confirmation.",
      inputSchema: {
        path: z.string().describe("res:// path to the scene to run first"),
        save: z.boolean().optional().describe("Persist to project.godot (default false)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, save, confirm }) => {
      const blocked = await gate(server, confirm, `Set main scene to ${path}${save ? " and save project.godot" : ""}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { path };
      if (save !== undefined) params.save = save;
      return call("project.set_main_scene", params);
    },
  );

  server.registerTool(
    "project_list_settings",
    {
      title: "List project settings",
      description:
        "List ProjectSettings keys and values, optionally filtered by a dotted-key prefix (e.g. \"input/\", \"autoload/\", \"application/\"). Read-only.",
      inputSchema: {
        prefix: z.string().optional().describe("Only return keys starting with this prefix (default: all)"),
      },
    },
    async ({ prefix }) => call("project.list_settings", prefix !== undefined ? { prefix } : {}),
  );

  server.registerTool(
    "editorsettings_get_set",
    {
      title: "Get or set an editor setting",
      description:
        "Read an EditorSettings value by name; if 'value' is provided, write it instead (persists to the editor's global config). Reading is read-only; writing is DESTRUCTIVE (mutates the editor config) — gated by confirmation.",
      inputSchema: {
        name: z.string().describe("EditorSettings key, e.g. interface/editor/code_font_size"),
        value: z.any().optional().describe("If provided, set this value (rich types use the {\"__type__\":...} tagging convention)"),
        confirm: z.boolean().optional().describe("Auto-approve the write (skip the confirmation prompt)"),
      },
    },
    async ({ name, value, confirm }) => {
      if (value !== undefined) {
        const blocked = await gate(server, confirm, `Set editor setting "${name}"`);
        if (blocked) return blocked;
        return call("editorsettings.get_set", { name, value });
      }
      return call("editorsettings.get_set", { name });
    },
  );

  server.registerTool(
    "test_detect",
    {
      title: "Detect test framework",
      description:
        "Detect an installed GDScript test framework (GUT or GdUnit4) in the project. Returns { framework: gut|gdunit4|none, path, version }. Read-only.",
      inputSchema: {},
    },
    async () => call("test.detect"),
  );

  server.registerTool(
    "test_list",
    {
      title: "List test scripts",
      description:
        "List GDScript test scripts (files named test_*.gd or *_test.gd) under a directory (default res://test), searched recursively. Read-only.",
      inputSchema: {
        dir: z.string().optional().describe("Directory to search (default res://test)"),
      },
    },
    async ({ dir }) => call("test.list", dir !== undefined ? { dir } : {}),
  );
}
