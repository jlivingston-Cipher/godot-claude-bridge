#!/usr/bin/env node
// runtime_scenario.mjs — single-session driver for Gate 5 (Plane C runtime bridge).
//
// godot_run_managed spawns the game as a CHILD of the host with captured stdout,
// so the host must stay alive across the whole sequence. Auto-accepts elicitation
// (runtime_call_method is gated). No debugger here, so take_damage returns
// immediately. Run from host/:  node runtime_scenario.mjs
//
// Prereq: close any game window from Gate 4 first so port 9081 is free.

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
    env: { ...process.env, GODOT_BIN, GODOT_PROJECT },
    stderr: "inherit",
  });
  const client = new Client({ name: "gcb-runtime", version: "1.0.0" }, { capabilities: { elicitation: {} } });
  client.setRequestHandler(ElicitRequestSchema, async () => {
    process.stderr.write("[scenario] elicitation → ACCEPT\n");
    return { action: "accept", content: { proceed: true } };
  });
  await client.connect(transport);
  const t = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });

  const summary = {};

  // 5.1 — run the game as a managed process (captured console)
  const runRes = S(await t("godot_run_managed", {}));
  log("5.1 godot_run_managed", runRes);
  const id = runRes && runRes.id;
  summary["5.1 managed id returned"] = Boolean(id);
  if (!id) { console.log("no managed id — aborting"); await client.close(); process.exit(1); }

  // wait for the runtime bridge to answer (game booted + autoload up)
  let counter = null;
  for (let i = 0; i < 25; i++) {
    await sleep(600);
    try {
      const g = S(await t("runtime_get_property", { path: ".", property: "counter" }));
      if (g && g.value !== undefined && !g.isError) { counter = g.value; break; }
    } catch { /* not up yet */ }
  }

  // 5.2 — captured console should include "[example] player ready"
  const out = S(await t("godot_output", { id }));
  log("5.2 godot_output", out);
  summary["5.2 '[example] player ready' captured"] = JSON.stringify(out).includes("[example] player ready");

  // 5.3 — counter is 100
  log("5.3 runtime_get_property counter", { value: counter });
  summary["5.3 counter == 100"] = counter === 100;

  // 5.4 — take_damage(10) -> 90
  const dmg = S(await t("runtime_call_method", { path: ".", method: "take_damage", args: [10] }));
  log("5.4 runtime_call_method take_damage([10])", dmg);
  summary["5.4 take_damage -> 90"] = Boolean(dmg && dmg.return === 90);

  // 5.5 — a performance monitor
  const mon = S(await t("runtime_get_monitors", { keys: ["time/fps"] }));
  log("5.5 runtime_get_monitors time/fps", mon);
  const fps = mon && mon.monitors && mon.monitors["time/fps"];
  summary["5.5 fps is numeric"] = typeof fps === "number";

  // 5.6 — a game frame
  const shot = await t("runtime_screenshot", {});
  const imgBlock = ((shot && shot.content) || []).find((c) => c.type === "image");
  const txtBlock = ((shot && shot.content) || []).find((c) => c.type === "text");
  log("5.6 runtime_screenshot", { image: imgBlock ? { mimeType: imgBlock.mimeType, dataChars: (imgBlock.data || "").length } : null, note: txtBlock && txtBlock.text });
  summary["5.6 screenshot image returned"] = Boolean(imgBlock);

  // 5.7 — the push_log ring buffer (info at _ready, warning from take_damage)
  const logs = S(await t("runtime_get_log", {}));
  log("5.7 runtime_get_log", logs);
  summary["5.7 push_log entries present"] = Boolean(logs && Array.isArray(logs.entries) && logs.entries.length > 0);

  // --- extra runtime tools (B1 schema sweep) — defensive so one bad schema
  //     doesn't abort before teardown ---
  for (const [name, args, ok] of [
    ["runtime_get_tree", {}, (r) => Boolean(r && r.name)],
    ["runtime_set_property", { path: ".", property: "counter", value: 100 }, (r) => Boolean(r && r.property === "counter")],
    ["runtime_emit_signal", { path: ".", signal: "renamed" }, (r) => Boolean(r && r.emitted === true)],
    ["runtime_inject_input", { event: { kind: "key", keycode: 32, pressed: true } }, (r) => Boolean(r && r.injected === true)],
  ]) {
    try {
      const r = S(await t(name, args));
      log(`sweep ${name}`, r);
      summary[name] = ok(r);
    } catch (e) {
      const m = String((e && e.message) || e);
      log(`sweep ${name}`, { error: m.slice(0, 200) });
      summary[name] = /validation|structured content/i.test(m) ? "SCHEMA-MISMATCH" : false;
    }
  }

  // teardown
  log("teardown — godot_stop", S(await t("godot_stop", { id })));

  console.log("\n=== SUMMARY (Gate 5) ===");
  console.log(JSON.stringify(summary, null, 2));
  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error("[scenario] FATAL:", (e && e.stack) || e); process.exit(1); });
