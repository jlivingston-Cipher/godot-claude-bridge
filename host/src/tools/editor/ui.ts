import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gate } from "../../confirm.js";
import type { EditorCall } from "./common.js";

/** UI / Control / theming. control_* + container_add_child mutate the EDITED scene and are undoable via EditorUndoRedoManager and ungated (the node_* model). theme_* author a Theme on disk via ResourceSaver, so — like resource_* — they are file-writers gated by confirmation. */
export function registerUiTools(server: McpServer, call: EditorCall): void {
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
}
