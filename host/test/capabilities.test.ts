import { test } from "node:test";
import assert from "node:assert/strict";
import { buildToolsets } from "../src/toolsets.js";
import { applyOutputSchemas } from "../src/schemas.js";
import { loadConfig } from "../src/config.js";
import {
  CAPABILITY_GROUPS,
  TOOL_CAPABILITIES,
  applyCapabilities,
  droppedTools,
  parsePrivilegedGroups,
  registerCapabilitiesResource,
  selectPrivilegedGroups,
  toolAllowed,
} from "../src/capabilities.js";

const FULL_TOOL_COUNT = 276;

// The 14 privileged tools, split by which single group keeps them.
const CODE_EXEC_ONLY = [
  // arbitrary execution / invocation / paused-frame evaluation
  "cs_dbg_evaluate",
  "dbg_evaluate",
  "godot_run_headless_script",
  "godot_run_managed",
  "node_call_method",
  "runtime_call_method",
  // asset-gen generators — the local command backend is their only privileged
  // path, so they load with code-execution alone (the network tag was dropped
  // because no external provider backend is implemented).
  "asset_gen_audio_sfx",
  "asset_gen_configure",
  "asset_gen_icon",
  "asset_gen_model",
  "asset_gen_sprite",
  "asset_gen_texture",
].sort();
const NETWORK_ONLY = ["backend_configure", "backend_detect"].sort();
const ALL_PRIVILEGED = [...CODE_EXEC_ONLY, ...NETWORK_ONLY].sort();

/**
 * Register the entire surface exactly as index.ts does — applyOutputSchemas, then
 * applyCapabilities(enabled), then every register*Tools — against a recorder, so
 * a disabled group's tools are dropped before they reach the recorder.
 */
function registerWith(tokens: string[] | null) {
  const calls: Array<{ name: string }> = [];
  const server = {
    registerTool(name: string) {
      calls.push({ name });
      return { name };
    },
    registerResource() {},
    experimental: {
      tasks: {
        registerToolTask(name: string) {
          calls.push({ name });
          return { name };
        },
      },
    },
    server: { elicitInput: async () => ({ action: "decline" }) },
  };
  const mcp = server as unknown as Parameters<typeof applyOutputSchemas>[0];
  const stub = {} as unknown as never;
  const cfg = loadConfig();

  applyOutputSchemas(mcp);
  applyCapabilities(mcp, selectPrivilegedGroups(tokens));
  const toolsets = buildToolsets({
    server: mcp,
    bridge: stub,
    runtime: stub,
    lsp: stub,
    csLsp: stub,
    dap: stub,
    csDap: stub,
    config: cfg,
  });
  for (const ts of toolsets) ts.run();
  return calls.map((c) => c.name);
}

test("secure default (no groups) drops exactly the 14 privileged tools → 262", () => {
  const names = registerWith(null);
  assert.equal(names.length, FULL_TOOL_COUNT - ALL_PRIVILEGED.length);
  assert.equal(names.length, 262);
  const present = new Set(names);
  for (const t of ALL_PRIVILEGED) assert.ok(!present.has(t), `${t} should be dropped by default`);
});

test("enabling both groups (or 'all') restores the full 276-tool surface", () => {
  assert.equal(registerWith(["code-execution", "network"]).length, FULL_TOOL_COUNT);
  assert.equal(registerWith(["all"]).length, FULL_TOOL_COUNT);
});

test("code-execution only keeps everything except the network-only tools (274)", () => {
  const names = registerWith(["code-execution"]);
  assert.equal(names.length, FULL_TOOL_COUNT - NETWORK_ONLY.length);
  const present = new Set(names);
  for (const t of NETWORK_ONLY) assert.ok(!present.has(t), `${t} needs the network group`);
  for (const t of CODE_EXEC_ONLY) assert.ok(present.has(t), `${t} should be present`);
});

test("network only keeps everything except the pure code-execution tools (264)", () => {
  const names = registerWith(["network"]);
  assert.equal(names.length, FULL_TOOL_COUNT - CODE_EXEC_ONLY.length);
  const present = new Set(names);
  for (const t of CODE_EXEC_ONLY) assert.ok(!present.has(t), `${t} needs the code-execution group`);
  for (const t of NETWORK_ONLY) assert.ok(present.has(t), `${t} should be present`);
});

test("every tagged tool is a real tool in the full surface (no stale capability tags)", () => {
  const full = new Set(registerWith(["all"]));
  const stale = Object.keys(TOOL_CAPABILITIES).filter((n) => !full.has(n));
  assert.deepEqual(stale, [], `capability tags reference unregistered tools: ${stale.join(", ")}`);
});

test("droppedTools reports the right set per enabled-group combination", () => {
  assert.deepEqual(droppedTools(selectPrivilegedGroups(null)), ALL_PRIVILEGED);
  assert.deepEqual(droppedTools(selectPrivilegedGroups(["code-execution"])), NETWORK_ONLY);
  assert.deepEqual(droppedTools(selectPrivilegedGroups(["network"])), CODE_EXEC_ONLY);
  assert.deepEqual(droppedTools(selectPrivilegedGroups(["all"])), []);
});

test("parse + select: unset → none; unknown tokens reported and ignored; 'all' expands", () => {
  assert.equal(parsePrivilegedGroups(undefined), null);
  assert.deepEqual(parsePrivilegedGroups("code-execution, network"), ["code-execution", "network"]);
  assert.equal(selectPrivilegedGroups(null).size, 0);

  const unknown: string[] = [];
  const set = selectPrivilegedGroups(["code-execution", "bogus"], (u) => unknown.push(...u));
  assert.deepEqual([...set], ["code-execution"]);
  assert.deepEqual(unknown, ["bogus"]);

  assert.deepEqual([...selectPrivilegedGroups(["all"])].sort(), [...CAPABILITY_GROUPS].sort());
});

test("untagged tools are always allowed; tagged tools require their group", () => {
  const none = selectPrivilegedGroups(null);
  assert.ok(toolAllowed("node_add", none), "an unprivileged tool is always allowed");
  assert.ok(!toolAllowed("godot_run_headless_script", none), "a code-execution tool is off by default");
  assert.ok(toolAllowed("godot_run_headless_script", selectPrivilegedGroups(["code-execution"])));
});

test("the capabilities resource reports group state, dropped tools, and how to enable", async () => {
  const registered: Array<{ name: string; uri: string; handler: (u: { href: string }) => Promise<unknown> }> = [];
  const server = {
    registerResource(name: string, uri: string, _meta: unknown, handler: (u: { href: string }) => Promise<unknown>) {
      registered.push({ name, uri, handler });
    },
  } as unknown as Parameters<typeof registerCapabilitiesResource>[0];

  registerCapabilitiesResource(server, selectPrivilegedGroups(null));
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "capabilities");
  assert.equal(registered[0].uri, "godot://capabilities");

  const res = (await registered[0].handler({ href: "godot://capabilities" })) as {
    contents: Array<{ text: string }>;
  };
  const payload = JSON.parse(res.contents[0].text) as {
    default_secure: boolean;
    enabled_groups: string[];
    dropped_tools: string[];
    how_to_enable: string;
    groups: Array<{ id: string; enabled: boolean; tools: string[] }>;
  };
  assert.equal(payload.default_secure, true);
  assert.deepEqual(payload.enabled_groups, []);
  assert.deepEqual(payload.dropped_tools, ALL_PRIVILEGED);
  assert.match(payload.how_to_enable, /BREAKPOINT_PRIVILEGED_GROUPS/);
  assert.deepEqual(
    payload.groups.map((g) => g.id).sort(),
    [...CAPABILITY_GROUPS].sort(),
  );
  for (const g of payload.groups) assert.equal(g.enabled, false);
});
