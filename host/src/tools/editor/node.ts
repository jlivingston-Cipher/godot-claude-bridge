import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gate } from "../../confirm.js";
import type { EditorCall } from "./common.js";

/** Scene-tree node authoring: add / delete / reparent / property / group ops. */
export function registerNodeTools(server: McpServer, call: EditorCall): void {
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
}
