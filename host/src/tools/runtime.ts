import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BridgeClient, BridgeError } from "../bridge.js";
import { gate } from "../confirm.js";

const confirmField = {
  confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
};

/**
 * Runtime-bridge tools (Plane C). Each forwards to the in-game autoload
 * (ClaudeRuntimeBridge) over TCP. These only work while the project is running.
 */

function ok(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj as Record<string, unknown>,
  };
}
function fail(err: unknown) {
  const be = err as Partial<BridgeError> & { message?: string };
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Runtime error [${be?.code ?? "error"}]: ${be?.message ?? String(err)}` }],
  };
}

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
      description: "Capture the current game frame as a PNG and return it as image content so Claude can see the running game.",
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
        "Read the runtime log ring buffer (entries game code pushed via ClaudeRuntimeBridge.push_log). " +
        "Use since_seq for incremental reads.",
      inputSchema: {
        since_seq: z.number().int().optional().describe("Return only entries with seq greater than this (default 0)"),
        levels: z.array(z.string()).optional().describe("Filter to these levels, e.g. [\"error\",\"warning\"]"),
      },
    },
    async ({ since_seq, levels }) => call("runtime.get_log", { since_seq: since_seq ?? 0, levels: levels ?? [] }),
  );
}
