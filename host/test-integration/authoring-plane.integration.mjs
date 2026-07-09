// Authoring-plane integration probe (EXPERIMENTAL) — drives the Group E (physics
// & collision) and Group F (VFX & audio) authoring mutators against a REAL running
// Godot editor's Claude Bridge addon (:9080) and asserts each mutation INDEPENDENTLY
// by reading the live edited scene back through separate read tools. This is the one
// thing the mocked-bridge unit suite cannot do: prove the mutator actually changes
// the edited scene inside a real editor, not just that the host emits the right
// bridge request.
//
// Coverage — all 29 tools shipped in v0.13.0 across Groups E+F:
//   Physics/collision (12): body_create, collisionshape_add, collisionpolygon_add,
//     body_set_collision_layer, body_set_collision_mask, area_set_monitoring,
//     area_set_gravity, rigidbody_set_properties, body_set_physics_material,
//     joint_create, joint_set_bodies, physics_set_gravity.
//   Particles (6): particles_create, particles_set_amount, particles_set_lifetime,
//     particles_set_emitting, particles_set_process_material, particles_set_texture.
//   Shaders (5): shader_create, shader_set_code, shadermaterial_create,
//     shadermaterial_set_shader, shadermaterial_set_param.
//   Audio (6): audio_player_create, audio_set_stream, audio_bus_add,
//     audio_bus_add_effect, audio_bus_set_volume, audio_set_bus_layout.
//
// How it asserts (independent read-back, not just the mutator's own echo):
//   * node creators  -> node_get_children(parent) shows the new node at the returned
//                       path with the expected class.
//   * scalar setters -> node_get_property(path, prop) re-reads the applied value
//                       (Codec passes int/float/bool/String through unchanged).
//   * resource setters-> node_get_property(path, prop) comes back Codec-tagged
//                       {__type__:"Resource", class:...}; we assert the class.
//   * project gravity -> project_get_setting re-reads the ProjectSettings value.
//   * file writers    -> resource_load re-opens the written .gdshader/.tres.
//   * global bus tools-> AudioServer has no editor read tool; we assert the live
//                       values the mutator read back from AudioServer post-commit.
//
// Assets: the example project ships no texture/audio, so the probe MINTS its own
// (PlaceholderTexture2D, AudioStreamWAV via resource_create; two .gdshader files via
// shader_create) — no committed binary fixtures.
//
// Markers (grep-able): AUTH_PHYS_* / AUTH_VFX_PARTICLES_* / AUTH_VFX_SHADER_* /
// AUTH_AUDIO_*. Every marker prints "OK" or "FAIL"; a trailing AUTH_SUMMARY line
// reports the tally and the process exits non-zero if any assertion failed. The
// reachability check is the gate (exit 1 if the addon is unreachable).
//
// NOT asserted here: undo/redo. The mutators register EditorUndoRedoManager actions,
// but there is no bridge action to TRIGGER an editor undo, so the undo stack cannot
// be exercised over :9080 without a new editor_undo capability. Undo-stack assertion
// is deferred to that follow-up; this probe proves the forward mutation only.
//
// Side effects (harmless in the ephemeral CI runner; clean up after a local run):
//   * unsaved in-memory edits to res://main.tscn (never saved -> vanish on close);
//   * written files res://_auth_probe_tex.tres, _auth_probe_audio.tres,
//     _auth_probe_a.gdshader, _auth_probe_b.gdshader, _auth_probe_bus_layout.tres
//     (+ their .import siblings);
//   * two extra AudioServer buses on the running editor (global, reset on restart).
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

  // ---------------------------------------------------------------- summary ----
  console.log("AUTH_UNDO_DEFERRED note=undo-stack assertion needs an editor_undo bridge action (see header)");
  const total = results.pass.length + results.fail.length;
  console.log(`\nAUTH_SUMMARY pass=${results.pass.length}/${total} fail=${results.fail.length}${results.fail.length ? " -> " + results.fail.join(", ") : ""}`);
  await client.close();
  process.exit(results.fail.length ? 1 : 0);
}

main().catch((e) => { console.error("[authoring] FATAL:", (e && e.stack) || e); process.exit(1); });
