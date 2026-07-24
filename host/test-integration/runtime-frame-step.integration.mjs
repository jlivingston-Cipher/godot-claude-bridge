// Frame-step integration probe (F4) — connects to a REAL example GAME booted headless
// with a deterministic mover (example/tests/frame_step_probe.tscn) via the in-game
// BreakpointRuntimeBridge autoload, and proves the async frame-step lane end-to-end — the
// one thing no host unit test can (the GDScript coroutine + real SceneTree frames):
//
//   1. runtime_time_scale{scale:0} FREEZES the game — the mover's `ticks` hold steady.
//   2. runtime_step_frames{frames:N, kind:"physics"} advances it by EXACTLY N frames.
//   3. The game stays frozen afterwards (a further wait does not advance `ticks`).
//
// It drives the host's OWN runtime tools (registerRuntimeTools) against the live game — the
// runtime-capture pattern, for Plane C — so the host<->engine path is exercised end-to-end.
// Markers (grep-able): F4_STEP_PING / F4_STEP_FREEZE / F4_STEP_ADVANCE / F4_STEP_RESULT.
// The reachability check is the gate (exit 1 if the runtime bridge is unreachable).
//
// Requires the probe game running (booted by integration.yml) with GODOT_PROJECT set and
// BREAKPOINT_RUNTIME_PORT pointing at its bridge. Not part of `npm test` (Godot-free).
import assert from "node:assert/strict";
import { BridgeClient } from "../dist/bridge.js";
import { loadConfig } from "../dist/config.js";
import { registerRuntimeTools } from "../dist/tools/runtime.js";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const cfg = loadConfig();
console.log(`F4 frame-step probe -> runtime bridge ${cfg.runtimeHost}:${cfg.runtimePort}  project=${cfg.projectPath}`);

// Register the runtime tools against a live runtime BridgeClient, exactly the way index.ts
// wires Plane C. elicitInput is never reached (we pass confirm:true on the gated tools).
const runtime = new BridgeClient(cfg.runtimeHost, cfg.runtimePort, 15000, "runtime bridge", "Is the frame-step probe game running?");
const tools = new Map();
const server = {
  registerTool: (name, _c, handler) => tools.set(name, handler),
  registerResource: () => {},
  server: { elicitInput: async () => ({ action: "decline" }) },
};
registerRuntimeTools(server, runtime);
const call = async (name, args = {}) => {
  const h = tools.get(name);
  if (!h) throw new Error(`tool not registered: ${name}`);
  const res = await h(args, {});
  if (res.isError) throw new Error(res.content?.[0]?.text ?? `tool ${name} failed`);
  return res.structuredContent ?? {};
};
// The mover exposes a plain int `ticks` (no Variant encoding), read straight off the root.
const ticksNow = async () => Number((await call("runtime_get_property", { path: ".", property: "ticks" })).value);

// Gate: the runtime bridge must be reachable.
try {
  await runtime.ensureConnected();
  const pong = await runtime.request("ping", {}, 20000);
  console.log(`F4_STEP_PING ok runtime=${pong?.runtime} godot=${pong?.godot ?? "?"}`);
} catch (err) {
  console.error("✘ could not reach the runtime bridge:", err?.message ?? String(err));
  runtime.close();
  process.exit(1);
}

try {
  // 1) Freeze. scale 0 pauses the tree; the mover's ticks must then hold steady.
  await call("runtime_time_scale", { scale: 0, confirm: true });
  await delay(250);
  const a1 = await ticksNow();
  await delay(300);
  const a2 = await ticksNow();
  console.log(`F4_STEP_FREEZE ticks ${a1} -> ${a2} (must be equal while frozen)`);
  assert.equal(a2, a1, `freeze failed: ticks advanced ${a1} -> ${a2} while time_scale 0`);

  // 2) Advance EXACTLY N physics frames; ticks must move by exactly N.
  const N = 30;
  const step = await call("runtime_step_frames", { frames: N, kind: "physics", confirm: true });
  await delay(150);
  const b = await ticksNow();
  console.log(`F4_STEP_ADVANCE frames_advanced=${step.frames_advanced} ticks ${a2} -> ${b} (expect +${N})`);
  assert.equal(Number(step.frames_advanced), N, `step_frames reported ${step.frames_advanced}, expected ${N}`);
  assert.equal(b - a2, N, `expected exactly ${N} physics frames of advance, got ${b - a2}`);

  // 3) Still frozen after stepping: a further wait must not advance ticks.
  await delay(300);
  const c = await ticksNow();
  assert.equal(c, b, `game did not stay frozen after stepping: ticks ${b} -> ${c}`);

  // Thaw so the game is left in a clean state.
  await call("runtime_time_scale", { scale: 1, confirm: true });
  console.log(`F4_STEP_RESULT froze, stepped +${N} deterministically, stayed frozen`);
  console.log("✔ frame-step integration OK");
  runtime.close();
} catch (err) {
  console.error("✘ frame-step integration FAILED:", err?.message ?? String(err));
  runtime.close();
  process.exit(1);
}
