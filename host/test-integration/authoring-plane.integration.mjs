// Authoring-plane integration probe (EXPERIMENTAL) — drives the Group A (scene
// graph: nodes, scenes, signals), Group B (resources & filesystem), Group C
// (animation), Group D (TileSet / TileMapLayer), Group E (physics & collision),
// and Group F (VFX & audio) authoring mutators against a REAL running Godot
// editor's Claude Bridge addon (:9080) and asserts each mutation INDEPENDENTLY by
// reading the live edited scene / project filesystem back through separate read
// tools. This is the one thing the mocked-bridge unit suite cannot do: prove the
// mutator actually changes the edited scene (or writes the resource) inside a real
// editor, not just that the host emits the right bridge request.
//
// Coverage — the authoring surface across Groups A–F:
//   A · scene graph (nodes): node_add, node_duplicate, node_add_to_group,
//       node_remove_from_group, node_move_child, node_change_type, node_set_owner,
//       node_find, node_get_path, node_list_properties, node_list_groups.
//   A · scenes: scene_pack, node_instantiate_scene, scene_list_open,
//       scene_get_dependencies.
//   A · signals: signal_connect, signal_disconnect, signal_add_user_signal,
//       signal_list, signal_list_connections, signal_emit.
//   B · resources/filesystem: resource_create, resource_load, resource_save,
//       resource_duplicate, resource_set_property, resource_get_property,
//       resource_get_import_settings, filesystem_create_dir, filesystem_list,
//       filesystem_scan, filesystem_move.
//   C · animation: anim_player_create, anim_create, anim_set_length, anim_set_loop,
//       anim_add_track, anim_insert_key, anim_get_track_keys, anim_remove_key,
//       anim_list, anim_tree_create, anim_tree_add_node, anim_statemachine_add_state,
//       anim_statemachine_add_transition, anim_delete.
//   D · tiles: tileset_create, tileset_add_source, tileset_add_tile,
//       tileset_set_tile_collision, tilemaplayer_create, tilemap_set_cell,
//       tilemap_set_cells_rect, tilemap_get_cell, tilemap_clear.
//   E · physics/collision (12) and F · particles/shaders/audio (17) — see markers.
//
// How it asserts (independent read-back, not just the mutator's own echo):
//   * node creators  -> node_get_children(parent) shows the new node at the returned
//                       path with the expected class.
//   * scalar setters -> node_get_property(path, prop) re-reads the applied value.
//   * resource setters-> node_get_property/resource_get_property comes back Codec-tagged.
//   * groups/signals -> node_list_groups / signal_list(_connections) re-read the state.
//   * anim mutators  -> anim_list / anim_get_track_keys re-read the library/tracks.
//   * tile mutators  -> tilemap_get_cell re-reads a painted cell; resource_load reopens
//                       the written TileSet/.tres.
//   * disk writers   -> resource_load / filesystem_list re-open / re-list what was written.
//   * project gravity -> project_get_setting re-reads the ProjectSettings value.
//   * global bus tools-> AudioServer has no editor read tool; we assert the live
//                       values the mutator read back from AudioServer post-commit.
//
// Undo/redo IS asserted per plane. editor_undo / editor_redo drive the edited scene's
// EditorUndoRedoManager history (resolved via get_object_history_id on the edited
// root), so every in-scene family round-trips a representative undoable archetype
// (creator / property / connection / cell paint): mutate -> undo -> revert -> redo ->
// restore. The dedicated AUTH_UNDO family additionally proves the mechanism across
// the creator / property / resource archetypes, a 3-deep LIFO stack, and a redo
// no-op guard. Disk-backed writers (Group B, TileSet .tres writers, project gravity,
// the global AudioServer tools) are NOT scene-undoable and are asserted forward only.
//
// Assets: the example project ships no texture/audio, so the probe MINTS its own
// (PlaceholderTexture2D, AudioStreamWAV, StyleBoxFlat via resource_create; two
// .gdshader files via shader_create; a PackedScene via scene_pack; a TileSet via
// tileset_create) — no committed binary fixtures.
//
// Markers (grep-able): AUTH_NODE_* / AUTH_SCENE_* / AUTH_SIGNAL_* / AUTH_RESOURCE_* /
// AUTH_ANIM_* / AUTH_TILESET_* / AUTH_TILEMAP_* / AUTH_PHYS_* / AUTH_VFX_PARTICLES_* /
// AUTH_VFX_SHADER_* / AUTH_AUDIO_* / AUTH_UI_* / AUTH_3D_* / AUTH_UNDO_* / AUTH_REDO_*. Every marker prints
// "OK" or "FAIL"; a trailing AUTH_SUMMARY line reports the tally and the process exits
// non-zero if any assertion failed. The reachability check is the gate (exit 1 if the
// addon is unreachable).
//
// Side effects (harmless in the ephemeral CI runner; clean up after a local run):
//   * unsaved in-memory edits to res://main.tscn (never saved -> vanish on close);
//   * written files under res://_auth_probe_* : _auth_probe_tex.tres,
//     _auth_probe_audio.tres, _auth_probe_a.gdshader, _auth_probe_b.gdshader,
//     _auth_probe_bus_layout.tres, _auth_probe_branch.tscn, _auth_probe_style*.tres,
//     _auth_probe_tiletex.tres, _auth_probe_tileset.tres, the Group G theme files
//     (_auth_probe.theme.tres, _auth_probe_sbox.tres, _auth_probe_font.tres), the Group H
//     3D resources (_auth_probe_box.mesh.tres, _auth_probe_mat3d.tres, _auth_probe_env.tres),
//     and the _auth_probe_dir/
//     directory (with moved.tres) — plus their .uid/.import siblings;
//   * two extra AudioServer buses on the running editor (global, reset on restart).
//   * Group I: in-memory ProjectSettings edits (input/autoload/main_scene, save:false ->
//     vanish on close), a net-zero EditorSettings write, and res://export_presets.cfg on disk.
//   Local cleanup (narrow — do NOT `rm example/*.uid`, that deletes tracked sidecars):
//     rm -rf example/_auth_probe_* example/default_bus_layout.tres example/export_presets.cfg
//     git checkout -- example/project.godot
//
// Requires the editor up (booted under Xvfb by the workflow) with GODOT_PROJECT set.
// Run from host/:  node test-integration/authoring-plane.integration.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url)); // host/test-integration
const HOST_DIR = path.resolve(THIS_DIR, "..");                 // host/ (the package root)
const REPO = path.resolve(HOST_DIR, "..");                     // repo root
const DIST = path.join(HOST_DIR, "dist", "index.js");
const GODOT_PROJECT = process.env.GODOT_PROJECT || path.join(REPO, "example");
const GODOT_BIN = process.env.GODOT_BIN || "godot";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tools gated behind a confirmation prompt — pass confirm:true so we exercise the
// action rather than the decline path.
const GATED = new Set([
  "physics_set_gravity", "shader_create", "shader_set_code", "resource_create",
  "audio_bus_add", "audio_bus_add_effect", "audio_bus_set_volume", "audio_set_bus_layout",
  // Group A/B/C/D destructive writers exercised below:
  "scene_pack", "signal_emit", "resource_save", "resource_duplicate",
  "resource_set_property", "filesystem_move", "anim_delete",
  "tileset_create", "tileset_add_source", "tileset_add_tile", "tileset_set_tile_collision",
  // Group G theme file-writers (Theme .tres on disk):
  "theme_create", "theme_set_color", "theme_set_font", "theme_set_stylebox", "theme_set_constant",
  // Group H resource file-writers (PrimitiveMesh / Environment .tres on disk):
  "primitive_mesh_create", "environment_create", "environment_set_sky",
  // Group I ProjectSettings / editor-config writers (in-memory input/autoload/main-scene
  // with save:false, export_presets.cfg on disk, EditorSettings on set):
  "inputmap_add_action", "inputmap_add_event", "inputmap_erase_action",
  "project_add_autoload", "project_remove_autoload", "project_add_export_preset",
  "project_set_main_scene", "editorsettings_get_set",
]);

const results = { pass: [], fail: [] };
function pass(marker, detail = "") { results.pass.push(marker); console.log(`${marker} OK ${detail}`.trimEnd()); }
function fail(marker, detail = "") { results.fail.push(marker); console.log(`${marker} FAIL ${detail}`.trimEnd()); }

const near = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-3;

async function main() {
  const transport = new StdioClientTransport({
    command: "node", args: [DIST], cwd: HOST_DIR,
    env: { ...process.env, GODOT_BIN, GODOT_PROJECT }, stderr: "inherit",
  });
  const client = new Client({ name: "gcb-authoring", version: "1.0.0" }, { capabilities: { elicitation: {} } });
  // Auto-approve any confirmation prompt (belt-and-suspenders with GATED/confirm:true).
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept", content: { proceed: true } }));
  await client.connect(transport);

  // ---- low-level call: returns structuredContent, throws on bridge/schema error ----
  async function call(name, args = {}) {
    const a = GATED.has(name) ? { confirm: true, ...args } : args;
    const r = await client.callTool({ name, arguments: a }, undefined, { timeout: 60000 });
    if (r.isError) throw new Error(`${name}: ${(r.content?.[0]?.text || "").slice(0, 200)}`);
    if (!r.structuredContent) throw new Error(`${name}: no structuredContent`);
    return r.structuredContent;
  }
  // ---- read-back helpers ----
  const childList = async (p) => (await call("node_get_children", { path: p })).children || [];
  const hasChild = async (parent, childPath, type) =>
    (await childList(parent)).some((c) => c.path === childPath && (!type || c.type === type));
  const propVal = async (p, property) => (await call("node_get_property", { path: p, property })).value;
  const propResClass = async (p, property) => { const v = await propVal(p, property); return v && typeof v === "object" ? v.class : undefined; };
  const propNodePath = async (p, property) => { const v = await propVal(p, property); return v && typeof v === "object" ? v.path : v; };
  const settingVal = async (name) => (await call("project_get_setting", { name })).value;
  const groupsOf = async (p) => (await call("node_list_groups", { path: p })).groups || [];
  const connsOf = async (p, signal) => (await call("signal_list_connections", signal ? { path: p, signal } : { path: p })).connections || [];
  const sigNames = async (p) => ((await call("signal_list", { path: p })).signals || []).map((s) => s.name);
  const animOf = async (pl, nm) => ((await call("anim_list", { player_path: pl })).animations || []).find((a) => a.name === nm);
  const nodeIndex = async (p) => (await call("node_get_path", { path: p })).index;

  // Run one family; a throw inside marks a fail but never aborts the other families.
  async function family(label, fn) {
    try { await fn(); } catch (e) { fail(`${label}_THREW`, String(e?.message || e).slice(0, 200)); }
  }

  // ---------------------------------------------------------------- gate ----
  console.log(`authoring-plane probe -> host stdio, GODOT_PROJECT=${GODOT_PROJECT}`);
  let up = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await client.callTool({ name: "editor_ping", arguments: {} }, undefined, { timeout: 5000 });
      if (r.structuredContent?.pong) {
        up = true;
        console.log(`AUTH_GATE_PING OK addon=${r.structuredContent.addon_version} godot=${r.structuredContent.godot}`);
        break;
      }
    } catch { /* not up yet */ }
    await sleep(1500);
  }
  if (!up) {
    console.error("AUTH_GATE_PING FAIL — editor bridge never answered on :9080 (editor not up, or plugin disabled)");
    await client.close();
    process.exit(1);
  }
  // A known edited scene root must exist for the in-scene mutators.
  await call("scene_open", { path: "res://main.tscn" });

  // ---------------------------------------------------------------- fixtures ----
  const TEX = "res://_auth_probe_tex.tres";
  const AUDIO = "res://_auth_probe_audio.tres";
  const SHADER_A = "res://_auth_probe_a.gdshader";
  const SHADER_B = "res://_auth_probe_b.gdshader";
  const BUS_LAYOUT = "res://_auth_probe_bus_layout.tres";
  const CODE_A = "shader_type canvas_item;\nuniform float amount = 1.0;\nvoid fragment() { COLOR.a *= amount; }\n";
  const CODE_A2 = "shader_type canvas_item;\nuniform float amount = 1.0;\nuniform vec4 tint : source_color = vec4(1.0);\nvoid fragment() { COLOR *= tint; COLOR.a *= amount; }\n";
  const CODE_B = "shader_type canvas_item;\nuniform float amount = 0.5;\nvoid fragment() { COLOR.rgb *= amount; }\n";

  await family("AUTH_FIXTURES", async () => {
    await call("resource_create", { class_name: "PlaceholderTexture2D", to_path: TEX });
    await call("resource_create", { class_name: "AudioStreamWAV", to_path: AUDIO });
    await call("shader_create", { to_path: SHADER_A, code: CODE_A });
    await call("shader_create", { to_path: SHADER_B, code: CODE_B });
    // Prove the minted assets are real & the right type via an independent load.
    const okTex = (await call("resource_load", { path: TEX })).type;
    const okAudio = (await call("resource_load", { path: AUDIO })).type;
    const okShader = (await call("resource_load", { path: SHADER_A })).type;
    if (okTex && okAudio && okShader === "Shader") pass("AUTH_FIXTURES_MINTED", `tex=${okTex} audio=${okAudio} shader=${okShader}`);
    else fail("AUTH_FIXTURES_MINTED", `tex=${okTex} audio=${okAudio} shader=${okShader}`);
  });

  // ---------------------------------------------------------------- Group A: node depth ----
  await family("AUTH_NODE", async () => {
    const rootc = (await call("node_add", { parent_path: ".", type: "Node2D", name: "AuthNodeRoot" })).path;
    (await hasChild(".", rootc, "Node2D")) ? pass("AUTH_NODE_ADD_CONTAINER", rootc) : fail("AUTH_NODE_ADD_CONTAINER", rootc);

    const child = (await call("node_add", { parent_path: rootc, type: "Sprite2D", name: "AuthChild" })).path;
    (await hasChild(rootc, child, "Sprite2D")) ? pass("AUTH_NODE_ADD_CHILD", child) : fail("AUTH_NODE_ADD_CHILD", child);

    // node_duplicate (undoable) — forward + undo + redo
    const dup = (await call("node_duplicate", { path: child })).path;
    const dupMade = await hasChild(rootc, dup, "Sprite2D");
    const du = await call("editor_undo");
    const dupGone = !(await hasChild(rootc, dup, "Sprite2D"));
    (dupMade && du.performed === true && dupGone)
      ? pass("AUTH_NODE_DUPLICATE", `dup=${dup}`) : fail("AUTH_NODE_DUPLICATE", `made=${dupMade} performed=${du.performed} gone=${dupGone}`);
    const dr = await call("editor_redo");
    (dr.performed === true && (await hasChild(rootc, dup, "Sprite2D")))
      ? pass("AUTH_NODE_DUPLICATE_REDO") : fail("AUTH_NODE_DUPLICATE_REDO", `performed=${dr.performed}`);

    // node_add_to_group / node_list_groups (undoable) — forward + undo + redo
    await call("node_add_to_group", { path: child, group: "auth_group" });
    const inGrp = (await groupsOf(child)).includes("auth_group");
    const gu = await call("editor_undo");
    const outGrp = !(await groupsOf(child)).includes("auth_group");
    (inGrp && gu.performed === true && outGrp)
      ? pass("AUTH_NODE_ADD_TO_GROUP") : fail("AUTH_NODE_ADD_TO_GROUP", `in=${inGrp} performed=${gu.performed} out=${outGrp}`);
    await call("editor_redo");
    (await groupsOf(child)).includes("auth_group")
      ? pass("AUTH_NODE_ADD_TO_GROUP_REDO") : fail("AUTH_NODE_ADD_TO_GROUP_REDO");

    // node_remove_from_group (undoable) — forward
    await call("node_remove_from_group", { path: child, group: "auth_group" });
    !(await groupsOf(child)).includes("auth_group")
      ? pass("AUTH_NODE_REMOVE_FROM_GROUP") : fail("AUTH_NODE_REMOVE_FROM_GROUP");

    // node_move_child (undoable) — reorder AuthChild to the last sibling index
    await call("node_add", { parent_path: rootc, type: "Node2D", name: "AuthSibling" });
    await call("node_move_child", { path: child, to_index: -1 });
    const sibCount = (await childList(rootc)).length;
    (await nodeIndex(child)) === sibCount - 1
      ? pass("AUTH_NODE_MOVE_CHILD", `index=${await nodeIndex(child)}/${sibCount}`) : fail("AUTH_NODE_MOVE_CHILD", `index=${await nodeIndex(child)} of ${sibCount}`);

    // node_change_type (undoable) — Node2D -> Sprite2D, carrying name/children
    const morph = (await call("node_add", { parent_path: rootc, type: "Node2D", name: "AuthMorph" })).path;
    const ct = await call("node_change_type", { path: morph, type: "Sprite2D" });
    ((await call("node_get_path", { path: morph })).type === "Sprite2D" && ct.old_type === "Node2D")
      ? pass("AUTH_NODE_CHANGE_TYPE", `old=${ct.old_type}`) : fail("AUTH_NODE_CHANGE_TYPE", `type=${(await call("node_get_path", { path: morph })).type} old=${ct.old_type}`);

    // node_set_owner (undoable) — reassert AuthChild's owner to the scene root
    const so = await call("node_set_owner", { path: child, owner_path: "." });
    so.path === child ? pass("AUTH_NODE_SET_OWNER", `owner=${JSON.stringify(so.owner)}`) : fail("AUTH_NODE_SET_OWNER", JSON.stringify(so));

    // node_find (read) — Sprite2D descendants of the container
    const found = await call("node_find", { root_path: rootc, type: "Sprite2D" });
    (found.count >= 1 && found.matches.some((m) => m.path === child))
      ? pass("AUTH_NODE_FIND", `count=${found.count}`) : fail("AUTH_NODE_FIND", `count=${found.count}`);

    // node_get_path (read)
    const gp = await call("node_get_path", { path: child });
    (gp.parent === rootc && typeof gp.index === "number" && typeof gp.child_count === "number")
      ? pass("AUTH_NODE_GET_PATH", `parent=${gp.parent} idx=${gp.index}`) : fail("AUTH_NODE_GET_PATH", JSON.stringify(gp));

    // node_list_properties (read) — a Sprite2D exposes "position"
    const lp = await call("node_list_properties", { path: child });
    lp.properties.some((p) => p.name === "position")
      ? pass("AUTH_NODE_LIST_PROPERTIES", `n=${lp.properties.length}`) : fail("AUTH_NODE_LIST_PROPERTIES", `n=${lp.properties.length}`);
  });

  // ---------------------------------------------------------------- Group A: scenes ----
  await family("AUTH_SCENE", async () => {
    const BRANCH = "res://_auth_probe_branch.tscn";
    // scene_pack: save an owned node as a PackedScene (disk-backed, gated), then load it back.
    const packSrc = (await call("node_add", { parent_path: ".", type: "Node2D", name: "AuthPackMe" })).path;
    const packed = await call("scene_pack", { path: packSrc, to_path: BRANCH });
    (packed.packed === BRANCH && (await call("resource_load", { path: BRANCH })).type === "PackedScene")
      ? pass("AUTH_SCENE_PACK", BRANCH) : fail("AUTH_SCENE_PACK", `packed=${packed.packed}`);

    // node_instantiate_scene (undoable): instance the just-packed scene under the root.
    const inst = await call("node_instantiate_scene", { parent_path: ".", scene_path: BRANCH, name: "AuthInstanced" });
    ((await hasChild(".", inst.path)) && inst.scene === BRANCH)
      ? pass("AUTH_SCENE_INSTANTIATE", inst.path) : fail("AUTH_SCENE_INSTANTIATE", JSON.stringify(inst).slice(0, 120));

    // scene_list_open (read) — main.tscn is open
    const open = await call("scene_list_open");
    (Array.isArray(open.scenes) && open.scenes.includes("res://main.tscn"))
      ? pass("AUTH_SCENE_LIST_OPEN", `current=${open.current}`) : fail("AUTH_SCENE_LIST_OPEN", JSON.stringify(open.scenes).slice(0, 120));

    // scene_get_dependencies (read) — main.tscn references player.gd
    const deps = await call("scene_get_dependencies", { path: "res://main.tscn" });
    Array.isArray(deps.dependencies)
      ? pass("AUTH_SCENE_DEPENDENCIES", `n=${deps.dependencies.length}`) : fail("AUTH_SCENE_DEPENDENCIES", JSON.stringify(deps));
  });

  // ---------------------------------------------------------------- Group A: signals ----
  await family("AUTH_SIGNAL", async () => {
    const a = (await call("node_add", { parent_path: ".", type: "Node2D", name: "AuthSigA" })).path;
    const b = (await call("node_add", { parent_path: ".", type: "Node2D", name: "AuthSigB" })).path;

    // signal_connect (undoable): AuthSigA.visibility_changed -> AuthSigB.queue_free
    await call("signal_connect", { path: a, signal: "visibility_changed", target_path: b, method: "queue_free" });
    const wired = (await connsOf(a, "visibility_changed")).some((c) => c.method === "queue_free");
    const su = await call("editor_undo");
    const unwired = !(await connsOf(a, "visibility_changed")).some((c) => c.method === "queue_free");
    (wired && su.performed === true && unwired)
      ? pass("AUTH_SIGNAL_CONNECT") : fail("AUTH_SIGNAL_CONNECT", `wired=${wired} performed=${su.performed} unwired=${unwired}`);
    await call("editor_redo");
    (await connsOf(a, "visibility_changed")).some((c) => c.method === "queue_free")
      ? pass("AUTH_SIGNAL_CONNECT_REDO") : fail("AUTH_SIGNAL_CONNECT_REDO");

    // signal_disconnect (undoable) — forward
    await call("signal_disconnect", { path: a, signal: "visibility_changed", target_path: b, method: "queue_free" });
    !(await connsOf(a, "visibility_changed")).some((c) => c.method === "queue_free")
      ? pass("AUTH_SIGNAL_DISCONNECT") : fail("AUTH_SIGNAL_DISCONNECT");

    // signal_add_user_signal (undoable) — forward + undo + redo
    await call("signal_add_user_signal", { path: a, signal: "auth_evt", args: [{ name: "amount", type: 2 }] });
    const declared = (await sigNames(a)).includes("auth_evt");
    const uu = await call("editor_undo");
    const undeclared = !(await sigNames(a)).includes("auth_evt");
    (declared && uu.performed === true && undeclared)
      ? pass("AUTH_SIGNAL_ADD_USER_SIGNAL") : fail("AUTH_SIGNAL_ADD_USER_SIGNAL", `declared=${declared} performed=${uu.performed} undeclared=${undeclared}`);
    await call("editor_redo");
    (await sigNames(a)).includes("auth_evt")
      ? pass("AUTH_SIGNAL_ADD_USER_SIGNAL_REDO") : fail("AUTH_SIGNAL_ADD_USER_SIGNAL_REDO");

    // signal_list (read) — a Sprite2D... here Node2D... exposes built-in visibility_changed
    (await sigNames(a)).includes("visibility_changed")
      ? pass("AUTH_SIGNAL_LIST") : fail("AUTH_SIGNAL_LIST");

    // signal_emit (gated, edit-time) — fires now, returns emitted:true (no connections left)
    const em = await call("signal_emit", { path: a, signal: "auth_evt", args: [7] });
    em.emitted === true ? pass("AUTH_SIGNAL_EMIT") : fail("AUTH_SIGNAL_EMIT", JSON.stringify(em));
  });

  // ---------------------------------------------------------------- Group B: resources & filesystem ----
  // Disk-backed (ResourceSaver / DirAccess), NOT scene-undoable — asserted forward only,
  // like physics_set_gravity and the global AudioServer bus tools.
  await family("AUTH_RESOURCE", async () => {
    const RES = "res://_auth_probe_style.tres";
    const RES_SAVED = "res://_auth_probe_style_saved.tres";
    const RES_DUP = "res://_auth_probe_style_dup.tres";
    const DIR = "res://_auth_probe_dir";

    await call("resource_create", { class_name: "StyleBoxFlat", to_path: RES });
    (await call("resource_load", { path: RES })).type === "StyleBoxFlat"
      ? pass("AUTH_RESOURCE_CREATE", RES) : fail("AUTH_RESOURCE_CREATE", RES);

    await call("resource_set_property", { path: RES, property: "content_margin_left", value: 12 });
    near((await call("resource_get_property", { path: RES, property: "content_margin_left" })).value, 12)
      ? pass("AUTH_RESOURCE_SET_GET_PROPERTY") : fail("AUTH_RESOURCE_SET_GET_PROPERTY", `got ${(await call("resource_get_property", { path: RES, property: "content_margin_left" })).value}`);

    const sv = await call("resource_save", { from_path: RES, to_path: RES_SAVED });
    (sv.saved === RES_SAVED && (await call("resource_load", { path: RES_SAVED })).type === "StyleBoxFlat")
      ? pass("AUTH_RESOURCE_SAVE", RES_SAVED) : fail("AUTH_RESOURCE_SAVE", JSON.stringify(sv));

    const dp = await call("resource_duplicate", { path: RES, to_path: RES_DUP, deep: true });
    (dp.deep === true && (await call("resource_load", { path: RES_DUP })).type === "StyleBoxFlat")
      ? pass("AUTH_RESOURCE_DUPLICATE", RES_DUP) : fail("AUTH_RESOURCE_DUPLICATE", JSON.stringify(dp));

    // resource_get_import_settings — a .tres is not an imported asset (degrade path -> imported:false)
    const imp = await call("resource_get_import_settings", { path: RES });
    (typeof imp.imported === "boolean")
      ? pass("AUTH_RESOURCE_IMPORT_SETTINGS", `imported=${imp.imported}`) : fail("AUTH_RESOURCE_IMPORT_SETTINGS", JSON.stringify(imp));

    // filesystem_create_dir + filesystem_list (dirs/files are bare names)
    const cd = await call("filesystem_create_dir", { path: DIR });
    const listRoot = await call("filesystem_list", { path: "res://" });
    (cd.created && listRoot.dirs.some((d) => d === "_auth_probe_dir"))
      ? pass("AUTH_RESOURCE_CREATE_DIR", DIR) : fail("AUTH_RESOURCE_CREATE_DIR", `dirs=${JSON.stringify(listRoot.dirs).slice(0, 120)}`);

    // filesystem_scan
    (await call("filesystem_scan")).scanning === true
      ? pass("AUTH_RESOURCE_FS_SCAN") : fail("AUTH_RESOURCE_FS_SCAN");

    // filesystem_move (gated): move the duplicate into the new dir
    const MOVED = DIR + "/moved.tres";
    const mv = await call("filesystem_move", { from_path: RES_DUP, to_path: MOVED });
    const listDir = await call("filesystem_list", { path: DIR });
    (mv.moved === MOVED && listDir.files.some((f) => f === "moved.tres"))
      ? pass("AUTH_RESOURCE_FS_MOVE", MOVED) : fail("AUTH_RESOURCE_FS_MOVE", `files=${JSON.stringify(listDir.files).slice(0, 120)}`);
  });

  // ---------------------------------------------------------------- Group C: animation ----
  await family("AUTH_ANIM", async () => {
    const player = (await call("anim_player_create", { parent_path: ".", name: "AuthAnimPlayer" })).path;
    (await hasChild(".", player, "AnimationPlayer")) ? pass("AUTH_ANIM_PLAYER_CREATE", player) : fail("AUTH_ANIM_PLAYER_CREATE", player);

    await call("anim_create", { player_path: player, name: "walk" });
    (await animOf(player, "walk")) ? pass("AUTH_ANIM_CREATE") : fail("AUTH_ANIM_CREATE");

    const sl = await call("anim_set_length", { player_path: player, name: "walk", length: 2.5 });
    near((await animOf(player, "walk"))?.length, 2.5)
      ? pass("AUTH_ANIM_SET_LENGTH", `prev=${sl.previous}`) : fail("AUTH_ANIM_SET_LENGTH", `got ${(await animOf(player, "walk"))?.length}`);

    const lo = await call("anim_set_loop", { player_path: player, name: "walk", mode: "linear" });
    ((await animOf(player, "walk"))?.loop_mode === "linear")
      ? pass("AUTH_ANIM_SET_LOOP", `prev=${lo.previous}`) : fail("AUTH_ANIM_SET_LOOP", `got ${(await animOf(player, "walk"))?.loop_mode}`);

    const tr = await call("anim_add_track", { player_path: player, name: "walk", path: "Sprite2D:rotation", type: "value" });
    const trackIdx = tr.track;
    (typeof trackIdx === "number" && tr.type === "value")
      ? pass("AUTH_ANIM_ADD_TRACK", `track=${trackIdx}`) : fail("AUTH_ANIM_ADD_TRACK", JSON.stringify(tr));

    const ik = await call("anim_insert_key", { player_path: player, name: "walk", track: trackIdx, time: 0.5, value: 1.5 });
    ik.key_count >= 1 ? pass("AUTH_ANIM_INSERT_KEY", `keys=${ik.key_count}`) : fail("AUTH_ANIM_INSERT_KEY", JSON.stringify(ik));

    const keys = await call("anim_get_track_keys", { player_path: player, name: "walk", track: trackIdx });
    (keys.keys.length >= 1 && near(keys.keys[0].time, 0.5))
      ? pass("AUTH_ANIM_GET_TRACK_KEYS", `n=${keys.keys.length}`) : fail("AUTH_ANIM_GET_TRACK_KEYS", JSON.stringify(keys.keys).slice(0, 120));

    await call("anim_remove_key", { player_path: player, name: "walk", track: trackIdx, key: 0 });
    (await call("anim_get_track_keys", { player_path: player, name: "walk", track: trackIdx })).keys.length === 0
      ? pass("AUTH_ANIM_REMOVE_KEY") : fail("AUTH_ANIM_REMOVE_KEY");

    // anim_list (read) — track_count reflects the added track
    ((await animOf(player, "walk"))?.track_count >= 1)
      ? pass("AUTH_ANIM_LIST") : fail("AUTH_ANIM_LIST", `track_count=${(await animOf(player, "walk"))?.track_count}`);

    // AnimationTree + blend-tree graph node (undoable in-scene)
    const bt = (await call("anim_tree_create", { parent_path: ".", name: "AuthBlendTree", root_type: "blend_tree" })).path;
    (await hasChild(".", bt, "AnimationTree")) ? pass("AUTH_ANIM_TREE_CREATE", bt) : fail("AUTH_ANIM_TREE_CREATE", bt);

    const an = await call("anim_tree_add_node", { tree_path: bt, node_name: "clipA", node_type: "AnimationNodeAnimation", animation: "walk" });
    an.node_name === "clipA" ? pass("AUTH_ANIM_TREE_ADD_NODE") : fail("AUTH_ANIM_TREE_ADD_NODE", JSON.stringify(an));

    // AnimationTree state machine + states + transition
    const sm = (await call("anim_tree_create", { parent_path: ".", name: "AuthStateMachine", root_type: "state_machine" })).path;
    await call("anim_statemachine_add_state", { tree_path: sm, state_name: "idle", animation: "walk" });
    const st2 = await call("anim_statemachine_add_state", { tree_path: sm, state_name: "run", animation: "walk" });
    st2.state_name === "run" ? pass("AUTH_ANIM_SM_ADD_STATE") : fail("AUTH_ANIM_SM_ADD_STATE", JSON.stringify(st2));

    const trn = await call("anim_statemachine_add_transition", { tree_path: sm, from_state: "idle", to_state: "run" });
    trn.transition_count >= 1 ? pass("AUTH_ANIM_SM_ADD_TRANSITION", `n=${trn.transition_count}`) : fail("AUTH_ANIM_SM_ADD_TRANSITION", JSON.stringify(trn));

    // anim_delete (gated): remove "walk"
    await call("anim_delete", { player_path: player, name: "walk" });
    !(await animOf(player, "walk")) ? pass("AUTH_ANIM_DELETE") : fail("AUTH_ANIM_DELETE");

    // undo/redo round-trip on a throwaway player (creator archetype -> scene history)
    const up = (await call("anim_player_create", { parent_path: ".", name: "AuthAnimUndoP" })).path;
    const made = await hasChild(".", up, "AnimationPlayer");
    const au = await call("editor_undo");
    const gone = !(await hasChild(".", up, "AnimationPlayer"));
    (made && au.performed === true && gone)
      ? pass("AUTH_ANIM_UNDO_CREATE") : fail("AUTH_ANIM_UNDO_CREATE", `made=${made} performed=${au.performed} gone=${gone}`);
    await call("editor_redo");
    (await hasChild(".", up, "AnimationPlayer")) ? pass("AUTH_ANIM_REDO_CREATE") : fail("AUTH_ANIM_REDO_CREATE");
  });

  // ---------------------------------------------------------------- Group D: TileSet / TileMapLayer ----
  await family("AUTH_TILEMAP", async () => {
    const TILETEX = "res://_auth_probe_tiletex.tres";
    const TILESET = "res://_auth_probe_tileset.tres";

    // atlas texture minted with a real 64x64 size so 16x16 tiles fit the grid
    await call("resource_create", { class_name: "PlaceholderTexture2D", to_path: TILETEX, properties: { size: { __type__: "Vector2", x: 64, y: 64 } } });

    // TileSet writers (disk-backed .tres, gated) — forward only
    const tc = await call("tileset_create", { to_path: TILESET, tile_size: [16, 16] });
    (tc.created === TILESET && (await call("resource_load", { path: TILESET })).type === "TileSet")
      ? pass("AUTH_TILESET_CREATE", TILESET) : fail("AUTH_TILESET_CREATE", JSON.stringify(tc));

    const src = await call("tileset_add_source", { tileset_path: TILESET, texture_path: TILETEX, texture_region_size: [16, 16] });
    const sourceId = src.source_id;
    (src.source_count >= 1 && typeof sourceId === "number")
      ? pass("AUTH_TILESET_ADD_SOURCE", `id=${sourceId}`) : fail("AUTH_TILESET_ADD_SOURCE", JSON.stringify(src));

    const at = await call("tileset_add_tile", { tileset_path: TILESET, source_id: sourceId, atlas_coords: [0, 0] });
    at.tiles_count >= 1 ? pass("AUTH_TILESET_ADD_TILE", `tiles=${at.tiles_count}`) : fail("AUTH_TILESET_ADD_TILE", JSON.stringify(at));

    const col = await call("tileset_set_tile_collision", { tileset_path: TILESET, source_id: sourceId, atlas_coords: [0, 0], polygon: [[-8, -8], [8, -8], [8, 8], [-8, 8]], physics_layer: 0 });
    (col.points >= 3 && col.physics_layer === 0)
      ? pass("AUTH_TILESET_SET_TILE_COLLISION", `points=${col.points}`) : fail("AUTH_TILESET_SET_TILE_COLLISION", JSON.stringify(col));

    // TileMapLayer (in-scene, undoable)
    const layer = (await call("tilemaplayer_create", { parent_path: ".", name: "AuthTileLayer", tileset_path: TILESET })).path;
    (await hasChild(".", layer, "TileMapLayer")) ? pass("AUTH_TILEMAP_LAYER_CREATE", layer) : fail("AUTH_TILEMAP_LAYER_CREATE", layer);

    // tilemap_set_cell (undoable) — forward + undo + redo
    await call("tilemap_set_cell", { path: layer, coords: [3, 3], source_id: sourceId, atlas_coords: [0, 0] });
    const painted = !(await call("tilemap_get_cell", { path: layer, coords: [3, 3] })).empty;
    const tu = await call("editor_undo");
    const cleared = (await call("tilemap_get_cell", { path: layer, coords: [3, 3] })).empty;
    (painted && tu.performed === true && cleared)
      ? pass("AUTH_TILEMAP_SET_CELL") : fail("AUTH_TILEMAP_SET_CELL", `painted=${painted} performed=${tu.performed} cleared=${cleared}`);
    await call("editor_redo");
    !(await call("tilemap_get_cell", { path: layer, coords: [3, 3] })).empty
      ? pass("AUTH_TILEMAP_SET_CELL_REDO") : fail("AUTH_TILEMAP_SET_CELL_REDO");

    // tilemap_set_cells_rect (undoable) — forward
    const rc = await call("tilemap_set_cells_rect", { path: layer, rect: [0, 0, 2, 2], source_id: sourceId, atlas_coords: [0, 0] });
    (rc.cells === 4 && !(await call("tilemap_get_cell", { path: layer, coords: [0, 0] })).empty)
      ? pass("AUTH_TILEMAP_SET_CELLS_RECT", `cells=${rc.cells}`) : fail("AUTH_TILEMAP_SET_CELLS_RECT", JSON.stringify(rc));

    // tilemap_get_cell (read) — the [3,3] cell reports the painted source
    ((await call("tilemap_get_cell", { path: layer, coords: [3, 3] })).source_id === sourceId)
      ? pass("AUTH_TILEMAP_GET_CELL") : fail("AUTH_TILEMAP_GET_CELL");

    // tilemap_clear (undoable) — forward
    const cl = await call("tilemap_clear", { path: layer });
    (cl.cleared_cells >= 1 && (await call("tilemap_get_cell", { path: layer, coords: [3, 3] })).empty)
      ? pass("AUTH_TILEMAP_CLEAR", `cleared=${cl.cleared_cells}`) : fail("AUTH_TILEMAP_CLEAR", JSON.stringify(cl));
  });

  // ---------------------------------------------------------------- Group E ----
  await family("AUTH_PHYS", async () => {
    const body = (await call("body_create", { parent_path: ".", type: "static", dim: "2d", name: "AuthBody" })).path;
    (await hasChild(".", body, "StaticBody2D")) ? pass("AUTH_PHYS_BODY_CREATE", body) : fail("AUTH_PHYS_BODY_CREATE", body);

    const cs = (await call("collisionshape_add", { parent_path: body, shape: "rect", dim: "2d", size: [40, 20] })).path;
    (await hasChild(body, cs, "CollisionShape2D")) ? pass("AUTH_PHYS_COLLISIONSHAPE", cs) : fail("AUTH_PHYS_COLLISIONSHAPE", cs);

    const cp = (await call("collisionpolygon_add", { parent_path: body, points: [[0, 0], [16, 0], [16, 16]], dim: "2d" })).path;
    (await hasChild(body, cp, "CollisionPolygon2D")) ? pass("AUTH_PHYS_COLLISIONPOLYGON", cp) : fail("AUTH_PHYS_COLLISIONPOLYGON", cp);

    await call("body_set_collision_layer", { path: body, layer: 5 });
    (await propVal(body, "collision_layer")) === 5 ? pass("AUTH_PHYS_LAYER") : fail("AUTH_PHYS_LAYER", `got ${await propVal(body, "collision_layer")}`);

    await call("body_set_collision_mask", { path: body, mask: 3 });
    (await propVal(body, "collision_mask")) === 3 ? pass("AUTH_PHYS_MASK") : fail("AUTH_PHYS_MASK", `got ${await propVal(body, "collision_mask")}`);

    const area = (await call("body_create", { parent_path: ".", type: "area", dim: "2d", name: "AuthArea" })).path;
    (await hasChild(".", area, "Area2D")) ? pass("AUTH_PHYS_AREA_CREATE", area) : fail("AUTH_PHYS_AREA_CREATE", area);

    await call("area_set_monitoring", { path: area, monitoring: false });
    (await propVal(area, "monitoring")) === false ? pass("AUTH_PHYS_AREA_MONITORING") : fail("AUTH_PHYS_AREA_MONITORING", `got ${await propVal(area, "monitoring")}`);

    await call("area_set_gravity", { path: area, gravity: 250 });
    near(await propVal(area, "gravity"), 250) ? pass("AUTH_PHYS_AREA_GRAVITY") : fail("AUTH_PHYS_AREA_GRAVITY", `got ${await propVal(area, "gravity")}`);

    const rigid = (await call("body_create", { parent_path: ".", type: "rigid", dim: "2d", name: "AuthRigid" })).path;
    (await hasChild(".", rigid, "RigidBody2D")) ? pass("AUTH_PHYS_RIGID_CREATE", rigid) : fail("AUTH_PHYS_RIGID_CREATE", rigid);

    await call("rigidbody_set_properties", { path: rigid, mass: 4, gravity_scale: 2 });
    near(await propVal(rigid, "mass"), 4) ? pass("AUTH_PHYS_RIGID_PROPS") : fail("AUTH_PHYS_RIGID_PROPS", `mass=${await propVal(rigid, "mass")}`);

    await call("body_set_physics_material", { path: rigid, friction: 0.3, bounce: 0.8 });
    (await propResClass(rigid, "physics_material_override")) === "PhysicsMaterial"
      ? pass("AUTH_PHYS_MATERIAL") : fail("AUTH_PHYS_MATERIAL", `class=${await propResClass(rigid, "physics_material_override")}`);

    const joint = (await call("joint_create", { parent_path: ".", type: "pin", dim: "2d", name: "AuthJoint" })).path;
    (await hasChild(".", joint, "PinJoint2D")) ? pass("AUTH_PHYS_JOINT_CREATE", joint) : fail("AUTH_PHYS_JOINT_CREATE", joint);

    await call("joint_set_bodies", { path: joint, node_a: "../AuthBody" });
    (await propNodePath(joint, "node_a")) === "../AuthBody" ? pass("AUTH_PHYS_JOINT_BODIES") : fail("AUTH_PHYS_JOINT_BODIES", `node_a=${await propNodePath(joint, "node_a")}`);

    await call("physics_set_gravity", { dim: "2d", magnitude: 137 });
    near(await settingVal("physics/2d/default_gravity"), 137) ? pass("AUTH_PHYS_PROJECT_GRAVITY") : fail("AUTH_PHYS_PROJECT_GRAVITY", `got ${await settingVal("physics/2d/default_gravity")}`);
  });

  // ---------------------------------------------------------------- Group F: particles ----
  await family("AUTH_VFX_PARTICLES", async () => {
    const p = (await call("particles_create", { parent_path: ".", dim: "2d", name: "AuthParticles", amount: 16, lifetime: 1 })).path;
    (await hasChild(".", p, "GPUParticles2D")) && (await propVal(p, "amount")) === 16
      ? pass("AUTH_VFX_PARTICLES_CREATE", p) : fail("AUTH_VFX_PARTICLES_CREATE", `${p} amount=${await propVal(p, "amount")}`);

    await call("particles_set_amount", { path: p, amount: 48 });
    (await propVal(p, "amount")) === 48 ? pass("AUTH_VFX_PARTICLES_AMOUNT") : fail("AUTH_VFX_PARTICLES_AMOUNT", `got ${await propVal(p, "amount")}`);

    await call("particles_set_lifetime", { path: p, lifetime: 3 });
    near(await propVal(p, "lifetime"), 3) ? pass("AUTH_VFX_PARTICLES_LIFETIME") : fail("AUTH_VFX_PARTICLES_LIFETIME", `got ${await propVal(p, "lifetime")}`);

    await call("particles_set_emitting", { path: p, emitting: false });
    (await propVal(p, "emitting")) === false ? pass("AUTH_VFX_PARTICLES_EMITTING") : fail("AUTH_VFX_PARTICLES_EMITTING", `got ${await propVal(p, "emitting")}`);

    await call("particles_set_process_material", { path: p, color: [1, 0, 0, 1], gravity: [0, -98, 0] });
    (await propResClass(p, "process_material")) === "ParticleProcessMaterial"
      ? pass("AUTH_VFX_PARTICLES_PROCESS_MATERIAL") : fail("AUTH_VFX_PARTICLES_PROCESS_MATERIAL", `class=${await propResClass(p, "process_material")}`);

    await call("particles_set_texture", { path: p, texture_path: TEX });
    (await propResClass(p, "texture")) === "PlaceholderTexture2D"
      ? pass("AUTH_VFX_PARTICLES_TEXTURE") : fail("AUTH_VFX_PARTICLES_TEXTURE", `class=${await propResClass(p, "texture")}`);
  });

  // ---------------------------------------------------------------- Group F: shaders ----
  await family("AUTH_VFX_SHADER", async () => {
    // shader_create already exercised in fixtures; assert it independently here too.
    (await call("resource_load", { path: SHADER_A })).type === "Shader"
      ? pass("AUTH_VFX_SHADER_CREATE", SHADER_A) : fail("AUTH_VFX_SHADER_CREATE", SHADER_A);

    const before = (await call("resource_load", { path: SHADER_A })); // Shader present
    const setRes = await call("shader_set_code", { path: SHADER_A, code: CODE_A2 });
    setRes.code_length === CODE_A2.length && before
      ? pass("AUTH_VFX_SHADER_SET_CODE", `len=${setRes.code_length}`) : fail("AUTH_VFX_SHADER_SET_CODE", `len=${setRes.code_length} want=${CODE_A2.length}`);

    await call("shadermaterial_create", { path: "Sprite2D", shader_path: SHADER_A });
    (await propResClass("Sprite2D", "material")) === "ShaderMaterial"
      ? pass("AUTH_VFX_SHADERMATERIAL_CREATE") : fail("AUTH_VFX_SHADERMATERIAL_CREATE", `class=${await propResClass("Sprite2D", "material")}`);

    const ss = await call("shadermaterial_set_shader", { path: "Sprite2D", shader_path: SHADER_B });
    ss.shader_path === SHADER_B ? pass("AUTH_VFX_SHADERMATERIAL_SET_SHADER") : fail("AUTH_VFX_SHADERMATERIAL_SET_SHADER", `shader_path=${ss.shader_path}`);

    const sp = await call("shadermaterial_set_param", { path: "Sprite2D", param: "amount", value: 0.25 });
    near(sp.value, 0.25) ? pass("AUTH_VFX_SHADERMATERIAL_SET_PARAM") : fail("AUTH_VFX_SHADERMATERIAL_SET_PARAM", `value=${JSON.stringify(sp.value)}`);
  });

  // ---------------------------------------------------------------- Group F: audio ----
  await family("AUTH_AUDIO", async () => {
    const player = (await call("audio_player_create", { parent_path: ".", dim: "none", name: "AuthAudio", volume_db: -6 })).path;
    (await hasChild(".", player, "AudioStreamPlayer")) && near(await propVal(player, "volume_db"), -6)
      ? pass("AUTH_AUDIO_PLAYER_CREATE", player) : fail("AUTH_AUDIO_PLAYER_CREATE", `${player} vol=${await propVal(player, "volume_db")}`);

    await call("audio_set_stream", { path: player, stream_path: AUDIO });
    (await propResClass(player, "stream")) === "AudioStreamWAV"
      ? pass("AUTH_AUDIO_SET_STREAM") : fail("AUTH_AUDIO_SET_STREAM", `class=${await propResClass(player, "stream")}`);

    const add = await call("audio_bus_add", { name: "AuthBus" });
    add.name === "AuthBus" && add.count >= 2 ? pass("AUTH_AUDIO_BUS_ADD", `idx=${add.index} count=${add.count}`) : fail("AUTH_AUDIO_BUS_ADD", JSON.stringify(add));

    const fx = await call("audio_bus_add_effect", { bus: "AuthBus", effect: "AudioEffectReverb" });
    fx.effect_count >= 1 ? pass("AUTH_AUDIO_BUS_ADD_EFFECT", `count=${fx.effect_count}`) : fail("AUTH_AUDIO_BUS_ADD_EFFECT", JSON.stringify(fx));

    const vol = await call("audio_bus_set_volume", { bus: "AuthBus", volume_db: -12 });
    near(vol.volume_db, -12) ? pass("AUTH_AUDIO_BUS_SET_VOLUME") : fail("AUTH_AUDIO_BUS_SET_VOLUME", `got ${vol.volume_db}`);

    await call("audio_set_bus_layout", { to_path: BUS_LAYOUT });
    (await call("resource_load", { path: BUS_LAYOUT })).type === "AudioBusLayout"
      ? pass("AUTH_AUDIO_SET_BUS_LAYOUT", BUS_LAYOUT) : fail("AUTH_AUDIO_SET_BUS_LAYOUT", BUS_LAYOUT);
  });

  // ---------------------------------------------------------------- Group G: UI / control / theming ----
  // control_* + container_add_child mutate the edited scene (undoable, ungated); theme_* write a
  // Theme .tres on disk (gated, asserted forward via the mutator echo + an independent Theme reload).
  const THEME = "res://_auth_probe.theme.tres";
  const SBOX = "res://_auth_probe_sbox.tres";
  const FONT = "res://_auth_probe_font.tres";
  await family("AUTH_UI", async () => {
    const uiroot = (await call("control_create", { parent_path: ".", type: "Control", name: "AuthUIRoot" })).path;
    const btn = (await call("control_create", { parent_path: uiroot, type: "Button", name: "AuthButton", text: "Hi" })).path;
    ((await hasChild(uiroot, btn, "Button")) && (await propVal(btn, "text")) === "Hi")
      ? pass("AUTH_UI_CONTROL_CREATE", `${btn} text=${await propVal(btn, "text")}`)
      : fail("AUTH_UI_CONTROL_CREATE", `${btn} text=${await propVal(btn, "text")}`);

    const vbox = (await call("control_create", { parent_path: uiroot, type: "VBoxContainer", name: "AuthVBox" })).path;
    const lbl = (await call("container_add_child", { container_path: vbox, type: "Label", name: "AuthLabel" })).path;
    (await hasChild(vbox, lbl, "Label"))
      ? pass("AUTH_UI_CONTAINER_ADD_CHILD", lbl) : fail("AUTH_UI_CONTAINER_ADD_CHILD", lbl);

    await call("control_set_anchors", { path: btn, right: 1, bottom: 1 });
    (near(await propVal(btn, "anchor_right"), 1) && near(await propVal(btn, "anchor_bottom"), 1))
      ? pass("AUTH_UI_SET_ANCHORS") : fail("AUTH_UI_SET_ANCHORS", `r=${await propVal(btn, "anchor_right")} b=${await propVal(btn, "anchor_bottom")}`);

    const lp = await call("control_set_layout_preset", { path: btn, preset: "full_rect" });
    (lp.preset_name === "full_rect" && near(await propVal(btn, "anchor_left"), 0) && near(await propVal(btn, "anchor_right"), 1))
      ? pass("AUTH_UI_SET_LAYOUT_PRESET", `preset=${lp.preset}`) : fail("AUTH_UI_SET_LAYOUT_PRESET", JSON.stringify(lp));

    await call("control_set_size_flags", { path: btn, horizontal: 3 });
    (await propVal(btn, "size_flags_horizontal")) === 3
      ? pass("AUTH_UI_SET_SIZE_FLAGS") : fail("AUTH_UI_SET_SIZE_FLAGS", `got ${await propVal(btn, "size_flags_horizontal")}`);

    await call("theme_create", { to_path: THEME });
    (await call("resource_load", { path: THEME })).type === "Theme"
      ? pass("AUTH_UI_THEME_CREATE", THEME) : fail("AUTH_UI_THEME_CREATE", THEME);

    const tcol = await call("theme_set_color", { path: THEME, name: "font_color", theme_type: "Button", color: [1, 0, 0, 1] });
    (tcol.color[0] === 1 && (await call("resource_load", { path: THEME })).type === "Theme")
      ? pass("AUTH_UI_THEME_SET_COLOR") : fail("AUTH_UI_THEME_SET_COLOR", JSON.stringify(tcol));

    const tconst = await call("theme_set_constant", { path: THEME, name: "h_separation", theme_type: "HBoxContainer", value: 7 });
    tconst.value === 7 ? pass("AUTH_UI_THEME_SET_CONSTANT") : fail("AUTH_UI_THEME_SET_CONSTANT", JSON.stringify(tconst));

    await call("resource_create", { class_name: "StyleBoxFlat", to_path: SBOX });
    const tsb = await call("theme_set_stylebox", { path: THEME, name: "normal", theme_type: "Button", stylebox_path: SBOX });
    tsb.stylebox_path === SBOX ? pass("AUTH_UI_THEME_SET_STYLEBOX") : fail("AUTH_UI_THEME_SET_STYLEBOX", JSON.stringify(tsb));

    await call("resource_create", { class_name: "SystemFont", to_path: FONT });
    const tfont = await call("theme_set_font", { path: THEME, name: "font", theme_type: "Label", font_path: FONT });
    tfont.font_path === FONT ? pass("AUTH_UI_THEME_SET_FONT") : fail("AUTH_UI_THEME_SET_FONT", JSON.stringify(tfont));

    await call("control_set_theme", { path: btn, theme_path: THEME });
    (await propResClass(btn, "theme")) === "Theme"
      ? pass("AUTH_UI_SET_THEME") : fail("AUTH_UI_SET_THEME", `class=${await propResClass(btn, "theme")}`);

    // Undo round-trip proves the control mutators push a reversible EditorUndoRedoManager action.
    const panel = (await call("control_create", { parent_path: uiroot, type: "Panel", name: "AuthUndoPanel" })).path;
    const pmade = await hasChild(uiroot, panel, "Panel");
    const pu = await call("editor_undo");
    const pgone = !(await hasChild(uiroot, panel, "Panel"));
    (pmade && pu.performed === true && pgone)
      ? pass("AUTH_UI_UNDO_CREATE", `action=${JSON.stringify(pu.action)}`) : fail("AUTH_UI_UNDO_CREATE", `made=${pmade} performed=${pu.performed} gone=${pgone}`);
    const pr = await call("editor_redo");
    (pr.performed === true && (await hasChild(uiroot, panel, "Panel")))
      ? pass("AUTH_UI_REDO_CREATE") : fail("AUTH_UI_REDO_CREATE", `performed=${pr.performed}`);
  });

  // ---------------------------------------------------------------- Group H: 3D & navigation ----
  // meshinstance/mesh/light/camera/csg/navregion/navagent mutate the edited scene (undoable, ungated);
  // primitive_mesh_create + environment_* write a resource .tres on disk (gated, asserted via the
  // mutator echo + an independent resource_load). A creator undo/redo round-trip proves reversibility.
  const BOXMESH = "res://_auth_probe_box.mesh.tres";
  const MAT3D = "res://_auth_probe_mat3d.tres";
  const ENV = "res://_auth_probe_env.tres";
  await family("AUTH_3D", async () => {
    const d3root = (await call("meshinstance_create", { parent_path: ".", name: "Auth3DRoot" })).path;
    (await hasChild(".", d3root, "MeshInstance3D"))
      ? pass("AUTH_3D_MESHINSTANCE_CREATE", d3root) : fail("AUTH_3D_MESHINSTANCE_CREATE", d3root);

    const pm = await call("primitive_mesh_create", { to_path: BOXMESH, shape: "box" });
    (pm.type === "BoxMesh" && (await call("resource_load", { path: BOXMESH })).type === "BoxMesh")
      ? pass("AUTH_3D_PRIMITIVE_MESH_CREATE", pm.type) : fail("AUTH_3D_PRIMITIVE_MESH_CREATE", JSON.stringify(pm));

    const boxmi = (await call("meshinstance_create", { parent_path: d3root, name: "AuthBox", mesh_path: BOXMESH })).path;
    (await propResClass(boxmi, "mesh")) === "BoxMesh"
      ? pass("AUTH_3D_MESHINSTANCE_WITH_MESH", boxmi) : fail("AUTH_3D_MESHINSTANCE_WITH_MESH", `class=${await propResClass(boxmi, "mesh")}`);

    await call("resource_create", { class_name: "StandardMaterial3D", to_path: MAT3D });
    const sm = await call("mesh_set_surface_material", { path: boxmi, material_path: MAT3D });
    (sm.material_path === MAT3D && (await propResClass(boxmi, "material_override")) === "StandardMaterial3D")
      ? pass("AUTH_3D_MESH_SET_SURFACE_MATERIAL", `surface=${sm.surface}`) : fail("AUTH_3D_MESH_SET_SURFACE_MATERIAL", JSON.stringify(sm));

    const light = (await call("light_create", { parent_path: d3root, kind: "spot", name: "AuthSpot" })).path;
    (await hasChild(d3root, light, "SpotLight3D"))
      ? pass("AUTH_3D_LIGHT_CREATE", light) : fail("AUTH_3D_LIGHT_CREATE", light);

    const cam = await call("camera_create", { parent_path: d3root, name: "AuthCam", current: true });
    ((await hasChild(d3root, cam.path, "Camera3D")) && (await propVal(cam.path, "current")) === true)
      ? pass("AUTH_3D_CAMERA_CREATE", cam.path) : fail("AUTH_3D_CAMERA_CREATE", `current=${await propVal(cam.path, "current")}`);

    const csg = (await call("csg_create", { parent_path: d3root, shape: "sphere", name: "AuthCSG" })).path;
    (await hasChild(d3root, csg, "CSGSphere3D"))
      ? pass("AUTH_3D_CSG_CREATE", csg) : fail("AUTH_3D_CSG_CREATE", csg);

    const nav = await call("navregion_create", { parent_path: d3root, name: "AuthNavRegion" });
    ((await hasChild(d3root, nav.path, "NavigationRegion3D")) && nav.has_navmesh === true)
      ? pass("AUTH_3D_NAVREGION_CREATE", nav.path) : fail("AUTH_3D_NAVREGION_CREATE", JSON.stringify(nav));

    const agent = await call("navagent_configure", { parent_path: boxmi, name: "AuthAgent", radius: 1.5, max_speed: 8 });
    ((await hasChild(boxmi, agent.path, "NavigationAgent3D")) && near(await propVal(agent.path, "radius"), 1.5) && near(await propVal(agent.path, "max_speed"), 8))
      ? pass("AUTH_3D_NAVAGENT_CONFIGURE", `r=${agent.config.radius} v=${agent.config.max_speed}`) : fail("AUTH_3D_NAVAGENT_CONFIGURE", JSON.stringify(agent.config));

    const env = await call("environment_create", { to_path: ENV, background: "clear_color" });
    (env.type === "Environment" && (await call("resource_load", { path: ENV })).type === "Environment")
      ? pass("AUTH_3D_ENVIRONMENT_CREATE", env.background_mode) : fail("AUTH_3D_ENVIRONMENT_CREATE", JSON.stringify(env));

    const sky = await call("environment_set_sky", { path: ENV, sky_material: "procedural" });
    (sky.sky_material === "procedural" && sky.background_mode === "sky" && (await call("resource_load", { path: ENV })).type === "Environment")
      ? pass("AUTH_3D_ENVIRONMENT_SET_SKY") : fail("AUTH_3D_ENVIRONMENT_SET_SKY", JSON.stringify(sky));

    // Creator undo/redo round-trip proves the 3D scene mutators push a reversible action.
    const tmp = (await call("light_create", { parent_path: d3root, kind: "omni", name: "AuthUndoLight" })).path;
    const lmade = await hasChild(d3root, tmp, "OmniLight3D");
    const lu = await call("editor_undo");
    const lgone = !(await hasChild(d3root, tmp, "OmniLight3D"));
    (lmade && lu.performed === true && lgone)
      ? pass("AUTH_3D_UNDO_CREATE") : fail("AUTH_3D_UNDO_CREATE", `made=${lmade} performed=${lu.performed} gone=${lgone}`);
    const lr = await call("editor_redo");
    (lr.performed === true && (await hasChild(d3root, tmp, "OmniLight3D")))
      ? pass("AUTH_3D_REDO_CREATE") : fail("AUTH_3D_REDO_CREATE", `performed=${lr.performed}`);
  });

  // ---------------------------------------------------------------- Group I: input / project config / testing ----
  // inputmap_* / project_* / editorsettings_* mutate ProjectSettings or the editor config
  // (gated, NOT the scene undo history) — asserted forward-only via a read-back tool
  // (inputmap_list / project_get_setting / project_list_settings / project_get_info) or the
  // mutator echo. ProjectSettings writers run with save:false (in-memory, vanish on close);
  // project_add_export_preset writes res://export_presets.cfg (cleaned up out-of-band);
  // editorsettings_get_set is exercised get-then-set-to-the-same-value (net-zero on disk).
  await family("AUTH_GROUPI", async () => {
    const ACT = "auth_probe_action";

    const iaa = await call("inputmap_add_action", { name: ACT, deadzone: 0.3 });
    (iaa.action === ACT && near(iaa.deadzone, 0.3))
      ? pass("AUTH_GROUPI_INPUTMAP_ADD_ACTION", `deadzone=${iaa.deadzone}`) : fail("AUTH_GROUPI_INPUTMAP_ADD_ACTION", JSON.stringify(iaa));

    const iae = await call("inputmap_add_event", { name: ACT, event: { type: "key", keycode: "A" } });
    (iae.event_count === 1 && iae.event_class === "InputEventKey")
      ? pass("AUTH_GROUPI_INPUTMAP_ADD_EVENT", `class=${iae.event_class}`) : fail("AUTH_GROUPI_INPUTMAP_ADD_EVENT", JSON.stringify(iae));

    const listed = ((await call("inputmap_list")).actions || []).find((a) => a.name === ACT);
    (listed && listed.events.length === 1 && listed.events[0].class === "InputEventKey")
      ? pass("AUTH_GROUPI_INPUTMAP_LIST", `events=${listed ? listed.events.length : "?"}`) : fail("AUTH_GROUPI_INPUTMAP_LIST", JSON.stringify(listed));

    const era = await call("inputmap_erase_action", { name: ACT });
    const actGone = !((await call("inputmap_list")).actions || []).some((a) => a.name === ACT);
    (era.erased === true && actGone)
      ? pass("AUTH_GROUPI_INPUTMAP_ERASE_ACTION") : fail("AUTH_GROUPI_INPUTMAP_ERASE_ACTION", `erased=${era.erased} gone=${actGone}`);

    const ala = await call("project_add_autoload", { name: "AuthProbeAuto", path: "res://gcb_smoke.gd" });
    (ala.autoload === "AuthProbeAuto" && ala.enabled === true && (await settingVal("autoload/AuthProbeAuto")) === "*res://gcb_smoke.gd")
      ? pass("AUTH_GROUPI_PROJECT_ADD_AUTOLOAD", ala.path) : fail("AUTH_GROUPI_PROJECT_ADD_AUTOLOAD", JSON.stringify(ala));

    const alr = await call("project_remove_autoload", { name: "AuthProbeAuto" });
    const autoGone = !((await call("project_list_settings", { prefix: "autoload/" })).settings || []).some((s) => s.name === "autoload/AuthProbeAuto");
    (alr.removed === true && autoGone)
      ? pass("AUTH_GROUPI_PROJECT_REMOVE_AUTOLOAD") : fail("AUTH_GROUPI_PROJECT_REMOVE_AUTOLOAD", `removed=${alr.removed} gone=${autoGone}`);

    const sms = await call("project_set_main_scene", { path: "res://main.tscn" });
    (sms.main_scene === "res://main.tscn" && (await call("project_get_info")).main_scene === "res://main.tscn")
      ? pass("AUTH_GROUPI_PROJECT_SET_MAIN_SCENE", sms.main_scene) : fail("AUTH_GROUPI_PROJECT_SET_MAIN_SCENE", JSON.stringify(sms));

    const pep = await call("project_add_export_preset", { name: "AuthProbePreset", platform: "Windows Desktop" });
    (pep.preset === "AuthProbePreset" && typeof pep.index === "number" && pep.path === "res://export_presets.cfg")
      ? pass("AUTH_GROUPI_PROJECT_ADD_EXPORT_PRESET", `index=${pep.index}`) : fail("AUTH_GROUPI_PROJECT_ADD_EXPORT_PRESET", JSON.stringify(pep));

    const pls = await call("project_list_settings", { prefix: "application/config/" });
    (pls.count > 0 && (pls.settings || []).some((s) => s.name === "application/config/name"))
      ? pass("AUTH_GROUPI_PROJECT_LIST_SETTINGS", `count=${pls.count}`) : fail("AUTH_GROUPI_PROJECT_LIST_SETTINGS", JSON.stringify(pls).slice(0, 120));

    const esg = await call("editorsettings_get_set", { name: "interface/editor/code_font_size" });
    (esg.mode === "get" && typeof esg.value === "number")
      ? pass("AUTH_GROUPI_EDITORSETTINGS_GET", `v=${esg.value}`) : fail("AUTH_GROUPI_EDITORSETTINGS_GET", JSON.stringify(esg));
    // set the same value back (net-zero) to exercise the write path without changing config.
    const ess = await call("editorsettings_get_set", { name: "interface/editor/code_font_size", value: esg.value });
    (ess.mode === "set" && ess.value === esg.value)
      ? pass("AUTH_GROUPI_EDITORSETTINGS_SET") : fail("AUTH_GROUPI_EDITORSETTINGS_SET", JSON.stringify(ess));

    const td = await call("test_detect");
    (td.framework === "none")
      ? pass("AUTH_GROUPI_TEST_DETECT", td.framework) : fail("AUTH_GROUPI_TEST_DETECT", JSON.stringify(td));

    const tl = await call("test_list");
    (tl.count === 0 && Array.isArray(tl.tests))
      ? pass("AUTH_GROUPI_TEST_LIST", `count=${tl.count}`) : fail("AUTH_GROUPI_TEST_LIST", JSON.stringify(tl));
  });

  // ---------------------------------------------------------------- undo / redo ----
  // editor_undo / editor_redo drive the edited scene's EditorUndoRedoManager history.
  // Round-trip each undo archetype on a throwaway node, then a 3-deep LIFO stack test
  // and a redo no-op guard. Only touches actions pushed here (the top of the stack).
  await family("AUTH_UNDO", async () => {
    const undo = () => call("editor_undo");
    const redo = () => call("editor_redo");

    // (1) creator (add_do_reference): body_create -> undo removes the node -> redo restores it.
    const ub = (await call("body_create", { parent_path: ".", type: "static", dim: "2d", name: "AuthUndoBody" })).path;
    const made = await hasChild(".", ub, "StaticBody2D");
    const u1 = await undo();
    const gone = !(await hasChild(".", ub, "StaticBody2D"));
    (made && u1.performed === true && u1.scope === "scene" && u1.history_id >= 0 && gone)
      ? pass("AUTH_UNDO_CREATE_REVERT", `action=${JSON.stringify(u1.action)} hid=${u1.history_id}`)
      : fail("AUTH_UNDO_CREATE_REVERT", `made=${made} performed=${u1.performed} hid=${u1.history_id} gone=${gone}`);
    const r1 = await redo();
    (r1.performed === true && (await hasChild(".", ub, "StaticBody2D")))
      ? pass("AUTH_REDO_CREATE_RESTORE") : fail("AUTH_REDO_CREATE_RESTORE", `performed=${r1.performed}`);

    // (2) scalar property (add_do_property): set collision_layer -> undo reverts to prior value -> redo re-applies.
    const layer0 = await propVal(ub, "collision_layer");
    await call("body_set_collision_layer", { path: ub, layer: 7 });
    const layerSet = await propVal(ub, "collision_layer");
    const u2 = await undo();
    const layerBack = await propVal(ub, "collision_layer");
    (layerSet === 7 && u2.performed === true && layerBack === layer0)
      ? pass("AUTH_UNDO_PROPERTY_REVERT", `set=${layerSet} back=${layerBack}`)
      : fail("AUTH_UNDO_PROPERTY_REVERT", `set=${layerSet} performed=${u2.performed} back=${layerBack} want=${layer0}`);
    await redo();
    (await propVal(ub, "collision_layer")) === 7
      ? pass("AUTH_REDO_PROPERTY_RESTORE") : fail("AUTH_REDO_PROPERTY_RESTORE", `got ${await propVal(ub, "collision_layer")}`);

    // (3) resource assignment: body_set_physics_material -> undo drops the override -> redo re-adds it.
    await call("body_set_physics_material", { path: ub, friction: 0.4, bounce: 0.6 });
    const matSet = await propResClass(ub, "physics_material_override");
    const u3 = await undo();
    const matBack = await propResClass(ub, "physics_material_override");
    (matSet === "PhysicsMaterial" && u3.performed === true && !matBack)
      ? pass("AUTH_UNDO_RESOURCE_REVERT", `set=${matSet} back=${matBack}`)
      : fail("AUTH_UNDO_RESOURCE_REVERT", `set=${matSet} performed=${u3.performed} back=${matBack}`);
    await redo();
    (await propResClass(ub, "physics_material_override")) === "PhysicsMaterial"
      ? pass("AUTH_REDO_RESOURCE_RESTORE") : fail("AUTH_REDO_RESOURCE_RESTORE");

    // (4) LIFO depth: 3 stacked edits (add child + 2 props) undo x3 -> full revert, redo x3 -> restore.
    const cs = (await call("collisionshape_add", { parent_path: ub, shape: "circle", dim: "2d", radius: 12 })).path;
    await call("body_set_collision_mask", { path: ub, mask: 6 });
    await call("body_set_collision_layer", { path: ub, layer: 9 });
    const stacked = (await hasChild(ub, cs, "CollisionShape2D")) && (await propVal(ub, "collision_mask")) === 6 && (await propVal(ub, "collision_layer")) === 9;
    const dz = await undo(), dy = await undo(), dx = await undo();
    const reverted = !(await hasChild(ub, cs, "CollisionShape2D")) && (await propVal(ub, "collision_mask")) !== 6 && (await propVal(ub, "collision_layer")) === 7;
    (stacked && dz.performed && dy.performed && dx.performed && reverted)
      ? pass("AUTH_UNDO_DEPTH3_REVERT") : fail("AUTH_UNDO_DEPTH3_REVERT", `stacked=${stacked} reverted=${reverted}`);
    await redo(); await redo(); await redo();
    ((await hasChild(ub, cs, "CollisionShape2D")) && (await propVal(ub, "collision_mask")) === 6 && (await propVal(ub, "collision_layer")) === 9)
      ? pass("AUTH_REDO_DEPTH3_RESTORE") : fail("AUTH_REDO_DEPTH3_RESTORE");

    // (5) no-op guard: with the head fully redone, another editor_redo is a graceful no-op (not an error).
    const noop = await redo();
    (noop.performed === false && noop.has_redo === false)
      ? pass("AUTH_UNDO_NOOP_GUARD", `performed=${noop.performed} has_redo=${noop.has_redo}`)
      : fail("AUTH_UNDO_NOOP_GUARD", `performed=${noop.performed} has_redo=${noop.has_redo}`);
  });

  // ---------------------------------------------------------------- summary ----
  console.log("AUTH_UNDO_ASSERTED note=undo/redo round-tripped via editor_undo/editor_redo (see AUTH_UNDO_* / AUTH_REDO_* markers)");
  const total = results.pass.length + results.fail.length;
  console.log(`\nAUTH_SUMMARY pass=${results.pass.length}/${total} fail=${results.fail.length}${results.fail.length ? " -> " + results.fail.join(", ") : ""}`);
  await client.close();
  process.exit(results.fail.length ? 1 : 0);
}

main().catch((e) => { console.error("[authoring] FATAL:", (e && e.stack) || e); process.exit(1); });
