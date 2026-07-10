import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gate } from "../../confirm.js";
import type { EditorCall } from "./common.js";

/** AnimationPlayer / Animation authoring + AnimationTree state machines. */
export function registerAnimationTools(server: McpServer, call: EditorCall): void {
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
}
