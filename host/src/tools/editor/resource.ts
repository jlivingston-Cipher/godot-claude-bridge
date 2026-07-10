import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gate } from "../../confirm.js";
import type { EditorCall } from "./common.js";

/** Resource (.tres/.res) create / load / save / property / import ops. */
export function registerResourceTools(server: McpServer, call: EditorCall): void {
  server.registerTool(
    "resource_create",
    {
      title: "Create resource",
      description:
        "Instantiate a Resource subclass and save it as a new file. DESTRUCTIVE (writes a file) — gated by confirmation. Optional initial properties use the tagged-Variant convention.",
      inputSchema: {
        class_name: z.string().describe("Resource subclass to instantiate, e.g. StyleBoxFlat, Theme, GDScript"),
        to_path: z.string().describe("Destination res:// path, e.g. res://styles/panel.tres"),
        properties: z.record(z.any()).optional().describe("Initial property values (JSON scalars or __type__-tagged Variants)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ class_name, to_path, properties, confirm }) => {
      const blocked = await gate(server, confirm, `Create ${class_name} resource at ${to_path}`);
      if (blocked) return blocked;
      return call("resource.create", properties !== undefined ? { class_name, to_path, properties } : { class_name, to_path });
    },
  );

  server.registerTool(
    "resource_load",
    {
      title: "Load resource",
      description: "Load a resource file and return its class, resource_name, and inspector-visible property list. Read-only.",
      inputSchema: { path: z.string().describe("Resource res:// path") },
    },
    async ({ path }) => call("resource.load", { path }),
  );

  server.registerTool(
    "resource_save",
    {
      title: "Save resource",
      description:
        "Load a resource and (re-)save it, optionally to a new path and with ResourceSaver flags. DESTRUCTIVE (writes a file) — gated by confirmation. Shares subresources by reference; use resource_duplicate for an independent copy.",
      inputSchema: {
        from_path: z.string().describe("Source resource res:// path"),
        to_path: z.string().optional().describe("Destination res:// path (default: overwrite from_path)"),
        flags: z.number().int().optional().describe("ResourceSaver.SaverFlags bitmask (e.g. 32 = FLAG_COMPRESS)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ from_path, to_path, flags, confirm }) => {
      const blocked = await gate(server, confirm, `Save resource ${from_path}${to_path ? ` to ${to_path}` : ""}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { from_path };
      if (to_path !== undefined) params.to_path = to_path;
      if (flags !== undefined) params.flags = flags;
      return call("resource.save", params);
    },
  );

  server.registerTool(
    "resource_duplicate",
    {
      title: "Duplicate resource",
      description:
        "Load a resource, duplicate it (optionally deep, cloning subresources), and save the copy to a new path. DESTRUCTIVE (writes a file) — gated by confirmation.",
      inputSchema: {
        path: z.string().describe("Source resource res:// path"),
        to_path: z.string().describe("Destination res:// path for the copy"),
        deep: z.boolean().optional().describe("Deep-duplicate subresources (default false)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, to_path, deep, confirm }) => {
      const blocked = await gate(server, confirm, `Duplicate resource ${path} to ${to_path}`);
      if (blocked) return blocked;
      return call("resource.duplicate", deep !== undefined ? { path, to_path, deep } : { path, to_path });
    },
  );

  server.registerTool(
    "resource_get_property",
    {
      title: "Get resource property",
      description: "Read a single property of a resource file by name. Read-only. The value comes back tagged (Variant convention).",
      inputSchema: {
        path: z.string().describe("Resource res:// path"),
        property: z.string().describe("Property name"),
      },
    },
    async ({ path, property }) => call("resource.get_property", { path, property }),
  );

  server.registerTool(
    "resource_set_property",
    {
      title: "Set resource property",
      description:
        "Set a single property on a resource file and save it. DESTRUCTIVE (writes a file) — gated by confirmation. The value uses the tagged-Variant convention.",
      inputSchema: {
        path: z.string().describe("Resource res:// path"),
        property: z.string().describe("Property name"),
        value: z.any().describe("New value (JSON scalar or __type__-tagged Variant)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, property, value, confirm }) => {
      const blocked = await gate(server, confirm, `Set ${property} on ${path}`);
      if (blocked) return blocked;
      return call("resource.set_property", { path, property, value });
    },
  );

  server.registerTool(
    "resource_get_import_settings",
    {
      title: "Get import settings",
      description:
        "Read an asset's import metadata (.import): the importer and its parameters. Read-only. Returns imported=false when the asset has no .import sidecar.",
      inputSchema: { path: z.string().describe("Asset res:// path (e.g. res://icon.png)") },
    },
    async ({ path }) => call("resource.get_import_settings", { path }),
  );

  server.registerTool(
    "resource_set_import_settings",
    {
      title: "Set import settings",
      description:
        "Update import parameters in an asset's .import metadata and trigger a reimport. DESTRUCTIVE (rewrites metadata + reimports) — gated by confirmation. Errors if the asset has no .import sidecar.",
      inputSchema: {
        path: z.string().describe("Asset res:// path"),
        settings: z.record(z.any()).describe("Import params to set (name -> JSON scalar or __type__-tagged Variant)"),
        reimport: z.boolean().optional().describe("Reimport after writing (default true)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ path, settings, reimport, confirm }) => {
      const blocked = await gate(server, confirm, `Set import settings on ${path} and reimport`);
      if (blocked) return blocked;
      return call("resource.set_import_settings", reimport !== undefined ? { path, settings, reimport } : { path, settings });
    },
  );
}
