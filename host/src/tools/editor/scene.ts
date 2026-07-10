import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gate } from "../../confirm.js";
import type { EditorCall } from "./common.js";

/** Scene lifecycle: open / save / new / reload / pack / dependencies. */
export function registerSceneTools(server: McpServer, call: EditorCall): void {
  server.registerTool(
    "scene_get_tree",
    {
      title: "Get scene tree",
      description: "Return the node tree of the currently edited scene (name, type, path, script, children).",
      inputSchema: { max_depth: z.number().int().positive().optional().describe("Max recursion depth (default 64)") },
    },
    async ({ max_depth }) => call("scene.get_tree", max_depth ? { max_depth } : {}),
  );

  server.registerTool(
    "scene_open",
    {
      title: "Open scene",
      description: "Open an existing scene in the editor by res:// path.",
      inputSchema: { path: z.string().describe("Scene path, e.g. res://scenes/main.tscn") },
    },
    async ({ path }) => call("scene.open", { path }),
  );

  server.registerTool(
    "scene_save",
    { title: "Save scene", description: "Save the currently edited scene to its existing path.", inputSchema: {} },
    async () => call("scene.save"),
  );

  server.registerTool(
    "scene_new",
    {
      title: "New scene",
      description: "Create a new scene with the given root class, save it to a path, and open it. DESTRUCTIVE (writes a file) — gated by confirmation.",
      inputSchema: {
        root_type: z.string().describe("Root node class, e.g. Node2D, Node3D, Control"),
        path: z.string().describe("Where to save, e.g. res://scenes/new.tscn"),
        name: z.string().optional().describe("Root node name (defaults to the class name)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ root_type, path, name, confirm }) => {
      const blocked = await gate(server, confirm, `Create and overwrite scene file "${path}"`);
      if (blocked) return blocked;
      return call("scene.new", { root_type, path, name });
    },
  );

  server.registerTool(
    "scene_list_open",
    {
      title: "List open scenes",
      description:
        "List the res:// paths of all scenes open in the editor, which one is current, and which have unsaved changes. Read-only.",
      inputSchema: {},
    },
    async () => call("scene.list_open"),
  );

  server.registerTool(
    "scene_reload",
    {
      title: "Reload scene from disk",
      description:
        "Reload a scene from disk, discarding unsaved changes to it. DESTRUCTIVE — gated by confirmation. Defaults to the current scene.",
      inputSchema: {
        path: z.string().optional().describe("Scene res:// path; omitted = the current edited scene"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, confirm }) => {
      const blocked = await gate(server, confirm, `Reload scene ${path ?? "(current)"} from disk, discarding unsaved changes`);
      if (blocked) return blocked;
      return call("scene.reload", path !== undefined ? { path } : {});
    },
  );

  server.registerTool(
    "scene_close",
    {
      title: "Close current scene",
      description:
        "Close the current scene tab, discarding unsaved changes. DESTRUCTIVE — gated by confirmation. Only the current scene can be closed; pass its path to assert which one.",
      inputSchema: {
        path: z.string().optional().describe("Optional assertion: must equal the current edited scene's path"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, confirm }) => {
      const blocked = await gate(server, confirm, "Close the current scene, discarding unsaved changes");
      if (blocked) return blocked;
      return call("scene.close", path !== undefined ? { path } : {});
    },
  );

  server.registerTool(
    "scene_pack",
    {
      title: "Pack branch as scene",
      description:
        "Save a node branch (the node and its subtree) as a new PackedScene file. DESTRUCTIVE (writes a file) — gated by confirmation. Does not modify the edited scene.",
      inputSchema: {
        path: z.string().describe("Branch root node path relative to the scene root"),
        to_path: z.string().describe("Where to save the PackedScene, e.g. res://scenes/branch.tscn"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, to_path, confirm }) => {
      const blocked = await gate(server, confirm, `Pack branch "${path}" to ${to_path}`);
      if (blocked) return blocked;
      return call("scene.pack", { path, to_path });
    },
  );

  server.registerTool(
    "scene_get_dependencies",
    {
      title: "Scene dependencies",
      description: "List the external resource dependencies of a scene file. Read-only. Defaults to the current scene.",
      inputSchema: { path: z.string().optional().describe("Scene res:// path; omitted = the current edited scene") },
    },
    async ({ path }) => call("scene.get_dependencies", path !== undefined ? { path } : {}),
  );

  server.registerTool(
    "scene_save_as",
    {
      title: "Save scene as",
      description: "Save the current scene to a new res:// path (Save As). DESTRUCTIVE (writes a file) — gated by confirmation.",
      inputSchema: {
        path: z.string().describe("Destination path, e.g. res://scenes/copy.tscn"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, confirm }) => {
      const blocked = await gate(server, confirm, `Save the current scene to ${path}`);
      if (blocked) return blocked;
      return call("scene.save_as", { path });
    },
  );
}
