// C#/LSP-plane integration probe (EXPERIMENTAL, D4 C2) — spawns a REAL OmniSharp
// over stdio (via the host's own StdioChannel) against the example-csharp fixture
// and live-exercises the cs_* tools. It (1) verifies the initialize handshake
// succeeds — the gate — then (2) runs a best-effort probe bank whose output is
// logged with grep-able markers (C#_LSP_REACHED / C#_LSP_CAPS / PROBE …). Probe
// failures are never fatal; only an unreachable/unspawnable language server fails.
//
// Requires a restored example-csharp project (the job runs `dotnet restore/build`
// first so OmniSharp's design-time build is warm) and OmniSharp resolvable via
// GODOT_CSLSP_CMD, with GODOT_CSHARP_PROJECT pointing at the fixture.
import { CsLspClient } from "../dist/cslsp.js";
import { StdioChannel } from "../dist/stdio.js";
import { loadConfig } from "../dist/config.js";
import { registerCsLspTools } from "../dist/tools/cslsp.js";

const cfg = loadConfig();
console.log(`C# LSP: cmd='${cfg.csLspCmd} ${cfg.csLspArgs.join(" ")}'  project=${cfg.csLspProjectPath}`);

const channel = new StdioChannel(
  cfg.csLspCmd,
  cfg.csLspArgs,
  cfg.csLspProjectPath,
  "C# LSP (OmniSharp)",
  "Is OmniSharp installed and GODOT_CSLSP_CMD/GODOT_CSHARP_PROJECT set?",
);
const cslsp = new CsLspClient(channel, cfg.csLspProjectUri, 45000);

// Pull tool handlers out and call them directly — the same code path a real MCP
// client hits, without standing up a transport.
const tools = new Map();
const rec = {
  registerTool: (name, _config, handler) => tools.set(name, handler),
  registerResource: () => {},
  server: { elicitInput: async () => ({ action: "decline" }) },
};
registerCsLspTools(rec, cslsp, cfg);
const call = (name, args) => tools.get(name)(args, {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let reached = false;
try {
  const caps = await cslsp.getServerCapabilities();
  console.log("C#_LSP_REACHED: initialize OK — capabilities:", Object.keys(caps).sort().join(", ") || "(none advertised)");
  console.log(
    `C#_LSP_CAPS: hover=${!!caps.hoverProvider} definition=${!!caps.definitionProvider}` +
    ` references=${!!caps.referencesProvider} completion=${!!caps.completionProvider}` +
    ` documentSymbol=${!!caps.documentSymbolProvider} workspaceSymbol=${!!caps.workspaceSymbolProvider}` +
    ` signatureHelp=${!!caps.signatureHelpProvider}`,
  );
  reached = true;
} catch (err) {
  console.error("C#_LSP_UNREACHED: could not reach OmniSharp:", err?.message ?? String(err));
  process.exitCode = 1;
}

if (reached) {
  // OmniSharp loads the project + runs a design-time build asynchronously after
  // initialize; document symbols only resolve once that's done. Poll cs_document_symbols
  // (bounded) so the semantic probes below have a loaded workspace to hit.
  let symbolsSeen = 0;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await call("cs_document_symbols", { path: "res://Player.cs" });
      symbolsSeen = res.structuredContent?.symbols?.length ?? 0;
      if (symbolsSeen > 0) break;
    } catch { /* keep polling */ }
    await sleep(3000);
  }
  console.log(`C#_LSP_DOCSYMS: Player.cs symbols=${symbolsSeen} (after project load)`);

  // Player.cs fixture (0-based): `Counter` property decl at line 13 char 15;
  // `TakeDamage` decl at line 26 char 15; the `Counter` use in TakeDamage at line 29 char 8.
  const probes = [
    ["cs_hover", { path: "res://Player.cs", line: 13, character: 15 }, "contents"],
    ["cs_definition", { path: "res://Player.cs", line: 29, character: 8 }, "locations"],
    ["cs_references", { path: "res://Player.cs", line: 13, character: 15 }, "locations"],
    ["cs_completion", { path: "res://Player.cs", line: 29, character: 8 }, "items"],
    ["cs_workspace_symbols", { query: "Player" }, "symbols"],
    ["cs_signature_help", { path: "res://Player.cs", line: 30, character: 30 }, "signatures"],
    ["cs_diagnostics", { path: "res://Player.cs", wait_ms: 4000 }, "diagnostics"],
  ];
  for (const [name, args, field] of probes) {
    try {
      const res = await call(name, args);
      const detail = res.isError
        ? JSON.stringify(res.content?.[0]?.text ?? "").slice(0, 100)
        : field === "contents"
          ? `contents.len=${(res.structuredContent?.contents ?? "").length}`
          : `${field}=${res.structuredContent?.[field]?.length ?? "-"}`;
      console.log(`C#_LSP PROBE ${name}: isError=${!!res.isError} ${detail}`);
    } catch (err) {
      console.log(`C#_LSP PROBE ${name} threw`, err?.message ?? String(err));
    }
  }
  // Headline acceptance marker: did the two core semantic ops resolve live?
  try {
    const hov = await call("cs_hover", { path: "res://Player.cs", line: 13, character: 15 });
    const def = await call("cs_definition", { path: "res://Player.cs", line: 29, character: 8 });
    const hoverOk = !hov.isError && (hov.structuredContent?.contents ?? "").length > 0;
    const defOk = !def.isError && (def.structuredContent?.locations?.length ?? 0) > 0;
    console.log(`C#_LSP_SEMANTIC_OK: hover=${hoverOk} definition=${defOk}`);
  } catch (err) {
    console.log("C#_LSP_SEMANTIC probe threw", err?.message ?? String(err));
  }
}

cslsp.close();
