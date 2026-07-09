import { test } from "node:test";
import assert from "node:assert/strict";
import { registerEditorTools } from "../src/tools/editor.js";
import { BridgeError } from "../src/bridge.js";
import {
  makeRecordingServer,
  type ElicitFn,
  type ToolResultLike,
} from "./helpers/recording-server.js";

/**
 * Behavior tests for the editor plane (tools/editor.ts) — the largest surface
 * (145 tools) and the one that had no unit coverage. Two invariants matter most
 * and are asserted here without a real Godot editor:
 *
 *   1. Every DESTRUCTIVE editor tool sits behind the confirmation gate: on a
 *      declined prompt it blocks and NEVER reaches the bridge; with confirm:true
 *      it skips the prompt and proceeds.
 *   2. When the editor bridge is unreachable, EVERY tool degrades to a friendly
 *      isError envelope rather than throwing an opaque protocol error.
 */

// editor.ts has 43 gate() call sites. 42 gate UNCONDITIONALLY (destructive by
// nature); the 43rd — editorsettings_get_set — is a dual read/write tool that
// gates only on the write path and is covered by its own test below. This list
// is the 42 unconditional ones, kept explicit (not a bare count) so that adding
// a destructive tool without a gate — or dropping a gate — fails loudly by name.
const UNCONDITIONALLY_GATED = [
  "anim_delete", "audio_bus_add", "audio_bus_add_effect", "audio_bus_set_volume",
  "audio_set_bus_layout", "environment_create", "environment_set_sky",
  "filesystem_move", "inputmap_add_action", "inputmap_add_event", "inputmap_erase_action",
  "node_call_method", "node_delete", "physics_set_gravity", "primitive_mesh_create",
  "project_add_autoload", "project_add_export_preset", "project_remove_autoload",
  "project_set_main_scene", "project_set_setting", "resource_create", "resource_duplicate",
  "resource_save", "resource_set_import_settings", "resource_set_property", "scene_close",
  "scene_new", "scene_pack", "scene_reload", "scene_save_as", "shader_create", "shader_set_code",
  "signal_emit", "theme_create", "theme_set_color", "theme_set_constant", "theme_set_font",
  "theme_set_stylebox", "tileset_add_source", "tileset_add_tile", "tileset_create",
  "tileset_set_tile_collision",
].sort();

interface BridgeCall {
  method: string;
  params: Record<string, unknown>;
}

/**
 * Register the editor plane against a recording server + a fake bridge whose
 * behavior (resolve vs. reject) and whose elicitation response are switchable
 * per test.
 */
function makeHarness() {
  const calls: BridgeCall[] = [];
  const elicitReqs: unknown[] = [];
  let bridgeMode: "resolve" | "reject" = "resolve";
  let canned: Record<string, unknown> = { ok: true };
  let elicitImpl: ElicitFn = async () => ({ action: "decline" });

  const bridge = {
    async request(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params });
      if (bridgeMode === "reject") {
        throw new BridgeError(
          "bridge_unavailable",
          'Cannot reach the Godot editor bridge at 127.0.0.1:9080. Is the editor open with the "Breakpoint MCP" plugin enabled?',
        );
      }
      return canned;
    },
  };

  const elicit: ElicitFn = async (req) => {
    elicitReqs.push(req);
    return elicitImpl(req);
  };
  const rec = makeRecordingServer(elicit);
  registerEditorTools(
    rec.server as unknown as Parameters<typeof registerEditorTools>[0],
    bridge as unknown as Parameters<typeof registerEditorTools>[1],
  );

  return {
    tools: rec.tools,
    handler: (name: string) => rec.handler(name),
    calls,
    elicitReqs,
    setBridge(mode: "resolve" | "reject", c?: Record<string, unknown>) {
      bridgeMode = mode;
      if (c) canned = c;
    },
    setElicit(fn: ElicitFn) {
      elicitImpl = fn;
    },
  };
}

const text = (r: ToolResultLike): string => r.content?.[0]?.text ?? "";

// -------------------------------------------------------- confirmation gate ----

test("the 42 unconditionally-destructive editor tools gate; each blocks on decline without touching the bridge", async () => {
  const h = makeHarness();
  // A rejecting bridge makes a leak obvious: a truly-gated tool must never get
  // this far on a declined prompt.
  h.setBridge("reject");
  h.setElicit(async () => ({ action: "decline" }));

  const discovered: string[] = [];
  for (const [name, t] of h.tools) {
    const bridgeBefore = h.calls.length;
    const elicitBefore = h.elicitReqs.length;
    let res: ToolResultLike | undefined;
    try {
      res = await t.handler({});
    } catch {
      res = undefined;
    }
    // A tool that never consulted the gate (on a no-arg call) is not
    // unconditionally destructive — editorsettings_get_set reads here.
    if (h.elicitReqs.length === elicitBefore) continue;

    discovered.push(name);
    assert.equal(h.calls.length, bridgeBefore, `${name} must NOT reach the bridge when the user declines`);
    assert.ok(res, `${name} must return a blocking result, not throw`);
    assert.equal(res!.isError, true, `${name} decline result must be an error`);
    assert.match(text(res!), /did not approve/i, `${name} must report the action was not approved`);
  }

  assert.deepEqual(
    discovered.sort(),
    UNCONDITIONALLY_GATED,
    `gated set drifted (found ${discovered.length}): ${discovered.sort().join(", ")}`,
  );
});

test("editorsettings_get_set gates the WRITE path only; reads pass through ungated", async () => {
  const h = makeHarness();
  // Read (no value): no elicitation, forwards straight to the bridge.
  h.setBridge("resolve", { name: "interface/editor/code_font_size", value: 14 });
  h.setElicit(async () => {
    throw new Error("a read must not prompt");
  });
  const read = await h.handler("editorsettings_get_set")({ name: "interface/editor/code_font_size" });
  assert.notEqual(read.isError, true);
  assert.equal(h.elicitReqs.length, 0, "reading an editor setting must not prompt");
  assert.deepEqual(h.calls[0].params, { name: "interface/editor/code_font_size" });

  // Write (value present) + decline: blocks, never reaches the bridge.
  const h2 = makeHarness();
  h2.setBridge("reject");
  h2.setElicit(async () => ({ action: "decline" }));
  const declined = await h2.handler("editorsettings_get_set")({ name: "x", value: 20 });
  assert.equal(declined.isError, true);
  assert.match(text(declined), /did not approve/i);
  assert.equal(h2.calls.length, 0, "a declined write must not reach the bridge");

  // Write + confirm:true: forwards name+value.
  const h3 = makeHarness();
  h3.setBridge("resolve", { name: "x", value: 20 });
  const written = await h3.handler("editorsettings_get_set")({ name: "x", value: 20, confirm: true });
  assert.notEqual(written.isError, true);
  assert.equal(h3.calls[0].method, "editorsettings.get_set");
  assert.deepEqual(h3.calls[0].params, { name: "x", value: 20 });
});

test("confirm:true skips the prompt and lets every destructive tool reach the bridge", async () => {
  const h = makeHarness();
  h.setBridge("resolve", { done: true });
  h.setElicit(async () => {
    throw new Error("elicitInput must not be called when confirm:true");
  });

  for (const name of UNCONDITIONALLY_GATED) {
    const before = h.calls.length;
    const r = await h.handler(name)({ confirm: true });
    assert.ok(h.calls.length > before, `${name} with confirm:true should forward to the bridge`);
    assert.notEqual(r.isError, true, `${name} should succeed when confirmed and the bridge resolves`);
  }
  assert.equal(h.elicitReqs.length, 0, "no elicitation should occur when confirm:true");
});

test("a destructive tool blocks with a 'confirm: true' hint when the client cannot elicit", async () => {
  const h = makeHarness();
  h.setBridge("reject");
  h.setElicit(async () => {
    throw new Error("Method not found: elicitation/create");
  });
  const before = h.calls.length;
  const r = await h.handler("scene_new")({ path: "res://X.tscn", root_type: "Node2D" });
  assert.equal(r.isError, true);
  assert.match(text(r), /confirm: true/);
  assert.equal(h.calls.length, before, "must not reach the bridge when it cannot confirm");
});

// ---------------------------------------------------- bridge-unreachable degrade ----

test("every editor tool degrades to a friendly isError when the bridge is unreachable (never throws)", async () => {
  const h = makeHarness();
  h.setBridge("reject");
  // Confirm up front so gated tools proceed past the gate to the (down) bridge.
  let errored = 0;
  for (const [name, t] of h.tools) {
    let r: ToolResultLike;
    try {
      r = await t.handler({ confirm: true });
    } catch (e) {
      assert.fail(`${name} threw instead of returning an error envelope: ${(e as Error).message}`);
      return;
    }
    assert.ok(Array.isArray(r.content), `${name} must return a content array`);
    if (r.isError) {
      errored++;
      assert.match(text(r), /bridge_unavailable/, `${name} should surface the bridge-unavailable code`);
    }
  }
  // editor.ts is a pure bridge-forwarding plane, so with the bridge down every
  // tool forwards and degrades — none silently "succeed".
  assert.equal(errored, h.tools.size, "all editor tools should error when the bridge is down");
});

// ----------------------------------------------------------------- happy path ----

test("editor_ping returns the ok() envelope (text + structuredContent) when the bridge resolves", async () => {
  const h = makeHarness();
  h.setBridge("resolve", { pong: true, editor: "4.7" });
  const r = await h.handler("editor_ping")({});
  assert.notEqual(r.isError, true);
  assert.deepEqual(r.structuredContent, { pong: true, editor: "4.7" });
  assert.equal(h.calls[0].method, "ping");
});

test("node_delete forwards node.delete with the path once confirmed", async () => {
  const h = makeHarness();
  h.setBridge("resolve", { deleted: true });
  const r = await h.handler("node_delete")({ path: "/root/Main/Enemy", confirm: true });
  assert.notEqual(r.isError, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, "node.delete");
  assert.deepEqual(h.calls[0].params, { path: "/root/Main/Enemy" });
});
