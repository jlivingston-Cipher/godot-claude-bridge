import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gate } from "../../confirm.js";
import type { EditorCall } from "./common.js";

/** Physics & collision: bodies, shapes, areas, joints, rigidbody tuning, gravity. */
export function registerPhysicsTools(server: McpServer, call: EditorCall): void {
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
}
