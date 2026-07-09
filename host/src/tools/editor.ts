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
    "node_duplicate",
    {
      title: "Duplicate node",
      description: "Duplicate a node and its children under the same parent (undoable). Returns the new node's path.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        name: z.string().optional().describe("Name for the duplicate (defaults to Godot's auto-numbered name)"),
      },
    },
    async ({ path, name }) => call("node.duplicate", name !== undefined ? { path, name } : { path }),
  );

  server.registerTool(
    "node_get_children",
    {
      title: "Get node children",
      description: "List the direct children of a node (name, type, path). Read-only.",
      inputSchema: { path: z.string().describe("Node path relative to the scene root; \".\" for the root") },
    },
    async ({ path }) => call("node.get_children", { path }),
  );

  server.registerTool(
    "node_find",
    {
      title: "Find nodes",
      description: "Search a node's descendants by class and/or name substring (case-insensitive). Read-only.",
      inputSchema: {
        root_path: z.string().optional().describe("Where to search from; \".\" or omitted for the scene root"),
        type: z.string().optional().describe("Only match nodes of this class (is_class), e.g. Sprite2D"),
        name_contains: z.string().optional().describe("Only match nodes whose name contains this substring"),
        limit: z.number().int().positive().optional().describe("Max matches to return (default 200)"),
      },
    },
    async ({ root_path, type, name_contains, limit }) =>
      call("node.find", {
        root_path: root_path ?? ".",
        type: type ?? "",
        name_contains: name_contains ?? "",
        limit: limit ?? 200,
      }),
  );

  server.registerTool(
    "node_list_groups",
    {
      title: "List node groups",
      description: "List the groups a node belongs to. Read-only.",
      inputSchema: { path: z.string().describe("Node path relative to the scene root") },
    },
    async ({ path }) => call("node.list_groups", { path }),
  );

  server.registerTool(
    "node_add_to_group",
    {
      title: "Add node to group",
      description: "Add a node to a group (persistent, undoable). No-op if already a member.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        group: z.string().describe("Group name"),
      },
    },
    async ({ path, group }) => call("node.add_to_group", { path, group }),
  );

  server.registerTool(
    "node_remove_from_group",
    {
      title: "Remove node from group",
      description: "Remove a node from a group (undoable). No-op if not a member.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        group: z.string().describe("Group name"),
      },
    },
    async ({ path, group }) => call("node.remove_from_group", { path, group }),
  );

  server.registerTool(
    "node_instantiate_scene",
    {
      title: "Instance scene under node",
      description:
        "Instance an external PackedScene (res:// path) as an editable child of a parent node (undoable). Returns the new node's path.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        scene_path: z.string().describe("Scene to instance, e.g. res://actors/enemy.tscn"),
        name: z.string().optional().describe("Node name (defaults to the instanced scene's root name)"),
      },
    },
    async ({ parent_path, scene_path, name }) =>
      call("node.instantiate_scene", name !== undefined ? { parent_path, scene_path, name } : { parent_path, scene_path }),
  );

  server.registerTool(
    "node_move_child",
    {
      title: "Move child",
      description: "Reorder a node among its siblings by index (undoable). Negative indices count from the end (-1 = last).",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        to_index: z.number().int().describe("New sibling index (0-based; negative counts from the end)"),
      },
    },
    async ({ path, to_index }) => call("node.move_child", { path, to_index }),
  );

  server.registerTool(
    "node_change_type",
    {
      title: "Change node type",
      description:
        "Replace a node with a new node of a different class, carrying over compatible properties, children, and groups (undoable). Refuses the scene root.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        type: z.string().describe("New node class, e.g. Sprite2D, StaticBody3D"),
      },
    },
    async ({ path, type }) => call("node.change_type", { path, type }),
  );

  server.registerTool(
    "node_set_owner",
    {
      title: "Set node owner",
      description:
        "Set a node's owner (undoable). Owner must be an ancestor; \".\" or omitted sets the scene root. Ownership determines which scene a node is saved into.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        owner_path: z.string().optional().describe("Ancestor to own the node; \".\" or omitted for the scene root"),
      },
    },
    async ({ path, owner_path }) =>
      call("node.set_owner", owner_path !== undefined ? { path, owner_path } : { path }),
  );

  server.registerTool(
    "node_call_method",
    {
      title: "Call node method (edit-time)",
      description:
        "Invoke a method on a node in the EDITED scene. DESTRUCTIVE (arbitrary invocation, not undoable) — gated by confirmation. " +
        "Args use the tagged-Variant convention; the return value comes back tagged.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        method: z.string().describe("Method name"),
        args: z.array(z.any()).optional().describe("Positional arguments (JSON scalars or __type__-tagged Variants)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, method, args, confirm }) => {
      const blocked = await gate(server, confirm, `Call ${path}.${method}() in the edited scene`);
      if (blocked) return blocked;
      return call("node.call_method", { path, method, args: args ?? [] });
    },
  );

  server.registerTool(
    "node_get_path",
    {
      title: "Get node path",
      description: "Return a node's scene-relative path, class, sibling index, parent path, and child count. Read-only.",
      inputSchema: { path: z.string().describe("Node path relative to the scene root; \".\" for the root") },
    },
    async ({ path }) => call("node.get_path", { path }),
  );

  server.registerTool(
    "node_list_properties",
    {
      title: "List node properties",
      description:
        "List a node's inspector-visible properties (name, Variant type, class_name, usage flags). Read-only. Use node_get_property to read a value.",
      inputSchema: { path: z.string().describe("Node path relative to the scene root") },
    },
    async ({ path }) => call("node.list_properties", { path }),
  );

  server.registerTool(
    "signal_list",
    {
      title: "List node signals",
      description: "List the signals a node declares (name and argument names), including user signals. Read-only.",
      inputSchema: { path: z.string().describe("Node path relative to the scene root") },
    },
    async ({ path }) => call("signal.list", { path }),
  );

  server.registerTool(
    "signal_list_connections",
    {
      title: "List signal connections",
      description:
        "List a node's outgoing signal connections (signal, target node path, method, flags). Optionally filter to one signal. Read-only.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        signal: z.string().optional().describe("Only list connections for this signal"),
      },
    },
    async ({ path, signal }) => call("signal.list_connections", signal !== undefined ? { path, signal } : { path }),
  );

  server.registerTool(
    "signal_connect",
    {
      title: "Connect signal",
      description:
        "Connect a source node's signal to a target node's method (undoable). Persistent by default (flags=2, CONNECT_PERSIST) so it saves into the scene. No-op if already connected.",
      inputSchema: {
        path: z.string().describe("Source node path (emitter)"),
        signal: z.string().describe("Signal name on the source"),
        target_path: z.string().describe("Target node path (receiver)"),
        method: z.string().describe("Method to call on the target"),
        flags: z.number().int().optional().describe("Object.ConnectFlags bitmask (default 2 = CONNECT_PERSIST)"),
      },
    },
    async ({ path, signal, target_path, method, flags }) =>
      call("signal.connect", flags !== undefined ? { path, signal, target_path, method, flags } : { path, signal, target_path, method }),
  );

  server.registerTool(
    "signal_disconnect",
    {
      title: "Disconnect signal",
      description: "Disconnect a source node's signal from a target node's method (undoable). No-op if not connected.",
      inputSchema: {
        path: z.string().describe("Source node path (emitter)"),
        signal: z.string().describe("Signal name on the source"),
        target_path: z.string().describe("Target node path (receiver)"),
        method: z.string().describe("Connected method on the target"),
      },
    },
    async ({ path, signal, target_path, method }) => call("signal.disconnect", { path, signal, target_path, method }),
  );

  server.registerTool(
    "signal_add_user_signal",
    {
      title: "Add user signal",
      description: "Declare a new user signal on a node (undoable). Optional typed arguments. Errors if the signal already exists.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        signal: z.string().describe("New signal name"),
        args: z
          .array(z.object({ name: z.string(), type: z.number().int().optional() }))
          .optional()
          .describe("Signal parameters (name + Variant type int)"),
      },
    },
    async ({ path, signal, args }) => call("signal.add_user_signal", args !== undefined ? { path, signal, args } : { path, signal }),
  );

  server.registerTool(
    "signal_emit",
    {
      title: "Emit signal (edit-time)",
      description:
        "Emit a signal from a node in the EDITED scene, firing its connected callables now. DESTRUCTIVE (edit-time side effects) — gated by confirmation. Args use the tagged-Variant convention.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        signal: z.string().describe("Signal name"),
        args: z.array(z.any()).optional().describe("Signal arguments (JSON scalars or __type__-tagged Variants)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, signal, args, confirm }) => {
      const blocked = await gate(server, confirm, `Emit signal "${signal}" from ${path} in the edited scene`);
      if (blocked) return blocked;
      return call("signal.emit", { path, signal, args: args ?? [] });
    },
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

  // ---- Group B: resources (operations.gd _resource_*) ----

  server.registerTool(
    "resource_create",
    {
      title: "Create resource",
      description:
        "Instantiate a Resource subclass and save it as a new file. DESTRUCTIVE (writes a file) — gated by confirmation. Optional initial properties use the tagged-Variant convention.",
      inputSchema: {
        class_name: z.string().describe("Resource subclass to instantiate, e.g. StyleBoxFlat, Theme, GDScript"),
        to_path: z.string().describe("Destination res:// path, e.g. res://styles/panel.tres"),
        properties: z.record(z.any()).optional().describe("Initial property values (JSON scalars or __type__-tagged Variants)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ class_name, to_path, properties, confirm }) => {
      const blocked = await gate(server, confirm, `Create ${class_name} resource at ${to_path}`);
      if (blocked) return blocked;
      return call("resource.create", properties !== undefined ? { class_name, to_path, properties } : { class_name, to_path });
    },
  );

  server.registerTool(
    "resource_load",
    {
      title: "Load resource",
      description: "Load a resource file and return its class, resource_name, and inspector-visible property list. Read-only.",
      inputSchema: { path: z.string().describe("Resource res:// path") },
    },
    async ({ path }) => call("resource.load", { path }),
  );

  server.registerTool(
    "resource_save",
    {
      title: "Save resource",
      description:
        "Load a resource and (re-)save it, optionally to a new path and with ResourceSaver flags. DESTRUCTIVE (writes a file) — gated by confirmation. Shares subresources by reference; use resource_duplicate for an independent copy.",
      inputSchema: {
        from_path: z.string().describe("Source resource res:// path"),
        to_path: z.string().optional().describe("Destination res:// path (default: overwrite from_path)"),
        flags: z.number().int().optional().describe("ResourceSaver.SaverFlags bitmask (e.g. 32 = FLAG_COMPRESS)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ from_path, to_path, flags, confirm }) => {
      const blocked = await gate(server, confirm, `Save resource ${from_path}${to_path ? ` to ${to_path}` : ""}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { from_path };
      if (to_path !== undefined) params.to_path = to_path;
      if (flags !== undefined) params.flags = flags;
      return call("resource.save", params);
    },
  );

  server.registerTool(
    "resource_duplicate",
    {
      title: "Duplicate resource",
      description:
        "Load a resource, duplicate it (optionally deep, cloning subresources), and save the copy to a new path. DESTRUCTIVE (writes a file) — gated by confirmation.",
      inputSchema: {
        path: z.string().describe("Source resource res:// path"),
        to_path: z.string().describe("Destination res:// path for the copy"),
        deep: z.boolean().optional().describe("Deep-duplicate subresources (default false)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, to_path, deep, confirm }) => {
      const blocked = await gate(server, confirm, `Duplicate resource ${path} to ${to_path}`);
      if (blocked) return blocked;
      return call("resource.duplicate", deep !== undefined ? { path, to_path, deep } : { path, to_path });
    },
  );

  server.registerTool(
    "resource_get_property",
    {
      title: "Get resource property",
      description: "Read a single property of a resource file by name. Read-only. The value comes back tagged (Variant convention).",
      inputSchema: {
        path: z.string().describe("Resource res:// path"),
        property: z.string().describe("Property name"),
      },
    },
    async ({ path, property }) => call("resource.get_property", { path, property }),
  );

  server.registerTool(
    "resource_set_property",
    {
      title: "Set resource property",
      description:
        "Set a single property on a resource file and save it. DESTRUCTIVE (writes a file) — gated by confirmation. The value uses the tagged-Variant convention.",
      inputSchema: {
        path: z.string().describe("Resource res:// path"),
        property: z.string().describe("Property name"),
        value: z.any().describe("New value (JSON scalar or __type__-tagged Variant)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, property, value, confirm }) => {
      const blocked = await gate(server, confirm, `Set ${property} on ${path}`);
      if (blocked) return blocked;
      return call("resource.set_property", { path, property, value });
    },
  );

  server.registerTool(
    "resource_get_import_settings",
    {
      title: "Get import settings",
      description:
        "Read an asset's import metadata (.import): the importer and its parameters. Read-only. Returns imported=false when the asset has no .import sidecar.",
      inputSchema: { path: z.string().describe("Asset res:// path (e.g. res://icon.png)") },
    },
    async ({ path }) => call("resource.get_import_settings", { path }),
  );

  server.registerTool(
    "resource_set_import_settings",
    {
      title: "Set import settings",
      description:
        "Update import parameters in an asset's .import metadata and trigger a reimport. DESTRUCTIVE (rewrites metadata + reimports) — gated by confirmation. Errors if the asset has no .import sidecar.",
      inputSchema: {
        path: z.string().describe("Asset res:// path"),
        settings: z.record(z.any()).describe("Import params to set (name -> JSON scalar or __type__-tagged Variant)"),
        reimport: z.boolean().optional().describe("Reimport after writing (default true)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, settings, reimport, confirm }) => {
      const blocked = await gate(server, confirm, `Set import settings on ${path} and reimport`);
      if (blocked) return blocked;
      return call("resource.set_import_settings", reimport !== undefined ? { path, settings, reimport } : { path, settings });
    },
  );

  // ---- Group B: filesystem (operations.gd _filesystem_*) ----

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

  // ---- Group C: animation authoring (undoable in-scene mutations) ----
  server.registerTool(
    "anim_player_create",
    {
      title: "Create AnimationPlayer",
      description:
        "Add an AnimationPlayer node under a parent (undoable). Seeds an empty default animation library so anim_create works immediately.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        name: z.string().optional().describe("Node name (default \"AnimationPlayer\")"),
      },
    },
    async ({ parent_path, name }) => call("anim.player_create", { parent_path, name }),
  );

  server.registerTool(
    "anim_create",
    {
      title: "Create animation",
      description:
        "Create an empty Animation in an AnimationPlayer's library (undoable). Creates the library if it does not exist yet.",
      inputSchema: {
        player_path: z.string().describe("AnimationPlayer node path relative to the scene root"),
        name: z.string().describe("Animation name (unique within its library)"),
        library: z.string().optional().describe("Animation library name (default \"\", the player's default library)"),
      },
    },
    async ({ player_path, name, library }) => call("anim.create", { player_path, name, library: library ?? "" }),
  );

  server.registerTool(
    "anim_delete",
    {
      title: "Delete animation",
      description:
        "Delete an Animation from an AnimationPlayer's library (undoable). DESTRUCTIVE — gated by confirmation.",
      inputSchema: {
        player_path: z.string().describe("AnimationPlayer node path relative to the scene root"),
        name: z.string().describe("Animation name"),
        library: z.string().optional().describe("Animation library name (default \"\")"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ player_path, name, library, confirm }) => {
      const blocked = await gate(server, confirm, `Delete animation "${name}"`);
      if (blocked) return blocked;
      return call("anim.delete", { player_path, name, library: library ?? "" });
    },
  );

  server.registerTool(
    "anim_add_track",
    {
      title: "Add animation track",
      description:
        "Add a track to an Animation and set its target path (undoable). Returns the new track index.",
      inputSchema: {
        player_path: z.string().describe("AnimationPlayer node path"),
        name: z.string().describe("Animation name"),
        path: z.string().describe("Track target: a node path, or \"Node:property\" for value tracks (e.g. \"Sprite2D:position\")"),
        type: z
          .string()
          .optional()
          .describe("Track type: value (default), position_3d, rotation_3d, scale_3d, blend_shape, method, bezier, audio, animation"),
        library: z.string().optional().describe("Animation library name (default \"\")"),
      },
    },
    async ({ player_path, name, path, type, library }) =>
      call("anim.add_track", { player_path, name, path, type: type ?? "value", library: library ?? "" }),
  );

  server.registerTool(
    "anim_insert_key",
    {
      title: "Insert animation key",
      description:
        "Insert a keyframe on a track at a given time (undoable). A key already at that exact time is overwritten.",
      inputSchema: {
        player_path: z.string().describe("AnimationPlayer node path"),
        name: z.string().describe("Animation name"),
        track: z.number().int().describe("Track index"),
        time: z.number().describe("Key time in seconds"),
        value: z.any().describe("Key value (JSON scalar, array, object, or a __type__-tagged Variant matching the track type)"),
        transition: z.number().optional().describe("Transition curve exponent (default 1.0)"),
        library: z.string().optional().describe("Animation library name (default \"\")"),
      },
    },
    async ({ player_path, name, track, time, value, transition, library }) =>
      call("anim.insert_key", { player_path, name, track, time, value, transition: transition ?? 1.0, library: library ?? "" }),
  );

  server.registerTool(
    "anim_remove_key",
    {
      title: "Remove animation key",
      description: "Remove a keyframe by index from a track (undoable).",
      inputSchema: {
        player_path: z.string().describe("AnimationPlayer node path"),
        name: z.string().describe("Animation name"),
        track: z.number().int().describe("Track index"),
        key: z.number().int().describe("Key index within the track"),
        library: z.string().optional().describe("Animation library name (default \"\")"),
      },
    },
    async ({ player_path, name, track, key, library }) =>
      call("anim.remove_key", { player_path, name, track, key, library: library ?? "" }),
  );

  server.registerTool(
    "anim_set_length",
    {
      title: "Set animation length",
      description: "Set an Animation's length in seconds (undoable).",
      inputSchema: {
        player_path: z.string().describe("AnimationPlayer node path"),
        name: z.string().describe("Animation name"),
        length: z.number().describe("New length in seconds (> 0)"),
        library: z.string().optional().describe("Animation library name (default \"\")"),
      },
    },
    async ({ player_path, name, length, library }) =>
      call("anim.set_length", { player_path, name, length, library: library ?? "" }),
  );

  server.registerTool(
    "anim_set_loop",
    {
      title: "Set animation loop mode",
      description: "Set an Animation's loop mode (undoable).",
      inputSchema: {
        player_path: z.string().describe("AnimationPlayer node path"),
        name: z.string().describe("Animation name"),
        mode: z.string().describe("Loop mode: none, linear, or pingpong"),
        library: z.string().optional().describe("Animation library name (default \"\")"),
      },
    },
    async ({ player_path, name, mode, library }) =>
      call("anim.set_loop", { player_path, name, mode, library: library ?? "" }),
  );

  server.registerTool(
    "anim_get_track_keys",
    {
      title: "Get animation track keys",
      description: "List all keyframes on a track (index, time, value, transition). Read-only.",
      inputSchema: {
        player_path: z.string().describe("AnimationPlayer node path"),
        name: z.string().describe("Animation name"),
        track: z.number().int().describe("Track index"),
        library: z.string().optional().describe("Animation library name (default \"\")"),
      },
    },
    async ({ player_path, name, track, library }) =>
      call("anim.get_track_keys", { player_path, name, track, library: library ?? "" }),
  );

  server.registerTool(
    "anim_list",
    {
      title: "List animations",
      description:
        "List all animations in an AnimationPlayer across its libraries, with length, loop mode, and track count. Read-only.",
      inputSchema: {
        player_path: z.string().describe("AnimationPlayer node path"),
      },
    },
    async ({ player_path }) => call("anim.list", { player_path }),
  );

  // ---- Group C batch 2: AnimationTree + state machine (undoable in-scene) ----
  server.registerTool(
    "anim_tree_create",
    {
      title: "Create AnimationTree",
      description:
        "Add an AnimationTree node under a parent (undoable) with a fresh tree_root graph. root_type \"blend_tree\" (AnimationNodeBlendTree) or \"state_machine\" (AnimationNodeStateMachine). Created inactive by default; set anim_player_path to the AnimationPlayer it should drive.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        name: z.string().optional().describe("Node name (default \"AnimationTree\")"),
        root_type: z.enum(["blend_tree", "state_machine"]).optional().describe("tree_root graph type (default blend_tree)"),
        anim_player_path: z.string().optional().describe("NodePath to the AnimationPlayer this tree drives, relative to the AnimationTree node"),
        active: z.boolean().optional().describe("Whether the tree processes immediately (default false)"),
      },
    },
    async ({ parent_path, name, root_type, anim_player_path, active }) =>
      call("anim.tree_create", { parent_path, name, root_type: root_type ?? "blend_tree", anim_player_path: anim_player_path ?? "", active: active ?? false }),
  );

  server.registerTool(
    "anim_tree_add_node",
    {
      title: "Add AnimationTree graph node",
      description:
        "Add a node to an AnimationTree's tree_root graph (AnimationNodeBlendTree or AnimationNodeStateMachine), undoable. node_type is any AnimationNode subclass (e.g. AnimationNodeAnimation, AnimationNodeBlend2, AnimationNodeStateMachine). For AnimationNodeAnimation, pass animation to bind a clip.",
      inputSchema: {
        tree_path: z.string().describe("AnimationTree node path relative to the scene root"),
        node_name: z.string().describe("Unique node name within the graph"),
        node_type: z.string().describe("AnimationNode subclass to instantiate (e.g. AnimationNodeAnimation)"),
        animation: z.string().optional().describe("For AnimationNodeAnimation: the animation name to play"),
        position: z.array(z.number()).optional().describe("Graph editor position [x, y] (default [0, 0])"),
      },
    },
    async ({ tree_path, node_name, node_type, animation, position }) =>
      call("anim.tree_add_node", { tree_path, node_name, node_type, animation, position }),
  );

  server.registerTool(
    "anim_statemachine_add_state",
    {
      title: "Add state machine state",
      description:
        "Add a state to an AnimationNodeStateMachine (undoable). Targets the AnimationTree's tree_root when it is a state machine, or a nested state-machine node via state_machine. Defaults the state to an AnimationNodeAnimation; pass animation to bind a clip.",
      inputSchema: {
        tree_path: z.string().describe("AnimationTree node path relative to the scene root"),
        state_name: z.string().describe("Unique state name within the state machine"),
        animation: z.string().optional().describe("For an AnimationNodeAnimation state: the animation name to play"),
        node_type: z.string().optional().describe("AnimationNode subclass for the state (default AnimationNodeAnimation)"),
        state_machine: z.string().optional().describe("Name of a nested AnimationNodeStateMachine node within tree_root; omit to target tree_root itself"),
        position: z.array(z.number()).optional().describe("Graph editor position [x, y] (default [0, 0])"),
      },
    },
    async ({ tree_path, state_name, animation, node_type, state_machine, position }) =>
      call("anim.statemachine_add_state", { tree_path, state_name, animation, node_type: node_type ?? "AnimationNodeAnimation", state_machine: state_machine ?? "", position }),
  );

  server.registerTool(
    "anim_statemachine_add_transition",
    {
      title: "Add state machine transition",
      description:
        "Add a transition between two states in an AnimationNodeStateMachine (undoable). from_state/to_state must exist (or be the built-in \"Start\"/\"End\"). switch_mode: immediate|sync|at_end; advance_mode: disabled|enabled|auto.",
      inputSchema: {
        tree_path: z.string().describe("AnimationTree node path relative to the scene root"),
        from_state: z.string().describe("Source state name (or \"Start\")"),
        to_state: z.string().describe("Destination state name (or \"End\")"),
        state_machine: z.string().optional().describe("Name of a nested AnimationNodeStateMachine node within tree_root; omit to target tree_root itself"),
        xfade_time: z.number().optional().describe("Cross-fade time in seconds (default 0)"),
        switch_mode: z.enum(["immediate", "sync", "at_end"]).optional().describe("Switch mode (default immediate)"),
        advance_mode: z.enum(["disabled", "enabled", "auto"]).optional().describe("Advance mode (default enabled)"),
        advance_condition: z.string().optional().describe("Advance condition parameter name (used with advance_mode auto)"),
        priority: z.number().int().optional().describe("Transition priority (lower wins when multiple are valid)"),
      },
    },
    async ({ tree_path, from_state, to_state, state_machine, xfade_time, switch_mode, advance_mode, advance_condition, priority }) =>
      call("anim.statemachine_add_transition", { tree_path, from_state, to_state, state_machine: state_machine ?? "", xfade_time: xfade_time ?? 0.0, switch_mode: switch_mode ?? "immediate", advance_mode: advance_mode ?? "enabled", advance_condition: advance_condition ?? "", priority }),
  );

  // ---- Group D: TileSet (operations.gd _tileset_*; disk-backed .tres, gated writers) ----
  server.registerTool(
    "tileset_create",
    {
      title: "Create TileSet",
      description:
        "Instantiate a TileSet resource and save it as a new .tres file. DESTRUCTIVE (writes a file) — gated by confirmation. tile_size is the base grid cell size in pixels (default 16×16).",
      inputSchema: {
        to_path: z.string().describe("Destination res:// path, e.g. res://tiles/world.tres"),
        tile_size: z.array(z.number().int()).optional().describe("Base tile grid size [x, y] in pixels (default [16, 16])"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ to_path, tile_size, confirm }) => {
      const blocked = await gate(server, confirm, `Create TileSet resource at ${to_path}`);
      if (blocked) return blocked;
      return call("tileset.create", tile_size !== undefined ? { to_path, tile_size } : { to_path });
    },
  );

  server.registerTool(
    "tileset_add_source",
    {
      title: "Add TileSet atlas source",
      description:
        "Add a TileSetAtlasSource (backed by a Texture2D) to a TileSet .tres and re-save. DESTRUCTIVE (writes a file) — gated by confirmation. texture_region_size defaults to the TileSet's tile_size; source_id -1 auto-assigns.",
      inputSchema: {
        tileset_path: z.string().describe("TileSet res:// .tres path"),
        texture_path: z.string().describe("Texture2D res:// path used as the atlas image"),
        texture_region_size: z.array(z.number().int()).optional().describe("Atlas cell size [x, y] in pixels (default = tile_size)"),
        source_id: z.number().int().optional().describe("Explicit source id, or -1 to auto-assign (default -1)"),
        margins: z.array(z.number().int()).optional().describe("Atlas margins [x, y] in pixels"),
        separation: z.array(z.number().int()).optional().describe("Atlas separation [x, y] in pixels"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ tileset_path, texture_path, texture_region_size, source_id, margins, separation, confirm }) => {
      const blocked = await gate(server, confirm, `Add atlas source (${texture_path}) to TileSet ${tileset_path}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { tileset_path, texture_path };
      if (texture_region_size !== undefined) params.texture_region_size = texture_region_size;
      if (source_id !== undefined) params.source_id = source_id;
      if (margins !== undefined) params.margins = margins;
      if (separation !== undefined) params.separation = separation;
      return call("tileset.add_source", params);
    },
  );

  server.registerTool(
    "tileset_add_tile",
    {
      title: "Add TileSet tile",
      description:
        "Create a tile at atlas_coords in an atlas source of a TileSet .tres and re-save. DESTRUCTIVE (writes a file) — gated by confirmation. size is measured in atlas cells (default [1, 1]).",
      inputSchema: {
        tileset_path: z.string().describe("TileSet res:// .tres path"),
        source_id: z.number().int().describe("Atlas source id within the TileSet"),
        atlas_coords: z.array(z.number().int()).describe("Tile atlas coordinates [x, y] (in cells)"),
        size: z.array(z.number().int()).optional().describe("Tile size in atlas cells [x, y] (default [1, 1])"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ tileset_path, source_id, atlas_coords, size, confirm }) => {
      const blocked = await gate(server, confirm, `Add tile ${JSON.stringify(atlas_coords)} to source ${source_id} in ${tileset_path}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { tileset_path, source_id, atlas_coords };
      if (size !== undefined) params.size = size;
      return call("tileset.add_tile", params);
    },
  );

  server.registerTool(
    "tileset_set_tile_collision",
    {
      title: "Set tile collision polygon",
      description:
        "Add a collision polygon to a tile on a TileSet physics layer and re-save. DESTRUCTIVE (writes a file) — gated by confirmation. Physics layers are created as needed. polygon is an array of [x, y] points (>= 3), tile-local pixels.",
      inputSchema: {
        tileset_path: z.string().describe("TileSet res:// .tres path"),
        source_id: z.number().int().describe("Atlas source id within the TileSet"),
        atlas_coords: z.array(z.number().int()).describe("Tile atlas coordinates [x, y] (in cells)"),
        polygon: z.array(z.array(z.number())).describe("Collision polygon points [[x, y], ...] (>= 3), tile-local pixels"),
        physics_layer: z.number().int().optional().describe("TileSet physics layer index (default 0; created if missing)"),
        one_way: z.boolean().optional().describe("Mark the polygon as one-way collision"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ tileset_path, source_id, atlas_coords, polygon, physics_layer, one_way, confirm }) => {
      const blocked = await gate(server, confirm, `Set collision on tile ${JSON.stringify(atlas_coords)} in ${tileset_path}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { tileset_path, source_id, atlas_coords, polygon };
      if (physics_layer !== undefined) params.physics_layer = physics_layer;
      if (one_way !== undefined) params.one_way = one_way;
      return call("tileset.set_tile_collision", params);
    },
  );

  // ---- Group D batch 2: TileMapLayer + cell painting (operations.gd _tilemap*; in-scene, undoable, ungated) ----
  server.registerTool(
    "tilemaplayer_create",
    {
      title: "Create TileMapLayer",
      description:
        "Add a TileMapLayer node under a parent in the edited scene (undoable), optionally binding a TileSet .tres so cells can be painted. In-scene and undoable — not gated.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        name: z.string().optional().describe("Node name (default \"TileMapLayer\")"),
        tileset_path: z.string().optional().describe("TileSet res:// .tres path to bind as tile_set (e.g. from tileset_create)"),
      },
    },
    async ({ parent_path, name, tileset_path }) => {
      const params: Record<string, unknown> = { parent_path };
      if (name !== undefined) params.name = name;
      if (tileset_path !== undefined) params.tileset_path = tileset_path;
      return call("tilemaplayer.create", params);
    },
  );

  server.registerTool(
    "tilemap_set_cell",
    {
      title: "Set TileMapLayer cell",
      description:
        "Paint a single cell on a TileMapLayer (undoable). source_id -1 erases the cell (default). atlas_coords defaults to [0, 0]; alternative defaults to 0.",
      inputSchema: {
        path: z.string().describe("TileMapLayer node path relative to the scene root"),
        coords: z.array(z.number().int()).describe("Cell coordinates [x, y] (in cells)"),
        source_id: z.number().int().optional().describe("Atlas source id from the bound TileSet, or -1 to erase (default -1)"),
        atlas_coords: z.array(z.number().int()).optional().describe("Tile atlas coordinates [x, y] within the source (default [0, 0])"),
        alternative: z.number().int().optional().describe("Alternative tile id (default 0)"),
      },
    },
    async ({ path, coords, source_id, atlas_coords, alternative }) => {
      const params: Record<string, unknown> = { path, coords };
      if (source_id !== undefined) params.source_id = source_id;
      if (atlas_coords !== undefined) params.atlas_coords = atlas_coords;
      if (alternative !== undefined) params.alternative = alternative;
      return call("tilemap.set_cell", params);
    },
  );

  server.registerTool(
    "tilemap_set_cells_rect",
    {
      title: "Fill TileMapLayer cells (rect)",
      description:
        "Paint every cell in a rectangular region of a TileMapLayer with one tile (undoable, one action). source_id -1 clears the region. Capped at 65536 cells; split larger fills across calls.",
      inputSchema: {
        path: z.string().describe("TileMapLayer node path relative to the scene root"),
        rect: z.array(z.number().int()).describe("Region [x, y, width, height] in cells (width/height > 0)"),
        source_id: z.number().int().optional().describe("Atlas source id from the bound TileSet, or -1 to clear (default -1)"),
        atlas_coords: z.array(z.number().int()).optional().describe("Tile atlas coordinates [x, y] within the source (default [0, 0])"),
        alternative: z.number().int().optional().describe("Alternative tile id (default 0)"),
      },
    },
    async ({ path, rect, source_id, atlas_coords, alternative }) => {
      const params: Record<string, unknown> = { path, rect };
      if (source_id !== undefined) params.source_id = source_id;
      if (atlas_coords !== undefined) params.atlas_coords = atlas_coords;
      if (alternative !== undefined) params.alternative = alternative;
      return call("tilemap.set_cells_rect", params);
    },
  );

  server.registerTool(
    "tilemap_get_cell",
    {
      title: "Get TileMapLayer cell",
      description:
        "Read one cell of a TileMapLayer. An empty cell reads back as source_id -1, atlas_coords [-1, -1], alternative 0 (empty = true).",
      inputSchema: {
        path: z.string().describe("TileMapLayer node path relative to the scene root"),
        coords: z.array(z.number().int()).describe("Cell coordinates [x, y] (in cells)"),
      },
    },
    async ({ path, coords }) => call("tilemap.get_cell", { path, coords }),
  );

  server.registerTool(
    "tilemap_clear",
    {
      title: "Clear TileMapLayer",
      description:
        "Remove every painted cell from a TileMapLayer (undoable — prior cells are restored on undo). Returns the number of cells cleared.",
      inputSchema: {
        path: z.string().describe("TileMapLayer node path relative to the scene root"),
      },
    },
    async ({ path }) => call("tilemap.clear", { path }),
  );

  // ---- Group E: Physics & collision (operations.gd _body_*/_collisionshape_add; in-scene, undoable, ungated) ----
  server.registerTool(
    "body_create",
    {
      title: "Create physics body",
      description:
        "Add a physics body node under a parent in the edited scene (undoable): a StaticBody, RigidBody, CharacterBody, or Area, in 2D or 3D. In-scene and undoable — not gated. Attach collision shapes with collisionshape_add.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        type: z.enum(["static", "rigid", "character", "area"]).describe("Body kind: static | rigid | character | area"),
        dim: z.enum(["2d", "3d"]).optional().describe("Dimension: \"2d\" (default) or \"3d\""),
        name: z.string().optional().describe("Node name (default the class name, e.g. \"StaticBody2D\")"),
      },
    },
    async ({ parent_path, type, dim, name }) => {
      const params: Record<string, unknown> = { parent_path, type };
      if (dim !== undefined) params.dim = dim;
      if (name !== undefined) params.name = name;
      return call("body.create", params);
    },
  );

  server.registerTool(
    "collisionshape_add",
    {
      title: "Add collision shape",
      description:
        "Add a CollisionShape2D/3D node carrying a shape resource under a parent (usually a body) in the edited scene (undoable). shape is rect | circle | capsule | polygon; dim selects 2D (Rectangle/Circle/Capsule/ConvexPolygon 2D) or 3D (Box/Sphere/Capsule/ConvexPolygon 3D). In-scene and undoable — not gated.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path (usually a body) relative to the scene root; \".\" for the root"),
        shape: z.enum(["rect", "circle", "capsule", "polygon"]).describe("Shape kind: rect | circle | capsule | polygon"),
        dim: z.enum(["2d", "3d"]).optional().describe("Dimension: \"2d\" (default) or \"3d\""),
        name: z.string().optional().describe("Node name (default \"CollisionShape2D\"/\"CollisionShape3D\")"),
        size: z.array(z.number()).optional().describe("rect: [w, h] (2D) or [w, h, d] (3D)"),
        radius: z.number().optional().describe("circle/capsule radius"),
        height: z.number().optional().describe("capsule height"),
        points: z.array(z.array(z.number())).optional().describe("polygon: convex-hull points, [[x, y], …] (2D, ≥3) or [[x, y, z], …] (3D, ≥4)"),
      },
    },
    async ({ parent_path, shape, dim, name, size, radius, height, points }) => {
      const params: Record<string, unknown> = { parent_path, shape };
      if (dim !== undefined) params.dim = dim;
      if (name !== undefined) params.name = name;
      if (size !== undefined) params.size = size;
      if (radius !== undefined) params.radius = radius;
      if (height !== undefined) params.height = height;
      if (points !== undefined) params.points = points;
      return call("collisionshape.add", params);
    },
  );

  server.registerTool(
    "body_set_collision_layer",
    {
      title: "Set collision layer",
      description:
        "Set the collision_layer bitmask on a physics body or area (CollisionObject2D/3D) in the edited scene (undoable). layer is the integer bitmask of layers this object occupies.",
      inputSchema: {
        path: z.string().describe("Body/Area node path relative to the scene root"),
        layer: z.number().int().describe("collision_layer bitmask (non-negative integer)"),
      },
    },
    async ({ path, layer }) => call("body.set_collision_layer", { path, layer }),
  );

  server.registerTool(
    "body_set_collision_mask",
    {
      title: "Set collision mask",
      description:
        "Set the collision_mask bitmask on a physics body or area (CollisionObject2D/3D) in the edited scene (undoable). mask is the integer bitmask of layers this object scans for collisions.",
      inputSchema: {
        path: z.string().describe("Body/Area node path relative to the scene root"),
        mask: z.number().int().describe("collision_mask bitmask (non-negative integer)"),
      },
    },
    async ({ path, mask }) => call("body.set_collision_mask", { path, mask }),
  );

  // ---- Group E batch 2: areas, joints, collision polygons, rigidbody tuning, physics material (in-scene, undoable, ungated) + project gravity (gated) ----
  server.registerTool(
    "area_set_monitoring",
    {
      title: "Set area monitoring",
      description:
        "Set monitoring and/or monitorable on an Area2D/3D in the edited scene (undoable). monitoring = the area detects overlapping bodies/areas; monitorable = other areas can detect it. In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("Area2D/3D node path relative to the scene root"),
        monitoring: z.boolean().optional().describe("Whether the area detects overlapping bodies/areas"),
        monitorable: z.boolean().optional().describe("Whether other areas can detect this area"),
      },
    },
    async ({ path, monitoring, monitorable }) => {
      const params: Record<string, unknown> = { path };
      if (monitoring !== undefined) params.monitoring = monitoring;
      if (monitorable !== undefined) params.monitorable = monitorable;
      return call("area.set_monitoring", params);
    },
  );

  server.registerTool(
    "area_set_gravity",
    {
      title: "Set area gravity",
      description:
        "Set the local gravity override of an Area2D/3D in the edited scene (undoable): space_override mode, gravity magnitude, direction, and whether gravity points toward a center (point). In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("Area2D/3D node path relative to the scene root"),
        space_override: z.enum(["disabled", "combine", "combine_replace", "replace", "replace_combine"]).optional().describe("How this area's gravity combines with the global/other areas"),
        gravity: z.number().optional().describe("Gravity magnitude (units/s^2)"),
        direction: z.array(z.number()).optional().describe("Gravity direction [x, y] (2D) or [x, y, z] (3D)"),
        point: z.boolean().optional().describe("If true, gravity pulls toward the area's gravity point instead of a direction"),
      },
    },
    async ({ path, space_override, gravity, direction, point }) => {
      const params: Record<string, unknown> = { path };
      if (space_override !== undefined) params.space_override = space_override;
      if (gravity !== undefined) params.gravity = gravity;
      if (direction !== undefined) params.direction = direction;
      if (point !== undefined) params.point = point;
      return call("area.set_gravity", params);
    },
  );

  server.registerTool(
    "joint_create",
    {
      title: "Create physics joint",
      description:
        "Add a physics joint node under a parent in the edited scene (undoable). 2D types: pin | groove | spring (PinJoint2D/GrooveJoint2D/DampedSpringJoint2D); 3D types: pin | hinge | slider | cone_twist | generic6dof (PinJoint3D/HingeJoint3D/SliderJoint3D/ConeTwistJoint3D/Generic6DOFJoint3D). Optionally wire node_a/node_b to the two bodies. In-scene and undoable — not gated.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        type: z.enum(["pin", "groove", "spring", "hinge", "slider", "cone_twist", "generic6dof"]).describe("Joint kind; pin works in both dims, the rest are dim-specific"),
        dim: z.enum(["2d", "3d"]).optional().describe("Dimension: \"2d\" (default) or \"3d\""),
        name: z.string().optional().describe("Node name (default the class name, e.g. \"PinJoint2D\")"),
        node_a: z.string().optional().describe("NodePath (relative to the joint) of the first body"),
        node_b: z.string().optional().describe("NodePath (relative to the joint) of the second body"),
      },
    },
    async ({ parent_path, type, dim, name, node_a, node_b }) => {
      const params: Record<string, unknown> = { parent_path, type };
      if (dim !== undefined) params.dim = dim;
      if (name !== undefined) params.name = name;
      if (node_a !== undefined) params.node_a = node_a;
      if (node_b !== undefined) params.node_b = node_b;
      return call("joint.create", params);
    },
  );

  server.registerTool(
    "joint_set_bodies",
    {
      title: "Set joint bodies",
      description:
        "Set node_a and/or node_b on an existing Joint2D/3D in the edited scene (undoable) — the NodePaths of the two bodies the joint connects, relative to the joint node. In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("Joint2D/3D node path relative to the scene root"),
        node_a: z.string().optional().describe("NodePath (relative to the joint) of the first body"),
        node_b: z.string().optional().describe("NodePath (relative to the joint) of the second body"),
      },
    },
    async ({ path, node_a, node_b }) => {
      const params: Record<string, unknown> = { path };
      if (node_a !== undefined) params.node_a = node_a;
      if (node_b !== undefined) params.node_b = node_b;
      return call("joint.set_bodies", params);
    },
  );

  server.registerTool(
    "collisionpolygon_add",
    {
      title: "Add collision polygon",
      description:
        "Add a CollisionPolygon2D/3D node carrying a polygon under a parent (usually a body) in the edited scene (undoable). points is a 2D outline [[x, y], …] (≥3); for 3D it is extruded along Z by depth. 2D build_mode is solids | segments. In-scene and undoable — not gated.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path (usually a body) relative to the scene root; \".\" for the root"),
        points: z.array(z.array(z.number())).describe("Polygon outline points [[x, y], …] (≥3); a 2D outline even for 3D"),
        dim: z.enum(["2d", "3d"]).optional().describe("Dimension: \"2d\" (default) or \"3d\""),
        name: z.string().optional().describe("Node name (default \"CollisionPolygon2D\"/\"CollisionPolygon3D\")"),
        build_mode: z.enum(["solids", "segments"]).optional().describe("2D only: solids (default) or segments"),
        depth: z.number().optional().describe("3D only: extrusion depth along Z (default 1.0)"),
      },
    },
    async ({ parent_path, points, dim, name, build_mode, depth }) => {
      const params: Record<string, unknown> = { parent_path, points };
      if (dim !== undefined) params.dim = dim;
      if (name !== undefined) params.name = name;
      if (build_mode !== undefined) params.build_mode = build_mode;
      if (depth !== undefined) params.depth = depth;
      return call("collisionpolygon.add", params);
    },
  );

  server.registerTool(
    "rigidbody_set_properties",
    {
      title: "Set rigidbody properties",
      description:
        "Tune a RigidBody2D/3D in the edited scene (undoable): mass (> 0), gravity_scale, linear_damp, angular_damp. Only the provided properties change. In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("RigidBody2D/3D node path relative to the scene root"),
        mass: z.number().optional().describe("Body mass (> 0)"),
        gravity_scale: z.number().optional().describe("Multiplier on gravity (1 = normal, 0 = float)"),
        linear_damp: z.number().optional().describe("Linear damping (≥ 0)"),
        angular_damp: z.number().optional().describe("Angular damping (≥ 0)"),
      },
    },
    async ({ path, mass, gravity_scale, linear_damp, angular_damp }) => {
      const params: Record<string, unknown> = { path };
      if (mass !== undefined) params.mass = mass;
      if (gravity_scale !== undefined) params.gravity_scale = gravity_scale;
      if (linear_damp !== undefined) params.linear_damp = linear_damp;
      if (angular_damp !== undefined) params.angular_damp = angular_damp;
      return call("rigidbody.set_properties", params);
    },
  );

  server.registerTool(
    "body_set_physics_material",
    {
      title: "Set body physics material",
      description:
        "Create a PhysicsMaterial and assign it as physics_material_override on a StaticBody/RigidBody (2D or 3D) in the edited scene (undoable): friction (default 1), bounce (default 0), rough, absorbent. In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("StaticBody/RigidBody 2D/3D node path relative to the scene root"),
        friction: z.number().optional().describe("Surface friction 0..1 (default 1)"),
        bounce: z.number().optional().describe("Restitution/bounciness 0..1 (default 0)"),
        rough: z.boolean().optional().describe("Rough friction combine mode (default false)"),
        absorbent: z.boolean().optional().describe("Absorbent bounce combine mode (default false)"),
      },
    },
    async ({ path, friction, bounce, rough, absorbent }) => {
      const params: Record<string, unknown> = { path };
      if (friction !== undefined) params.friction = friction;
      if (bounce !== undefined) params.bounce = bounce;
      if (rough !== undefined) params.rough = rough;
      if (absorbent !== undefined) params.absorbent = absorbent;
      return call("body.set_physics_material", params);
    },
  );

  server.registerTool(
    "physics_set_gravity",
    {
      title: "Set project gravity",
      description:
        "Write the project's default gravity for 2D or 3D (ProjectSettings physics/{2d,3d}/default_gravity + default_gravity_vector). Set save=true to persist to project.godot. DESTRUCTIVE (project-wide setting) — gated by confirmation.",
      inputSchema: {
        dim: z.enum(["2d", "3d"]).optional().describe("Which gravity to set: \"2d\" (default) or \"3d\""),
        magnitude: z.number().optional().describe("Gravity magnitude (default 2D 980, 3D 9.8)"),
        direction: z.array(z.number()).optional().describe("Gravity direction vector [x, y] (2D) or [x, y, z] (3D)"),
        save: z.boolean().optional().describe("Persist to project.godot (default false)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ dim, magnitude, direction, save, confirm }) => {
      const blocked = await gate(server, confirm, `Set project ${dim ?? "2d"} gravity${save ? " and save project.godot" : ""}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = {};
      if (dim !== undefined) params.dim = dim;
      if (magnitude !== undefined) params.magnitude = magnitude;
      if (direction !== undefined) params.direction = direction;
      params.save = save ?? false;
      return call("physics.set_gravity", params);
    },
  );

  server.registerTool(
    "particles_create",
    {
      title: "Create particles",
      description:
        "Add a GPUParticles2D/3D node under a parent in the edited scene (undoable). Optional initial amount (> 0), lifetime (> 0), emitting. In-scene and undoable — not gated.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        dim: z.enum(["2d", "3d"]).optional().describe("Dimension: \"2d\" (default, GPUParticles2D) or \"3d\" (GPUParticles3D)"),
        name: z.string().optional().describe("Node name (default \"GPUParticles2D\"/\"GPUParticles3D\")"),
        amount: z.number().optional().describe("Number of particles (> 0, default 8)"),
        lifetime: z.number().optional().describe("Particle lifetime in seconds (> 0, default 1)"),
        emitting: z.boolean().optional().describe("Whether the system is emitting (default true)"),
      },
    },
    async ({ parent_path, dim, name, amount, lifetime, emitting }) => {
      const params: Record<string, unknown> = { parent_path };
      if (dim !== undefined) params.dim = dim;
      if (name !== undefined) params.name = name;
      if (amount !== undefined) params.amount = amount;
      if (lifetime !== undefined) params.lifetime = lifetime;
      if (emitting !== undefined) params.emitting = emitting;
      return call("particles.create", params);
    },
  );

  server.registerTool(
    "particles_set_process_material",
    {
      title: "Set particles process material",
      description:
        "Create a ParticleProcessMaterial and assign it as process_material on a GPUParticles2D/3D in the edited scene (undoable). Optional knobs: gravity [x, y, z], direction [x, y, z], spread, initial_velocity_min/max, scale_min/max, color [r, g, b, a]. GPU particles need a process material to emit. In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("GPUParticles2D/3D node path relative to the scene root"),
        gravity: z.array(z.number()).optional().describe("Gravity vector [x, y, z]"),
        direction: z.array(z.number()).optional().describe("Emission direction [x, y, z]"),
        spread: z.number().optional().describe("Emission spread in degrees"),
        initial_velocity_min: z.number().optional().describe("Minimum initial velocity"),
        initial_velocity_max: z.number().optional().describe("Maximum initial velocity"),
        scale_min: z.number().optional().describe("Minimum particle scale"),
        scale_max: z.number().optional().describe("Maximum particle scale"),
        color: z.array(z.number()).optional().describe("Base color [r, g, b] or [r, g, b, a] (0..1)"),
      },
    },
    async ({ path, gravity, direction, spread, initial_velocity_min, initial_velocity_max, scale_min, scale_max, color }) => {
      const params: Record<string, unknown> = { path };
      if (gravity !== undefined) params.gravity = gravity;
      if (direction !== undefined) params.direction = direction;
      if (spread !== undefined) params.spread = spread;
      if (initial_velocity_min !== undefined) params.initial_velocity_min = initial_velocity_min;
      if (initial_velocity_max !== undefined) params.initial_velocity_max = initial_velocity_max;
      if (scale_min !== undefined) params.scale_min = scale_min;
      if (scale_max !== undefined) params.scale_max = scale_max;
      if (color !== undefined) params.color = color;
      return call("particles.set_process_material", params);
    },
  );

  server.registerTool(
    "particles_set_amount",
    {
      title: "Set particles amount",
      description:
        "Set the number of particles (amount, > 0) on a GPUParticles2D/3D in the edited scene (undoable). In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("GPUParticles2D/3D node path relative to the scene root"),
        amount: z.number().describe("Number of particles (> 0)"),
      },
    },
    async ({ path, amount }) => call("particles.set_amount", { path, amount }),
  );

  server.registerTool(
    "particles_set_lifetime",
    {
      title: "Set particles lifetime",
      description:
        "Set the particle lifetime in seconds (> 0) on a GPUParticles2D/3D in the edited scene (undoable). In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("GPUParticles2D/3D node path relative to the scene root"),
        lifetime: z.number().describe("Lifetime in seconds (> 0)"),
      },
    },
    async ({ path, lifetime }) => call("particles.set_lifetime", { path, lifetime }),
  );

  server.registerTool(
    "particles_set_emitting",
    {
      title: "Set particles emitting",
      description:
        "Toggle whether a GPUParticles2D/3D is emitting in the edited scene (undoable). In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("GPUParticles2D/3D node path relative to the scene root"),
        emitting: z.boolean().describe("Whether the system is emitting"),
      },
    },
    async ({ path, emitting }) => call("particles.set_emitting", { path, emitting }),
  );

  server.registerTool(
    "particles_set_texture",
    {
      title: "Set particles texture",
      description:
        "Load a Texture2D from a res:// path and assign it as texture on a GPUParticles2D in the edited scene (undoable). GPUParticles2D only — GPUParticles3D draws meshes and has no texture (returns unsupported). In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("GPUParticles2D node path relative to the scene root"),
        texture_path: z.string().describe("res:// path to a Texture2D resource"),
      },
    },
    async ({ path, texture_path }) => call("particles.set_texture", { path, texture_path }),
  );

  server.registerTool(
    "shader_create",
    {
      title: "Create shader",
      description:
        "Create a Shader resource with optional initial code and save it as a .gdshader file. DESTRUCTIVE (writes a file) — gated by confirmation.",
      inputSchema: {
        to_path: z.string().describe("Destination res:// path, e.g. res://shaders/glow.gdshader"),
        code: z.string().optional().describe("Initial GDShader source (e.g. \"shader_type canvas_item; ...\")"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ to_path, code, confirm }) => {
      const blocked = await gate(server, confirm, `Create shader at ${to_path}`);
      if (blocked) return blocked;
      return call("shader.create", code !== undefined ? { to_path, code } : { to_path });
    },
  );

  server.registerTool(
    "shader_set_code",
    {
      title: "Set shader code",
      description:
        "Replace the source code of an existing .gdshader resource and save it. DESTRUCTIVE (writes a file) — gated by confirmation.",
      inputSchema: {
        path: z.string().describe("Shader res:// path"),
        code: z.string().describe("New GDShader source"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, code, confirm }) => {
      const blocked = await gate(server, confirm, `Overwrite shader code at ${path}`);
      if (blocked) return blocked;
      return call("shader.set_code", { path, code });
    },
  );

  server.registerTool(
    "shadermaterial_create",
    {
      title: "Create shader material",
      description:
        "Create a ShaderMaterial and assign it to a node's material slot in the edited scene (undoable). Targets CanvasItem.material (2D / Control) or GeometryInstance3D.material_override (3D); other node types return unsupported. Optionally assign a Shader loaded from a res:// path. In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root (a CanvasItem or GeometryInstance3D)"),
        shader_path: z.string().optional().describe("res:// path to a Shader to assign to the new material"),
      },
    },
    async ({ path, shader_path }) =>
      call("shadermaterial.create", shader_path !== undefined ? { path, shader_path } : { path }),
  );

  server.registerTool(
    "shadermaterial_set_shader",
    {
      title: "Set shader material shader",
      description:
        "Load a Shader from a res:// path and assign it to the ShaderMaterial on a node's material slot in the edited scene (undoable). The node must already have a ShaderMaterial. In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        shader_path: z.string().describe("res:// path to a Shader resource"),
      },
    },
    async ({ path, shader_path }) => call("shadermaterial.set_shader", { path, shader_path }),
  );

  server.registerTool(
    "shadermaterial_set_param",
    {
      title: "Set shader material parameter",
      description:
        "Set a shader uniform parameter on the ShaderMaterial of a node's material slot in the edited scene (undoable). The node must already have a ShaderMaterial. The value uses the tagged-Variant convention. In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("Node path relative to the scene root"),
        param: z.string().describe("Shader uniform name"),
        value: z.any().describe("New value (JSON scalar or __type__-tagged Variant)"),
      },
    },
    async ({ path, param, value }) => call("shadermaterial.set_param", { path, param, value }),
  );

  server.registerTool(
    "audio_player_create",
    {
      title: "Create audio player",
      description:
        "Add an AudioStreamPlayer / AudioStreamPlayer2D / AudioStreamPlayer3D node under a parent in the edited scene (undoable). `dim` selects \"none\" (default, non-positional AudioStreamPlayer), \"2d\", or \"3d\". Optional initial stream_path (res:// AudioStream), autoplay, volume_db, bus. In-scene and undoable — not gated.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        dim: z.enum(["none", "2d", "3d"]).optional().describe("Player kind: \"none\" (default, AudioStreamPlayer), \"2d\" (AudioStreamPlayer2D), or \"3d\" (AudioStreamPlayer3D)"),
        name: z.string().optional().describe("Node name (default matches the player class)"),
        stream_path: z.string().optional().describe("res:// path to an AudioStream to assign to the new player"),
        autoplay: z.boolean().optional().describe("Whether the player starts automatically on scene load"),
        volume_db: z.number().optional().describe("Player volume in dB"),
        bus: z.string().optional().describe("Target audio bus name (default \"Master\")"),
      },
    },
    async ({ parent_path, dim, name, stream_path, autoplay, volume_db, bus }) => {
      const params: Record<string, unknown> = { parent_path };
      if (dim !== undefined) params.dim = dim;
      if (name !== undefined) params.name = name;
      if (stream_path !== undefined) params.stream_path = stream_path;
      if (autoplay !== undefined) params.autoplay = autoplay;
      if (volume_db !== undefined) params.volume_db = volume_db;
      if (bus !== undefined) params.bus = bus;
      return call("audio.player_create", params);
    },
  );

  server.registerTool(
    "audio_set_stream",
    {
      title: "Set audio stream",
      description:
        "Load an AudioStream from a res:// path and assign it as stream on an AudioStreamPlayer/2D/3D in the edited scene (undoable). In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("AudioStreamPlayer/2D/3D node path relative to the scene root"),
        stream_path: z.string().describe("res:// path to an AudioStream resource"),
      },
    },
    async ({ path, stream_path }) => call("audio.set_stream", { path, stream_path }),
  );

  server.registerTool(
    "audio_bus_add",
    {
      title: "Add audio bus",
      description:
        "Add a bus to the project's global AudioServer layout, optionally naming it, positioning it (at_position), and setting its send bus. DESTRUCTIVE (project-wide audio state) — gated by confirmation.",
      inputSchema: {
        name: z.string().optional().describe("Name for the new bus"),
        at_position: z.number().optional().describe("Insert index (default -1 = append at end)"),
        send: z.string().optional().describe("Name of the bus this bus sends its output to"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ name, at_position, send, confirm }) => {
      const blocked = await gate(server, confirm, `Add audio bus${name ? ` "${name}"` : ""}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = {};
      if (name !== undefined) params.name = name;
      if (at_position !== undefined) params.at_position = at_position;
      if (send !== undefined) params.send = send;
      return call("audio.bus_add", params);
    },
  );

  server.registerTool(
    "audio_bus_add_effect",
    {
      title: "Add audio bus effect",
      description:
        "Instantiate an AudioEffect subclass (by class name, e.g. \"AudioEffectReverb\") and add it to a named bus on the global AudioServer, optionally at a position in the bus's effect chain. DESTRUCTIVE (project-wide audio state) — gated by confirmation.",
      inputSchema: {
        bus: z.string().describe("Target bus name"),
        effect: z.string().describe("AudioEffect subclass name, e.g. \"AudioEffectReverb\", \"AudioEffectDelay\""),
        at_position: z.number().optional().describe("Insert index within the bus's effect chain (default -1 = append)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ bus, effect, at_position, confirm }) => {
      const blocked = await gate(server, confirm, `Add ${effect} to audio bus "${bus}"`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { bus, effect };
      if (at_position !== undefined) params.at_position = at_position;
      return call("audio.bus_add_effect", params);
    },
  );

  server.registerTool(
    "audio_bus_set_volume",
    {
      title: "Set audio bus volume",
      description:
        "Set the volume (in dB) of a named bus on the global AudioServer. DESTRUCTIVE (project-wide audio state) — gated by confirmation.",
      inputSchema: {
        bus: z.string().describe("Bus name"),
        volume_db: z.number().describe("Volume in dB"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ bus, volume_db, confirm }) => {
      const blocked = await gate(server, confirm, `Set audio bus "${bus}" volume to ${volume_db} dB`);
      if (blocked) return blocked;
      return call("audio.bus_set_volume", { bus, volume_db });
    },
  );

  server.registerTool(
    "audio_set_bus_layout",
    {
      title: "Save audio bus layout",
      description:
        "Save the current AudioServer bus layout (buses, effects, volumes) to a .tres resource on disk (default res://default_bus_layout.tres) via generate_bus_layout + ResourceSaver.save. DESTRUCTIVE (writes a file) — gated by confirmation.",
      inputSchema: {
        to_path: z.string().optional().describe("Destination res:// path (default res://default_bus_layout.tres)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ to_path, confirm }) => {
      const blocked = await gate(server, confirm, `Save audio bus layout to ${to_path ?? "res://default_bus_layout.tres"}`);
      if (blocked) return blocked;
      return call("audio.set_bus_layout", to_path !== undefined ? { to_path } : {});
    },
  );

  // ---- Group G: UI / Control / theming --------------------------------------
  // control_* + container_add_child mutate the EDITED scene (Control nodes) and are
  // undoable via EditorUndoRedoManager and ungated — the node_* model. theme_* author a
  // Theme (or its entries) on disk via ResourceSaver, so — like resource_* / shader_create —
  // they are file-writers gated by confirmation, not scene-undoable.

  server.registerTool(
    "control_create",
    {
      title: "Create control",
      description:
        "Instance a Control-derived UI node (Button, Label, Panel, VBoxContainer, TextureRect, …) under a parent (undoable). Refuses non-Control classes. Optional 'text' is applied only to controls that expose a 'text' property. Returns the new node's path.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        type: z.string().describe("Control subclass to instance, e.g. Button, Label, Panel, VBoxContainer, TextureRect"),
        name: z.string().optional().describe("Node name (defaults to the class name)"),
        text: z.string().optional().describe("Initial text; applied only if the control has a 'text' property"),
      },
    },
    async ({ parent_path, type, name, text }) => {
      const params: Record<string, unknown> = { parent_path, type };
      if (name !== undefined) params.name = name;
      if (text !== undefined) params.text = text;
      return call("control.create", params);
    },
  );

  server.registerTool(
    "container_add_child",
    {
      title: "Add control to container",
      description:
        "Instance a Control-derived child under a Container node (VBoxContainer, GridContainer, MarginContainer, …) so it participates in the container's layout (undoable). Refuses a non-Container parent or a non-Control child. Returns the new node's path.",
      inputSchema: {
        container_path: z.string().describe("Container node path relative to the scene root"),
        type: z.string().describe("Control subclass to instance as the container's child, e.g. Button, Label"),
        name: z.string().optional().describe("Node name (defaults to the class name)"),
      },
    },
    async ({ container_path, type, name }) =>
      call("container.add_child", name !== undefined ? { container_path, type, name } : { container_path, type }),
  );

  server.registerTool(
    "control_set_anchors",
    {
      title: "Set control anchors",
      description:
        "Set one or more of a Control's anchors (left/top/right/bottom, each 0..1) directly (undoable). Only the sides you pass are changed; offsets are left as-is. Provide at least one side.",
      inputSchema: {
        path: z.string().describe("Control node path relative to the scene root"),
        left: z.number().optional().describe("anchor_left (0..1)"),
        top: z.number().optional().describe("anchor_top (0..1)"),
        right: z.number().optional().describe("anchor_right (0..1)"),
        bottom: z.number().optional().describe("anchor_bottom (0..1)"),
      },
    },
    async ({ path, left, top, right, bottom }) => {
      const params: Record<string, unknown> = { path };
      if (left !== undefined) params.left = left;
      if (top !== undefined) params.top = top;
      if (right !== undefined) params.right = right;
      if (bottom !== undefined) params.bottom = bottom;
      return call("control.set_anchors", params);
    },
  );

  server.registerTool(
    "control_set_layout_preset",
    {
      title: "Apply control layout preset",
      description:
        "Apply a LayoutPreset to a Control via set_anchors_and_offsets_preset (undoable). 'preset' is a name (full_rect, center, top_left, center_top, left_wide, hcenter_wide, …) or the integer enum value. Optional resize_mode (0=min_size,1=keep_width,2=keep_height,3=keep_size) and margin.",
      inputSchema: {
        path: z.string().describe("Control node path relative to the scene root"),
        preset: z.union([z.string(), z.number()]).describe("LayoutPreset name or integer (0..15)"),
        resize_mode: z.number().int().optional().describe("LayoutPresetMode 0..3 (default 0 = min size)"),
        margin: z.number().int().optional().describe("Margin in pixels applied by the preset (default 0)"),
      },
    },
    async ({ path, preset, resize_mode, margin }) => {
      const params: Record<string, unknown> = { path, preset };
      if (resize_mode !== undefined) params.resize_mode = resize_mode;
      if (margin !== undefined) params.margin = margin;
      return call("control.set_layout_preset", params);
    },
  );

  server.registerTool(
    "control_set_size_flags",
    {
      title: "Set control size flags",
      description:
        "Set a Control's container size flags and/or stretch ratio (undoable). 'horizontal'/'vertical' are SizeFlags bitmasks (1=fill, 2=expand, 3=expand_fill, 4=shrink_center, 8=shrink_end). Provide at least one of horizontal/vertical/stretch_ratio.",
      inputSchema: {
        path: z.string().describe("Control node path relative to the scene root"),
        horizontal: z.number().int().optional().describe("size_flags_horizontal bitmask"),
        vertical: z.number().int().optional().describe("size_flags_vertical bitmask"),
        stretch_ratio: z.number().optional().describe("size_flags_stretch_ratio (default 1.0)"),
      },
    },
    async ({ path, horizontal, vertical, stretch_ratio }) => {
      const params: Record<string, unknown> = { path };
      if (horizontal !== undefined) params.horizontal = horizontal;
      if (vertical !== undefined) params.vertical = vertical;
      if (stretch_ratio !== undefined) params.stretch_ratio = stretch_ratio;
      return call("control.set_size_flags", params);
    },
  );

  server.registerTool(
    "control_set_theme",
    {
      title: "Set control theme",
      description:
        "Assign a Theme resource (res:// path) to a Control's 'theme' property so it and its children inherit it (undoable). Pass an empty theme_path to clear the override.",
      inputSchema: {
        path: z.string().describe("Control node path relative to the scene root"),
        theme_path: z.string().describe("Theme res:// path, or \"\" to clear the theme override"),
      },
    },
    async ({ path, theme_path }) => call("control.set_theme", { path, theme_path }),
  );

  server.registerTool(
    "theme_create",
    {
      title: "Create theme",
      description:
        "Create a new empty Theme resource and save it to a res:// path. DESTRUCTIVE (writes a file) — gated by confirmation.",
      inputSchema: {
        to_path: z.string().describe("Destination res:// path, e.g. res://ui/main.theme or res://ui/main.tres"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ to_path, confirm }) => {
      const blocked = await gate(server, confirm, `Create Theme resource at ${to_path}`);
      if (blocked) return blocked;
      return call("theme.create", { to_path });
    },
  );

  server.registerTool(
    "theme_set_color",
    {
      title: "Set theme color",
      description:
        "Set a color entry on a Theme resource file and save it (e.g. font_color for the Button type). DESTRUCTIVE (writes a file) — gated by confirmation. 'color' is [r,g,b] or [r,g,b,a] with components 0..1.",
      inputSchema: {
        path: z.string().describe("Theme res:// path"),
        name: z.string().describe("Theme item name, e.g. font_color"),
        theme_type: z.string().describe("Theme type the item belongs to, e.g. Button, Label"),
        color: z.array(z.number()).describe("[r,g,b] or [r,g,b,a], components 0..1"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, name, theme_type, color, confirm }) => {
      const blocked = await gate(server, confirm, `Set theme color ${theme_type}/${name} in ${path}`);
      if (blocked) return blocked;
      return call("theme.set_color", { path, name, theme_type, color });
    },
  );

  server.registerTool(
    "theme_set_font",
    {
      title: "Set theme font",
      description:
        "Set a font entry on a Theme resource file (loading a Font from a res:// path) and save it. DESTRUCTIVE (writes a file) — gated by confirmation.",
      inputSchema: {
        path: z.string().describe("Theme res:// path"),
        name: z.string().describe("Theme item name, e.g. font"),
        theme_type: z.string().describe("Theme type the item belongs to, e.g. Button, Label"),
        font_path: z.string().describe("Font resource res:// path (FontFile / SystemFont / …)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, name, theme_type, font_path, confirm }) => {
      const blocked = await gate(server, confirm, `Set theme font ${theme_type}/${name} in ${path}`);
      if (blocked) return blocked;
      return call("theme.set_font", { path, name, theme_type, font_path });
    },
  );

  server.registerTool(
    "theme_set_stylebox",
    {
      title: "Set theme stylebox",
      description:
        "Set a StyleBox entry on a Theme resource file (loading a StyleBox from a res:// path) and save it. DESTRUCTIVE (writes a file) — gated by confirmation.",
      inputSchema: {
        path: z.string().describe("Theme res:// path"),
        name: z.string().describe("Theme item name, e.g. normal, pressed, panel"),
        theme_type: z.string().describe("Theme type the item belongs to, e.g. Button, PanelContainer"),
        stylebox_path: z.string().describe("StyleBox resource res:// path (StyleBoxFlat / StyleBoxTexture / …)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, name, theme_type, stylebox_path, confirm }) => {
      const blocked = await gate(server, confirm, `Set theme stylebox ${theme_type}/${name} in ${path}`);
      if (blocked) return blocked;
      return call("theme.set_stylebox", { path, name, theme_type, stylebox_path });
    },
  );

  server.registerTool(
    "theme_set_constant",
    {
      title: "Set theme constant",
      description:
        "Set an integer constant entry on a Theme resource file and save it (e.g. h_separation for a BoxContainer). DESTRUCTIVE (writes a file) — gated by confirmation.",
      inputSchema: {
        path: z.string().describe("Theme res:// path"),
        name: z.string().describe("Theme item name, e.g. h_separation, margin_left"),
        theme_type: z.string().describe("Theme type the item belongs to, e.g. HBoxContainer, MarginContainer"),
        value: z.number().int().describe("Integer constant value"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, name, theme_type, value, confirm }) => {
      const blocked = await gate(server, confirm, `Set theme constant ${theme_type}/${name} in ${path}`);
      if (blocked) return blocked;
      return call("theme.set_constant", { path, name, theme_type, value });
    },
  );

  // ---- Group H: 3D & navigation -------------------------------------------
  // meshinstance/mesh/light/camera/csg/navregion/navagent mutate the EDITED scene (3D nodes) and are
  // undoable via EditorUndoRedoManager and ungated — the node_* model. primitive_mesh_create and the
  // two environment_* tools author a resource (PrimitiveMesh / Environment) on disk via ResourceSaver,
  // so — like resource_* / theme_create — they are file-writers gated by confirmation.

  server.registerTool(
    "meshinstance_create",
    {
      title: "Create MeshInstance3D",
      description:
        "Add a MeshInstance3D under a parent (undoable). Optional 'mesh_path' loads a Mesh resource (e.g. a primitive_mesh_create output) and assigns it. Returns the new node's path.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        name: z.string().optional().describe("Node name (default MeshInstance3D)"),
        mesh_path: z.string().optional().describe("Mesh resource res:// path to assign to the instance's 'mesh'"),
      },
    },
    async ({ parent_path, name, mesh_path }) => {
      const params: Record<string, unknown> = { parent_path };
      if (name !== undefined) params.name = name;
      if (mesh_path !== undefined) params.mesh_path = mesh_path;
      return call("meshinstance.create", params);
    },
  );

  server.registerTool(
    "mesh_set_surface_material",
    {
      title: "Set mesh surface material",
      description:
        "Assign a Material (res:// path) to a MeshInstance3D (undoable). Default surface -1 sets 'material_override' (whole instance); a surface index >= 0 sets that surface's override material (must be within the mesh's surface count). Refuses a non-MeshInstance3D node or a non-Material resource.",
      inputSchema: {
        path: z.string().describe("MeshInstance3D node path relative to the scene root"),
        material_path: z.string().describe("Material resource res:// path (StandardMaterial3D / ShaderMaterial / …)"),
        surface: z.number().int().optional().describe("Surface index, or -1 (default) for material_override"),
      },
    },
    async ({ path, material_path, surface }) => {
      const params: Record<string, unknown> = { path, material_path };
      if (surface !== undefined) params.surface = surface;
      return call("mesh.set_surface_material", params);
    },
  );

  server.registerTool(
    "primitive_mesh_create",
    {
      title: "Create primitive mesh",
      description:
        "Create a PrimitiveMesh resource (box/sphere/cylinder/plane/capsule/prism/torus/quad) and save it to a res:// path. DESTRUCTIVE (writes a file) — gated by confirmation. Assign it with meshinstance_create's 'mesh_path'.",
      inputSchema: {
        to_path: z.string().describe("Destination res:// path, e.g. res://meshes/box.tres"),
        shape: z.string().optional().describe("box | sphere | cylinder | plane | capsule | prism | torus | quad (default box)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ to_path, shape, confirm }) => {
      const blocked = await gate(server, confirm, `Create ${shape ?? "box"} PrimitiveMesh at ${to_path}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { to_path };
      if (shape !== undefined) params.shape = shape;
      return call("primitive_mesh.create", params);
    },
  );

  server.registerTool(
    "light_create",
    {
      title: "Create Light3D",
      description:
        "Add a 3D light under a parent (undoable). 'kind' selects DirectionalLight3D (dir), OmniLight3D (omni), or SpotLight3D (spot). Returns the new node's path.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        kind: z.enum(["dir", "directional", "omni", "spot"]).optional().describe("Light kind: dir | omni | spot (default omni)"),
        name: z.string().optional().describe("Node name (defaults to the class name)"),
      },
    },
    async ({ parent_path, kind, name }) => {
      const params: Record<string, unknown> = { parent_path };
      if (kind !== undefined) params.kind = kind;
      if (name !== undefined) params.name = name;
      return call("light.create", params);
    },
  );

  server.registerTool(
    "camera_create",
    {
      title: "Create Camera3D",
      description:
        "Add a Camera3D under a parent (undoable). Optional 'current' makes it the active camera. Returns the new node's path.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        name: z.string().optional().describe("Node name (default Camera3D)"),
        current: z.boolean().optional().describe("Make this the current/active camera (default false)"),
      },
    },
    async ({ parent_path, name, current }) => {
      const params: Record<string, unknown> = { parent_path };
      if (name !== undefined) params.name = name;
      if (current !== undefined) params.current = current;
      return call("camera.create", params);
    },
  );

  server.registerTool(
    "csg_create",
    {
      title: "Create CSG node",
      description:
        "Add a CSG node under a parent (undoable). 'shape' selects CSGBox3D (box), CSGSphere3D (sphere), CSGCylinder3D (cylinder), CSGTorus3D (torus), CSGPolygon3D (polygon), CSGMesh3D (mesh), or CSGCombiner3D (combiner). Returns the new node's path.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        shape: z.string().optional().describe("box | sphere | cylinder | torus | polygon | mesh | combiner (default box)"),
        name: z.string().optional().describe("Node name (defaults to the class name)"),
      },
    },
    async ({ parent_path, shape, name }) => {
      const params: Record<string, unknown> = { parent_path };
      if (shape !== undefined) params.shape = shape;
      if (name !== undefined) params.name = name;
      return call("csg.create", params);
    },
  );

  server.registerTool(
    "navregion_create",
    {
      title: "Create NavigationRegion3D",
      description:
        "Add a NavigationRegion3D under a parent (undoable). By default seeds a fresh empty NavigationMesh (set with_navmesh=false to skip). Returns the new node's path and whether a navmesh was attached.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        name: z.string().optional().describe("Node name (default NavigationRegion3D)"),
        with_navmesh: z.boolean().optional().describe("Seed a fresh empty NavigationMesh resource (default true)"),
      },
    },
    async ({ parent_path, name, with_navmesh }) => {
      const params: Record<string, unknown> = { parent_path };
      if (name !== undefined) params.name = name;
      if (with_navmesh !== undefined) params.with_navmesh = with_navmesh;
      return call("navregion.create", params);
    },
  );

  server.registerTool(
    "navagent_configure",
    {
      title: "Add & configure NavigationAgent3D",
      description:
        "Add a NavigationAgent3D under a parent (undoable) and set any of its steering/avoidance properties. Returns the new node's path and the resulting config (radius, height, max_speed, path/target desired distances, avoidance_enabled).",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        name: z.string().optional().describe("Node name (default NavigationAgent3D)"),
        radius: z.number().optional().describe("Agent radius"),
        height: z.number().optional().describe("Agent height"),
        max_speed: z.number().optional().describe("Maximum movement speed"),
        path_desired_distance: z.number().optional().describe("Distance to a path point before advancing"),
        target_desired_distance: z.number().optional().describe("Distance to the target that counts as arrived"),
        avoidance_enabled: z.boolean().optional().describe("Enable RVO avoidance"),
      },
    },
    async ({ parent_path, name, radius, height, max_speed, path_desired_distance, target_desired_distance, avoidance_enabled }) => {
      const params: Record<string, unknown> = { parent_path };
      if (name !== undefined) params.name = name;
      if (radius !== undefined) params.radius = radius;
      if (height !== undefined) params.height = height;
      if (max_speed !== undefined) params.max_speed = max_speed;
      if (path_desired_distance !== undefined) params.path_desired_distance = path_desired_distance;
      if (target_desired_distance !== undefined) params.target_desired_distance = target_desired_distance;
      if (avoidance_enabled !== undefined) params.avoidance_enabled = avoidance_enabled;
      return call("navagent.configure", params);
    },
  );

  server.registerTool(
    "environment_create",
    {
      title: "Create Environment",
      description:
        "Create an Environment resource and save it to a res:// path. 'background' sets the mode (clear_color/color/sky/canvas, default clear_color); optional 'ambient_color' ([r,g,b(,a)], 0..1) sets the ambient light color. DESTRUCTIVE (writes a file) — gated by confirmation.",
      inputSchema: {
        to_path: z.string().describe("Destination res:// path, e.g. res://world.tres"),
        background: z.string().optional().describe("clear_color | color | sky | canvas (default clear_color)"),
        ambient_color: z.array(z.number()).optional().describe("Ambient light color [r,g,b] or [r,g,b,a], 0..1"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ to_path, background, ambient_color, confirm }) => {
      const blocked = await gate(server, confirm, `Create Environment at ${to_path}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { to_path };
      if (background !== undefined) params.background = background;
      if (ambient_color !== undefined) params.ambient_color = ambient_color;
      return call("environment.create", params);
    },
  );

  server.registerTool(
    "environment_set_sky",
    {
      title: "Set Environment sky",
      description:
        "Attach a Sky to an existing Environment resource file (setting a ProceduralSkyMaterial, PhysicalSkyMaterial, or PanoramaSkyMaterial) and switch its background to SKY, then re-save. DESTRUCTIVE (writes a file) — gated by confirmation. Refuses a path that is not an Environment.",
      inputSchema: {
        path: z.string().describe("Environment res:// path"),
        sky_material: z.enum(["procedural", "physical", "panorama"]).optional().describe("Sky material kind (default procedural)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, sky_material, confirm }) => {
      const blocked = await gate(server, confirm, `Set sky on Environment ${path}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { path };
      if (sky_material !== undefined) params.sky_material = sky_material;
      return call("environment.set_sky", params);
    },
  );
}
