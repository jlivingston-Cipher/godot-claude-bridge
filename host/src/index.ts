#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, selectToolsets } from "./config.js";
import { BridgeClient } from "./bridge.js";
import { resolveBridgeSecret } from "./secret.js";
import { LspClient } from "./lsp.js";
import { CsLspClient } from "./cslsp.js";
import { CsDapClient } from "./csdap.js";
import { StdioChannel } from "./stdio.js";
import { DapClient } from "./dap.js";
import { buildToolsets } from "./toolsets.js";
import { registerRecipes } from "./recipes.js";
import { applyOutputSchemas } from "./schemas.js";
import {
  applyCapabilities,
  droppedTools,
  registerCapabilitiesResource,
  selectPrivilegedGroups,
} from "./capabilities.js";
import { taskStore, TASK_CAPABILITIES } from "./tasks.js";
import { RESOURCE_CAPABILITIES, registerResourceSubscriptions } from "./subscriptions.js";
import { pauseLatch, installPauseSignalHandlers } from "./pause.js";
import { log } from "./logger.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const bridge = new BridgeClient(
    config.bridgeHost,
    config.bridgePort,
    config.bridgeTimeoutMs,
    "editor bridge",
    undefined,
    () => resolveBridgeSecret(config.projectPath, ["BREAKPOINT_BRIDGE_SECRET"]),
  );
  const runtime = new BridgeClient(
    config.runtimeHost,
    config.runtimePort,
    config.runtimeTimeoutMs,
    "runtime bridge",
    "Is the project running? Launch it (godot_run_project or dbg_launch) with the Breakpoint MCP plugin enabled — it auto-registers the runtime autoload.",
    () => resolveBridgeSecret(config.projectPath, ["BREAKPOINT_RUNTIME_SECRET", "BREAKPOINT_BRIDGE_SECRET"]),
  );
  const lsp = new LspClient(config.lspHost, config.lspPort, config.projectUri, config.lspTimeoutMs);
  // D4 C2: the C# semantic plane. OmniSharp is spawned over stdio (lazily, on the
  // first cs_* call) against the C# project root — so a host without OmniSharp
  // installed starts and runs the other planes unaffected.
  const csLsp = new CsLspClient(
    new StdioChannel(
      config.csLspCmd,
      config.csLspArgs,
      config.csLspProjectPath,
      "C# LSP (OmniSharp)",
      "Is OmniSharp installed and on PATH (or set GODOT_CSLSP_CMD to its binary), and GODOT_CSHARP_PROJECT pointed at a restored C# project?",
    ),
    config.csLspProjectUri,
    config.csLspTimeoutMs,
  );
  const dap = new DapClient(config.dapHost, config.dapPort, config.dapTimeoutMs);
  // D4 C3: the C# debugging plane. netcoredbg is spawned over stdio (lazily, on
  // the first cs_dbg_* call) — so a host without netcoredbg installed starts and
  // runs every other plane unaffected.
  const csDap = new CsDapClient(
    new StdioChannel(
      config.csDapCmd,
      config.csDapArgs,
      config.csDapProjectPath,
      "C# DAP (netcoredbg)",
      "Is netcoredbg installed and on PATH (or set GODOT_CSDAP_CMD to its binary), and GODOT_CSHARP_PROJECT pointed at a C# project?",
    ),
    config.csDapTimeoutMs,
  );

  // D2: advertise the MCP task-execution model and hand the SDK a task store,
  // so long jobs (export/import/headless script) support poll/await/cancel.
  // D3: also advertise resources.subscribe so clients can subscribe to
  // godot://… resources and receive notifications/resources/updated.
  const server = new McpServer(
    { name: "breakpoint-mcp", version: "1.20.0" },
    { capabilities: { ...TASK_CAPABILITIES, ...RESOURCE_CAPABILITIES }, taskStore },
  );

  // B1: enforce frozen output schemas on every structured tool. Must run before
  // any register*Tools call — it wraps server.registerTool.
  applyOutputSchemas(server);

  // Capability groups — a risk-based axis over the toolsets. Both `code-execution`
  // and `network` are OFF by default; a disabled group's tools are DROPPED at
  // registration (omitted from tools/list), so the secure-default surface is
  // 276 − 14 = 262 tools. Enable via BREAKPOINT_PRIVILEGED_GROUPS. Wraps
  // server.registerTool AFTER applyOutputSchemas (schema wrapper stays innermost).
  const privilegedGroups = selectPrivilegedGroups(config.privilegedGroups, (unknown) =>
    log(`ignoring unknown BREAKPOINT_PRIVILEGED_GROUPS token(s): ${unknown.join(", ")}`),
  );
  applyCapabilities(server, privilegedGroups);

  // The A/B/C/D planes ARE the grouping. Build the ordered toolset registry
  // (the single source of truth, shared with the registration tests) and
  // register only the selected groups. Default (BREAKPOINT_TOOLSETS unset) =
  // every group → the full 276-tool surface, byte-identical to before. A filter
  // lets a client that can't defer tools, or a user who wants a smaller default
  // menu, load only the planes a project needs (GitHub-MCP `--toolsets` style).
  let processes: { killAll: () => void } | undefined;
  const toolsets = buildToolsets({
    server,
    bridge,
    runtime,
    lsp,
    csLsp,
    dap,
    csDap,
    config,
    onProcesses: (h) => {
      processes = h;
    },
  });
  const enabled = selectToolsets(
    toolsets.map((t) => t.id),
    config.toolsets,
    (unknown) => log(`ignoring unknown BREAKPOINT_TOOLSETS token(s): ${unknown.join(", ")}`),
  );
  for (const ts of toolsets) if (enabled.has(ts.id)) ts.run();

  // D3: resource subscriptions — push notifications/resources/updated when a
  // subscribed godot://… resource changes (editor selection / edited scene, or
  // the running game's live SceneTree). Adds no tools (pure notification
  // plumbing), so it's wired here rather than as a toolset, gated on `resources`.
  // Rapid changes are coalesced per-URI; the trailing window is overridable via
  // BREAKPOINT_RESOURCE_COALESCE_MS.
  const coalesceRaw = process.env.BREAKPOINT_RESOURCE_COALESCE_MS;
  const coalesceMs = coalesceRaw ? Number.parseInt(coalesceRaw, 10) : undefined;
  if (enabled.has("resources")) {
    registerResourceSubscriptions(server, bridge, runtime, undefined, { coalesceMs });
  }
  if (config.toolsets) {
    log(`toolsets enabled: ${[...enabled].sort().join(", ")} (${enabled.size}/${toolsets.length} groups)`);
  }

  // Recipes: a free, curated task-recipe layer exposed as MCP prompts (discoverable
  // via prompts/list). Adds NO tools — the 276-tool count is unchanged — and drives
  // the enforced tools above, so it's a skill-pack layer over typed/undoable tools.
  registerRecipes(server);

  // Always-on capability affordance — never behind a toolset or a privileged
  // group — so the dropped high-trust tools are never a silent gap: an agent can
  // read godot://capabilities to see what exists-but-is-disabled and how to
  // enable it. Registered directly (not via the `resources` toolset).
  registerCapabilitiesResource(server, privilegedGroups);
  if (config.privilegedGroups) {
    const on = [...privilegedGroups].sort().join(", ") || "(none)";
    log(`privileged groups enabled: ${on}; dropped ${droppedTools(privilegedGroups).length} tool(s) from the surface`);
  }

  // Track 2 — global-pause latch (prototype). A coarse overlay on the destructive
  // gate: SIGUSR1 pauses, SIGUSR2 resumes; BREAKPOINT_START_PAUSED starts held.
  // Per-tool elicitation gating stays the lead control (see src/pause.ts).
  installPauseSignalHandlers();
  if (pauseLatch.isPaused()) {
    log("[pause] started PAUSED (BREAKPOINT_START_PAUSED) — send SIGUSR2 to resume");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log(
    `ready · godotBin=${config.godotBin} · project=${config.projectPath} · ` +
      `bridge=${config.bridgeHost}:${config.bridgePort} · runtime=${config.runtimeHost}:${config.runtimePort} · ` +
      `lsp=${config.lspHost}:${config.lspPort} · dap=${config.dapHost}:${config.dapPort}`,
  );

  const shutdown = () => {
    bridge.close();
    runtime.close();
    lsp.close();
    csLsp.close();
    dap.close();
    csDap.close();
    processes?.killAll();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function printUsage(): void {
  process.stdout.write(
    [
      "breakpoint-mcp — MCP server exposing Godot to AI coding assistants.",
      "",
      "Usage:",
      "  breakpoint-mcp             Start the MCP server on stdio (default; how MCP clients launch it).",
      "  breakpoint-mcp init        Install + enable the editor addon in a project and wire the MCP client.",
      "  breakpoint-mcp doctor      Check the Godot binary, the editor addon, and the four bridges.",
      "  breakpoint-mcp --help      Show this help.",
      "",
      "init options:",
      "  --project <dir>     Target Godot project (default: $GODOT_PROJECT or the current directory).",
      "  --client <id>       Write the MCP config for a client: claude-code | claude-desktop | cursor | windsurf | vscode.",
      "  --force             Overwrite an addon that is already installed.",
      "  --dry-run           Print what would change without writing anything.",
      "  --from-github [ref] Fetch the editor addon from GitHub at [ref] (default: this package's version tag) instead of the bundled copy.",
      "  --repo <owner/repo> With --from-github, the source repo (default: jlivingston-Cipher/godot-breakpoint-mcp).",
      "",
      "doctor options:",
      "  --project <dir>     Project to check (default: $GODOT_PROJECT or the current directory).",
      "  --require-live      Also require the editor/runtime/LSP/DAP bridges to be reachable.",
      "  --include-csharp    Also probe OmniSharp / netcoredbg on PATH (the C# planes).",
      "  --timeout <ms>      Per-bridge connect timeout (default 1500).",
      "  --json              Emit the report as JSON.",
      "",
      "All runtime configuration is via environment variables; see the README.",
      "",
    ].join("\n"),
  );
}

// Subcommand dispatch. Anything that isn't a recognized subcommand — including
// no arguments at all, which is how every MCP client launches this — falls
// through to the stdio server, so the server's launch contract is unchanged.
void (async () => {
  const sub = process.argv[2];
  if (sub === "doctor") {
    const { runDoctor } = await import("./cli/doctor.js");
    process.exit(await runDoctor(process.argv.slice(3)));
  }
  if (sub === "init") {
    const { runInit } = await import("./cli/init.js");
    process.exit(await runInit(process.argv.slice(3)));
  }
  if (sub === "help" || sub === "--help" || sub === "-h") {
    printUsage();
    process.exit(0);
  }
  await main();
})().catch((err) => {
  log("fatal:", err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
