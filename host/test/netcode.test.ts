import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  registerNetcodeTools,
  buildEnetScript,
  buildWebrtcScript,
  buildLobbyScript,
  rpcAnnotation,
  insertRpc,
} from "../src/tools/netcode.js";
import type { Config } from "../src/config.js";

type Handler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
}>;

interface BridgeCall {
  method: string;
  params: Record<string, unknown>;
}

/** A recording fake bridge whose responses are canned per method. */
function fakeBridge(responses: Record<string, Record<string, unknown>>) {
  const calls: BridgeCall[] = [];
  const bridge = {
    async request(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params });
      if (method in responses) return responses[method];
      throw new Error(`unexpected bridge method ${method}`);
    },
  };
  return { bridge, calls };
}

/** Register Group M against a recorder + fake bridge; returns handlers + call log. */
function setup(cfg: Partial<Config>, responses: Record<string, Record<string, unknown>> = {}) {
  const handlers: Record<string, Handler> = {};
  const server = {
    registerTool(name: string, _config: unknown, handler: Handler) { handlers[name] = handler; },
    // Auto-accept any elicitation so gated writers proceed under test.
    server: { elicitInput: async () => ({ action: "accept", content: { proceed: true } }) },
  };
  const { bridge, calls } = fakeBridge(responses);
  const full: Config = { projectPath: cfg.projectPath ?? "/tmp/nonexistent" } as Config;
  registerNetcodeTools(
    server as unknown as Parameters<typeof registerNetcodeTools>[0],
    bridge as unknown as Parameters<typeof registerNetcodeTools>[1],
    full,
  );
  return { handlers, calls };
}

const WRITTEN = { "mp.write_script": { status: "written", path: null as string | null, bytes: 100, created: true } };

// ------------------------------------------------------------- codegen ----

test("buildEnetScript produces valid-looking GDScript with host/join + peer assignment", () => {
  const src = buildEnetScript({ port: 9999, maxClients: 16 });
  assert.match(src, /^extends Node/m);
  assert.match(src, /const DEFAULT_PORT := 9999/);
  assert.match(src, /const MAX_CLIENTS := 16/);
  assert.match(src, /func host_game\(/);
  assert.match(src, /func join_game\(/);
  assert.match(src, /peer\.create_server\(/);
  assert.match(src, /peer\.create_client\(/);
  assert.match(src, /multiplayer\.multiplayer_peer = peer/);
  assert.ok(!src.includes("class_name"), "no class_name unless requested");
  // Indentation is tabs (GDScript), never leading spaces on code lines.
  assert.ok(!/^ +\S/m.test(src), "no space-indented lines");
});

test("buildEnetScript adds a class_name when requested", () => {
  const src = buildEnetScript({ className: "NetPeer", port: 24565, maxClients: 32 });
  assert.match(src, /^class_name NetPeer\nextends Node/);
});

test("buildWebrtcScript targets WebRTCMultiplayerPeer", () => {
  const src = buildWebrtcScript({});
  assert.match(src, /WebRTCMultiplayerPeer\.new\(\)/);
  assert.match(src, /func create_mesh\(/);
  assert.match(src, /multiplayer\.multiplayer_peer = peer/);
});

test("buildLobbyScript tracks peers and exposes the lobby signals", () => {
  const src = buildLobbyScript({ port: 7000, maxPlayers: 4 });
  assert.match(src, /signal player_joined/);
  assert.match(src, /signal player_left/);
  assert.match(src, /const MAX_PLAYERS := 4/);
  assert.match(src, /multiplayer\.peer_connected\.connect/);
  assert.match(src, /multiplayer\.peer_disconnected\.connect/);
  assert.match(src, /func host_game\(/);
  assert.match(src, /func join_game\(/);
});

test("rpcAnnotation formats all four @rpc fields", () => {
  assert.equal(
    rpcAnnotation({ mode: "any_peer", call_local: true, transfer_mode: "reliable", channel: 2 }),
    '@rpc("any_peer", "call_local", "reliable", 2)',
  );
  assert.equal(
    rpcAnnotation({ mode: "authority", call_local: false, transfer_mode: "unreliable", channel: 0 }),
    '@rpc("authority", "call_remote", "unreliable", 0)',
  );
});

test("insertRpc adds the annotation above an existing function, preserving indentation", () => {
  const src = "extends Node\n\nfunc take_damage(amount):\n\thealth -= amount\n";
  const ann = rpcAnnotation({ mode: "any_peer", call_local: false, transfer_mode: "reliable", channel: 0 });
  const { content, stub_created } = insertRpc(src, "take_damage", ann);
  assert.equal(stub_created, false);
  assert.match(content, /@rpc\("any_peer", "call_remote", "reliable", 0\)\nfunc take_damage\(/);
});

test("insertRpc matches a tab-indented (nested) function and indents the annotation to match", () => {
  const src = "class Inner:\n\tfunc ping():\n\t\tpass\n";
  const { content } = insertRpc(src, "ping", '@rpc("authority", "call_remote", "unreliable", 0)');
  assert.match(content, /\n\t@rpc\("authority", "call_remote", "unreliable", 0\)\n\tfunc ping\(/);
});

test("insertRpc replaces an existing @rpc annotation instead of stacking a second", () => {
  const src = 'extends Node\n\n@rpc("authority", "call_remote", "unreliable", 0)\nfunc shoot():\n\tpass\n';
  const ann = rpcAnnotation({ mode: "any_peer", call_local: true, transfer_mode: "reliable", channel: 1 });
  const { content } = insertRpc(src, "shoot", ann);
  const count = (content.match(/@rpc\(/g) || []).length;
  assert.equal(count, 1, "the old annotation is replaced, not duplicated");
  assert.match(content, /@rpc\("any_peer", "call_local", "reliable", 1\)\nfunc shoot\(/);
});

test("insertRpc appends a stub when the function is absent", () => {
  const src = "extends Node\n";
  const ann = '@rpc("authority", "call_remote", "unreliable", 0)';
  const { content, stub_created } = insertRpc(src, "sync_state", ann);
  assert.equal(stub_created, true);
  assert.match(content, /@rpc\("authority", "call_remote", "unreliable", 0\)\nfunc sync_state\(\) -> void:\n\tpass\n$/);
});

// ------------------------------------------------------ node tool forwarding ----

test("mp_add_spawner forwards parent/spawn_path/spawnable_scenes to the bridge", async () => {
  const { handlers, calls } = setup({}, { "mp.add_spawner": { path: "Spawner", name: "Spawner", type: "MultiplayerSpawner", spawn_path: "../Players", spawnable_scenes: ["res://p.tscn"] } });
  const r = await handlers.mp_add_spawner({ parent_path: ".", spawn_path: "../Players", spawnable_scenes: ["res://p.tscn"] });
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent!.type, "MultiplayerSpawner");
  assert.equal(calls[0].method, "mp.add_spawner");
  assert.equal(calls[0].params.spawn_path, "../Players");
  assert.deepEqual(calls[0].params.spawnable_scenes, ["res://p.tscn"]);
});

test("mp_add_synchronizer forwards properties + replication_mode", async () => {
  const { handlers, calls } = setup({}, { "mp.add_synchronizer": { path: "Sync", name: "Sync", type: "MultiplayerSynchronizer", root_path: "..", properties: [".:position"] } });
  const r = await handlers.mp_add_synchronizer({ parent_path: ".", properties: [".:position"], replication_mode: "on_change" });
  assert.equal(r.structuredContent!.type, "MultiplayerSynchronizer");
  assert.equal(calls[0].method, "mp.add_synchronizer");
  assert.deepEqual(calls[0].params.properties, [".:position"]);
  assert.equal(calls[0].params.replication_mode, "on_change");
});

test("mp_set_authority forwards peer_id + recursive", async () => {
  const { handlers, calls } = setup({}, { "mp.set_authority": { path: "P", peer_id: 42, previous: 1, recursive: true } });
  const r = await handlers.mp_set_authority({ path: "P", peer_id: 42 });
  assert.equal(r.structuredContent!.peer_id, 42);
  assert.equal(calls[0].method, "mp.set_authority");
  assert.equal(calls[0].params.peer_id, 42);
});

// ------------------------------------------------------------- codegen tools ----

test("mp_setup_enet_peer writes the generated script through mp.write_script (gated)", async () => {
  const { handlers, calls } = setup({}, WRITTEN);
  const r = await handlers.mp_setup_enet_peer({ to_path: "res://net/enet.gd", port: 5555, confirm: true });
  const s = r.structuredContent!;
  assert.equal(s.status, "written");
  assert.equal(s.kind, "enet");
  assert.equal(calls[0].method, "mp.write_script");
  assert.equal(calls[0].params.to_path, "res://net/enet.gd");
  assert.match(String(calls[0].params.content), /const DEFAULT_PORT := 5555/);
});

test("mp_setup_enet_peer rejects a non-.gd path with no bridge call", async () => {
  const { handlers, calls } = setup({}, WRITTEN);
  const r = await handlers.mp_setup_enet_peer({ to_path: "res://net/enet.txt", confirm: true });
  assert.equal(r.isError, true);
  assert.equal(calls.length, 0);
});

test("mp_setup_webrtc_peer DEGRADES to 'unsupported' when the module is absent", async () => {
  const { handlers, calls } = setup({}, { "mp.write_script": { status: "unsupported", path: null, required_class: "WebRTCMultiplayerPeer" } });
  const r = await handlers.mp_setup_webrtc_peer({ to_path: "res://net/webrtc.gd", confirm: true });
  const s = r.structuredContent!;
  assert.equal(s.status, "unsupported");
  assert.equal(s.path, null);
  assert.match(String(s.message), /WebRTC/);
  // It still asked the editor (which is where feature detection lives).
  assert.equal(calls[0].method, "mp.write_script");
  assert.equal(calls[0].params.require_class, "WebRTCMultiplayerPeer");
});

test("mp_setup_webrtc_peer writes when the module IS present", async () => {
  const { handlers } = setup({}, WRITTEN);
  const r = await handlers.mp_setup_webrtc_peer({ to_path: "res://net/webrtc.gd", confirm: true });
  assert.equal(r.structuredContent!.status, "written");
  assert.equal(r.structuredContent!.kind, "webrtc");
});

test("mp_wire_rpc reads the on-disk script, inserts the annotation, and rewrites it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcb-netcode-"));
  fs.mkdirSync(path.join(dir, "net"));
  fs.writeFileSync(path.join(dir, "net", "player.gd"), "extends Node\n\nfunc shoot(dir):\n\tpass\n");
  const { handlers, calls } = setup({ projectPath: dir }, WRITTEN);
  const r = await handlers.mp_wire_rpc({ path: "res://net/player.gd", function: "shoot", mode: "any_peer", transfer_mode: "reliable", confirm: true });
  const s = r.structuredContent!;
  assert.equal(s.status, "written");
  assert.equal(s.stub_created, false);
  assert.equal(s.annotation, '@rpc("any_peer", "call_remote", "reliable", 0)');
  assert.match(String(calls[0].params.content), /@rpc\("any_peer", "call_remote", "reliable", 0\)\nfunc shoot\(/);
  assert.equal(calls[0].params.overwrite, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("mp_wire_rpc appends a stub when the target function is missing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcb-netcode-"));
  fs.writeFileSync(path.join(dir, "e.gd"), "extends Node\n");
  const { handlers, calls } = setup({ projectPath: dir }, WRITTEN);
  const r = await handlers.mp_wire_rpc({ path: "res://e.gd", function: "sync_state", confirm: true });
  assert.equal(r.structuredContent!.stub_created, true);
  assert.match(String(calls[0].params.content), /func sync_state\(\) -> void:/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("mp_wire_rpc errors clearly when the script cannot be read (no bridge call)", async () => {
  const { handlers, calls } = setup({ projectPath: "/tmp/gcb-does-not-exist" }, WRITTEN);
  const r = await handlers.mp_wire_rpc({ path: "res://missing.gd", function: "x", confirm: true });
  assert.equal(r.isError, true);
  assert.match(r.content![0].text!, /Cannot read/);
  assert.equal(calls.length, 0);
});

test("mp_scaffold_lobby writes the lobby controller through mp.write_script", async () => {
  const { handlers, calls } = setup({}, WRITTEN);
  const r = await handlers.mp_scaffold_lobby({ to_path: "res://net/lobby.gd", max_players: 6, confirm: true });
  assert.equal(r.structuredContent!.status, "written");
  assert.equal(r.structuredContent!.kind, "lobby");
  assert.match(String(calls[0].params.content), /const MAX_PLAYERS := 6/);
  assert.match(String(calls[0].params.content), /signal player_joined/);
});
