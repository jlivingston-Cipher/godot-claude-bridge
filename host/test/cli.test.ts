import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerCliTools } from "../src/tools/cli.js";
import type { Config } from "../src/config.js";

/**
 * Behavior tests for the headless-CLI plane (tools/cli.ts). The value here is
 * pure host logic: capturing a child's stdout, degrading (not throwing) when the
 * binary is missing or exits non-zero, and launching detached processes. A tiny
 * POSIX fixture stands in for the Godot binary so no real Godot is needed.
 */

const POSIX = process.platform !== "win32";

type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
};
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

/**
 * A recorder that captures plain tools AND task-model tools (godot_export/import/
 * run_headless_script register via server.experimental.tasks). Task handlers are
 * not plain callables, so we only assert their presence, never invoke them.
 */
function setup(godotBin: string, projectPath: string) {
  const tools = new Map<string, Handler>();
  const server = {
    registerTool(name: string, _config: unknown, handler: Handler) {
      tools.set(name, handler);
    },
    experimental: {
      tasks: {
        registerToolTask(name: string) {
          tools.set(name, (async () => ({ content: [] })) as Handler);
        },
      },
    },
    server: { elicitInput: async () => ({ action: "decline" }) },
  };
  registerCliTools(
    server as unknown as Parameters<typeof registerCliTools>[0],
    { godotBin, projectPath } as unknown as Config,
  );
  return tools;
}

let dir: string;
let fakeGodot: string;

before(() => {
  if (!POSIX) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcb-cli-"));
  fakeGodot = path.join(dir, "fakegodot.sh");
  // Prints a fixed version line for `--version`; exits 0 for anything else.
  fs.writeFileSync(
    fakeGodot,
    ['#!/bin/sh', 'if [ "$1" = "--version" ]; then echo "4.7.stable.custom"; fi', "exit 0", ""].join("\n"),
    { mode: 0o755 },
  );
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const sc = (r: ToolResult) => r.structuredContent as Record<string, unknown>;

test("godot_version returns the captured version string and exit code 0", { skip: !POSIX }, async () => {
  const tools = setup(fakeGodot, dir);
  const r = await tools.get("godot_version")!({});
  assert.equal(sc(r).version, "4.7.stable.custom");
  assert.equal((sc(r).raw as { code: number }).code, 0);
});

test("godot_version degrades (no throw) when the binary is missing", { skip: !POSIX }, async () => {
  const tools = setup("/no/such/godot-binary-xyz", dir);
  const r = await tools.get("godot_version")!({});
  // A spawn failure resolves to a result (never throws): exit code is null and
  // timed_out is false — the tool reports the failure instead of crashing.
  assert.notEqual(r.isError, true, "a missing binary should be reported, not thrown");
  const raw = sc(r).raw as { code: number | null; timedOut: boolean };
  assert.equal(raw.code, null);
  assert.equal(raw.timedOut, false);
});

test("godot_version records a non-zero exit code without throwing", { skip: !POSIX }, async () => {
  const tools = setup("/usr/bin/false", dir);
  const r = await tools.get("godot_version")!({});
  assert.notEqual(r.isError, true);
  assert.equal((sc(r).raw as { code: number | null }).code, 1);
});

test("godot_run_project launches detached and returns a numeric pid", { skip: !POSIX }, async () => {
  const tools = setup(fakeGodot, dir);
  const r = await tools.get("godot_run_project")!({});
  assert.equal(sc(r).running, true);
  assert.equal(typeof sc(r).pid, "number");
});

test("godot_launch_editor reports launched:true and the project path", { skip: !POSIX }, async () => {
  const tools = setup(fakeGodot, dir);
  const r = await tools.get("godot_launch_editor")!({});
  assert.equal(sc(r).launched, true);
  assert.equal(sc(r).project, dir);
});

test("the long-running CLI tools register under the task model", { skip: !POSIX }, () => {
  const tools = setup(fakeGodot, dir);
  for (const n of ["godot_export", "godot_import", "godot_run_headless_script"]) {
    assert.ok(tools.has(n), `${n} should be registered`);
  }
});
