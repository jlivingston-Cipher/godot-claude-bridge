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
}
