import { test } from "node:test";
import assert from "node:assert/strict";
import { registerCliTools } from "../src/tools/cli.js";
import { registerEditorTools } from "../src/tools/editor.js";
import { registerLspTools } from "../src/tools/lsp.js";
import { registerCsLspTools } from "../src/tools/cslsp.js";
import { registerDapTools } from "../src/tools/dap.js";
import { registerCsDapTools } from "../src/tools/csdap.js";
import { registerRuntimeTools } from "../src/tools/runtime.js";
import { registerProcessTools } from "../src/tools/processes.js";
import { registerResources } from "../src/tools/resources.js";
import { applyOutputSchemas, outputSchemas } from "../src/schemas.js";
import { loadConfig } from "../src/config.js";

/** Tools that return image content with no structuredContent — deliberately schema-exempt. */
const IMAGE_TOOLS = ["screenshot_editor", "runtime_screenshot"];
const EXPECTED_TOOL_COUNT = 144;
const EXPECTED_RESOURCES = ["scene-tree", "editor-state", "runtime-tree", "runtime-log", "class-doc"];

/**
 * Register the entire surface exactly as index.ts does — applyOutputSchemas first,
 * then every register*Tools — but against a recorder, so we can assert the whole
 * contract at once. Handlers are never invoked, so stub clients are fine.
 */
function registerAll() {
  const calls: Array<{ name: string; config: Record<string, unknown> }> = [];
  const resources: string[] = [];
  const server = {
    registerTool(name: string, config: Record<string, unknown>) { calls.push({ name, config }); return { name }; },
    registerResource(name: string) { resources.push(name); },
    // D2 task-model tools register through server.experimental.tasks.registerToolTask;
    // record them into the same list so the whole surface is asserted at once.
    experimental: {
      tasks: {
        registerToolTask(name: string, config: Record<string, unknown>) { calls.push({ name, config }); return { name }; },
      },
    },
    server: { elicitInput: async () => ({ action: "decline" }) },
  };

  const mcp = server as unknown as Parameters<typeof registerCliTools>[0];
  const stub = {} as unknown as never;
  const cfg = loadConfig();

  applyOutputSchemas(mcp); // wraps registerTool to inject frozen output schemas
  registerCliTools(mcp, cfg);
  registerEditorTools(mcp, stub);
  registerLspTools(mcp, stub, cfg);
  registerCsLspTools(mcp, stub, cfg);
  registerDapTools(mcp, stub, cfg);
  registerCsDapTools(mcp, stub, cfg);
  registerRuntimeTools(mcp, stub);
  registerProcessTools(mcp, cfg);
  registerResources(mcp, stub, stub);

  return { calls, resources };
}

test("every registered tool name is unique", () => {
  const { calls } = registerAll();
  const names = calls.map((c) => c.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(dupes, [], `duplicate tool names: ${dupes.join(", ")}`);
});

test(`the full surface registers exactly ${EXPECTED_TOOL_COUNT} tools and 5 resources`, () => {
  const { calls, resources } = registerAll();
  assert.equal(calls.length, EXPECTED_TOOL_COUNT);
  assert.deepEqual(resources.sort(), [...EXPECTED_RESOURCES].sort());
});

test("every tool declares an inputSchema", () => {
  const { calls } = registerAll();
  const missing = calls.filter((c) => c.config.inputSchema === undefined).map((c) => c.name);
  assert.deepEqual(missing, [], `tools missing inputSchema: ${missing.join(", ")}`);
});

test("every non-image tool gets an enforced outputSchema; the two image tools get none", () => {
  const { calls } = registerAll();
  const withoutOutput = calls.filter((c) => c.config.outputSchema === undefined).map((c) => c.name).sort();
  assert.deepEqual(withoutOutput, [...IMAGE_TOOLS].sort(),
    `only the image tools may lack an outputSchema; got: ${withoutOutput.join(", ")}`);
});

test("outputSchemas has no stale entries (every schema maps to a real registered tool)", () => {
  const { calls } = registerAll();
  const registered = new Set(calls.map((c) => c.name));
  const stale = Object.keys(outputSchemas).filter((n) => !registered.has(n));
  assert.deepEqual(stale, [], `outputSchemas references unregistered tools: ${stale.join(", ")}`);
});

test("output-schema count equals tools minus the image tools", () => {
  const { calls } = registerAll();
  assert.equal(Object.keys(outputSchemas).length, calls.length - IMAGE_TOOLS.length);
});

test("the image tools are actually present in the surface", () => {
  const { calls } = registerAll();
  const names = new Set(calls.map((c) => c.name));
  for (const t of IMAGE_TOOLS) assert.ok(names.has(t), `${t} should be registered`);
});
