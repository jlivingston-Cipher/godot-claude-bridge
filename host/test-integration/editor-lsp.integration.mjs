// Editor/LSP-plane integration smoke (EXPERIMENTAL) — connects to a REAL running
// Godot editor's built-in GDScript language server (LSP, :6005). It (1) verifies
// the initialize handshake succeeds — the gate — then (2) runs a best-effort probe
// bank that live-exercises the newer LSP tools and answers backlog item D7: does
// this Godot build actually RETURN results from workspace/symbol, or does it only
// advertise the capability and then reply -32601? Probe output is logged with
// grep-able markers (D7_CAPS / D7_WS_RAW / D7_WS_TOOL / PROBE …); probe failures
// are never fatal — only an unreachable language server fails the job.
//
// Requires the editor up (booted under Xvfb by the workflow) with GODOT_PROJECT set.
import { LspClient } from "../dist/lsp.js";
import { loadConfig } from "../dist/config.js";
import { registerLspTools } from "../dist/tools/lsp.js";

const cfg = loadConfig();
console.log(`LSP target ${cfg.lspHost}:${cfg.lspPort}  project=${cfg.projectPath}`);

const lsp = new LspClient(cfg.lspHost, cfg.lspPort, cfg.projectUri, 20000);

// A tiny recording server so we can pull tool handlers out and call them directly
// (the same code path a real MCP client hits), without standing up a transport.
const tools = new Map();
const rec = {
  registerTool: (name, _config, handler) => tools.set(name, handler),
  registerResource: () => {},
  server: { elicitInput: async () => ({ action: "decline" }) },
};
registerLspTools(rec, lsp, cfg);
const call = (name, args) => tools.get(name)(args, {});

let reached = false;
try {
  const caps = await lsp.getServerCapabilities();
  console.log("initialize OK — server capabilities:", Object.keys(caps).sort().join(", ") || "(none advertised)");
  console.log(`D7_CAPS: workspaceSymbolProvider=${!!caps.workspaceSymbolProvider} signatureHelpProvider=${!!caps.signatureHelpProvider} codeActionProvider=${!!caps.codeActionProvider}`);
  console.log("✔ editor/LSP-plane reached the live language server");
  reached = true;
} catch (err) {
  console.error("✘ could not reach the language server:", err?.message ?? String(err));
  process.exitCode = 1;
}

// ---- Best-effort probes (log-only; skipped if the server was unreachable) --
if (reached) {
  // D7 ground truth: raw workspace/symbol tells us results-vs-(-32601); the tool
  // wrapper tells us the user-facing behavior this build produces.
  for (const query of ["_ready", "take_damage", ""]) {
    try {
      const raw = await lsp.request("workspace/symbol", { query });
      const n = Array.isArray(raw) ? raw.length : raw == null ? 0 : 1;
      console.log(`D7_WS_RAW: query=${JSON.stringify(query)} -> results=${n}`);
    } catch (err) {
      console.log(`D7_WS_RAW: query=${JSON.stringify(query)} -> error code=${err?.code ?? "?"} msg=${err?.message ?? String(err)}`);
    }
  }
  try {
    const res = await call("gd_workspace_symbols", { query: "_ready" });
    console.log(`D7_WS_TOOL: isError=${!!res.isError} ${res.isError ? JSON.stringify(res.content?.[0]?.text ?? "") : "symbols=" + (res.structuredContent?.symbols?.length ?? 0)}`);
  } catch (err) {
    console.log("D7_WS_TOOL: threw", err?.message ?? String(err));
  }

  // Live-smoke the two new LSP-depth tools against the real server.
  try {
    const res = await call("gd_signature_help", { path: "res://player.gd", line: 13, character: 32 });
    console.log(`PROBE gd_signature_help: isError=${!!res.isError} signatures=${res.structuredContent?.signatures?.length ?? "-"}`);
  } catch (err) {
    console.log("PROBE gd_signature_help threw", err?.message ?? String(err));
  }
  try {
    const res = await call("gd_code_action", { path: "res://player.gd", start_line: 25, start_character: 0, end_line: 25, end_character: 18 });
    console.log(`PROBE gd_code_action: isError=${!!res.isError} actions=${res.structuredContent?.actions?.length ?? "-"}`);
  } catch (err) {
    console.log("PROBE gd_code_action threw", err?.message ?? String(err));
  }

  // Phase-1 LSP-depth: does this build actually RETURN results from the newer
  // read-only providers, or only advertise them (the D7 workspace/symbol trap)?
  // The tool wrappers are capability-gated, so an advertised-but-unimplemented
  // provider shows up as isError:"unsupported" here rather than crashing the probe.
  const navCaps = await lsp.getServerCapabilities();
  console.log(
    `D7_CAPS2: documentHighlight=${!!navCaps.documentHighlightProvider} foldingRange=${!!navCaps.foldingRangeProvider}` +
    ` typeDefinition=${!!navCaps.typeDefinitionProvider} implementation=${!!navCaps.implementationProvider}` +
    ` declaration=${!!navCaps.declarationProvider} documentLink=${!!navCaps.documentLinkProvider}` +
    ` formatting=${!!navCaps.documentFormattingProvider} color=${!!navCaps.colorProvider}`,
  );
  const navProbes = [
    ["gd_document_highlight", { path: "res://player.gd", line: 13, character: 8 }, "highlights"],
    ["gd_type_definition",    { path: "res://player.gd", line: 13, character: 8 }, "locations"],
    ["gd_implementation",     { path: "res://player.gd", line: 13, character: 8 }, "locations"],
    ["gd_declaration",        { path: "res://player.gd", line: 13, character: 8 }, "locations"],
    ["gd_folding_ranges",     { path: "res://player.gd" }, "ranges"],
    ["gd_document_link",      { path: "res://player.gd" }, "links"],
    ["gd_formatting",         { path: "res://player.gd" }, null],
    ["gd_document_color",     { path: "res://player.gd" }, "colors"],
  ];
  for (const [name, args, field] of navProbes) {
    try {
      const res = await call(name, args);
      const detail = res.isError
        ? JSON.stringify(res.content?.[0]?.text ?? "").slice(0, 90)
        : field
          ? `${field}=${res.structuredContent?.[field]?.length ?? "-"}`
          : `edit_count=${res.structuredContent?.edit_count ?? "-"}`;
      console.log(`PROBE ${name}: isError=${!!res.isError} ${detail}`);
    } catch (err) {
      console.log(`PROBE ${name} threw`, err?.message ?? String(err));
    }
  }
}

lsp.close();
