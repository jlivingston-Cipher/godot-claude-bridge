import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gate } from "../../confirm.js";
import type { EditorCall } from "./common.js";

/** Shader + ShaderMaterial authoring. */
export function registerShaderTools(server: McpServer, call: EditorCall): void {
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
}
