import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BridgeClient, BridgeError } from "../bridge.js";
import { gate } from "../confirm.js";
import { ok } from "./lsp-common.js";

const confirmField = {
  confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
};

/**
 * Runtime-bridge tools (Plane C). Each forwards to the in-game autoload
 * (BreakpointRuntimeBridge) over TCP. These only work while the project is running.
 */

function fail(err: unknown) {
  const be = err as Partial<BridgeError> & { message?: string };
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Runtime error [${be?.code ?? "error"}]: ${be?.message ?? String(err)}` }],
  };
}

/**
 * Compare a polled property value against an expected value under one of the
 * restricted operators exposed by runtime_await_condition. eq/ne use structural
 * (JSON) equality so tagged-Variant objects compare cleanly; the ordered
 * operators are numeric-only and are false unless both sides are numbers.
 */
function compareValues(actual: unknown, expected: unknown, op: string): boolean {
  const bothNum = typeof actual === "number" && typeof expected === "number";
  switch (op) {
    case "ne":
      return JSON.stringify(actual) !== JSON.stringify(expected);
    case "gt":
      return bothNum && (actual as number) > (expected as number);
    case "ge":
      return bothNum && (actual as number) >= (expected as number);
    case "lt":
      return bothNum && (actual as number) < (expected as number);
    case "le":
      return bothNum && (actual as number) <= (expected as number);
    case "eq":
    default:
      return JSON.stringify(actual) === JSON.stringify(expected);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function registerRuntimeTools(server: McpServer, runtime: BridgeClient): void {
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    try {
      return ok(await runtime.request(method, params));
    } catch (err) {
      return fail(err);
    }
  };

  server.registerTool(
    "runtime_get_tree",
    {
      title: "Runtime scene tree",
      description: "Traverse the LIVE SceneTree of the running game (name, type, path, visibility, children).",
      inputSchema: { max_depth: z.number().int().positive().optional().describe("Max recursion depth (default 64)") },
    },
    async ({ max_depth }) => call("runtime.get_tree", max_depth ? { max_depth } : {}),
  );

  server.registerTool(
    "runtime_get_property",
    {
      title: "Runtime get property",
      description: "Read a property from a live node (path relative to the current scene; '/root/...' absolute allowed).",
      inputSchema: { path: z.string(), property: z.string() },
    },
    async ({ path, property }) => call("runtime.get_property", { path, property }),
  );

  server.registerTool(
    "runtime_set_property",
    {
      title: "Runtime set property",
      description: "Set a property on a live node. DESTRUCTIVE (mutates running game state) — gated by confirmation. Rich types use the {\"__type__\":...} convention.",
      inputSchema: { path: z.string(), property: z.string(), value: z.any(), ...confirmField },
    },
    async ({ path, property, value, confirm }) => {
      const blocked = await gate(server, confirm, `Set live property ${path}.${property}`);
      if (blocked) return blocked;
      return call("runtime.set_property", { path, property, value });
    },
  );

  server.registerTool(
    "runtime_call_method",
    {
      title: "Runtime call method",
      description: "Invoke a method on a live node. DESTRUCTIVE (arbitrary invocation) — gated by confirmation. Args use the tagged-Variant convention.",
      inputSchema: { path: z.string(), method: z.string(), args: z.array(z.any()).optional(), ...confirmField },
    },
    async ({ path, method, args, confirm }) => {
      const blocked = await gate(server, confirm, `Call ${path}.${method}() on the running game`);
      if (blocked) return blocked;
      return call("runtime.call_method", { path, method, args: args ?? [] });
    },
  );

  server.registerTool(
    "runtime_emit_signal",
    {
      title: "Runtime emit signal",
      description: "Emit a signal from a live node. DESTRUCTIVE — gated by confirmation.",
      inputSchema: { path: z.string(), signal: z.string(), args: z.array(z.any()).optional(), ...confirmField },
    },
    async ({ path, signal, args, confirm }) => {
      const blocked = await gate(server, confirm, `Emit signal "${signal}" from ${path}`);
      if (blocked) return blocked;
      return call("runtime.emit_signal", { path, signal, args: args ?? [] });
    },
  );

  server.registerTool(
    "runtime_inject_input",
    {
      title: "Runtime inject input",
      description:
        "Inject a synthetic input event for automated play-testing. DESTRUCTIVE. " +
        "event.kind is 'action' | 'key' | 'mouse_button' | 'mouse_motion'. " +
        "Example: {\"kind\":\"action\",\"action\":\"jump\",\"pressed\":true}.",
      inputSchema: {
        event: z.object({
          kind: z.enum(["action", "key", "mouse_button", "mouse_motion"]),
          action: z.string().optional(),
          strength: z.number().optional(),
          keycode: z.number().int().optional(),
          button: z.number().int().optional(),
          pressed: z.boolean().optional(),
          position: z.any().optional(),
          relative: z.any().optional(),
        }),
        ...confirmField,
      },
    },
    async ({ event, confirm }) => {
      const blocked = await gate(server, confirm, `Inject ${event.kind} input event into the running game`);
      if (blocked) return blocked;
      return call("runtime.inject_input", { event });
    },
  );

  server.registerTool(
    "runtime_get_monitors",
    {
      title: "Runtime performance monitors",
      description:
        "Read live Performance monitors (FPS, draw calls, node count, physics, audio output latency, ...). " +
        "Pass specific keys or omit for all. Keys include time/fps, render/total_draw_calls, audio/output_latency.",
      inputSchema: { keys: z.array(z.string()).optional() },
    },
    async ({ keys }) => call("runtime.get_monitors", keys ? { keys } : {}),
  );

  server.registerTool(
    "runtime_screenshot",
    {
      title: "Runtime screenshot",
      description: "Capture the current game frame as a PNG and return it as image content so the assistant can see the running game.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = (await runtime.request("runtime.screenshot", {})) as { base64: string; mime: string; width: number; height: number };
        return {
          content: [
            { type: "image" as const, data: r.base64, mimeType: r.mime },
            { type: "text" as const, text: `Captured game frame (${r.width}x${r.height}).` },
          ],
        };
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "runtime_get_log",
    {
      title: "Runtime log",
      description:
        "Read the runtime log ring buffer (entries game code pushed via BreakpointRuntimeBridge.push_log). " +
        "Use since_seq for incremental reads.",
      inputSchema: {
        since_seq: z.number().int().optional().describe("Return only entries with seq greater than this (default 0)"),
        levels: z.array(z.string()).optional().describe("Filter to these levels, e.g. [\"error\",\"warning\"]"),
      },
    },
    async ({ since_seq, levels }) => call("runtime.get_log", { since_seq: since_seq ?? 0, levels: levels ?? [] }),
  );

  server.registerTool(
    "runtime_assert_node_state",
    {
      title: "Runtime assert node state",
      description:
        "Assert that properties of a LIVE node equal expected values (read-only verification). " +
        "Reports per-property mismatches; supports an optional absolute numeric tolerance.",
      inputSchema: {
        path: z.string().describe("Node path (relative to the current scene; '/root/...' absolute allowed)"),
        expect: z
          .record(z.any())
          .describe("Map of property name -> expected value (JSON; use the tagged-Variant form for complex types like Vector2/Color)"),
        tolerance: z
          .number()
          .nonnegative()
          .optional()
          .describe("Absolute tolerance for numeric comparisons (default 0 = exact match)"),
      },
    },
    async ({ path, expect, tolerance }) =>
      call(
        "runtime.assert_node_state",
        tolerance !== undefined ? { path, expect, tolerance } : { path, expect },
      ),
  );

  server.registerTool(
    "runtime_assert_scene_structure",
    {
      title: "Runtime assert scene structure",
      description:
        "Assert the LIVE SceneTree matches structural expectations (read-only). Each entry asserts a node " +
        "exists at a path (and, if given, is of a class via is_class); set absent:true to assert it is NOT present.",
      inputSchema: {
        expect: z
          .array(
            z.object({
              path: z.string(),
              type: z.string().optional(),
              absent: z.boolean().optional(),
            }),
          )
          .describe("List of node expectations: {path, type?, absent?}."),
      },
    },
    async ({ expect }) => call("runtime.assert_scene_structure", { expect }),
  );

  server.registerTool(
    "runtime_assert_perf",
    {
      title: "Runtime assert perf",
      description:
        "Assert that live Performance monitors meet a caller-supplied baseline within tolerance (read-only). " +
        "Capture the baseline earlier with runtime_get_monitors and pass it back inline. Pass direction is inferred " +
        "(time/fps is higher-better; every other monitor is lower-better) unless overridden per key.",
      inputSchema: {
        baseline: z
          .record(z.number())
          .describe("Monitor key -> baseline value (capture earlier via runtime_get_monitors)"),
        tolerance: z
          .number()
          .nonnegative()
          .optional()
          .describe("Fractional tolerance applied to each comparison (default 0 = exact)"),
        direction: z
          .record(z.enum(["higher_better", "lower_better"]))
          .optional()
          .describe("Per-key override of the pass direction (defaults: time/fps higher_better, else lower_better)"),
      },
    },
    async ({ baseline, tolerance, direction }) =>
      call("runtime.assert_perf", {
        baseline,
        ...(tolerance !== undefined ? { tolerance } : {}),
        ...(direction !== undefined ? { direction } : {}),
      }),
  );

  server.registerTool(
    "runtime_assert_screen_text",
    {
      title: "Runtime assert screen text",
      description:
        "Assert that on-screen text is present (or absent) by scanning visible Control text in the LIVE scene tree " +
        "(read-only; no OCR). Sees text on Label / RichTextLabel / Button / LineEdit / TextEdit / CheckBox / LinkButton " +
        "and similar; does NOT see text drawn directly to the canvas or baked into textures.",
      inputSchema: {
        text: z.string().describe("Text (or regular expression) to look for"),
        present: z
          .boolean()
          .optional()
          .describe("Assert the text IS present (default true); set false to assert it is absent"),
        regex: z.boolean().optional().describe("Treat `text` as a regular expression (default false = substring)"),
        case_sensitive: z.boolean().optional().describe("Case-sensitive match (default false)"),
        min_count: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Require at least this many matches (implies present)"),
      },
    },
    async ({ text, present, regex, case_sensitive, min_count }) =>
      call("runtime.assert_screen_text", {
        text,
        ...(present !== undefined ? { present } : {}),
        ...(regex !== undefined ? { regex } : {}),
        ...(case_sensitive !== undefined ? { case_sensitive } : {}),
        ...(min_count !== undefined ? { min_count } : {}),
      }),
  );

  server.registerTool(
    "runtime_screenshot_diff",
    {
      title: "Runtime screenshot diff",
      description:
        "Capture the current frame and compare it to a reference PNG at a project path, returning diff stats and a " +
        "pass/fail vs tolerance (read-only; the diff is computed engine-side so the host stays dependency-free). " +
        "Establish the reference first by saving a runtime_screenshot as a project asset.",
      inputSchema: {
        reference: z.string().describe("res:// or user:// path to the reference PNG"),
        tolerance: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Max fraction of differing pixels that still passes (default 0)"),
        per_channel_threshold: z
          .number()
          .int()
          .min(0)
          .max(255)
          .optional()
          .describe("Per-channel delta (0-255) for a pixel to count as different (default 0)"),
        region: z
          .object({ x: z.number().int(), y: z.number().int(), w: z.number().int(), h: z.number().int() })
          .optional()
          .describe("Optional sub-region (applied to both frame and reference) to compare"),
      },
    },
    async ({ reference, tolerance, per_channel_threshold, region }) =>
      call("runtime.screenshot_diff", {
        reference,
        ...(tolerance !== undefined ? { tolerance } : {}),
        ...(per_channel_threshold !== undefined ? { per_channel_threshold } : {}),
        ...(region !== undefined ? { region } : {}),
      }),
  );

  // F8: deterministic-verification helper. Poll a live property until it meets a
  // comparison, or a timeout elapses. Host-side over runtime.get_property (no new
  // bridge method), so it works on every engine build the runtime bridge supports.
  // Read-only: it never mutates the game, so it is not confirmation-gated.
  server.registerTool(
    "runtime_await_condition",
    {
      title: "Runtime await condition",
      description:
        "Poll a property on a LIVE node until it satisfies a comparison, or a timeout elapses (read-only verification). " +
        "op is eq | ne | gt | ge | lt | le (the ordered operators require numeric values). Use this to wait for the " +
        "running game to reach a state before asserting on it — e.g. wait for hp le 0, then runtime_assert_screen_text.",
      inputSchema: {
        path: z.string().describe("Node path (relative to the current scene; '/root/...' absolute allowed)"),
        property: z.string().describe("Property to read on each poll"),
        value: z.any().describe("Value to compare the property against (tagged-Variant form for complex types)"),
        op: z.enum(["eq", "ne", "gt", "ge", "lt", "le"]).optional().describe("Comparison operator (default eq)"),
        timeout_ms: z.number().int().positive().optional().describe("Maximum time to wait, in ms (default 5000)"),
        poll_interval_ms: z.number().int().positive().optional().describe("Delay between polls, in ms (default 100)"),
      },
    },
    async ({ path, property, value, op, timeout_ms, poll_interval_ms }) => {
      const operator = op ?? "eq";
      const interval = poll_interval_ms ?? 100;
      const start = Date.now();
      const deadline = start + (timeout_ms ?? 5000);
      let polls = 0;
      let last: unknown = null;
      for (;;) {
        polls++;
        let res: { value?: unknown };
        try {
          res = (await runtime.request("runtime.get_property", { path, property })) as { value?: unknown };
        } catch (err) {
          return fail(err);
        }
        last = res?.value ?? null;
        if (compareValues(last, value, operator)) {
          return ok({ met: true, polls, elapsed_ms: Date.now() - start, value: last });
        }
        if (Date.now() >= deadline) {
          return ok({ met: false, polls, elapsed_ms: Date.now() - start, value: last });
        }
        await sleep(interval);
      }
    },
  );

  server.registerTool(
    "runtime_anim_play",
    {
      title: "Runtime play animation",
      description:
        "Play an animation on a LIVE AnimationPlayer node. DESTRUCTIVE (drives the running game) — gated by confirmation. " +
        "Omit `animation` to (re)play the currently-assigned one.",
      inputSchema: {
        path: z.string().describe("Path to an AnimationPlayer node in the running scene"),
        animation: z.string().optional().describe("Animation name to play (default: the current/assigned animation)"),
        custom_speed: z.number().optional().describe("Playback speed multiplier (default 1.0; negative not supported here)"),
        from_end: z.boolean().optional().describe("Start playback from the end (default false)"),
        ...confirmField,
      },
    },
    async ({ path, animation, custom_speed, from_end, confirm }) => {
      const blocked = await gate(server, confirm, `Play animation "${animation ?? "(current)"}" on ${path}`);
      if (blocked) return blocked;
      return call("runtime.anim_play", {
        path,
        ...(animation !== undefined ? { animation } : {}),
        ...(custom_speed !== undefined ? { custom_speed } : {}),
        ...(from_end !== undefined ? { from_end } : {}),
      });
    },
  );

  server.registerTool(
    "runtime_anim_stop",
    {
      title: "Runtime stop animation",
      description:
        "Stop (or pause) a LIVE AnimationPlayer node. DESTRUCTIVE (drives the running game) — gated by confirmation. " +
        "keep_state:true pauses in place; false (default) stops.",
      inputSchema: {
        path: z.string().describe("Path to an AnimationPlayer node in the running scene"),
        keep_state: z.boolean().optional().describe("Pause in place instead of stopping (default false)"),
        ...confirmField,
      },
    },
    async ({ path, keep_state, confirm }) => {
      const blocked = await gate(server, confirm, `Stop animation on ${path}`);
      if (blocked) return blocked;
      return call("runtime.anim_stop", { path, ...(keep_state !== undefined ? { keep_state } : {}) });
    },
  );

  server.registerTool(
    "runtime_anim_get_state",
    {
      title: "Runtime animation state",
      description:
        "Read the playback state of a LIVE AnimationPlayer (read-only): current animation, whether it is playing, " +
        "position, length, speed scale, and the list of available animations.",
      inputSchema: { path: z.string().describe("Path to an AnimationPlayer node in the running scene") },
    },
    async ({ path }) => call("runtime.anim_get_state", { path }),
  );

  server.registerTool(
    "runtime_node_add",
    {
      title: "Runtime add node",
      description:
        "Add a node to the LIVE running game as a child of `parent`. DESTRUCTIVE — gated by confirmation. " +
        "Provide `scene` (a res:// PackedScene to instantiate) OR `type` (a ClassDB class to instantiate); `name` renames it.",
      inputSchema: {
        parent: z.string().describe("Path to the parent node in the running scene"),
        type: z.string().optional().describe("Class name to instantiate (e.g. Node2D) — mutually exclusive with `scene`"),
        scene: z.string().optional().describe("res:// path to a PackedScene to instantiate — mutually exclusive with `type`"),
        name: z.string().optional().describe("Optional name for the new node"),
        ...confirmField,
      },
    },
    async ({ parent, type, scene, name, confirm }) => {
      const blocked = await gate(server, confirm, `Add ${scene ?? type ?? "node"} under ${parent} in the running game`);
      if (blocked) return blocked;
      return call("runtime.node_add", {
        parent,
        ...(type !== undefined ? { type } : {}),
        ...(scene !== undefined ? { scene } : {}),
        ...(name !== undefined ? { name } : {}),
      });
    },
  );

  server.registerTool(
    "runtime_node_remove",
    {
      title: "Runtime remove node",
      description:
        "Remove (queue_free) a node from the LIVE running game. DESTRUCTIVE — gated by confirmation. " +
        "Refuses to remove the current scene root.",
      inputSchema: { path: z.string().describe("Path to the node to remove in the running scene"), ...confirmField },
    },
    async ({ path, confirm }) => {
      const blocked = await gate(server, confirm, `Remove ${path} from the running game`);
      if (blocked) return blocked;
      return call("runtime.node_remove", { path });
    },
  );

  // F4: deterministic playtesting — freeze time, step exact frames, snapshot state, seed RNG.
  server.registerTool(
    "runtime_time_scale",
    {
      title: "Runtime time scale",
      description:
        "Set Engine.time_scale on the running game: 0 freezes time, 1 is normal, >1 fast, <1 slow-motion. " +
        "DESTRUCTIVE (alters the running game's clock) — gated by confirmation. Freeze with scale 0, then " +
        "runtime_step_frames to advance deterministically before asserting.",
      inputSchema: {
        scale: z.number().min(0).describe("0 = freeze, 1 = normal, N = slow/fast (negative is clamped to 0)"),
        ...confirmField,
      },
    },
    async ({ scale, confirm }) => {
      const blocked = await gate(server, confirm, `Set time scale to ${scale} on the running game`);
      if (blocked) return blocked;
      return call("runtime.time_scale", { scale });
    },
  );

  server.registerTool(
    "runtime_step_frames",
    {
      title: "Runtime step frames",
      description:
        "Advance the running game by an exact number of frames while otherwise frozen, for deterministic, " +
        "frame-accurate playtesting. DESTRUCTIVE — gated by confirmation. `kind` selects which loop to tick each " +
        "step: idle (default), physics, or both. Pair with runtime_time_scale{scale:0} to freeze, then assert.",
      inputSchema: {
        frames: z.number().int().positive().describe("Number of frames to advance"),
        kind: z.enum(["idle", "physics", "both"]).optional().describe("Which loop to tick each step (default idle)"),
        ...confirmField,
      },
    },
    async ({ frames, kind, confirm }) => {
      const blocked = await gate(server, confirm, `Advance ${frames} frame(s) of the running game`);
      if (blocked) return blocked;
      return call("runtime.step_frames", { frames, ...(kind !== undefined ? { kind } : {}) });
    },
  );

  server.registerTool(
    "runtime_state_digest",
    {
      title: "Runtime state digest",
      description:
        "Capture a compact, stable-ordered JSON snapshot of a live subtree's salient state (read-only) — position, " +
        "rotation, scale, visibility, and modulate by default, or a caller-supplied field list. Deterministic ordering " +
        "makes it ideal for frame-by-frame comparison alongside runtime_step_frames.",
      inputSchema: {
        root: z.string().describe("Root node path in the running scene"),
        fields: z
          .array(z.string())
          .optional()
          .describe("Property names to capture per node (default: position/global_position/rotation/scale/visible/modulate when present)"),
        max_depth: z.number().int().nonnegative().optional().describe("Max recursion depth (default 8)"),
      },
    },
    async ({ root, fields, max_depth }) =>
      call("runtime.state_digest", {
        root,
        ...(fields !== undefined ? { fields } : {}),
        ...(max_depth !== undefined ? { max_depth } : {}),
      }),
  );

  server.registerTool(
    "runtime_seed_rng",
    {
      title: "Runtime seed RNG",
      description:
        "Seed the running game's GLOBAL random number generator (GDScript seed()) so a playtest is reproducible. " +
        "DESTRUCTIVE (changes RNG state) — gated by confirmation. Note: seeds only the global RNG (randi/randf), not " +
        "per-instance RandomNumberGenerators or physics determinism.",
      inputSchema: { seed: z.number().int().describe("Seed value for the global RNG"), ...confirmField },
    },
    async ({ seed, confirm }) => {
      const blocked = await gate(server, confirm, `Seed the running game's global RNG with ${seed}`);
      if (blocked) return blocked;
      return call("runtime.seed_rng", { seed });
    },
  );
}
