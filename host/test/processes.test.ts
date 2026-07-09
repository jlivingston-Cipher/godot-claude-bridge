import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ProcessRegistry, registerProcessTools } from "../src/tools/processes.js";
import { makeRecordingServer, type ToolResultLike } from "./helpers/recording-server.js";
import type { Config } from "../src/config.js";

/**
 * Behavior tests for the managed-process plane (tools/processes.ts). This is
 * pure host logic — a captured child process and an in-memory ring buffer — so
 * no Godot is needed. A tiny POSIX fixture stands in for the Godot binary and
 * emits deterministic stdout/stderr; the injected `--path <project>` args are
 * ignored, and the first extra arg selects how many stdout lines to print.
 */

const POSIX = process.platform !== "win32";

let dir: string;
let fakeGodot: string;

before(() => {
  if (!POSIX) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcb-proc-"));
  fakeGodot = path.join(dir, "fakegodot.sh");
  // argv is: --path <projectPath> [count].  Emit <count> stdout lines
  // (default 3) then one stderr line, then exit 0.
  fs.writeFileSync(
    fakeGodot,
    [
      "#!/bin/sh",
      'count="${3:-3}"',
      "i=1",
      'while [ "$i" -le "$count" ]; do echo "out$i"; i=$((i+1)); done',
      'echo "boom" 1>&2',
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function cfg(): Config {
  return { godotBin: fakeGodot, projectPath: dir } as unknown as Config;
}

async function waitFor(cond: () => boolean | undefined, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for the child to exit");
    await delay(10);
  }
  // Let any trailing stdout/stderr 'data' events flush after 'exit'.
  await delay(30);
}

const sc = (r: ToolResultLike) => r.structuredContent as Record<string, unknown>;

test("ProcessRegistry captures stdout and stderr separately and records the exit code", { skip: !POSIX }, async () => {
  const reg = new ProcessRegistry();
  const m = reg.run(cfg(), ["3"]);
  await waitFor(() => m.exited);

  const outs = m.lines.filter((l) => l.stream === "stdout").map((l) => l.text);
  const errs = m.lines.filter((l) => l.stream === "stderr").map((l) => l.text);
  assert.deepEqual(outs, ["out1", "out2", "out3"]);
  assert.deepEqual(errs, ["boom"]);
  assert.equal(m.lines.length, 4);
  assert.equal(m.exitCode, 0);
  // seq values are unique.
  assert.equal(new Set(m.lines.map((l) => l.seq)).size, 4);
  reg.killAll();
});

test("the capture ring buffer caps at 5000 lines, dropping the oldest", { skip: !POSIX }, async () => {
  const reg = new ProcessRegistry();
  const m = reg.run(cfg(), ["5100"]); // 5100 stdout + 1 stderr = 5101 emitted
  await waitFor(() => m.exited, 20000);

  assert.equal(m.lines.length, 5000, "ring buffer must cap at LINE_CAP");
  assert.ok(!m.lines.some((l) => l.text === "out1"), "the oldest lines should be dropped");
  assert.ok(m.lines.some((l) => l.text === "out5100"), "the newest stdout line should be retained");
  assert.ok(m.lines.some((l) => l.text === "boom"), "the final stderr line should be retained");
  reg.killAll();
});

test("godot_output filters by since_seq and by stream", { skip: !POSIX }, async () => {
  const rec = makeRecordingServer();
  const reg = registerProcessTools(rec.server as unknown as Parameters<typeof registerProcessTools>[0], cfg());

  const run = await rec.handler("godot_run_managed")({});
  const id = sc(run).id as string;
  assert.equal(typeof id, "string");
  await waitFor(() => reg.get(id)?.exited);

  const all = sc(await rec.handler("godot_output")({ id }));
  assert.equal(all.exited, true);
  assert.equal(all.exit_code, 0);
  assert.equal((all.lines as unknown[]).length, 4); // 3 stdout + 1 stderr (default count 3)

  const outOnly = sc(await rec.handler("godot_output")({ id, stream: "stdout" }));
  const outLines = outOnly.lines as Array<{ stream: string }>;
  assert.equal(outLines.length, 3);
  assert.ok(outLines.every((l) => l.stream === "stdout"));

  const since = sc(await rec.handler("godot_output")({ id, since_seq: 2 }));
  const sinceLines = since.lines as Array<{ seq: number }>;
  assert.ok(sinceLines.length > 0 && sinceLines.every((l) => l.seq > 2));

  reg.killAll();
});

test("godot_output and godot_stop return a friendly error for an unknown process id", { skip: !POSIX }, async () => {
  const rec = makeRecordingServer();
  registerProcessTools(rec.server as unknown as Parameters<typeof registerProcessTools>[0], cfg());

  const out = await rec.handler("godot_output")({ id: "does-not-exist" });
  assert.equal(out.isError, true);
  assert.match(out.content?.[0]?.text ?? "", /No managed process/);

  const stop = await rec.handler("godot_stop")({ id: "does-not-exist" });
  assert.equal(stop.isError, true);
  assert.match(stop.content?.[0]?.text ?? "", /No managed process/);
});

test("godot_stop terminates a managed process", { skip: !POSIX }, async () => {
  const rec = makeRecordingServer();
  const reg = registerProcessTools(rec.server as unknown as Parameters<typeof registerProcessTools>[0], cfg());
  const run = await rec.handler("godot_run_managed")({});
  const id = sc(run).id as string;

  const stop = sc(await rec.handler("godot_stop")({ id }));
  assert.equal(stop.stopped, true);
  assert.equal(stop.id, id);
  reg.killAll();
});
