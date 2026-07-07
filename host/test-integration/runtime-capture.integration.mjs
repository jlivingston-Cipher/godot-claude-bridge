// Runtime-plane integration probe (D6) — connects to the REAL example GAME
// (booted headless by the workflow) via its in-game ClaudeRuntimeBridge autoload
// on :9081, and proves the one thing no unit test can: a live engine's print()
// is captured into runtime_get_log through the scriptable Logger (Godot 4.5+).
//
// It drives the host's OWN runtime tools (registerRuntimeTools) against the live
// game — the CLI-plane pattern, but for Plane C — so the host<->engine path is
// exercised end-to-end, not just the raw socket. A direct BridgeClient ping is
// used only for the reachability gate and to read the capture flag.
//
// Version-aware, so a single probe is correct across the whole matrix:
//   * Godot >= 4.5 (log_capture true)  — the print() MUST appear in runtime_get_log.
//   * Godot <  4.5 (log_capture false) — capture is a documented no-op: the print()
//     must NOT appear, but push_log() entries still must (runtime_get_log works).
//
// Markers (grep-able): D6_CAP_PING / D6_CAP_LOG / D6_CAP_CALL / D6_CAP_RESULT.
// The reachability check is the gate (exit 1 if the runtime bridge is unreachable).
//
// Requires the game running (booted by the workflow) with GODOT_PROJECT set. Not
// part of `npm test` (Godot-free); invoked directly by integration.yml.
import assert from "node:assert/strict";
import { BridgeClient } from "../dist/bridge.js";
import { loadConfig } from "../dist/config.js";
import { registerRuntimeTools } from "../dist/tools/runtime.js";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const cfg = loadConfig();
console.log(`D6 runtime capture probe -> runtime bridge ${cfg.runtimeHost}:${cfg.runtimePort}  project=${cfg.projectPath}`);

// Register the runtime tools against a live runtime BridgeClient, exactly the way
// index.ts wires Plane C. elicitInput is never reached (we pass confirm:true).
const runtime = new BridgeClient(cfg.runtimeHost, cfg.runtimePort, 15000, "runtime bridge", "Is the example game running?");
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

// Gate: the runtime bridge must be reachable. ensureConnected() retries and never
// rejects, so prove reachability with a real ping — and read the capture flag.
let capture = false;
try {
  await runtime.ensureConnected();
  const pong = await runtime.request("ping", {}, 20000);
  capture = pong?.log_capture === true;
  console.log(`D6_CAP_PING ok runtime=${pong?.runtime} godot=${pong?.godot ?? "?"} log_capture=${pong?.log_capture}`);
} catch (err) {
  console.error("✘ could not reach the runtime bridge:", err?.message ?? String(err));
  runtime.close();
  process.exit(1);
}

// Baseline the log (the autoload's startup + the scene's _ready already pushed a few).
const before = await call("runtime_get_log", { since_seq: 0 });
const baseSeq = Number(before.latest_seq ?? 0);
console.log(`D6_CAP_LOG capture=${before.capture} latest_seq=${baseSeq} entries=${before.entries?.length ?? 0}`);

// Actively drive a fresh print() through the live game. Main (player.gd) has
// take_damage(amount): it print()s "[example] took N damage, counter now M" (a
// print — captured only via the Logger) AND push_log()s a "took N damage"
// warning (present on every version). confirm:true bypasses the destructive gate.
const dmg = await call("runtime_call_method", { path: ".", method: "take_damage", args: [7], confirm: true });
console.log(`D6_CAP_CALL take_damage(7) -> ${JSON.stringify(dmg.return ?? dmg)}`);
await delay(400);

const after = await call("runtime_get_log", { since_seq: baseSeq });
const entries = after.entries ?? [];
const printLine = entries.find((e) => String(e.message).includes("took 7 damage, counter now"));
const pushLine = entries.find((e) => e.level === "warning" && String(e.message).includes("took 7 damage"));

if (capture) {
  // Godot >= 4.5: the print() must have been captured into the runtime log.
  assert.equal(after.capture, true, "runtime_get_log should report capture=true on a >=4.5 engine");
  assert.ok(printLine, "expected the print() line to be captured into runtime_get_log");
  assert.equal(printLine.level, "info", "a captured print() should land at info level");
  console.log(`D6_CAP_RESULT engine=capture captured_print_seq=${printLine.seq}`);
  console.log("✔ live print() reached runtime_get_log via the D6 Logger capture");
} else {
  // Godot < 4.5: capture is a documented no-op. print() must NOT be captured,
  // but push_log() entries still must — runtime_get_log keeps working.
  assert.equal(after.capture, false, "runtime_get_log should report capture=false on a <4.5 engine");
  assert.ok(!printLine, "on <4.5 the print() must NOT be captured (no scriptable Logger)");
  assert.ok(pushLine, "the push_log() warning must still be present on <4.5");
  console.log(`D6_CAP_RESULT engine=no-capture push_log_seq=${pushLine.seq}`);
  console.log("✔ capture no-ops cleanly on <4.5; runtime_get_log still serves push_log entries");
}

runtime.close();
console.log("✔ runtime-plane integration OK");
