import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { runDoctor, runDoctorChecks, isPluginEnabled } from "../src/cli/doctor.js";
import { startTcpServer, type TcpServer } from "./helpers/tcp.js";

/**
 * Tests for `breakpoint-mcp doctor`. The four bridges are exercised against
 * in-process loopback TCP servers (the same helper the DAP/bridge suites use);
 * a POSIX shell fixture stands in for the Godot binary, so no real Godot is
 * needed. Env is snapshotted/restored around each test so ports/paths don't leak.
 */

const POSIX = process.platform !== "win32";

const ENV_KEYS = [
  "GODOT_PROJECT",
  "GODOT_BIN",
  "BREAKPOINT_BRIDGE_PORT",
  "BREAKPOINT_RUNTIME_PORT",
  "GODOT_LSP_PORT",
  "GODOT_DAP_PORT",
];

let saved: Record<string, string | undefined> = {};
function snapshotEnv(): void {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
}
function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

let dir: string;
let projectDir: string;
let fakeGodot: string;

/** Write a minimal Godot project that installs + enables the addon. */
function writeInstalledProject(root: string, enabled: boolean, version = "1.1.0"): void {
  const addonDir = path.join(root, "addons", "breakpoint_mcp");
  fs.mkdirSync(addonDir, { recursive: true });
  fs.writeFileSync(
    path.join(addonDir, "plugin.cfg"),
    `[plugin]\nname="Breakpoint MCP"\nversion="${version}"\nscript="plugin.gd"\n`,
  );
  const enabledLine = enabled
    ? 'enabled=PackedStringArray("res://addons/breakpoint_mcp/plugin.cfg")'
    : "enabled=PackedStringArray()";
  fs.writeFileSync(
    path.join(root, "project.godot"),
    `config_version=5\n\n[application]\n\nconfig/name="fixture"\n\n[editor_plugins]\n\n${enabledLine}\n`,
  );
}

before(() => {
  if (!POSIX) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bpmcp-doctor-"));
  projectDir = path.join(dir, "project");
  writeInstalledProject(projectDir, true);
  fakeGodot = path.join(dir, "fakegodot.sh");
  fs.writeFileSync(
    fakeGodot,
    ['#!/bin/sh', 'if [ "$1" = "--version" ]; then echo "4.7.stable.fixture"; fi', "exit 0", ""].join("\n"),
    { mode: 0o755 },
  );
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

/** Start N loopback servers and return them (each just accepts + holds). */
async function startBridges(n: number): Promise<TcpServer[]> {
  const servers: TcpServer[] = [];
  for (let i = 0; i < n; i++) servers.push(await startTcpServer(() => {}));
  return servers;
}
async function closeAll(servers: TcpServer[]): Promise<void> {
  await Promise.all(servers.map((s) => s.close()));
}
/** A port that was bound then released — reliably closed for a refusal test. */
async function closedPort(): Promise<number> {
  const s = await startTcpServer(() => {});
  const p = s.port;
  await s.close();
  return p;
}

const status = (r: { checks: Array<{ name: string; status: string }> }, name: string) =>
  r.checks.find((c) => c.name === name)?.status;

test("isPluginEnabled detects the enabled plugin, ignores others / missing section", () => {
  const enabled =
    '[editor_plugins]\n\nenabled=PackedStringArray("res://addons/other/plugin.cfg", "res://addons/breakpoint_mcp/plugin.cfg")\n';
  assert.equal(isPluginEnabled(enabled), true);
  const otherOnly = '[editor_plugins]\n\nenabled=PackedStringArray("res://addons/other/plugin.cfg")\n';
  assert.equal(isPluginEnabled(otherOnly), false);
  assert.equal(isPluginEnabled('[application]\n\nconfig/name="x"\n'), false);
  // The res path must be inside [editor_plugins], not just anywhere in the file.
  const wrongSection =
    '[application]\n\nconfig/icon="res://addons/breakpoint_mcp/plugin.cfg"\n\n[editor_plugins]\n\nenabled=PackedStringArray()\n';
  assert.equal(isPluginEnabled(wrongSection), false);
});

test("all checks pass against a fully-set-up install", { skip: !POSIX }, async () => {
  snapshotEnv();
  const servers = await startBridges(4);
  try {
    process.env.GODOT_BIN = fakeGodot;
    process.env.GODOT_PROJECT = projectDir;
    process.env.BREAKPOINT_BRIDGE_PORT = String(servers[0].port);
    process.env.BREAKPOINT_RUNTIME_PORT = String(servers[1].port);
    process.env.GODOT_LSP_PORT = String(servers[2].port);
    process.env.GODOT_DAP_PORT = String(servers[3].port);

    const report = await runDoctorChecks(loadConfig(), {
      timeoutMs: 1000,
      requireLive: true,
      includeCsharp: false,
    });

    assert.equal(report.ok, true);
    assert.equal(status(report, "godot-binary"), "ok");
    assert.equal(status(report, "addon-installed"), "ok");
    assert.equal(status(report, "addon-enabled"), "ok");
    for (const b of ["editor-bridge", "runtime-bridge", "gdscript-lsp", "gdscript-dap"]) {
      assert.equal(status(report, b), "ok", `${b} should be reachable`);
    }
  } finally {
    await closeAll(servers);
    restoreEnv();
  }
});

test("an unreachable bridge fails the report under --require-live", { skip: !POSIX }, async () => {
  snapshotEnv();
  const servers = await startBridges(3);
  const dead = await closedPort();
  try {
    process.env.GODOT_BIN = fakeGodot;
    process.env.GODOT_PROJECT = projectDir;
    process.env.BREAKPOINT_BRIDGE_PORT = String(servers[0].port);
    process.env.BREAKPOINT_RUNTIME_PORT = String(servers[1].port);
    process.env.GODOT_LSP_PORT = String(servers[2].port);
    process.env.GODOT_DAP_PORT = String(dead);

    const report = await runDoctorChecks(loadConfig(), {
      timeoutMs: 800,
      requireLive: true,
      includeCsharp: false,
    });
    assert.equal(status(report, "gdscript-dap"), "fail");
    assert.equal(report.ok, false);
  } finally {
    await closeAll(servers);
    restoreEnv();
  }
});

test("unreachable bridges are informational (report still ok) without --require-live", { skip: !POSIX }, async () => {
  snapshotEnv();
  const dead = await closedPort();
  try {
    process.env.GODOT_BIN = fakeGodot;
    process.env.GODOT_PROJECT = projectDir;
    // Point every bridge at closed ports; with requireLive:false they're info-only.
    process.env.BREAKPOINT_BRIDGE_PORT = String(dead);
    process.env.BREAKPOINT_RUNTIME_PORT = String(dead);
    process.env.GODOT_LSP_PORT = String(dead);
    process.env.GODOT_DAP_PORT = String(dead);

    const report = await runDoctorChecks(loadConfig(), {
      timeoutMs: 500,
      requireLive: false,
      includeCsharp: false,
    });
    assert.equal(status(report, "editor-bridge"), "fail");
    // Only godot-binary + addon checks are required here, and those pass.
    assert.equal(report.ok, true);
  } finally {
    restoreEnv();
  }
});

test("a missing addon fails the required addon-installed check", { skip: !POSIX }, async () => {
  snapshotEnv();
  const bare = path.join(dir, "bare");
  fs.mkdirSync(bare, { recursive: true });
  fs.writeFileSync(path.join(bare, "project.godot"), 'config_version=5\n\n[application]\n\nconfig/name="bare"\n');
  try {
    process.env.GODOT_BIN = fakeGodot;
    process.env.GODOT_PROJECT = bare;
    const report = await runDoctorChecks(loadConfig(), {
      timeoutMs: 300,
      requireLive: false,
      includeCsharp: false,
    });
    assert.equal(status(report, "addon-installed"), "fail");
    assert.equal(status(report, "addon-enabled"), "fail");
    assert.equal(report.ok, false);
  } finally {
    restoreEnv();
  }
});

test("a missing Godot binary fails the required godot-binary check", { skip: !POSIX }, async () => {
  snapshotEnv();
  try {
    process.env.GODOT_BIN = "/no/such/godot-binary-xyz";
    process.env.GODOT_PROJECT = projectDir;
    const report = await runDoctorChecks(loadConfig(), {
      timeoutMs: 300,
      requireLive: false,
      includeCsharp: false,
    });
    assert.equal(status(report, "godot-binary"), "fail");
    assert.equal(report.ok, false);
  } finally {
    restoreEnv();
  }
});

test("runDoctor returns exit 0 and emits valid JSON when everything is up", { skip: !POSIX }, async () => {
  snapshotEnv();
  const servers = await startBridges(4);
  const origWrite = process.stdout.write.bind(process.stdout);
  let out = "";
  try {
    process.env.GODOT_BIN = fakeGodot;
    process.env.BREAKPOINT_BRIDGE_PORT = String(servers[0].port);
    process.env.BREAKPOINT_RUNTIME_PORT = String(servers[1].port);
    process.env.GODOT_LSP_PORT = String(servers[2].port);
    process.env.GODOT_DAP_PORT = String(servers[3].port);
    (process.stdout as unknown as { write: (c: string | Uint8Array) => boolean }).write = (
      chunk: string | Uint8Array,
    ) => {
      out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    };
    // --project routes into GODOT_PROJECT inside runDoctor.
    const code = await runDoctor(["--json", "--require-live", "--project", projectDir]);
    (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
    assert.equal(code, 0);
    const parsed = JSON.parse(out) as { ok: boolean; checks: unknown[] };
    assert.equal(parsed.ok, true);
    assert.ok(Array.isArray(parsed.checks) && parsed.checks.length >= 7);
  } finally {
    (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
    await closeAll(servers);
    restoreEnv();
  }
});
