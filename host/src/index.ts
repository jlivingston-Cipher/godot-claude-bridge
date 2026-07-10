#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { BridgeClient } from "./bridge.js";
import { LspClient } from "./lsp.js";
import { CsLspClient } from "./cslsp.js";
import { CsDapClient } from "./csdap.js";
import { StdioChannel } from "./stdio.js";
import { DapClient } from "./dap.js";
import { registerCliTools } from "./tools/cli.js";
import { registerEditorTools } from "./tools/editor.js";
import { registerLspTools } from "./tools/lsp.js";
import { registerCsLspTools } from "./tools/cslsp.js";
import { registerDapTools } from "./tools/dap.js";
import { registerCsDapTools } from "./tools/csdap.js";
import { registerRuntimeTools } from "./tools/runtime.js";
import { registerProcessTools } from "./tools/processes.js";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerAssetGenTools } from "./tools/assetgen.js";
import { registerNetcodeTools } from "./tools/netcode.js";
import { registerBackendTools } from "./tools/backend.js";
import { registerResources } from "./tools/resources.js";
import { applyOutputSchemas } from "./schemas.js";
import { taskStore, TASK_CAPABILITIES } from "./tasks.js";
import { RESOURCE_CAPABILITIES, registerResourceSubscriptions } from "./subscriptions.js";
import { log } from "./logger.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const bridge = new BridgeClient(config.bridgeHost, config.bridgePort, config.bridgeTimeoutMs);
  const runtime = new BridgeClient(
    config.runtimeHost,
    config.runtimePort,
    config.runtimeTimeoutMs,
    "runtime bridge",
    "Is the project running? Launch it (godot_run_project or dbg_launch) with the Breakpoint MCP plugin enabled — it auto-registers the runtime autoload.",
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
    { name: "breakpoint-mcp", version: "1.1.0" },
    { capabilities: { ...TASK_CAPABILITIES, ...RESOURCE_CAPABILITIES }, taskStore },
  );

  // B1: enforce frozen output schemas on every structured tool. Must run before
  // the register*Tools calls below — it wraps server.registerTool.
  applyOutputSchemas(server);

  // Plane B (headless CLI): works without the editor running.
  registerCliTools(server, config);
  // Plane A (live editor): requires the editor open with the Breakpoint MCP plugin.
  registerEditorTools(server, bridge);
  // Plane D (semantic): connects to Godot's GDScript language server (LSP, 6005).
  registerLspTools(server, lsp, config);
  // Plane D (C# semantic, D4 C2): drives OmniSharp over stdio for the cs_* tools.
  registerCsLspTools(server, csLsp, config);
  // Plane D (debugging): connects to Godot's Debug Adapter (DAP, 6006).
  registerDapTools(server, dap, config);
  // Plane D (C# debugging, D4 C3): drives netcoredbg over stdio for the cs_dbg_* tools.
  registerCsDapTools(server, csDap, config);
  // Plane C (runtime): connects to the in-game runtime autoload (9081).
  registerRuntimeTools(server, runtime);
  // Phase 4: managed run + captured console output (transparent print() logs).
  const processes = registerProcessTools(server, config);
  // Group K: host-side knowledge & search (project grep, symbol/usage index, idiom lookup).
  registerKnowledgeTools(server, config);
  // Group J: AI asset generation (delegated backend / connected client; degrades
  // to a request spec when no backend is configured). Writes + imports via the bridge.
  registerAssetGenTools(server, bridge, config);
  // Group M: native multiplayer & backend scaffolding (mp_*). Pure authoring —
  // undoable node ops (spawner/synchronizer/authority) + gated GDScript codegen
  // (enet/webrtc peer, @rpc wiring, lobby). Hosts nothing; scaffolds everything.
  registerNetcodeTools(server, bridge, config);
  // Group M (second half): backend-SDK integration scaffolding (backend_* / *_scaffold).
  // Detects the installed SDK (SilentWolf/Nakama/PlayFab/Photon) and generates gated
  // GDScript against it; degrades cleanly when the SDK is absent or lacks the feature.
  registerBackendTools(server, bridge, config);
  // Phase 4: MCP resources (scene tree, editor state, runtime tree/log, ClassDB docs).
  registerResources(server, bridge, runtime);
  // D3: resource subscriptions — push notifications/resources/updated when a
  // subscribed godot://… resource changes (editor selection / edited scene, or
  // the running game's live SceneTree). Rapid changes are coalesced per-URI; the
  // trailing window is overridable via BREAKPOINT_RESOURCE_COALESCE_MS.
  const coalesceRaw = process.env.BREAKPOINT_RESOURCE_COALESCE_MS;
  const coalesceMs = coalesceRaw ? Number.parseInt(coalesceRaw, 10) : undefined;
  registerResourceSubscriptions(server, bridge, runtime, undefined, { coalesceMs });

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
    processes.killAll();
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
