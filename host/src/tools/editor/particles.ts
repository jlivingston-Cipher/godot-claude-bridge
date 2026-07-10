import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EditorCall } from "./common.js";

/** GPUParticles authoring (process material, amount, lifetime, texture). */
export function registerParticleTools(server: McpServer, call: EditorCall): void {
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
}
