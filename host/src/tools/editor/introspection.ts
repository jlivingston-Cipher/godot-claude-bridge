import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../../bridge.js";
import { fail, type EditorCall } from "./common.js";

/** Editor selection, ClassDB / docs lookups, and viewport screenshot. */
export function registerIntrospectionTools(server: McpServer, call: EditorCall, bridge: BridgeClient): void {
  server.registerTool(
    "selection_get",
    { title: "Get selection", description: "Return the paths of the nodes currently selected in the editor.", inputSchema: {} },
    async () => call("selection.get"),
  );

  server.registerTool(
    "selection_set",
    {
      title: "Set selection",
      description: "Replace the editor's node selection with the given node paths.",
      inputSchema: { paths: z.array(z.string()).describe("Node paths relative to the scene root") },
    },
    async ({ paths }) => call("selection.set", { paths }),
  );

  server.registerTool(
    "classdb_get_class",
    {
      title: "Introspect class",
      description: "Return the parent class, methods, properties, and signals of an engine class via ClassDB.",
      inputSchema: {
        class_name: z.string().describe("Engine class name, e.g. AudioStreamPlayer3D"),
        include_inherited: z.boolean().optional().describe("Include inherited members (default false)"),
      },
    },
    async ({ class_name, include_inherited }) =>
      call("classdb.get_class", { class_name, include_inherited: include_inherited ?? false }),
  );

  server.registerTool(
    "class_reference",
    {
      title: "Class reference",
      description:
        "Full engine-class reference via ClassDB: method SIGNATURES (return type + typed args), signal " +
        "signatures, and typed properties — the detailed view classdb_get_class summarises as bare names. " +
        "Read-only. Includes the canonical online docs URL. Pass member to filter to a single method/property/signal.",
      inputSchema: {
        class_name: z.string().describe("Engine class name, e.g. AudioStreamPlayer3D"),
        include_inherited: z.boolean().optional().describe("Include inherited members (default false)"),
        member: z.string().optional().describe("Only return members whose name contains this substring"),
      },
    },
    async ({ class_name, include_inherited, member }) =>
      call("classdb.reference", {
        class_name,
        include_inherited: include_inherited ?? false,
        member: member ?? "",
      }),
  );

  server.registerTool(
    "docs_search",
    {
      title: "Search the class reference",
      description:
        "Search the Godot class reference (ClassDB) by keyword — matching class names and, unless a scope narrows " +
        "it, their methods/properties/signals — and return each hit with its canonical docs URL. Read-only. " +
        "Use kind to restrict to one member type, class_name to scope to a single class, and limit to bound results.",
      inputSchema: {
        query: z.string().describe("Case-insensitive substring to match against class / member names"),
        kind: z.enum(["any", "class", "method", "property", "signal"]).optional().describe("Restrict to one result kind (default any)"),
        class_name: z.string().optional().describe("Scope the member search to a single class (still returns class-name matches project-wide)"),
        limit: z.number().int().positive().optional().describe("Max results before truncation (default 40)"),
        deep: z.boolean().optional().describe("Also scan members, not just class names (default true)"),
      },
    },
    async ({ query, kind, class_name, limit, deep }) =>
      call("docs.search", {
        query,
        kind: kind ?? "any",
        class_name: class_name ?? "",
        limit: limit ?? 40,
        deep: deep ?? true,
      }),
  );

  server.registerTool(
    "screenshot_editor",
    {
      title: "Screenshot editor viewport",
      description:
        "Capture the 2D or 3D editor viewport as a PNG and return it as image content so the assistant can see the scene. " +
        "Requires the matching editor tab (2D/3D) to be active and rendered.",
      inputSchema: { viewport: z.enum(["2d", "3d"]).optional().describe("Which viewport (default 3d)") },
    },
    async ({ viewport }) => {
      try {
        const r = (await bridge.request("screenshot.editor_viewport", { viewport: viewport ?? "3d" })) as {
          base64: string;
          mime: string;
          width: number;
          height: number;
          viewport: string;
        };
        return {
          content: [
            { type: "image" as const, data: r.base64, mimeType: r.mime },
            { type: "text" as const, text: `Captured ${r.viewport} viewport (${r.width}x${r.height}).` },
          ],
        };
      } catch (err) {
        return fail(err);
      }
    },
  );
}
