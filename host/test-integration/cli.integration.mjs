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
import { GodotTaskStore } from "../dist/tasks.js";

const tools = new Map();
const taskTools = new Map();
// D2: the long jobs (export/import/headless script) register as task tools via
// server.experimental.tasks.registerToolTask; capture those too.
const server = {
  registerTool: (name, _config, handler) => tools.set(name, handler),
  registerResource: () => {},
  experimental: {
    tasks: { registerToolTask: (name, _config, handler) => taskTools.set(name, handler) },
  },
  server: { elicitInput: async () => ({ action: "decline" }) },
};
const cfg = loadConfig();
registerCliTools(server, cfg);

const call = (name, args = {}) => {
  const h = tools.get(name);
  if (!h) throw new Error(`tool not registered: ${name}`);
  return h(args, {});
};

// Drive a D2 task tool through its lifecycle (create -> poll -> result), the way
// a task-aware MCP client would. Uses a real GodotTaskStore as the backing store.
const store = new GodotTaskStore();
async function callTask(name, args = {}) {
  const h = taskTools.get(name);
  if (!h) throw new Error(`task tool not registered: ${name}`);
  const extra = {
    taskStore: {
      createTask: (opts) => store.createTask(opts, "smoke", { method: "tools/call", params: {} }),
      getTask: (id) => store.getTask(id),
      getTaskResult: (id) => store.getTaskResult(id),
      storeTaskResult: (id, s, r) => store.storeTaskResult(id, s, r),
    },
    taskId: undefined,
  };
  const created = await h.createTask(args, extra);
  extra.taskId = created.task.taskId;
  for (let i = 0; i < 900; i++) {
    const t = await h.getTask({}, extra);
    if (t.status !== "working") break;
    await new Promise((r) => setTimeout(r, 200));
  }
  return h.getTaskResult({}, extra);
}

console.log(`GODOT_BIN=${cfg.godotBin}  GODOT_PROJECT=${cfg.projectPath}`);

// 1) godot_version — the simplest real host<->Godot round trip.
{
  const res = await call("godot_version");
  const version = res.structuredContent?.version ?? "";
  console.log("godot_version ->", JSON.stringify(version));
  assert.match(version, /\d+\.\d+/, `expected a version string, got: ${version}`);
}

// 2) godot_run_headless_script (a D2 task tool) — run a tiny SceneTree script,
//    capture its stdout, driven through the task lifecycle.
{
  const scriptRel = "_ci_smoke.gd";
  const scriptAbs = path.join(cfg.projectPath, scriptRel);
  fs.writeFileSync(scriptAbs, 'extends SceneTree\nfunc _init():\n\tprint("GCB_CI_OK")\n\tquit()\n', "utf8");
  try {
    const res = await callTask("godot_run_headless_script", { script_path: "res://" + scriptRel, timeout_ms: 120000 });
    const sc = res.structuredContent ?? {};
    console.log("godot_run_headless_script ->", JSON.stringify({ exit_code: sc.exit_code, timed_out: sc.timed_out }));
    console.log("---- stdout ----\n" + (sc.stdout ?? "") + "\n----------------");
    assert.ok(String(sc.stdout ?? "").includes("GCB_CI_OK"), "expected the GCB_CI_OK marker in the headless script's stdout");
  } finally {
    fs.rmSync(scriptAbs, { force: true });
  }
}

store.cleanup(); // clear TTL timers so the process exits promptly
console.log("✔ CLI-plane integration OK");
