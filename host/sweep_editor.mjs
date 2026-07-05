#!/usr/bin/env node
// sweep_editor.mjs — B1 runtime schema validation for the editor + LSP planes.
//
// Launches the editor (validating godot_launch_editor), waits for the bridge,
// then calls every editor/LSP tool that wasn't runtime-validated in Track A.
// A WRONG output schema makes the SDK reject the call (McpError), which we catch
// and flag as SCHEMA-MISMATCH. Auto-accepts elicitation (project_set_setting and
// node_delete are gated). Run from host/:  node sweep_editor.mjs
//
// Side effects: creates a throwaway res://gcb_tmp.tscn (cleaned up afterwards)
// and makes unsaved in-memory edits to the main scene — if the editor prompts on
// close, DON'T save.

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

async function main() {
  const transport = new StdioClientTransport({
    command: "node", args: [DIST], cwd: HOST_DIR,
    env: { ...process.env, GODOT_BIN, GODOT_PROJECT }, stderr: "inherit",
  });
  const client = new Client({ name: "gcb-sweep", version: "1.0.0" }, { capabilities: { elicitation: {} } });
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept", content: { proceed: true } }));
  await client.connect(transport);

  const results = [];
  async function check(name, args = {}) {
    try {
      const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
      const sc = r.structuredContent;
      const status = r.isError ? "TOOL-ERROR(not exercised)" : (sc ? "OK" : "NO-structuredContent");
      const detail = r.isError ? (r.content?.[0]?.text || "").slice(0, 110) : (sc ? Object.keys(sc).join(",") : "");
      results.push({ tool: name, status });
      console.log(`  ${status.padEnd(26)} ${name}  {${detail}}`);
      return sc;
    } catch (e) {
      const msg = String((e && e.message) || e);
      const status = /validation|structured content/i.test(msg) ? "SCHEMA-MISMATCH" : "THREW";
      results.push({ tool: name, status });
      console.log(`  ${status.padEnd(26)} ${name}  -> ${msg.slice(0, 150)}`);
      return null;
    }
  }

  console.log("\n# launching editor via godot_launch_editor …");
  await check("godot_launch_editor");
  let up = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const r = await client.callTool({ name: "editor_ping", arguments: {} }, undefined, { timeout: 5000 });
      if (r.structuredContent && r.structuredContent.pong) { up = true; break; }
    } catch { /* not up yet */ }
  }
  console.log(`# editor bridge ${up ? "ready" : "NOT ready"}\n`);
  if (!up) {
    console.log("!! editor bridge never answered on 9080. Is another editor already open, or the plugin disabled? Aborting.");
    await client.close();
    process.exit(1);
  }

  console.log("# editor tools");
  await check("scene_open", { path: "res://main.tscn" });
  await check("editor_get_state");
  await check("project_get_info");
  await check("project_get_setting", { name: "application/config/name" });
  await check("selection_get");
  await check("classdb_get_class", { class_name: "Node2D" });
  await check("selection_set", { paths: ["Sprite2D"] });
  await check("node_add", { parent_path: ".", type: "Node2D", name: "SweepTmp" });
  await check("node_rename", { path: "SweepTmp", new_name: "SweepTmp2" });
  await check("node_reparent", { path: "SweepTmp2", new_parent_path: "Sprite2D" });
  await check("node_delete", { path: "Sprite2D/SweepTmp2", confirm: true });
  await check("project_set_setting", { name: "application/config/description", value: "gcb sweep", save: false, confirm: true });
  await check("scene_new", { root_type: "Node2D", path: "res://gcb_tmp.tscn", confirm: true });
  await check("scene_save");

  console.log("\n# LSP tools");
  await check("gd_completion", { path: "res://player.gd", line: 25, character: 4 });
  await check("gd_references", { path: "res://player.gd", line: 8, character: 6 });
  await check("gd_document_symbols", { path: "res://player.gd" });
  await check("gd_workspace_symbols", { query: "take_damage" });
  await check("gd_rename", { path: "res://player.gd", line: 8, character: 6, new_name: "counter_renamed", apply: false });

  const bad = results.filter((r) => r.status === "SCHEMA-MISMATCH");
  const other = results.filter((r) => r.status !== "OK" && r.status !== "SCHEMA-MISMATCH");
  console.log("\n=== SUMMARY (editor + LSP) ===");
  console.log(`OK              : ${results.filter((r) => r.status === "OK").length}/${results.length}`);
  console.log(`SCHEMA-MISMATCH : ${bad.length}${bad.length ? " -> " + bad.map((b) => b.tool).join(", ") : ""}`);
  console.log(`other           : ${other.length}${other.length ? " -> " + other.map((b) => `${b.tool}(${b.status})`).join(", ") : ""}`);
  console.log("\nreminder: res://gcb_tmp.tscn is a throwaway (will be deleted); if the editor asks to save the main scene on close, choose Don't Save.");

  await client.close();
  process.exit(0);
}
main().catch((e) => { console.error("[sweep] FATAL:", (e && e.stack) || e); process.exit(1); });
