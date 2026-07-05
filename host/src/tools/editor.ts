import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BridgeClient, BridgeError } from "../bridge.js";
import { gate } from "../confirm.js";

/**
 * Editor-bridge tools. Each forwards to a method on the in-editor addon over
 * TCP and returns the result as both human-readable text and structuredContent.
 * A friendly, actionable message is returned (isError) when the editor/bridge
 * is not reachable, instead of throwing an opaque protocol error.
 */

function ok(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj as Record<string, unknown>,
  };
}

function fail(err: unknown) {
  const be = err as Partial<BridgeError> & { message?: string };
  const code = be?.code ?? "error";
  const message = be?.message ?? String(err);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Bridge error [${code}]: ${message}` }],
  };
}

export function registerEditorTools(server: McpServer, bridge: BridgeClient): void {
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    try {
      const result = await bridge.request(method, params);
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  };

  server.registerTool(
    "editor_ping",
    { title: "Ping editor bridge", description: "Check that the editor is running with the Claude Bridge plugin enabled.", inputSchema: {} },
    async () => call("ping"),
  );

  server.registerTool(
    "editor_get_state",
    { title: "Editor state", description: "Return the currently edited scene, its root type/path, and the current node selection.", inputSchema: {} },
    async () => call("editor.get_state"),
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
    "node_add",
    {
      title: "Add node",
      description: "Instance a node of the given class under a parent path (undoable). Returns the new node's path.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        type: z.string().describe("Node class to instance, e.g. Sprite2D, AudioStreamPlayer3D"),
        name: z.string().optional().describe("Node name (defaults to the class name)"),
      },
    },
    async ({ parent_path, type, name }) => call("node.add", { parent_path, type, name }),
  );

  server.registerTool(
    "node_delete",
    {
      title: "Delete node",
      description: "Delete a node (undoable). DESTRUCTIVE — gated by confirmation. Refuses to delete the scene root.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, confirm }) => {
      const blocked = await gate(server, confirm, `Delete node "${path}"`);
      if (blocked) return blocked;
      return call("node.delete", { path });
    },
  );

  server.registerTool(
    "node_rename",
    {
      title: "Rename node",
      description: "Rename a node (undoable).",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        new_name: z.string().describe("New node name"),
      },
    },
    async ({ path, new_name }) => call("node.rename", { path, new_name }),
  );

  server.registerTool(
    "node_reparent",
    {
      title: "Reparent node",
      description: "Move a node under a new parent (undoable).",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        new_parent_path: z.string().describe("New parent path; \".\" for the root"),
        keep_global_transform: z.boolean().optional().describe("Preserve global transform (default true)"),
      },
    },
    async ({ path, new_parent_path, keep_global_transform }) =>
      call("node.reparent", { path, new_parent_path, keep_global_transform: keep_global_transform ?? true }),
  );

  server.registerTool(
    "node_set_property",
    {
      title: "Set node property",
      description:
        "Set a property on a node (undoable). Rich types use the {\"__type__\":\"Vector3\",\"x\":..} convention. " +
        "Example value for position: {\"__type__\":\"Vector3\",\"x\":1,\"y\":0,\"z\":2}.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        property: z.string().describe("Property name, e.g. position, modulate, text"),
        value: z.any().describe("New value (JSON scalar, array, object, or a __type__-tagged Variant)"),
      },
    },
    async ({ path, property, value }) => call("node.set_property", { path, property, value }),
  );

  server.registerTool(
    "node_get_property",
    {
      title: "Get node property",
      description: "Read a single property from a node. Rich types come back __type__-tagged.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        property: z.string().describe("Property name"),
      },
    },
    async ({ path, property }) => call("node.get_property", { path, property }),
  );

  server.registerTool(
    "selection_get",
    { title: "Get selection", description: "Return the paths of the nodes currently selected in the editor.", inputSchema: {} },
    async () => call("selection.get"),
  );

  server.registerTool(
    "selection_set",
    {
      title: "Set selection",
      description: "Replace the editor's node selection with the given node paths.",
      inputSchema: { paths: z.array(z.string()).describe("Node paths relative to the scene root") },
    },
    async ({ paths }) => call("selection.set", { paths }),
  );

  server.registerTool(
    "classdb_get_class",
    {
      title: "Introspect class",
      description: "Return the parent class, methods, properties, and signals of an engine class via ClassDB.",
      inputSchema: {
        class_name: z.string().describe("Engine class name, e.g. AudioStreamPlayer3D"),
        include_inherited: z.boolean().optional().describe("Include inherited members (default false)"),
      },
    },
    async ({ class_name, include_inherited }) =>
      call("classdb.get_class", { class_name, include_inherited: include_inherited ?? false }),
  );

  server.registerTool(
    "screenshot_editor",
    {
      title: "Screenshot editor viewport",
      description:
        "Capture the 2D or 3D editor viewport as a PNG and return it as image content so Claude can see the scene. " +
        "Requires the matching editor tab (2D/3D) to be active and rendered.",
      inputSchema: { viewport: z.enum(["2d", "3d"]).optional().describe("Which viewport (default 3d)") },
    },
    async ({ viewport }) => {
      try {
        const r = (await bridge.request("screenshot.editor_viewport", { viewport: viewport ?? "3d" })) as {
          base64: string;
          mime: string;
          width: number;
          height: number;
          viewport: string;
        };
        return {
          content: [
            { type: "image" as const, data: r.base64, mimeType: r.mime },
            { type: "text" as const, text: `Captured ${r.viewport} viewport (${r.width}x${r.height}).` },
          ],
        };
      } catch (err) {
        return fail(err);
      }
    },
  );
}
