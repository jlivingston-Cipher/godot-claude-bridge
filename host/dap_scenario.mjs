#!/usr/bin/env node
// dap_scenario.mjs — single-session driver for Gate 4 (DAP debugging plane).
//
// The debug session is stateful, so unlike drive.mjs this holds ONE host + ONE
// debug session across the whole sequence. It auto-ACCEPTS elicitation because
// dbg_evaluate and the runtime_call_method trigger are both confirmation-gated.
//
// Flow: set breakpoint -> launch -> (game boots) -> fire take_damage() but do NOT
// await it (it halts at the breakpoint) -> drive the stop over DAP (stack/scopes/
// variables/step/evaluate) -> continue, which releases the trigger so take_damage
// returns. Run from host/:  node dap_scenario.mjs

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HOST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HOST_DIR, "..");
const DIST = path.join(HOST_DIR, "dist", "index.js");
const GODOT_PROJECT = process.env.GODOT_PROJECT || path.join(REPO, "example");
const GODOT_BIN = process.env.GODOT_BIN || "godot";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (_k, v) => (typeof v === "string" && v.length > 200 ? `«${v.length} chars»` : v);
const S = (res) => (res && res.structuredContent ? res.structuredContent : res);
function log(label, val) { console.log(`\n=== ${label} ===`); console.log(JSON.stringify(val, short, 2)); }

async function main() {
  const transport = new StdioClientTransport({
    command: "node", args: [DIST], cwd: HOST_DIR,
    env: { ...process.env, GODOT_BIN, GODOT_PROJECT, CLAUDE_RUNTIME_TIMEOUT_MS: "120000" },
    stderr: "inherit",
  });
  const client = new Client({ name: "gcb-dap", version: "1.0.0" }, { capabilities: { elicitation: {} } });
  client.setRequestHandler(ElicitRequestSchema, async () => {
    process.stderr.write("[scenario] elicitation → ACCEPT\n");
    return { action: "accept", content: { proceed: true } };
  });
  await client.connect(transport);
  const t = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 130000 });

  // 4.1 — buffer a breakpoint on `counter -= amount` (player.gd line 26, 1-based)
  log("4.1 dbg_set_breakpoints player.gd:[26]", S(await t("dbg_set_breakpoints", { path: "res://player.gd", lines: [26] })));

  // 4.2 — launch the game under the debugger
  log("4.2 dbg_launch (scene=main)", S(await t("dbg_launch", { scene: "main" })));

  // wait for the game's runtime bridge to come up; also confirms counter=100 (Gate 5.3 preview)
  let ready = null;
  for (let i = 0; i < 25; i++) {
    await sleep(600);
    try {
      const g = S(await t("runtime_get_property", { path: ".", property: "counter" }));
      if (g && g.value !== undefined && !g.isError) { ready = g; break; }
    } catch { /* not up yet */ }
  }
  log("game ready — runtime_get_property counter (expect 100)", ready ?? "(runtime bridge never answered)");

  // 4.3 — fire take_damage(10); do NOT await (halts at the breakpoint until we continue)
  console.log("\n=== 4.3 firing runtime_call_method take_damage([10]) — NOT awaited (pauses at breakpoint) ===");
  const trigger = t("runtime_call_method", { path: ".", method: "take_damage", args: [10] })
    .then((r) => ({ ok: true, result: S(r) }))
    .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));

  // wait for the stop by polling stackTrace until frames appear
  let frames = [];
  for (let i = 0; i < 24; i++) {
    await sleep(500);
    try {
      const st = S(await t("dbg_stack_trace", {}));
      if (Array.isArray(st.frames) && st.frames.length > 0) { frames = st.frames; break; }
    } catch { /* not stopped yet */ }
  }
  if (frames.length === 0) console.log("\n!! never stopped at the breakpoint within ~12s");
  log("4.3/4.4 dbg_stack_trace (stopped at breakpoint)", { frames });

  // 4.4 — scopes + variables of the top frame; surface amount (local) + counter (member)
  const top = frames[0] && frames[0].id != null ? frames[0].id : 0;
  const scopes = S(await t("dbg_scopes", { frame_id: top }));
  log("4.4 dbg_scopes(top frame)", scopes);
  for (const sc of (scopes.scopes || [])) {
    if (!sc.variables_ref) continue;
    let vars = [];
    try { vars = (S(await t("dbg_variables", { variables_ref: sc.variables_ref })).variables) || []; }
    catch (e) { vars = [{ error: String(e) }]; }
    const picked = vars.length > 20
      ? vars.filter((v) => ["counter", "amount"].includes(v.name)).concat([{ note: `…${vars.length} total in ${sc.name}` }])
      : vars;
    log(`4.4 dbg_variables (${sc.name})`, picked);
  }

  // 4.5 — step over (executes line 26: counter -= amount)
  log("4.5 dbg_step over", S(await t("dbg_step", { kind: "over" })));

  // 4.6 — evaluate counter (now decremented), then continue
  log("4.6 dbg_evaluate counter (expect 90 after the step)", S(await t("dbg_evaluate", { expression: "counter" })));
  log("4.6 dbg_continue (resumes; ~15s to report 'running')", S(await t("dbg_continue", {})));

  // the trigger should now have returned take_damage's value (90)
  const trig = await Promise.race([trigger, sleep(10000).then(() => ({ ok: false, error: "trigger still pending 10s after continue" }))]);
  log("take_damage() return value (from the fired runtime_call_method)", trig);

  console.log("\n=== done. The game window is still open — close it before Gate 5. ===");
  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error("[scenario] FATAL:", (e && e.stack) || e); process.exit(1); });
