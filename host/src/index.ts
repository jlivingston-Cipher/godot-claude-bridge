#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { BridgeClient } from "./bridge.js";
import { LspClient } from "./lsp.js";
import { DapClient } from "./dap.js";
import { registerCliTools } from "./tools/cli.js";
import { registerEditorTools } from "./tools/editor.js";
import { registerLspTools } from "./tools/lsp.js";
import { registerDapTools } from "./tools/dap.js";
import { registerRuntimeTools } from "./tools/runtime.js";
import { registerProcessTools } from "./tools/processes.js";
import { registerResources } from "./tools/resources.js";
import { applyOutputSchemas } from "./schemas.js";
import { log } from "./logger.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const bridge = new BridgeClient(config.bridgeHost, config.bridgePort, config.bridgeTimeoutMs);
  const runtime = new BridgeClient(
    config.runtimeHost,
    config.runtimePort,
    config.runtimeTimeoutMs,
    "runtime bridge",
    "Is the project running? Launch it (godot_run_project or dbg_launch) with the Claude Bridge plugin enabled — it auto-registers the runtime autoload.",
  );
  const lsp = new LspClient(config.lspHost, config.lspPort, config.projectUri, config.lspTimeoutMs);
  const dap = new DapClient(config.dapHost, config.dapPort, config.dapTimeoutMs);

  const server = new McpServer({ name: "godot-claude-bridge", version: "0.4.3" });

  // B1: enforce frozen output schemas on every structured tool. Must run before
  // the register*Tools calls below — it wraps server.registerTool.
  applyOutputSchemas(server);

  // Plane B (headless CLI): works without the editor running.
  registerCliTools(server, config);
  // Plane A (live editor): requires the editor open with the Claude Bridge plugin.
  registerEditorTools(server, bridge);
  // Plane D (semantic): connects to Godot's GDScript language server (LSP, 6005).
  registerLspTools(server, lsp, config);
  // Plane D (debugging): connects to Godot's Debug Adapter (DAP, 6006).
  registerDapTools(server, dap, config);
  // Plane C (runtime): connects to the in-game runtime autoload (9081).
  registerRuntimeTools(server, runtime);
  // Phase 4: managed run + captured console output (transparent print() logs).
  const processes = registerProcessTools(server, config);
  // Phase 4: MCP resources (scene tree, editor state, runtime tree/log, ClassDB docs).
  registerResources(server, bridge, runtime);

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
    dap.close();
    processes.killAll();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log("fatal:", err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
