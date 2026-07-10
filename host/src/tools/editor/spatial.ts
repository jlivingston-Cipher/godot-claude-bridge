import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gate } from "../../confirm.js";
import type { EditorCall } from "./common.js";

/** 3D & navigation. meshinstance/mesh/light/camera/csg/navregion/navagent mutate the EDITED scene and are undoable + ungated (the node_* model). primitive_mesh_create and the two environment_* tools author a resource on disk, so are file-writers gated by confirmation. */
export function registerSpatialTools(server: McpServer, call: EditorCall): void {
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
