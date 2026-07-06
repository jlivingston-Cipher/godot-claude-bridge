// DAP-plane integration smoke (EXPERIMENTAL) — connects to a REAL running Godot
// editor's built-in Debug Adapter (DAP, :6006). It (1) runs the initialize handshake
// via a real dbg_launch and verifies it completes — the gate — then (2) dumps the
// adapter's advertised capabilities (the "D-DAP" probe) so we learn which dbg_* tools
// light up live vs. degrade to "unsupported" on this Godot build. Then (3) it tries to
// LAND A REAL STOP: it breakpoints BOTH the one-shot _ready() (player.gd:13, runs once
// at scene load) and the per-frame _process() (player.gd:21, runs every frame) so a stop
// lands even if the single scene-load one is missed under slow software rendering, waits
// up to 60s, and on a stop reads stack/scopes/variables and exercises watch/step/continue
// live. The launched game's console output is captured from DAP `output` events
// (D_DAP_OUT) — the clearest signal of whether `launch` actually spawned and RAN the game
// (its _ready() prints a line) vs. never ran / crashed (e.g. a GPU-less renderer).
// Grep-able markers: D_DAP_CAPS / D_DAP_FILTERS / D_DAP_BP / D_DAP_OUT / D_DAP_STOP /
// D_DAP_GAME_RAN / D_DAP_VAR / PROBE. Probe failures are NEVER fatal — only an unreachable
// debug adapter (no capabilities captured) fails the job.
//
// Requires the editor up (booted under Xvfb by the workflow) with GODOT_PROJECT set.
import { DapClient } from "../dist/dap.js";
import { loadConfig } from "../dist/config.js";
import { registerDapTools } from "../dist/tools/dap.js";

const cfg = loadConfig();
console.log(`DAP target ${cfg.dapHost}:${cfg.dapPort}  project=${cfg.projectPath}`);

// How long to wait for the launched game to settle at a breakpoint. Software-rendered
// (llvmpipe) game boot in CI is slow, so this window is generous.
const STOP_WAIT_MS = 60000;

const dap = new DapClient(cfg.dapHost, cfg.dapPort, 20000);

// Capture the launched game's console output (DAP `output` events). This is the single
// clearest signal of whether Godot's DAP `launch` actually spawned and RAN the game:
// player.gd's _ready() prints "[example] player ready". A crash (e.g. a GPU-less Vulkan
// init) surfaces here too. Grep D_DAP_OUT in the job log.
const gameOutput = [];
dap.on("output", (body) => {
  const line = String(body?.output ?? "").replace(/\s+$/, "");
  if (line) {
    gameOutput.push(line);
    console.log(`D_DAP_OUT: ${line}`);
  }
});

// A tiny recording server so we can pull the tool handlers out and call them directly
// (the same code path a real MCP client hits), without standing up a transport. The
// elicit stub auto-declines, so gated tools (dbg_goto) never actually mutate state here.
const tools = new Map();
const rec = {
  registerTool: (name, _config, handler) => tools.set(name, handler),
  registerResource: () => {},
  server: { elicitInput: async () => ({ action: "decline" }) },
};
registerDapTools(rec, dap, cfg);
const call = (name, args = {}) => tools.get(name)(args, {});

// Arm a one-shot 'stopped' listener BEFORE the triggering request so a fast stop can't
// be missed; resolves true on stop, false on timeout. The timer is unref'd so it can
// never hold the process open on the failure path (where stopSoon is left unawaited).
function waitForStop(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { dap.removeListener("stopped", onStop); resolve(false); }, ms);
    timer.unref?.();
    const onStop = () => { clearTimeout(timer); resolve(true); };
    dap.once("stopped", onStop);
  });
}

let reached = false;
let stopSoon = Promise.resolve(false);
try {
  // Buffer breakpoints on both _ready() (one-shot) and _process() (per-frame) BEFORE
  // launch, so they are applied during the initialize→configurationDone handshake, i.e.
  // before the game starts running. The repeating _process breakpoint is the insurance:
  // even if the single scene-load stop is missed, a later frame still lands one.
  const bp = await call("dbg_set_breakpoints", { path: "res://player.gd", lines: [13, 21] });
  console.log("dbg_set_breakpoints (buffered) ->", JSON.stringify(bp.structuredContent ?? {}));
  stopSoon = waitForStop(STOP_WAIT_MS);
  const launch = await call("dbg_launch", { scene: "main", stop_on_entry: false });
  console.log("dbg_launch ->", JSON.stringify(launch.structuredContent ?? launch.content?.[0]?.text ?? {}));
  if (!dap.capabilities) {
    throw new Error("no DAP capabilities captured — the initialize handshake did not complete");
  }
  const caps = dap.capabilities;
  console.log(
    "initialize OK — capabilities advertised true:",
    Object.keys(caps).filter((k) => caps[k] === true).sort().join(", ") || "(none true)",
  );
  console.log(
    `D_DAP_CAPS: supportsRestartRequest=${!!caps.supportsRestartRequest}` +
      ` supportsGotoTargetsRequest=${!!caps.supportsGotoTargetsRequest}` +
      ` supportsDataBreakpoints=${!!caps.supportsDataBreakpoints}` +
      ` supportsSetVariable=${!!caps.supportsSetVariable}` +
      ` supportsConditionalBreakpoints=${!!caps.supportsConditionalBreakpoints}` +
      ` supportsHitConditionalBreakpoints=${!!caps.supportsHitConditionalBreakpoints}` +
      ` supportsLogPoints=${!!caps.supportsLogPoints}` +
      ` supportsTerminateRequest=${!!caps.supportsTerminateRequest}` +
      ` supportsEvaluateForHovers=${!!caps.supportsEvaluateForHovers}`,
  );
  const filters = Array.isArray(caps.exceptionBreakpointFilters)
    ? caps.exceptionBreakpointFilters.map((f) => f.filter ?? "?").join(",")
    : "";
  console.log(`D_DAP_FILTERS: exceptionBreakpointFilters=[${filters}]`);
  // Re-assert the breakpoints now that the session is configured, so the response carries
  // the adapter's `verified` flags (the pre-launch set was buffered, hence unverified).
  try {
    const rebp = await call("dbg_set_breakpoints", { path: "res://player.gd", lines: [13, 21] });
    console.log(`D_DAP_BP: ${JSON.stringify(rebp.structuredContent?.breakpoints ?? [])}`);
  } catch (e) { console.log("D_DAP_BP: (re-assert threw)", e?.message ?? String(e)); }
  console.log("✔ DAP-plane reached the live debug adapter");
  reached = true;
} catch (err) {
  console.error("✘ could not reach the debug adapter:", err?.message ?? String(err));
  process.exitCode = 1;
}

// ---- Best-effort probes (log-only; skipped if the adapter was unreachable) --------
if (reached) {
  // Did the launched scene actually reach a breakpoint? A software-rendered game boot is
  // slow and may not settle within the window — never fatal.
  const stopped = await stopSoon;
  console.log(`D_DAP_STOP: breakpoint_hit=${stopped} reason=${dap.lastStoppedReason ?? "-"}`);
  console.log(`D_DAP_GAME_RAN: ${gameOutput.length > 0} (captured ${gameOutput.length} game output line(s))`);
  if (stopped) {
    try {
      const st = await call("dbg_stack_trace", { levels: 10 });
      const frames = st.structuredContent?.frames ?? [];
      const top = frames[0];
      console.log(`PROBE dbg_stack_trace: frames=${frames.length} top=${top?.name ?? "-"}@${top?.line ?? "-"} src=${top?.source ?? "-"}`);
      if (top?.id !== undefined) {
        const sc = await call("dbg_scopes", { frame_id: top.id });
        const scopes = sc.structuredContent?.scopes ?? [];
        console.log(`PROBE dbg_scopes: [${scopes.map((s) => s.name).join(", ") || "-"}]`);
        // Read variables from EVERY scope and hunt for `counter` — a concrete proof that
        // live variable inspection returns real values (player.gd `var counter = 100`).
        let counterVal = null;
        for (const s of scopes) {
          if (!s.variables_ref) continue;
          const vars = await call("dbg_variables", { variables_ref: s.variables_ref });
          const list = vars.structuredContent?.variables ?? [];
          console.log(`PROBE dbg_variables[${s.name}]: count=${list.length} sample=[${list.slice(0, 6).map((v) => v.name).join(", ")}]`);
          const hit = list.find((v) => v.name === "counter");
          if (hit) counterVal = hit.value;
        }
        console.log(`D_DAP_VAR: counter=${counterVal ?? "(not found)"}`);
        // Live control-flow proofs (all log-only, each independently guarded): evaluate a
        // watch, single-step, then continue (which should re-hit the per-frame _process bp).
        try {
          const w = await call("dbg_watch", { add: ["counter"] });
          console.log(`PROBE dbg_watch: ${JSON.stringify((w.structuredContent?.watches ?? []).slice(0, 3))}`);
        } catch (e) { console.log("PROBE dbg_watch threw:", e?.message ?? String(e)); }
        try {
          const step = await call("dbg_step", { kind: "over" });
          console.log(`PROBE dbg_step(over): ${JSON.stringify(step.structuredContent ?? {})}`);
        } catch (e) { console.log("PROBE dbg_step threw:", e?.message ?? String(e)); }
        try {
          const cont = await call("dbg_continue", {});
          console.log(`PROBE dbg_continue: ${JSON.stringify(cont.structuredContent ?? {})}`);
        } catch (e) { console.log("PROBE dbg_continue threw:", e?.message ?? String(e)); }
      }
    } catch (err) {
      console.log("PROBE stack/scopes/variables threw:", err?.message ?? String(err));
    }
  } else {
    console.log("PROBE (no stop within window) — skipping stack/scopes/variables/step/continue");
  }

  // Feature-detect the newer dbg_* tools live: each is capability-gated, so an adapter
  // that doesn't advertise the capability yields isError:"unsupported" here rather than
  // crashing — the same advertised-vs-implemented signal the LSP D7 probe gives. dbg_goto
  // lists targets only (the auto-decline elicit stub blocks any actual jump).
  const featureProbes = [
    ["dbg_goto", { path: "res://player.gd", line: 14 }],
    ["dbg_data_breakpoints", { watch: [{ name: "counter" }] }],
    ["dbg_set_exception_breakpoints", {}],
  ];
  for (const [name, args] of featureProbes) {
    try {
      const res = await call(name, args);
      const detail = res.isError
        ? `err: ${JSON.stringify(res.content?.[0]?.text ?? "").slice(0, 100)}`
        : JSON.stringify(res.structuredContent ?? {}).slice(0, 160);
      console.log(`PROBE ${name}: isError=${!!res.isError} ${detail}`);
    } catch (err) {
      console.log(`PROBE ${name} threw:`, err?.message ?? String(err));
    }
  }

  // Best-effort teardown so the launched game process doesn't linger.
  try { await dap.request("terminate", {}, 3000); } catch { /* ignore */ }
}

dap.close();
