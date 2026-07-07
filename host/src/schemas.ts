import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * B1 — enforced tool output schemas.
 *
 * Every shape below is frozen from the source of truth: the host reshaping code
 * (cli/processes/lsp/dap) and the addon handlers (operations.gd / runtime_bridge.gd),
 * cross-checked against the v0.4.2 live validation run. The MCP SDK validates a
 * tool's `structuredContent` against its `outputSchema` on every SUCCESS result
 * (error results — `isError: true` — are exempt), so these must match the real
 * runtime shape or that tool's success path throws.
 *
 * Notes:
 *  - `z.object` is non-strict, so a tool returning EXTRA fields still validates;
 *    the schemas pin the required envelope, not an exhaustive field list.
 *  - The two image tools (screenshot_editor, runtime_screenshot) return image
 *    content with NO structuredContent, so they are deliberately NOT listed and
 *    receive no outputSchema.
 *  - `encodedValue` is a Godot Variant run through the addon's JSON codec — a
 *    scalar, array, or a {"__type__": ...}-tagged object — so it stays `any`.
 */

const encodedValue = z.any();

const capturedRaw = z.object({
  code: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
});

const location = z.object({ uri: z.string(), line: z.number(), character: z.number() });

// Recursive edited-scene node (scene.get_tree in operations.gd: _serialize_node).
const sceneNode: z.ZodType = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string(),
    path: z.string(),
    script: z.string().nullable(),
    child_count: z.number(),
    children: z.array(sceneNode).optional(),
  }),
);

// Recursive live-game node (runtime.get_tree in runtime_bridge.gd: _serialize).
const runtimeNode: z.ZodType = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string(),
    path: z.string(),
    child_count: z.number(),
    visible: z.boolean().optional(),
    children: z.array(runtimeNode).optional(),
  }),
);

/** name -> ZodRawShape describing that tool's structuredContent. */
export const outputSchemas: Record<string, z.ZodRawShape> = {
  // ---- Plane B: headless CLI (tools/cli.ts) ----
  godot_version: { version: z.string(), raw: capturedRaw },
  godot_launch_editor: { launched: z.boolean(), pid: z.number().nullable(), project: z.string() },
  godot_run_project: { running: z.boolean(), pid: z.number().nullable(), scene: z.string().nullable() },
  godot_export: { preset: z.string(), output_path: z.string(), exit_code: z.number().nullable(), timed_out: z.boolean(), stdout: z.string(), stderr: z.string() },
  godot_import: { exit_code: z.number().nullable(), timed_out: z.boolean(), stdout: z.string(), stderr: z.string() },
  godot_run_headless_script: { script_path: z.string(), exit_code: z.number().nullable(), timed_out: z.boolean(), stdout: z.string(), stderr: z.string() },

  // ---- Managed processes (tools/processes.ts) ----
  godot_run_managed: { id: z.string(), pid: z.number().nullable(), running: z.boolean(), scene: z.string().nullable() },
  godot_output: {
    id: z.string(),
    exited: z.boolean(),
    exit_code: z.number().nullable(),
    latest_seq: z.number(),
    lines: z.array(z.object({ seq: z.number(), stream: z.enum(["stdout", "stderr"]), text: z.string() })),
  },
  godot_stop: { id: z.string(), stopped: z.boolean() },

  // ---- Plane A: editor bridge (tools/editor.ts -> operations.gd) ----
  editor_ping: { pong: z.boolean(), addon_version: z.string(), godot: z.string() },
  editor_get_state: {
    has_open_scene: z.boolean(),
    edited_scene_root: z.string().nullable(),
    edited_scene_path: z.string().nullable(),
    root_type: z.string().nullable(),
    selection: z.array(z.string()),
    godot: z.string(),
  },
  project_get_info: { name: z.string(), main_scene: z.string(), project_root: z.string(), godot: z.string(), features: z.array(z.string()) },
  project_get_setting: { name: z.string(), value: encodedValue },
  project_set_setting: { name: z.string(), saved: z.boolean() },
  scene_get_tree: {
    name: z.string(),
    type: z.string(),
    path: z.string(),
    script: z.string().nullable(),
    child_count: z.number(),
    children: z.array(sceneNode).optional(),
  },
  scene_open: { opened: z.string() },
  scene_save: { saved: z.string() },
  scene_new: { created: z.string(), root_type: z.string() },
  node_add: { path: z.string(), name: z.string(), type: z.string() },
  node_delete: { deleted: z.string() },
  node_rename: { path: z.string(), name: z.string() },
  node_reparent: { path: z.string() },
  node_set_property: { path: z.string(), property: z.string(), value: encodedValue },
  node_get_property: { path: z.string(), property: z.string(), value: encodedValue },
  selection_get: { selection: z.array(z.string()) },
  selection_set: { selection: z.array(z.string()) },
  classdb_get_class: {
    class: z.string(),
    parent: z.string(),
    can_instantiate: z.boolean(),
    methods: z.array(z.string()),
    properties: z.array(z.string()),
    signals: z.array(z.string()),
  },

  // ---- Plane D: semantic / LSP (tools/lsp.ts) ----
  gd_completion: { items: z.array(z.object({ label: z.string(), kind: z.string(), detail: z.string(), insertText: z.string() })) },
  gd_hover: { contents: z.string() },
  gd_definition: { locations: z.array(location) },
  gd_references: { locations: z.array(location) },
  gd_rename: { changed_files: z.array(z.string()), edit_count: z.number(), applied: z.boolean(), written: z.array(z.string()) },
  gd_document_symbols: { symbols: z.array(z.object({ name: z.string(), kind: z.string(), line: z.number() })) },
  gd_workspace_symbols: { symbols: z.array(z.object({ name: z.string(), kind: z.string(), uri: z.string(), line: z.number() })) },
  gd_diagnostics: {
    uri: z.string(),
    diagnostics: z.array(z.object({ severity: z.string(), message: z.string(), line: z.number(), character: z.number() })),
  },
  gd_signature_help: {
    signatures: z.array(z.object({
      label: z.string(),
      documentation: z.string(),
      parameters: z.array(z.object({ label: z.string(), documentation: z.string() })),
    })),
    active_signature: z.number(),
    active_parameter: z.number(),
  },
  gd_code_action: {
    actions: z.array(z.object({ title: z.string(), kind: z.string(), has_edit: z.boolean(), command: z.string().nullable() })),
  },
  gd_document_highlight: {
    highlights: z.array(z.object({ line: z.number(), character: z.number(), end_line: z.number(), end_character: z.number(), kind: z.string() })),
  },
  gd_type_definition: { locations: z.array(location) },
  gd_implementation: { locations: z.array(location) },
  gd_declaration: { locations: z.array(location) },
  gd_folding_ranges: { ranges: z.array(z.object({ start_line: z.number(), end_line: z.number(), kind: z.string() })) },
  gd_document_link: {
    links: z.array(z.object({ line: z.number(), character: z.number(), end_line: z.number(), end_character: z.number(), target: z.string() })),
  },
  gd_formatting: { edit_count: z.number(), formatted: z.string() },
  gd_document_color: {
    colors: z.array(z.object({
      line: z.number(), character: z.number(), end_line: z.number(), end_character: z.number(),
      red: z.number(), green: z.number(), blue: z.number(), alpha: z.number(), hex: z.string(),
    })),
  },

  // ---- Plane D: C# semantic / OmniSharp LSP (tools/cslsp.ts) ----
  cs_completion: { items: z.array(z.object({ label: z.string(), kind: z.string(), detail: z.string(), insertText: z.string() })) },
  cs_hover: { contents: z.string() },
  cs_definition: { locations: z.array(location) },
  cs_references: { locations: z.array(location) },
  cs_document_symbols: { symbols: z.array(z.object({ name: z.string(), kind: z.string(), line: z.number() })) },
  cs_workspace_symbols: { symbols: z.array(z.object({ name: z.string(), kind: z.string(), uri: z.string(), line: z.number() })) },
  cs_signature_help: {
    signatures: z.array(z.object({
      label: z.string(),
      documentation: z.string(),
      parameters: z.array(z.object({ label: z.string(), documentation: z.string() })),
    })),
    active_signature: z.number(),
    active_parameter: z.number(),
  },
  cs_diagnostics: {
    uri: z.string(),
    diagnostics: z.array(z.object({ severity: z.string(), message: z.string(), line: z.number(), character: z.number() })),
  },

  // ---- Plane D: debugging / DAP (tools/dap.ts) ----
  dbg_launch: { session_id: z.string(), state: z.string(), scene: z.string() },
  dbg_attach: { session_id: z.string(), state: z.string() },
  dbg_set_breakpoints: {
    path: z.string(), buffered: z.boolean(),
    breakpoints: z.array(z.object({ line: z.number(), verified: z.boolean() })),
    // Present only when the adapter advertised a requested modifier unsupported (see tools/dap.ts).
    unsupported_modifiers: z.array(z.string()).optional(),
    warning: z.string().optional(),
  },
  dbg_continue: { state: z.string(), stopped_reason: z.string().nullable() },
  dbg_step: { state: z.string(), stopped_reason: z.string().nullable() },
  dbg_stack_trace: { frames: z.array(z.object({ id: z.number(), name: z.string(), source: z.string(), line: z.number() })) },
  dbg_scopes: { scopes: z.array(z.object({ name: z.string(), variables_ref: z.number() })) },
  dbg_variables: { variables: z.array(z.object({ name: z.string(), value: z.string(), type: z.string(), variables_ref: z.number() })) },
  dbg_evaluate: { result: z.string(), type: z.string(), variables_ref: z.number() },
  dbg_watch: {
    watches: z.array(z.object({ expression: z.string(), value: z.string(), type: z.string(), error: z.string().nullable() })),
  },
  dbg_set_exception_breakpoints: {
    filters: z.array(z.string()),
    available_filters: z.array(z.object({ filter: z.string(), label: z.string() })),
    breakpoints: z.array(z.object({ verified: z.boolean() })),
  },
  dbg_set_variable: { name: z.string(), value: z.string(), type: z.string(), variables_ref: z.number() },
  dbg_restart: { session_id: z.string(), method: z.string(), state: z.string(), scene: z.string().nullable() },
  dbg_goto: {
    targets: z.array(z.object({ id: z.number(), label: z.string(), line: z.number() })),
    jumped: z.boolean(),
    target_id: z.number().nullable(),
  },
  dbg_data_breakpoints: {
    breakpoints: z.array(z.object({ name: z.string(), data_id: z.string(), verified: z.boolean() })),
    unresolved: z.array(z.object({ name: z.string(), reason: z.string() })),
  },

  // ---- Plane C: runtime bridge (tools/runtime.ts -> runtime_bridge.gd) ----
  runtime_get_tree: {
    name: z.string(),
    type: z.string(),
    path: z.string(),
    child_count: z.number(),
    visible: z.boolean().optional(),
    children: z.array(runtimeNode).optional(),
  },
  runtime_get_property: { path: z.string(), property: z.string(), value: encodedValue },
  runtime_set_property: { path: z.string(), property: z.string(), value: encodedValue },
  runtime_call_method: { return: encodedValue },
  runtime_emit_signal: { emitted: z.boolean() },
  runtime_inject_input: { injected: z.boolean(), kind: z.string() },
  runtime_get_monitors: { monitors: z.record(z.number()) },
  runtime_get_log: {
    entries: z.array(z.object({ seq: z.number(), level: z.string(), message: z.string() })),
    latest_seq: z.number(),
    // D6: true when the Godot 4.5+ Logger capture is active (zero-config print()
    // capture, no managed parent). Optional so older addons still validate.
    capture: z.boolean().optional(),
  },
};

/**
 * Inject the frozen output schemas into every matching tool at registration
 * time by wrapping `server.registerTool`, so individual tool registrations stay
 * untouched and `schemas.ts` is the single source of truth. A tool that already
 * declares its own `outputSchema` is left as-is. Call once, right after the
 * McpServer is constructed and before any register*Tools() call.
 */
export function applyOutputSchemas(server: McpServer): void {
  const raw = server.registerTool.bind(server) as unknown as (name: string, config: unknown, handler: unknown) => unknown;
  (server as unknown as { registerTool: unknown }).registerTool = (
    name: string,
    config: Record<string, unknown>,
    handler: unknown,
  ) => {
    const outputSchema = outputSchemas[name];
    if (outputSchema && config && config.outputSchema === undefined) {
      config = { ...config, outputSchema };
    }
    return raw(name, config, handler);
  };
}
