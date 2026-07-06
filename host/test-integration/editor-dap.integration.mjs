// DAP-plane integration smoke (EXPERIMENTAL) — connects to a REAL running Godot
// editor's built-in Debug Adapter (DAP, :6006). It (1) runs the initialize handshake
// via a real dbg_launch and verifies it completes — the gate — then (2) dumps the
// adapter's advertised capabilities (the "D-DAP" probe, analogous to the LSP D7 probe)
// so we finally learn which of supportsRestartRequest / supportsGotoTargetsRequest /
// supportsDataBreakpoints / supportsSetVariable / exceptionBreakpointFilters Godot 4.x
// actually advertises — i.e. which newer dbg_* tools light up live vs. degrade to
// "unsupported". Then (3) a best-effort scenario tries to hit a breakpoint in _ready(),
// reads stack/scopes/variables if it stops, and feature-probes dbg_goto /
// dbg_data_breakpoints / dbg_set_exception_breakpoints. Output uses grep-able markers
// (D_DAP_CAPS / D_DAP_FILTERS / D_DAP_STOP / PROBE …); probe failures are NEVER fatal —
// only an unreachable debug adapter (no capabilities captured) fails the job.
//
// Requires the editor up (booted under Xvfb by the workflow) with GODOT_PROJECT set.
import { DapClient } from "../dist/dap.js";
import { loadConfig } from "../dist/config.js";
import { registerDapTools } from "../dist/tools/dap.js";

const cfg = loadConfig();
console.log(`DAP target ${cfg.dapHost}:${cfg.dapPort}  project=${cfg.projectPath}`);

const dap = new DapClient(cfg.dapHost, cfg.dapPort, 20000);

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
  // Buffer a breakpoint on the first executable line of _ready() (runs at scene start),
  // then launch: dbg_launch runs the full initialize -> launch -> configurationDone
  // handshake and records dap.capabilities. We read those capabilities right after.
  await call("dbg_set_breakpoints", { path: "res://player.gd", lines: [13] });
  stopSoon = waitForStop(20000);
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
  console.log("✔ DAP-plane reached the live debug adapter");
  reached = true;
} catch (err) {
  console.error("✘ could not reach the debug adapter:", err?.message ?? String(err));
  process.exitCode = 1;
}

// ---- Best-effort probes (log-only; skipped if the adapter was unreachable) --------
if (reached) {
  // Did the launched scene actually reach the breakpoint in _ready()? A software-
  // rendered game boot is slow and may not settle within the window — never fatal.
  const stopped = await stopSoon;
  console.log(`D_DAP_STOP: breakpoint_hit=${stopped} reason=${dap.lastStoppedReason ?? "-"}`);
  if (stopped) {
    try {
      const st = await call("dbg_stack_trace", { levels: 10 });
      const frames = st.structuredContent?.frames ?? [];
      const top = frames[0];
      console.log(`PROBE dbg_stack_trace: frames=${frames.length} top=${top?.name ?? "-"}@${top?.line ?? "-"}`);
      if (top?.id !== undefined) {
        const sc = await call("dbg_scopes", { frame_id: top.id });
        const scopes = sc.structuredContent?.scopes ?? [];
        console.log(`PROBE dbg_scopes: [${scopes.map((s) => s.name).join(", ") || "-"}]`);
        const ref = scopes[0]?.variables_ref;
        if (ref) {
          const vars = await call("dbg_variables", { variables_ref: ref });
          const names = (vars.structuredContent?.variables ?? []).map((v) => v.name);
          console.log(`PROBE dbg_variables: count=${names.length} sample=[${names.slice(0, 6).join(", ")}]`);
        }
      }
    } catch (err) {
      console.log("PROBE stack/scopes/variables threw:", err?.message ?? String(err));
    }
  } else {
    console.log("PROBE (no stop within window) — skipping stack/scopes/variables");
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
