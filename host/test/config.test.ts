import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../src/config.js";

/** Keys loadConfig reads, so each test can restore the environment cleanly.
 *  The CLAUDE_* names are listed only so withEnv() saves/clears/restores them —
 *  loadConfig no longer reads them (the compat shim was removed in 1.1.0); the
 *  regression test below asserts a set CLAUDE_* is ignored. */
const ENV_KEYS = [
  "GODOT_PROJECT", "GODOT_BIN",
  "BREAKPOINT_BRIDGE_HOST", "BREAKPOINT_BRIDGE_PORT", "BREAKPOINT_BRIDGE_TIMEOUT_MS",
  "CLAUDE_BRIDGE_HOST", "CLAUDE_BRIDGE_PORT", "CLAUDE_BRIDGE_TIMEOUT_MS",
  "GODOT_LSP_HOST", "GODOT_LSP_PORT", "GODOT_LSP_TIMEOUT_MS",
  "GODOT_DAP_HOST", "GODOT_DAP_PORT", "GODOT_DAP_TIMEOUT_MS",
  "BREAKPOINT_RUNTIME_HOST", "BREAKPOINT_RUNTIME_PORT", "BREAKPOINT_RUNTIME_TIMEOUT_MS",
  "CLAUDE_RUNTIME_HOST", "CLAUDE_RUNTIME_PORT", "CLAUDE_RUNTIME_TIMEOUT_MS",
];

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("loadConfig applies documented defaults when no env is set", () => {
  withEnv({ GODOT_PROJECT: "/tmp/proj" }, () => {
    const c = loadConfig();
    assert.equal(c.godotBin, "godot");
    assert.equal(c.projectPath, "/tmp/proj");
    assert.equal(c.bridgeHost, "127.0.0.1");
    assert.equal(c.bridgePort, 9080);
    assert.equal(c.bridgeTimeoutMs, 15000);
    assert.equal(c.lspHost, "127.0.0.1");
    assert.equal(c.lspPort, 6005);
    assert.equal(c.lspTimeoutMs, 15000);
    assert.equal(c.dapHost, "127.0.0.1");
    assert.equal(c.dapPort, 6006);
    assert.equal(c.dapTimeoutMs, 20000);
    assert.equal(c.runtimeHost, "127.0.0.1");
    assert.equal(c.runtimePort, 9081);
    assert.equal(c.runtimeTimeoutMs, 15000);
  });
});

test("projectUri is derived from projectPath as a file:// URI", () => {
  withEnv({ GODOT_PROJECT: "/tmp/My Proj" }, () => {
    const c = loadConfig();
    assert.equal(c.projectUri, pathToFileURL("/tmp/My Proj").href);
    assert.ok(c.projectUri.includes("%20"));
  });
});

test("ports and timeouts are parsed as integers from the environment", () => {
  withEnv(
    {
      GODOT_PROJECT: "/tmp/proj",
      GODOT_BIN: "/opt/homebrew/bin/godot",
      BREAKPOINT_BRIDGE_HOST: "0.0.0.0",
      BREAKPOINT_BRIDGE_PORT: "19080",
      BREAKPOINT_BRIDGE_TIMEOUT_MS: "5000",
      GODOT_LSP_PORT: "16005",
      GODOT_DAP_PORT: "16006",
      BREAKPOINT_RUNTIME_PORT: "19081",
    },
    () => {
      const c = loadConfig();
      assert.equal(c.godotBin, "/opt/homebrew/bin/godot");
      assert.equal(c.bridgeHost, "0.0.0.0");
      assert.equal(c.bridgePort, 19080);
      assert.strictEqual(typeof c.bridgePort, "number");
      assert.equal(c.bridgeTimeoutMs, 5000);
      assert.equal(c.lspPort, 16005);
      assert.equal(c.dapPort, 16006);
      assert.equal(c.runtimePort, 19081);
    },
  );
});

test("deprecated CLAUDE_* env vars are ignored (compat shim removed in 1.1.0)", () => {
  withEnv(
    {
      GODOT_PROJECT: "/tmp/proj",
      CLAUDE_BRIDGE_HOST: "10.0.0.1",
      CLAUDE_BRIDGE_PORT: "18080",
      CLAUDE_BRIDGE_TIMEOUT_MS: "4000",
      CLAUDE_RUNTIME_HOST: "10.0.0.2",
      CLAUDE_RUNTIME_PORT: "18081",
      CLAUDE_RUNTIME_TIMEOUT_MS: "4200",
    },
    () => {
      const c = loadConfig();
      // BREAKPOINT_* is unset, so a set CLAUDE_* must NOT leak in: every value
      // falls back to the documented default now that the shim is gone.
      assert.equal(c.bridgeHost, "127.0.0.1");
      assert.equal(c.bridgePort, 9080);
      assert.equal(c.bridgeTimeoutMs, 15000);
      assert.equal(c.runtimeHost, "127.0.0.1");
      assert.equal(c.runtimePort, 9081);
      assert.equal(c.runtimeTimeoutMs, 15000);
    },
  );
});
