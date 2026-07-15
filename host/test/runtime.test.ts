import { test } from "node:test";
import assert from "node:assert/strict";
import { registerRuntimeTools } from "../src/tools/runtime.js";
import { BridgeError } from "../src/bridge.js";
import {
  makeRecordingServer,
  type ElicitFn,
  type ToolResultLike,
} from "./helpers/recording-server.js";

/**
 * Behavior tests for the runtime plane (tools/runtime.ts). Same two invariants
 * as the editor plane — destructive tools are confirmation-gated, and an
 * unreachable runtime bridge degrades to a friendly isError — but this plane
 * mutates the LIVE running game, so its four mutators are the ones gated.
 */

// The four destructive runtime tools (mutate the running game) that MUST gate.
const GATED = [
  "runtime_call_method",
  "runtime_emit_signal",
  "runtime_inject_input",
  "runtime_set_property",
].sort();

// Valid-enough args per tool so that gate summaries (some read args, e.g.
// `event.kind`) evaluate. Non-gated tools default to {}.
const ARGS: Record<string, Record<string, unknown>> = {
  runtime_set_property: { path: "/root/Player", property: "hp", value: 1 },
  runtime_call_method: { path: "/root/Player", method: "take_damage", args: [1] },
  runtime_emit_signal: { path: "/root/Player", signal: "died", args: [] },
  runtime_inject_input: { event: { kind: "action", action: "jump", pressed: true } },
};

interface BridgeCall {
  method: string;
  params: Record<string, unknown>;
}

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
          "Cannot reach the Godot runtime bridge at 127.0.0.1:9081. Is the project running with the runtime autoload?",
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
  registerRuntimeTools(
    rec.server as unknown as Parameters<typeof registerRuntimeTools>[0],
    bridge as unknown as Parameters<typeof registerRuntimeTools>[1],
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

test("exactly the four runtime mutators are gated; each blocks on decline without touching the bridge", async () => {
  const h = makeHarness();
  h.setBridge("reject");
  h.setElicit(async () => ({ action: "decline" }));

  const discovered: string[] = [];
  for (const [name, t] of h.tools) {
    const bridgeBefore = h.calls.length;
    const elicitBefore = h.elicitReqs.length;
    let res: ToolResultLike | undefined;
    try {
      res = await t.handler(ARGS[name] ?? {});
    } catch {
      res = undefined;
    }
    if (h.elicitReqs.length === elicitBefore) continue;

    discovered.push(name);
    assert.equal(h.calls.length, bridgeBefore, `${name} must NOT reach the bridge when the user declines`);
    assert.ok(res, `${name} must return a blocking result, not throw`);
    assert.equal(res!.isError, true, `${name} decline result must be an error`);
    assert.match(text(res!), /did not approve/i, `${name} must report the action was not approved`);
  }

  assert.deepEqual(discovered.sort(), GATED, `gated set drifted: ${discovered.sort().join(", ")}`);
});

test("confirm:true skips the prompt and forwards each mutator to the runtime bridge", async () => {
  const h = makeHarness();
  h.setBridge("resolve", { ok: true });
  h.setElicit(async () => {
    throw new Error("elicitInput must not be called when confirm:true");
  });

  for (const name of GATED) {
    const before = h.calls.length;
    const r = await h.handler(name)({ ...ARGS[name], confirm: true });
    assert.ok(h.calls.length > before, `${name} with confirm:true should forward to the bridge`);
    assert.notEqual(r.isError, true, `${name} should succeed when confirmed and the bridge resolves`);
  }
  assert.equal(h.elicitReqs.length, 0);
});

// ---------------------------------------------------- bridge-unreachable degrade ----

test("every runtime tool degrades to a friendly isError when the bridge is unreachable (never throws)", async () => {
  const h = makeHarness();
  h.setBridge("reject");
  let errored = 0;
  for (const [name, t] of h.tools) {
    let r: ToolResultLike;
    try {
      r = await t.handler({ ...ARGS[name], confirm: true });
    } catch (e) {
      assert.fail(`${name} threw instead of returning an error envelope: ${(e as Error).message}`);
      return;
    }
    assert.ok(Array.isArray(r.content), `${name} must return a content array`);
    if (r.isError) {
      errored++;
      assert.match(text(r), /Runtime error \[bridge_unavailable\]/, `${name} should surface the runtime error prefix`);
    }
  }
  assert.equal(errored, h.tools.size, "all runtime tools forward to the bridge and should error when it is down");
});

// ----------------------------------------------------------------- happy path ----

test("runtime_get_tree returns the ok() envelope when the bridge resolves", async () => {
  const h = makeHarness();
  h.setBridge("resolve", { name: "root", children: [] });
  const r = await h.handler("runtime_get_tree")({});
  assert.notEqual(r.isError, true);
  assert.deepEqual(r.structuredContent, { name: "root", children: [] });
  assert.equal(h.calls[0].method, "runtime.get_tree");
});

test("runtime_call_method forwards runtime.call_method with args once confirmed", async () => {
  const h = makeHarness();
  h.setBridge("resolve", { returned: null });
  const r = await h.handler("runtime_call_method")({
    path: "/root/Player",
    method: "take_damage",
    args: [5],
    confirm: true,
  });
  assert.notEqual(r.isError, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, "runtime.call_method");
  assert.deepEqual(h.calls[0].params, { path: "/root/Player", method: "take_damage", args: [5] });
});

test("runtime_assert_node_state forwards runtime.assert_node_state with path/expect/tolerance", async () => {
  const h = makeHarness();
  h.setBridge("resolve", { path: "/root/Player", ok: true, checked: 1, mismatches: [] });
  const r = await h.handler("runtime_assert_node_state")({
    path: "/root/Player",
    expect: { hp: 100 },
    tolerance: 0,
  });
  assert.notEqual(r.isError, true);
  assert.deepEqual(r.structuredContent, { path: "/root/Player", ok: true, checked: 1, mismatches: [] });
  assert.equal(h.calls[0].method, "runtime.assert_node_state");
  assert.deepEqual(h.calls[0].params, { path: "/root/Player", expect: { hp: 100 }, tolerance: 0 });
});

test("runtime_assert_node_state omits tolerance when not supplied", async () => {
  const h = makeHarness();
  h.setBridge("resolve", { path: "/root/Player", ok: true, checked: 1, mismatches: [] });
  await h.handler("runtime_assert_node_state")({ path: "/root/Player", expect: { hp: 100 } });
  assert.deepEqual(h.calls[0].params, { path: "/root/Player", expect: { hp: 100 } });
});

test("runtime_assert_scene_structure forwards the expectation list", async () => {
  const h = makeHarness();
  h.setBridge("resolve", { ok: true, checked: 2, failures: [] });
  const expect = [{ path: "/root/Player" }, { path: "/root/HUD", type: "CanvasLayer" }];
  const r = await h.handler("runtime_assert_scene_structure")({ expect });
  assert.notEqual(r.isError, true);
  assert.deepEqual(r.structuredContent, { ok: true, checked: 2, failures: [] });
  assert.equal(h.calls[0].method, "runtime.assert_scene_structure");
  assert.deepEqual(h.calls[0].params, { expect });
});

test("runtime_assert_perf forwards baseline/tolerance/direction", async () => {
  const h = makeHarness();
  h.setBridge("resolve", {
    ok: true,
    checked: 2,
    regressions: [],
    monitors: { "time/fps": 60, "render/total_draw_calls": 40 },
  });
  const r = await h.handler("runtime_assert_perf")({
    baseline: { "time/fps": 60, "render/total_draw_calls": 50 },
    tolerance: 0.1,
    direction: { "time/fps": "higher_better" },
  });
  assert.notEqual(r.isError, true);
  assert.deepEqual(r.structuredContent, {
    ok: true,
    checked: 2,
    regressions: [],
    monitors: { "time/fps": 60, "render/total_draw_calls": 40 },
  });
  assert.equal(h.calls[0].method, "runtime.assert_perf");
  assert.deepEqual(h.calls[0].params, {
    baseline: { "time/fps": 60, "render/total_draw_calls": 50 },
    tolerance: 0.1,
    direction: { "time/fps": "higher_better" },
  });
});

test("runtime_assert_perf omits tolerance and direction when not supplied", async () => {
  const h = makeHarness();
  h.setBridge("resolve", { ok: true, checked: 1, regressions: [], monitors: { "time/fps": 60 } });
  await h.handler("runtime_assert_perf")({ baseline: { "time/fps": 60 } });
  assert.deepEqual(h.calls[0].params, { baseline: { "time/fps": 60 } });
});

test("runtime_assert_screen_text forwards text and optional flags", async () => {
  const h = makeHarness();
  h.setBridge("resolve", {
    ok: true,
    matches: 2,
    present: true,
    samples: [{ path: "HUD/Score", text: "Score: 100" }],
  });
  const r = await h.handler("runtime_assert_screen_text")({
    text: "Score",
    regex: false,
    case_sensitive: false,
    min_count: 1,
  });
  assert.notEqual(r.isError, true);
  assert.deepEqual(r.structuredContent, {
    ok: true,
    matches: 2,
    present: true,
    samples: [{ path: "HUD/Score", text: "Score: 100" }],
  });
  assert.equal(h.calls[0].method, "runtime.assert_screen_text");
  assert.deepEqual(h.calls[0].params, { text: "Score", regex: false, case_sensitive: false, min_count: 1 });
});

test("runtime_assert_screen_text omits unset optionals (absence check)", async () => {
  const h = makeHarness();
  h.setBridge("resolve", { ok: true, matches: 0, present: false, samples: [] });
  await h.handler("runtime_assert_screen_text")({ text: "Game Over", present: false });
  assert.deepEqual(h.calls[0].params, { text: "Game Over", present: false });
});

test("runtime_screenshot_diff forwards reference and optional params", async () => {
  const h = makeHarness();
  h.setBridge("resolve", {
    ok: true,
    diff_ratio: 0,
    differing_pixels: 0,
    total_pixels: 100,
    width: 10,
    height: 10,
    reference: "res://ref.png",
  });
  const r = await h.handler("runtime_screenshot_diff")({
    reference: "res://ref.png",
    tolerance: 0.01,
    per_channel_threshold: 8,
    region: { x: 0, y: 0, w: 10, h: 10 },
  });
  assert.notEqual(r.isError, true);
  assert.equal(h.calls[0].method, "runtime.screenshot_diff");
  assert.deepEqual(h.calls[0].params, {
    reference: "res://ref.png",
    tolerance: 0.01,
    per_channel_threshold: 8,
    region: { x: 0, y: 0, w: 10, h: 10 },
  });
});

test("runtime_screenshot_diff omits unset optionals", async () => {
  const h = makeHarness();
  h.setBridge("resolve", {
    ok: true,
    diff_ratio: 0,
    differing_pixels: 0,
    total_pixels: 100,
    width: 10,
    height: 10,
    reference: "res://ref.png",
  });
  await h.handler("runtime_screenshot_diff")({ reference: "res://ref.png" });
  assert.deepEqual(h.calls[0].params, { reference: "res://ref.png" });
});
