import { test } from "node:test";
import assert from "node:assert/strict";
import { buildToolsets } from "../src/toolsets.js";
import { applyOutputSchemas } from "../src/schemas.js";
import { loadConfig, selectToolsets, parseToolsets, TOOLSET_ALIASES } from "../src/config.js";

const EXPECTED_TOOL_COUNT = 276;

/** A recording server that captures registered tool names. */
function recorder() {
  const calls: string[] = [];
  const resources: string[] = [];
  const server = {
    registerTool(name: string, _config: Record<string, unknown>) { calls.push(name); return { name }; },
    registerResource(name: string) { resources.push(name); },
    experimental: {
      tasks: {
        registerToolTask(name: string, _config: Record<string, unknown>) { calls.push(name); return { name }; },
      },
    },
    server: { elicitInput: async () => ({ action: "decline" }) },
  };
  return { calls, resources, server };
}

/** applyOutputSchemas + build the toolset registry against a recorder (nothing run yet). */
function build(rec: ReturnType<typeof recorder>) {
  const mcp = rec.server as unknown as Parameters<typeof applyOutputSchemas>[0];
  const stub = {} as unknown as never;
  applyOutputSchemas(mcp);
  return buildToolsets({
    server: mcp, bridge: stub, runtime: stub, lsp: stub, csLsp: stub, dap: stub, csDap: stub, config: loadConfig(),
  });
}

const ALL_IDS = [
  "cli", "editor", "lsp", "cslsp", "dap", "csdap", "runtime",
  "processes", "knowledge", "vcs", "assetgen", "netcode", "backend", "tabletop", "resources",
];

// --- parseToolsets ----------------------------------------------------------
test("parseToolsets: unset -> null (full surface)", () => {
  assert.equal(parseToolsets(undefined), null);
});
test("parseToolsets: empty / separators-only -> null", () => {
  assert.equal(parseToolsets(""), null);
  assert.equal(parseToolsets("  , ,  "), null);
});
test("parseToolsets: comma/space list -> lower-cased tokens", () => {
  assert.deepEqual(parseToolsets("Runtime, editor  vcs"), ["runtime", "editor", "vcs"]);
});

// --- selectToolsets ---------------------------------------------------------
test("selectToolsets: null -> every id", () => {
  assert.deepEqual([...selectToolsets(ALL_IDS, null)].sort(), [...ALL_IDS].sort());
});
test("selectToolsets: plane aliases expand to ids", () => {
  assert.deepEqual([...selectToolsets(ALL_IDS, ["c"])], ["runtime"]);
  assert.deepEqual([...selectToolsets(ALL_IDS, ["d"])].sort(), ["cslsp", "csdap", "dap", "lsp"].sort());
  assert.deepEqual([...selectToolsets(ALL_IDS, ["a", "b"])].sort(), ["cli", "editor"].sort());
  assert.deepEqual([...selectToolsets(ALL_IDS, ["csharp"])].sort(), ["csdap", "cslsp"].sort());
});
test("selectToolsets: unknown tokens are reported and dropped", () => {
  const bad: string[] = [];
  const sel = selectToolsets(ALL_IDS, ["runtime", "bogus"], (u) => bad.push(...u));
  assert.deepEqual([...sel], ["runtime"]);
  assert.deepEqual(bad, ["bogus"]);
});
test("selectToolsets: an all-unknown filter falls back to the full surface", () => {
  assert.deepEqual([...selectToolsets(ALL_IDS, ["nope"])].sort(), [...ALL_IDS].sort());
});
test("selectToolsets: the 'all' keyword -> full surface", () => {
  assert.deepEqual([...selectToolsets(ALL_IDS, ["all"])].sort(), [...ALL_IDS].sort());
});

// --- registry integrity -----------------------------------------------------
test("registry ids match the hard-coded ALL_IDS (in order)", () => {
  assert.deepEqual(build(recorder()).map((t) => t.id), ALL_IDS);
});
test("every alias target names a real toolset id", () => {
  const ids = new Set(build(recorder()).map((t) => t.id));
  for (const [alias, targets] of Object.entries(TOOLSET_ALIASES))
    for (const t of targets) assert.ok(ids.has(t), `alias '${alias}' -> unknown id '${t}'`);
});

// --- the key property: toolsets partition the whole surface -----------------
test("toolsets partition the full 276-tool surface (disjoint + lossless)", () => {
  const full = recorder();
  for (const ts of build(full)) ts.run();
  assert.equal(full.calls.length, EXPECTED_TOOL_COUNT);

  let sum = 0;
  const seen = new Set<string>();
  for (const id of ALL_IDS) {
    const rec = recorder();
    for (const ts of build(rec)) if (ts.id === id) ts.run();
    sum += rec.calls.length;
    for (const n of rec.calls) {
      assert.ok(!seen.has(n), `tool '${n}' is registered by more than one toolset`);
      seen.add(n);
    }
  }
  assert.equal(sum, EXPECTED_TOOL_COUNT, "sum of per-toolset tool counts must equal the full surface");
  assert.deepEqual([...seen].sort(), [...full.calls].sort());
});

// --- a couple of concrete subset sizes (guards against accidental empties) ---
test("runtime-only and plane-D selections register a non-empty, smaller surface", () => {
  const countFor = (ids: string[]) => {
    const rec = recorder();
    const enabled = new Set(ids);
    for (const ts of build(rec)) if (enabled.has(ts.id)) ts.run();
    return rec.calls.length;
  };
  const runtimeN = countFor(["runtime"]);
  const planeDN = countFor([...TOOLSET_ALIASES.d]);
  assert.ok(runtimeN > 0 && runtimeN < EXPECTED_TOOL_COUNT, `runtime-only = ${runtimeN}`);
  assert.ok(planeDN > 0 && planeDN < EXPECTED_TOOL_COUNT, `plane-D = ${planeDN}`);
  assert.ok(planeDN > runtimeN, "plane D (4 groups) should exceed runtime alone");
});
