import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gate } from "../../confirm.js";
import type { EditorCall } from "./common.js";

/** Signal introspection and (dis)connection on nodes. */
export function registerSignalTools(server: McpServer, call: EditorCall): void {
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
}
