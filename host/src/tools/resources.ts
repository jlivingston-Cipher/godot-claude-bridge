import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge.js";

/**
 * MCP resources — read-mostly context Claude can pull on demand (and clients can
 * subscribe to). Each wraps a bridge call and degrades to an informative JSON
 * note when the source (editor/game) isn't currently reachable, rather than
 * failing the read.
 */
async function jsonResource(uriHref: string, fetcher: () => Promise<unknown>) {
  try {
    const data = await fetcher();
    return { contents: [{ uri: uriHref, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    const message = (err as { message?: string })?.message ?? String(err);
    return {
      contents: [{ uri: uriHref, mimeType: "application/json", text: JSON.stringify({ available: false, note: message }, null, 2) }],
    };
  }
}

export function registerResources(server: McpServer, editor: BridgeClient, runtime: BridgeClient): void {
  server.registerResource(
    "scene-tree",
    "godot://scene-tree",
    { title: "Edited scene tree", description: "Live node tree of the scene open in the editor.", mimeType: "application/json" },
    async (uri) => jsonResource(uri.href, () => editor.request("scene.get_tree", {})),
  );

  server.registerResource(
    "editor-state",
    "godot://editor-state",
    { title: "Editor state", description: "Currently edited scene, selection, and Godot version.", mimeType: "application/json" },
    async (uri) => jsonResource(uri.href, () => editor.request("editor.get_state", {})),
  );

  server.registerResource(
    "runtime-tree",
    "godot://runtime/tree",
    { title: "Runtime scene tree", description: "Live SceneTree of the running game.", mimeType: "application/json" },
    async (uri) => jsonResource(uri.href, () => runtime.request("runtime.get_tree", {})),
  );

  server.registerResource(
    "runtime-log",
    "godot://runtime/log",
    { title: "Runtime log", description: "Log ring buffer from the running game.", mimeType: "application/json" },
    async (uri) => jsonResource(uri.href, () => runtime.request("runtime.get_log", { since_seq: 0, levels: [] })),
  );

  server.registerResource(
    "class-doc",
    new ResourceTemplate("godot://class/{name}", { list: undefined }),
    { title: "ClassDB documentation", description: "Methods, properties, and signals of an engine class.", mimeType: "application/json" },
    async (uri, vars) =>
      jsonResource(uri.href, () =>
        editor.request("classdb.get_class", { class_name: String((vars as { name?: string })?.name ?? ""), include_inherited: false }),
      ),
  );
}
