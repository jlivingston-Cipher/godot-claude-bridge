// CLI-plane integration smoke — drives the REAL Godot binary through the host's
// registered CLI tools. This is the piece no unit test can do: it proves the
// host actually talks to a live engine, headlessly (no GUI needed).
//
// Run in CI after `npm run build`, with GODOT_BIN and GODOT_PROJECT set. Exits
// non-zero on any failure. Not part of `npm test` (which is Godot-free); it is
// invoked directly by .github/workflows/integration.yml.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { registerCliTools } from "../dist/tools/cli.js";
import { loadConfig } from "../dist/config.js";

const tools = new Map();
const server = {
  registerTool: (name, _config, handler) => tools.set(name, handler),
  registerResource: () => {},
  server: { elicitInput: async () => ({ action: "decline" }) },
};
const cfg = loadConfig();
registerCliTools(server, cfg);

const call = (name, args = {}) => {
  const h = tools.get(name);
  if (!h) throw new Error(`tool not registered: ${name}`);
  return h(args, {});
};

console.log(`GODOT_BIN=${cfg.godotBin}  GODOT_PROJECT=${cfg.projectPath}`);

// 1) godot_version — the simplest real host<->Godot round trip.
{
  const res = await call("godot_version");
  const version = res.structuredContent?.version ?? "";
  console.log("godot_version ->", JSON.stringify(version));
  assert.match(version, /\d+\.\d+/, `expected a version string, got: ${version}`);
}

// 2) godot_run_headless_script — run a tiny SceneTree script, capture its stdout.
{
  const scriptRel = "_ci_smoke.gd";
  const scriptAbs = path.join(cfg.projectPath, scriptRel);
  fs.writeFileSync(scriptAbs, 'extends SceneTree\nfunc _init():\n\tprint("GCB_CI_OK")\n\tquit()\n', "utf8");
  try {
    const res = await call("godot_run_headless_script", { script_path: "res://" + scriptRel, timeout_ms: 120000 });
    const sc = res.structuredContent ?? {};
    console.log("godot_run_headless_script ->", JSON.stringify({ exit_code: sc.exit_code, timed_out: sc.timed_out }));
    console.log("---- stdout ----\n" + (sc.stdout ?? "") + "\n----------------");
    assert.ok(String(sc.stdout ?? "").includes("GCB_CI_OK"), "expected the GCB_CI_OK marker in the headless script's stdout");
  } finally {
    fs.rmSync(scriptAbs, { force: true });
  }
}

console.log("✔ CLI-plane integration OK");
