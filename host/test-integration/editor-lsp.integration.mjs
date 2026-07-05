// Editor/LSP-plane integration smoke (EXPERIMENTAL) — connects to a REAL running
// Godot editor's built-in GDScript language server (LSP, :6005) and verifies the
// initialize handshake succeeds. Requires the editor to be up (booted under Xvfb
// by the workflow) with GODOT_PROJECT set.
//
// This is the harder half of the integration story (it needs a live editor GUI),
// so the workflow runs it under `continue-on-error` while the GUI-boot timing is
// tuned on real runners. Exits non-zero if it cannot reach the language server.
import { LspClient } from "../dist/lsp.js";
import { loadConfig } from "../dist/config.js";

const cfg = loadConfig();
console.log(`LSP target ${cfg.lspHost}:${cfg.lspPort}  project=${cfg.projectPath}`);

const lsp = new LspClient(cfg.lspHost, cfg.lspPort, cfg.projectUri, 20000);
try {
  const caps = await lsp.getServerCapabilities();
  console.log("initialize OK — server capabilities:", Object.keys(caps).sort().join(", ") || "(none advertised)");
  // A build with a language server should at least advertise text-doc sync.
  console.log("✔ editor/LSP-plane reached the live language server");
} catch (err) {
  console.error("✘ could not reach the language server:", err?.message ?? String(err));
  process.exitCode = 1;
} finally {
  lsp.close();
}
