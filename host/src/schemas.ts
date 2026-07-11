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
  editor_undo: {
    performed: z.boolean(),
    direction: z.string(),
    action: z.string(),
    has_undo: z.boolean(),
    has_redo: z.boolean(),
    history_id: z.number(),
    scope: z.string(),
  },
  editor_redo: {
    performed: z.boolean(),
    direction: z.string(),
    action: z.string(),
    has_undo: z.boolean(),
    has_redo: z.boolean(),
    history_id: z.number(),
    scope: z.string(),
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
  scene_list_open: { scenes: z.array(z.string()), current: z.string().nullable(), unsaved: z.array(z.string()), unsaved_supported: z.boolean() },
  scene_reload: { reloaded: z.string() },
  scene_close: { closed: z.string() },
  scene_pack: { packed: z.string(), branch: z.string() },
  scene_get_dependencies: { path: z.string(), dependencies: z.array(z.string()) },
  scene_save_as: { saved_as: z.string() },
  node_add: { path: z.string(), name: z.string(), type: z.string() },
  node_delete: { deleted: z.string() },
  node_rename: { path: z.string(), name: z.string() },
  node_reparent: { path: z.string() },
  node_set_property: { path: z.string(), property: z.string(), value: encodedValue },
  node_get_property: { path: z.string(), property: z.string(), value: encodedValue },
  node_duplicate: { path: z.string(), name: z.string(), type: z.string() },
  node_get_children: { path: z.string(), children: z.array(z.object({ name: z.string(), type: z.string(), path: z.string() })) },
  node_find: { matches: z.array(z.object({ name: z.string(), type: z.string(), path: z.string() })), count: z.number() },
  node_list_groups: { path: z.string(), groups: z.array(z.string()) },
  node_add_to_group: { path: z.string(), group: z.string(), added: z.boolean() },
  node_remove_from_group: { path: z.string(), group: z.string(), removed: z.boolean() },
  node_instantiate_scene: { path: z.string(), name: z.string(), type: z.string(), scene: z.string() },
  node_move_child: { path: z.string(), index: z.number() },
  node_change_type: { path: z.string(), name: z.string(), type: z.string(), old_type: z.string() },
  node_set_owner: { path: z.string(), owner: z.string().nullable() },
  node_call_method: { path: z.string(), method: z.string(), result: encodedValue },
  node_get_path: {
    path: z.string(), name: z.string(), type: z.string(),
    index: z.number(), parent: z.string().nullable(), child_count: z.number(),
  },
  node_list_properties: {
    path: z.string(),
    properties: z.array(z.object({ name: z.string(), type: z.number(), class_name: z.string(), usage: z.number() })),
  },
  signal_list: { path: z.string(), signals: z.array(z.object({ name: z.string(), args: z.array(z.string()) })) },
  signal_list_connections: {
    path: z.string(),
    connections: z.array(z.object({ signal: z.string(), target: z.string().nullable(), method: z.string(), flags: z.number() })),
  },
  signal_connect: { signal: z.string(), source: z.string(), target: z.string(), method: z.string(), flags: z.number(), connected: z.boolean() },
  signal_disconnect: { signal: z.string(), source: z.string(), target: z.string(), method: z.string(), disconnected: z.boolean() },
  signal_add_user_signal: { path: z.string(), signal: z.string(), added: z.boolean() },
  signal_emit: { path: z.string(), signal: z.string(), emitted: z.boolean() },
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

  // ---- Group B: resources (tools/editor.ts -> operations.gd _resource_*) ----
  resource_create: { created: z.string(), type: z.string() },
  resource_load: {
    path: z.string(),
    type: z.string(),
    resource_name: z.string(),
    properties: z.array(z.object({ name: z.string(), type: z.number(), class_name: z.string(), usage: z.number() })),
  },
  resource_save: { saved: z.string(), from: z.string() },
  resource_duplicate: { duplicated: z.string(), from: z.string(), deep: z.boolean() },
  resource_get_property: { path: z.string(), property: z.string(), value: encodedValue },
  resource_set_property: { path: z.string(), property: z.string(), value: encodedValue },
  resource_get_import_settings: { path: z.string(), imported: z.boolean(), importer: z.string(), settings: z.record(encodedValue) },
  resource_set_import_settings: { path: z.string(), reimported: z.boolean(), settings: z.array(z.string()) },

  // ---- Group B: filesystem (tools/editor.ts -> operations.gd _filesystem_*) ----
  filesystem_list: { path: z.string(), dirs: z.array(z.string()), files: z.array(z.string()) },
  filesystem_scan: { scanning: z.boolean() },
  filesystem_move: { moved: z.string(), from: z.string(), moved_import: z.boolean() },
  filesystem_create_dir: { created: z.string(), existed: z.boolean() },

  // ---- Group C: animation (tools/editor.ts -> operations.gd _anim_*) ----
  anim_player_create: { path: z.string(), name: z.string(), type: z.string() },
  anim_create: { player: z.string(), library: z.string(), name: z.string() },
  anim_delete: { player: z.string(), library: z.string(), deleted: z.string() },
  anim_add_track: { track: z.number(), type: z.string(), path: z.string() },
  anim_insert_key: { track: z.number(), time: z.number(), key_count: z.number() },
  anim_remove_key: { track: z.number(), removed_key: z.number(), time: z.number() },
  anim_set_length: { length: z.number(), previous: z.number() },
  anim_set_loop: { mode: z.string(), previous: z.string() },
  anim_get_track_keys: { track: z.number(), type: z.string(), path: z.string(), keys: z.array(z.object({ index: z.number(), time: z.number(), value: encodedValue, transition: z.number() })) },
  anim_list: { player: z.string(), animations: z.array(z.object({ name: z.string(), library: z.string(), animation: z.string(), length: z.number(), loop_mode: z.string(), track_count: z.number() })) },
  anim_tree_create: { path: z.string(), name: z.string(), type: z.string(), root_type: z.string(), anim_player: z.string(), active: z.boolean() },
  anim_tree_add_node: { tree: z.string(), node_name: z.string(), node_type: z.string(), position: z.array(z.number()) },
  anim_statemachine_add_state: { tree: z.string(), state_machine: z.string(), state_name: z.string(), node_type: z.string(), animation: z.string(), position: z.array(z.number()) },
  anim_statemachine_add_transition: { tree: z.string(), state_machine: z.string(), from_state: z.string(), to_state: z.string(), xfade_time: z.number(), switch_mode: z.string(), advance_mode: z.string(), transition_count: z.number() },

  // ---- Group D: TileSet (tools/editor.ts -> operations.gd _tileset_*) ----
  tileset_create: { created: z.string(), tile_size: z.array(z.number()) },
  tileset_add_source: { tileset: z.string(), source_id: z.number(), texture: z.string(), texture_region_size: z.array(z.number()), source_count: z.number() },
  tileset_add_tile: { tileset: z.string(), source_id: z.number(), atlas_coords: z.array(z.number()), size: z.array(z.number()), tiles_count: z.number() },
  tileset_set_tile_collision: { tileset: z.string(), source_id: z.number(), atlas_coords: z.array(z.number()), physics_layer: z.number(), polygon_index: z.number(), points: z.number(), one_way: z.boolean() },

  // ---- Group D batch 2: TileMapLayer + cell painting (tools/editor.ts -> operations.gd _tilemap*) ----
  tilemaplayer_create: { path: z.string(), name: z.string(), type: z.string(), tile_set: z.string() },
  tilemap_set_cell: { path: z.string(), coords: z.array(z.number()), source_id: z.number(), atlas_coords: z.array(z.number()), alternative: z.number(), erased: z.boolean() },
  tilemap_set_cells_rect: { path: z.string(), rect: z.array(z.number()), cells: z.number(), source_id: z.number(), atlas_coords: z.array(z.number()), alternative: z.number(), erased: z.boolean() },
  tilemap_get_cell: { path: z.string(), coords: z.array(z.number()), source_id: z.number(), atlas_coords: z.array(z.number()), alternative: z.number(), empty: z.boolean() },
  tilemap_clear: { path: z.string(), cleared_cells: z.number() },

  // ---- Group E: Physics & collision (tools/editor.ts -> operations.gd _body_*/_collisionshape_add) ----
  body_create: { path: z.string(), name: z.string(), type: z.string(), body: z.string(), dim: z.string() },
  collisionshape_add: { path: z.string(), name: z.string(), type: z.string(), shape: z.string(), shape_class: z.string(), dim: z.string() },
  body_set_collision_layer: { path: z.string(), collision_layer: z.number() },
  body_set_collision_mask: { path: z.string(), collision_mask: z.number() },

  // ---- Group E batch 2: areas, joints, collision polygons, rigidbody tuning, physics material, project gravity ----
  area_set_monitoring: { path: z.string(), monitoring: z.boolean(), monitorable: z.boolean() },
  area_set_gravity: { path: z.string(), space_override: z.string(), gravity: z.number(), direction: z.array(z.number()), gravity_point: z.boolean(), dim: z.string() },
  joint_create: { path: z.string(), name: z.string(), type: z.string(), joint: z.string(), dim: z.string(), node_a: z.string(), node_b: z.string() },
  joint_set_bodies: { path: z.string(), node_a: z.string(), node_b: z.string() },
  collisionpolygon_add: { path: z.string(), name: z.string(), type: z.string(), dim: z.string(), points: z.number() },
  rigidbody_set_properties: { path: z.string(), mass: z.number(), gravity_scale: z.number(), linear_damp: z.number(), angular_damp: z.number() },
  body_set_physics_material: { path: z.string(), friction: z.number(), bounce: z.number(), rough: z.boolean(), absorbent: z.boolean() },
  physics_set_gravity: { dim: z.string(), magnitude: z.number(), direction: z.array(z.number()), saved: z.boolean() },

  // ---- Group F batch 1: VFX particles (tools/editor.ts -> operations.gd _particles_*) ----
  particles_create: { path: z.string(), name: z.string(), type: z.string(), dim: z.string(), amount: z.number(), lifetime: z.number(), emitting: z.boolean() },
  particles_set_process_material: { path: z.string(), gravity: z.array(z.number()), direction: z.array(z.number()), spread: z.number(), initial_velocity_min: z.number(), initial_velocity_max: z.number(), scale_min: z.number(), scale_max: z.number(), color: z.array(z.number()) },
  particles_set_amount: { path: z.string(), amount: z.number() },
  particles_set_lifetime: { path: z.string(), lifetime: z.number() },
  particles_set_emitting: { path: z.string(), emitting: z.boolean() },
  particles_set_texture: { path: z.string(), texture_path: z.string() },

  // ---- Group F batch 2: shaders (tools/editor.ts -> operations.gd _shader_* / _shadermaterial_*) ----
  shader_create: { created: z.string(), type: z.string(), code_length: z.number() },
  shader_set_code: { path: z.string(), code_length: z.number() },
  shadermaterial_create: { path: z.string(), target_property: z.string(), type: z.string(), shader_path: z.string() },
  shadermaterial_set_shader: { path: z.string(), shader_path: z.string() },
  shadermaterial_set_param: { path: z.string(), param: z.string(), value: encodedValue },
  // ---- Group F batch 3: audio (tools/editor.ts -> operations.gd _audio_*) ----
  audio_player_create: { path: z.string(), name: z.string(), type: z.string(), dim: z.string(), autoplay: z.boolean(), volume_db: z.number(), bus: z.string(), stream_path: z.string() },
  audio_set_stream: { path: z.string(), stream_path: z.string() },
  audio_bus_add: { index: z.number(), name: z.string(), send: z.string(), count: z.number() },
  audio_bus_add_effect: { bus: z.string(), bus_index: z.number(), effect: z.string(), effect_count: z.number() },
  audio_bus_set_volume: { bus: z.string(), bus_index: z.number(), volume_db: z.number() },
  audio_set_bus_layout: { saved: z.string(), bus_count: z.number() },

  // ---- Group G: UI / Control / theming (tools/editor.ts -> operations.gd _control_* / _container_* / _theme_*) ----
  control_create: { path: z.string(), name: z.string(), type: z.string() },
  container_add_child: { path: z.string(), name: z.string(), type: z.string(), container: z.string() },
  control_set_anchors: {
    path: z.string(),
    anchors: z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() }),
  },
  control_set_layout_preset: { path: z.string(), preset: z.number(), preset_name: z.string() },
  control_set_size_flags: { path: z.string(), horizontal: z.number(), vertical: z.number(), stretch_ratio: z.number() },
  control_set_theme: { path: z.string(), theme_path: z.string() },
  theme_create: { created: z.string(), type: z.string() },
  theme_set_color: { path: z.string(), name: z.string(), theme_type: z.string(), color: z.array(z.number()) },
  theme_set_font: { path: z.string(), name: z.string(), theme_type: z.string(), font_path: z.string() },
  theme_set_stylebox: { path: z.string(), name: z.string(), theme_type: z.string(), stylebox_path: z.string() },
  theme_set_constant: { path: z.string(), name: z.string(), theme_type: z.string(), value: z.number() },

  // ---- Group H: 3D & navigation (tools/editor.ts -> operations.gd _meshinstance_* / _mesh_* / _primitive_mesh_* / _light_* / _camera_* / _csg_* / _navregion_* / _navagent_* / _environment_*) ----
  meshinstance_create: { path: z.string(), name: z.string(), type: z.string(), mesh_path: z.string() },
  mesh_set_surface_material: { path: z.string(), material_path: z.string(), surface: z.number() },
  primitive_mesh_create: { created: z.string(), type: z.string(), shape: z.string() },
  light_create: { path: z.string(), name: z.string(), type: z.string(), kind: z.string() },
  camera_create: { path: z.string(), name: z.string(), type: z.string(), current: z.boolean() },
  csg_create: { path: z.string(), name: z.string(), type: z.string(), shape: z.string() },
  navregion_create: { path: z.string(), name: z.string(), type: z.string(), has_navmesh: z.boolean() },
  navagent_configure: {
    path: z.string(),
    name: z.string(),
    type: z.string(),
    config: z.object({
      radius: z.number(),
      height: z.number(),
      max_speed: z.number(),
      path_desired_distance: z.number(),
      target_desired_distance: z.number(),
      avoidance_enabled: z.boolean(),
    }),
  },
  environment_create: { created: z.string(), type: z.string(), background_mode: z.string() },
  environment_set_sky: { path: z.string(), background_mode: z.string(), sky_material: z.string() },

  // ---- Group I: input / project config / testing (tools/editor.ts -> operations.gd _inputmap_* / _project_add_autoload / _project_remove_autoload / _project_add_export_preset / _project_set_main_scene / _project_list_settings / _editorsettings_get_set / _test_detect / _test_list) ----
  inputmap_add_action: { action: z.string(), deadzone: z.number(), saved: z.boolean() },
  inputmap_add_event: { action: z.string(), event_count: z.number(), event_class: z.string(), saved: z.boolean() },
  inputmap_list: { count: z.number(), actions: z.array(z.object({ name: z.string(), deadzone: z.number(), events: z.array(z.object({ class: z.string(), text: z.string() })) })) },
  inputmap_erase_action: { erased: z.boolean(), action: z.string(), saved: z.boolean() },
  project_add_autoload: { autoload: z.string(), path: z.string(), enabled: z.boolean(), saved: z.boolean() },
  project_remove_autoload: { removed: z.boolean(), autoload: z.string(), saved: z.boolean() },
  project_add_export_preset: { preset: z.string(), platform: z.string(), index: z.number(), path: z.string() },
  project_set_main_scene: { main_scene: z.string(), saved: z.boolean() },
  project_list_settings: { prefix: z.string(), count: z.number(), settings: z.array(z.object({ name: z.string(), value: z.any() })) },
  editorsettings_get_set: { name: z.string(), value: z.any(), mode: z.string() },
  test_detect: { framework: z.string(), path: z.string(), version: z.string() },
  test_list: { dir: z.string(), count: z.number(), tests: z.array(z.string()) },

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
  gd_call_hierarchy: {
    direction: z.string(),
    items: z.array(z.object({
      name: z.string(), kind: z.string(), uri: z.string(), line: z.number(), character: z.number(), detail: z.string(),
      calls: z.array(z.object({
        name: z.string(), kind: z.string(), uri: z.string(), line: z.number(), character: z.number(), detail: z.string(),
        ranges: z.array(z.object({ line: z.number(), character: z.number(), end_line: z.number(), end_character: z.number() })),
      })),
    })),
  },
  gd_semantic_tokens: {
    token_count: z.number(),
    tokens: z.array(z.object({
      line: z.number(), character: z.number(), length: z.number(), type: z.string(), modifiers: z.array(z.string()),
    })),
  },

  // ---- Plane D: C# semantic / OmniSharp LSP (tools/cslsp.ts) ----
  cs_completion: { items: z.array(z.object({ label: z.string(), kind: z.string(), detail: z.string(), insertText: z.string() })) },
  cs_hover: { contents: z.string() },
  cs_definition: { locations: z.array(location) },
  cs_references: { locations: z.array(location) },
  cs_rename: { changed_files: z.array(z.string()), edit_count: z.number(), applied: z.boolean(), written: z.array(z.string()) },
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
  cs_code_action: {
    actions: z.array(z.object({ title: z.string(), kind: z.string(), has_edit: z.boolean(), command: z.string().nullable() })),
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

  // ---- Plane D: C# debugging / netcoredbg DAP (tools/csdap.ts) ----
  cs_dbg_launch: { session_id: z.string(), state: z.string() },
  cs_dbg_attach: { session_id: z.string(), state: z.string() },
  cs_dbg_set_breakpoints: {
    path: z.string(), buffered: z.boolean(),
    breakpoints: z.array(z.object({ line: z.number(), verified: z.boolean() })),
    // Present only when the adapter advertised the requested condition modifier unsupported (see tools/csdap.ts).
    unsupported_modifiers: z.array(z.string()).optional(),
    warning: z.string().optional(),
  },
  cs_dbg_continue: { state: z.string(), stopped_reason: z.string().nullable() },
  cs_dbg_step: { state: z.string(), stopped_reason: z.string().nullable() },
  cs_dbg_stack_trace: { frames: z.array(z.object({ id: z.number(), name: z.string(), source: z.string(), line: z.number() })) },
  cs_dbg_scopes: { scopes: z.array(z.object({ name: z.string(), variables_ref: z.number() })) },
  cs_dbg_variables: { variables: z.array(z.object({ name: z.string(), value: z.string(), type: z.string(), variables_ref: z.number() })) },
  cs_dbg_evaluate: { result: z.string(), type: z.string(), variables_ref: z.number() },
  cs_dbg_set_variable: { name: z.string(), value: z.string(), type: z.string(), variables_ref: z.number() },
  cs_dbg_watch: {
    watches: z.array(z.object({ expression: z.string(), value: z.string(), type: z.string(), error: z.string().nullable() })),
  },
  cs_dbg_set_exception_breakpoints: {
    filters: z.array(z.string()),
    available_filters: z.array(z.object({ filter: z.string(), label: z.string() })),
    breakpoints: z.array(z.object({ verified: z.boolean() })),
  },
  // C# sessions have no scene, so — unlike dbg_restart — no `scene` field here.
  cs_dbg_restart: { session_id: z.string(), method: z.string(), state: z.string() },

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

  // ---- Group K: knowledge & search ----
  // Host-side project index (tools/knowledge.ts) — no bridge/LSP; read the project files directly.
  project_search: {
    query: z.string(),
    regex: z.boolean(),
    matches: z.array(z.object({ file: z.string(), line: z.number(), column: z.number(), text: z.string() })),
    count: z.number(),
    truncated: z.boolean(),
  },
  find_symbol: {
    name: z.string(),
    matches: z.array(z.object({ file: z.string(), line: z.number(), kind: z.string(), symbol: z.string(), text: z.string() })),
    count: z.number(),
    truncated: z.boolean(),
  },
  find_usages: {
    name: z.string(),
    usages: z.array(z.object({ file: z.string(), line: z.number(), column: z.number(), text: z.string() })),
    count: z.number(),
    truncated: z.boolean(),
  },
  example_snippet: {
    query: z.string().nullable(),
    count: z.number(),
    snippets: z.array(z.object({
      id: z.string(), title: z.string(), tags: z.array(z.string()),
      code: z.string(), explanation: z.string(), docs_url: z.string(),
    })),
    available: z.array(z.string()),
  },
  // ClassDB-backed reference tools (tools/editor.ts -> operations.gd _classdb_reference / _docs_search).
  class_reference: {
    class: z.string(),
    parent: z.string(),
    can_instantiate: z.boolean(),
    docs_url: z.string(),
    methods: z.array(z.object({ name: z.string(), return_type: z.string(), args: z.array(z.object({ name: z.string(), type: z.string() })) })),
    signals: z.array(z.object({ name: z.string(), args: z.array(z.object({ name: z.string(), type: z.string() })) })),
    properties: z.array(z.object({ name: z.string(), type: z.string(), class_name: z.string() })),
  },
  docs_search: {
    query: z.string(),
    count: z.number(),
    truncated: z.boolean(),
    results: z.array(z.object({ class: z.string(), member: z.string(), kind: z.string(), docs_url: z.string() })),
  },

  // ---- Group J: AI asset generation (tools/assetgen.ts) ----
  // asset_gen_configure reports/sets the session backend (the feature flag).
  asset_gen_configure: {
    backend: z.string(),
    provider: z.string().nullable(),
    command: z.string().nullable(),
    configured: z.boolean(),
    supported_kinds: z.array(z.string()),
    note: z.string(),
  },
  // The six generators share one envelope. It must validate all three success
  // outcomes — "placeholder" (in-engine), "generated" (command backend) and
  // "no_backend" (degraded) — so only the always-present fields are pinned
  // (path/prompt nullable; width/height/bytes/imported_type/request optional).
  ...(() => {
    const assetGenResult: z.ZodRawShape = {
      status: z.string(),
      kind: z.string(),
      backend: z.string(),
      path: z.string().nullable(),
      prompt: z.string().nullable(),
      message: z.string(),
    };
    return {
      asset_gen_placeholder: assetGenResult,
      asset_gen_sprite: assetGenResult,
      asset_gen_texture: assetGenResult,
      asset_gen_icon: assetGenResult,
      asset_gen_audio_sfx: assetGenResult,
      asset_gen_model: assetGenResult,
    };
  })(),

  // ---- Group M: netcode & backend scaffolding (tools/netcode.ts) ----
  // Node authoring (undoable, over the editor bridge).
  mp_add_spawner: { path: z.string(), name: z.string(), type: z.string(), spawn_path: z.string(), spawnable_scenes: z.array(z.string()) },
  mp_add_synchronizer: { path: z.string(), name: z.string(), type: z.string(), root_path: z.string(), properties: z.array(z.string()) },
  mp_set_authority: { path: z.string(), peer_id: z.number(), previous: z.number(), recursive: z.boolean() },
  // The four codegen tools share one envelope validating both the "written" and
  // "unsupported" (webrtc feature-detect) outcomes — path nullable, tool-specific
  // extras (bytes/created/function/annotation/stub_created) left optional (non-strict).
  ...(() => {
    const netcodeScaffold: z.ZodRawShape = {
      status: z.string(),
      kind: z.string(),
      path: z.string().nullable(),
      message: z.string(),
    };
    return {
      mp_setup_enet_peer: netcodeScaffold,
      mp_setup_webrtc_peer: netcodeScaffold,
      mp_wire_rpc: netcodeScaffold,
      mp_scaffold_lobby: netcodeScaffold,
    };
  })(),

  // ---- Group M (second half): backend-SDK integration scaffolding (tools/backend.ts) ----
  // backend_detect reports which SDKs are installed (read-only).
  backend_detect: {
    detected: z.array(z.string()),
    backends: z.array(z.object({
      sdk: z.string(),
      installed: z.boolean(),
      method: z.string().nullable(),
      autoload: z.string().nullable(),
      addon_dir: z.string().nullable(),
      class_name: z.string().nullable(),
    })),
    message: z.string(),
  },
  // The four scaffolders share one envelope validating all three outcomes:
  // "written", "sdk_missing" (degrade — SDK absent) and "unsupported_feature"
  // (this SDK has no such API). path nullable; bytes/created optional (non-strict).
  ...(() => {
    const backendScaffold: z.ZodRawShape = {
      status: z.string(),
      sdk: z.string(),
      kind: z.string(),
      path: z.string().nullable(),
      message: z.string(),
    };
    return {
      backend_configure: backendScaffold,
      leaderboard_scaffold: backendScaffold,
      cloudsave_scaffold: backendScaffold,
      auth_scaffold: backendScaffold,
    };
  })(),

  // ---- Group N: card/board/piece authoring composites (tools/tabletop.ts) ----
  card_template_create: {
    scene_path: z.string(),
    script_path: z.string(),
    root_type: z.string(),
    has_back: z.boolean(),
    node_count: z.number(),
    saved: z.boolean(),
    slots: z.array(z.object({ name: z.string(), node_path: z.string(), kind: z.string() })),
  },
  card_instance: {
    instance_path: z.string(),
    face_up: z.boolean(),
    bound: z.array(z.string()),
    unbound: z.array(z.string()),
  },
  card_hand_layout: {
    container_path: z.string(),
    mode: z.string(),
    count: z.number(),
    instances: z.array(z.object({ index: z.number(), instance_path: z.string() })),
  },
  card_deck_from_table: {
    deck_container: z.string(),
    count: z.number(),
    rows_read: z.number(),
    rows_skipped: z.number(),
    unmapped_columns: z.array(z.string()),
    instances: z.array(z.object({ row_index: z.number(), instance_path: z.string() })),
  },
  board_create: {
    scene_path: z.string(),
    root_type: z.string(),
    cell_kind: z.string(),
    layout_mode: z.string(),
    cell_count: z.number(),
    node_count: z.number(),
    saved: z.boolean(),
    cells: z.array(z.object({ id: z.string(), node_path: z.string(), x: z.number(), y: z.number() })),
  },
  board_place: {
    placed: z.boolean(),
    cell: z.string(),
    cell_path: z.string(),
    node_path: z.string(),
    align: z.object({ x: z.number(), y: z.number() }),
  },
  piece_template_create: {
    scene_path: z.string(),
    script_path: z.string(),
    root_type: z.string(),
    has_label: z.boolean(),
    has_hit_area: z.boolean(),
    has_back: z.boolean(),
    node_count: z.number(),
    saved: z.boolean(),
    nodes: z.array(z.object({ name: z.string(), node_path: z.string(), type: z.string() })),
  },
  piece_instance: {
    instance_path: z.string(),
    face_up: z.boolean(),
    bound: z.array(z.string()),
    unbound: z.array(z.string()),
    placed: z.boolean(),
    cell: z.string().nullable(),
  },
  piece_move: {
    moved: z.boolean(),
    from: z.string().nullable(),
    to: z.string(),
    node_path: z.string(),
    animated: z.boolean(),
  },
  interact_make_draggable: {
    node_path: z.string(),
    mode: z.string(),
    script_path: z.string(),
    payload_keys: z.array(z.string()),
    action: z.string().nullable(),
    connected: z.boolean(),
  },
  interact_add_drop_zone: {
    node_path: z.string(),
    mode: z.string(),
    script_path: z.string(),
    on_drop: z.string(),
    accepts_key: z.string(),
    accepts_values: z.array(z.string()),
    notified: z.boolean(),
    area_path: z.string().nullable(),
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
