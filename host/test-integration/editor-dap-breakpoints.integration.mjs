// DAP-plane breakpoint-MODIFIER probe (EXPERIMENTAL) — answers the open question from
// the DAP capability dump: Godot 4.3's adapter advertises supportsConditionalBreakpoints
// / supportsHitConditionalBreakpoints / supportsLogPoints = FALSE, yet dbg_set_breakpoints
// still sends `condition` / `hitCondition` / `logMessage` unconditionally. Does Godot HONOR
// them anyway, or ignore them (so a "conditional" breakpoint actually halts every time)?
//
// Each scenario is an INDEPENDENT debug session (its own connection → launch → terminate)
// against the same already-running editor. It breakpoints the per-frame _process()
// (player.gd:21) with ONE modifier that, IF HONORED, suppresses the stop:
//   - condition   "counter < 0"    — always false      → honored ⇒ never stops
//   - hitCondition ">1000000"      — effectively never → honored ⇒ never stops
//   - logMessage  "GCB_LOGPOINT …" — logpoint           → honored ⇒ logs + never halts
// player.gd:13 (_ready) is left un-broken, so its "[example] player ready" print confirms
// the game actually ran. Therefore: game ran + NO stop ⇒ modifier HONORED; a stop ⇒
// modifier IGNORED (the plain breakpoint halted on the first frame regardless).
//
// Grep markers: D_DAP_COND / D_DAP_HIT / D_DAP_LOG / D_DAP_MODIFIERS. Log-only + never
// fatal except when the adapter is completely unreachable (no session ever initialized).
import { DapClient } from "../dist/dap.js";
import { loadConfig } from "../dist/config.js";
import { registerDapTools } from "../dist/tools/dap.js";

const cfg = loadConfig();
console.log(`DAP target ${cfg.dapHost}:${cfg.dapPort}  project=${cfg.projectPath}`);

// How long to watch each launched game for a stop before concluding it ran on unhalted.
const OBSERVE_MS = 12000;

// Build one isolated session (fresh connection + tool handlers + output capture).
function makeSession() {
  const dap = new DapClient(cfg.dapHost, cfg.dapPort, 20000);
  const outputs = [];
  dap.on("output", (b) => {
    const l = String(b?.output ?? "").replace(/\s+$/, "");
    if (l) outputs.push(l);
  });
  const tools = new Map();
  const rec = {
    registerTool: (name, _config, handler) => tools.set(name, handler),
    registerResource: () => {},
    server: { elicitInput: async () => ({ action: "decline" }) },
  };
  registerDapTools(rec, dap, cfg);
  const call = (name, args = {}) => tools.get(name)(args, {});
  return { dap, outputs, call };
}

// Arm a one-shot 'stopped' listener BEFORE the triggering request; resolve true on stop,
// false on timeout. The timer is unref'd so it can never hold the process open.
function waitForStop(dap, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { dap.removeListener("stopped", onStop); resolve(false); }, ms);
    timer.unref?.();
    const onStop = () => { clearTimeout(timer); resolve(true); };
    dap.once("stopped", onStop);
  });
}

// Run one modifier scenario end-to-end and report whether the game stopped.
async function runScenario(bpArgs) {
  const { dap, outputs, call } = makeSession();
  let stopped = false;
  let reached = false;
  try {
    await call("dbg_set_breakpoints", { path: "res://player.gd", lines: [21], ...bpArgs });
    const stopSoon = waitForStop(dap, OBSERVE_MS);
    await call("dbg_launch", { scene: "main", stop_on_entry: false });
    reached = dap.capabilities != null;
    stopped = await stopSoon;
  } catch (err) {
    console.log("  scenario error:", err?.message ?? String(err));
  } finally {
    try { await dap.request("terminate", {}, 3000); } catch { /* ignore */ }
    dap.close();
  }
  // A stop proves the game ran; otherwise the _ready() print proves it ran unhalted.
  const ran = stopped || outputs.some((l) => l.includes("[example] player ready"));
  return { stopped, ran, reached, outputs };
}

// A short breather so the previous session's game fully tears down before the next launch.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// honored ⇒ the modifier suppressed the stop: the game ran but never halted at the bp.
const verdict = (r) => (r.ran && !r.stopped ? "HONORED" : r.stopped ? "IGNORED" : "INCONCLUSIVE");

const cond = await runScenario({ conditions: ["counter < 0"] });
console.log(`D_DAP_COND: stopped=${cond.stopped} ran=${cond.ran} => condition ${verdict(cond)}`);
await pause(1500);

const hit = await runScenario({ hit_conditions: [">1000000"] });
console.log(`D_DAP_HIT: stopped=${hit.stopped} ran=${hit.ran} => hitCondition ${verdict(hit)}`);
await pause(1500);

const log = await runScenario({ log_messages: ["GCB_LOGPOINT counter={counter}"] });
const logged = log.outputs.some((l) => l.includes("GCB_LOGPOINT"));
// A logpoint is honored only if it logs AND does not halt.
const logVerdict = log.ran && !log.stopped ? (logged ? "HONORED" : "SILENTLY_DROPPED") : log.stopped ? "IGNORED" : "INCONCLUSIVE";
console.log(`D_DAP_LOG: stopped=${log.stopped} ran=${log.ran} logged=${logged} => logMessage ${logVerdict}`);

// One-line summary for quick grep.
console.log(
  `D_DAP_MODIFIERS: condition=${verdict(cond)} hitCondition=${verdict(hit)} logMessage=${logVerdict}` +
    ` (adapter advertises all three unsupported on Godot ${process.env.GODOT_VERSION ?? "this build"})`,
);

if (!cond.reached && !hit.reached && !log.reached) {
  console.error("✘ could not reach the debug adapter in any scenario");
  process.exitCode = 1;
}
