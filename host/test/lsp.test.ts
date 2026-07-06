import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LspClient, LspError } from "../src/lsp.js";
import { registerLspTools } from "../src/tools/lsp.js";
import { loadConfig } from "../src/config.js";
import type { Config } from "../src/config.js";
import { makeRecordingServer, type ToolResultLike } from "./helpers/recording-server.js";
import { startTcpServer, makeFrameParser, writeFrame, waitFor, type TcpServer } from "./helpers/tcp.js";

interface LspMsg { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown }

interface MockOpts {
  capabilities?: Record<string, unknown>;
  onRequest?: (msg: LspMsg, socket: net.Socket) => void;
  onNotify?: (msg: LspMsg, socket: net.Socket) => void;
}

/** A mock Godot GDScript language server: answers `initialize`, delegates the rest. */
async function startLsp(opts: MockOpts): Promise<{ srv: TcpServer; received: LspMsg[] }> {
  const received: LspMsg[] = [];
  const srv = await startTcpServer((s) => {
    const parse = makeFrameParser((m) => {
      const msg = m as LspMsg;
      received.push(msg);
      if (msg.method === "initialize") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: { capabilities: opts.capabilities ?? {} } });
        return;
      }
      if (msg.method !== undefined && msg.id !== undefined) { opts.onRequest?.(msg, s); return; }
      if (msg.method !== undefined && msg.id === undefined) { opts.onNotify?.(msg, s); return; }
      // else: a response from the client to a server->client request — recorded only.
    });
    s.on("data", (c) => parse(Buffer.from(c)));
  });
  return { srv, received };
}

/** Full Config rooted at a real temp project dir. */
function makeConfig(projectPath: string): Config {
  const saved = process.env.GODOT_PROJECT;
  process.env.GODOT_PROJECT = projectPath;
  try { return loadConfig(); } finally {
    if (saved === undefined) delete process.env.GODOT_PROJECT; else process.env.GODOT_PROJECT = saved;
  }
}

function tmpProject(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcb-lsp-"));
  for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), content, "utf8");
  return dir;
}

function lspToolHarness(srvPort: number, projectPath: string, elicit?: Parameters<typeof makeRecordingServer>[0]) {
  const cfg = makeConfig(projectPath);
  const lsp = new LspClient("127.0.0.1", srvPort, cfg.projectUri, 3000);
  const rec = makeRecordingServer(elicit);
  registerLspTools(rec.server as unknown as Parameters<typeof registerLspTools>[0], lsp, cfg);
  return { lsp, rec, cfg };
}

test("gd_workspace_symbols returns 'unsupported' WITHOUT sending workspace/symbol when the server never advertised the capability", async () => {
  const projectPath = tmpProject();
  const { srv, received } = await startLsp({ capabilities: {} }); // no workspaceSymbolProvider
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_workspace_symbols")({ query: "Player" })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /unsupported/i);
  assert.ok(!received.some((m) => m.method === "workspace/symbol"), "must NOT send workspace/symbol when the capability is absent");
  lsp.close();
  await srv.close();
});

test("gd_workspace_symbols maps a -32601 reply to 'unsupported' (belt-and-suspenders for builds that lie about the capability)", async () => {
  const projectPath = tmpProject();
  const { srv } = await startLsp({
    capabilities: { workspaceSymbolProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "workspace/symbol") writeFrame(s, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_workspace_symbols")({ query: "Player" })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /unsupported/i);
  lsp.close();
  await srv.close();
});

test("gd_workspace_symbols returns mapped symbols on a build that supports it", async () => {
  const projectPath = tmpProject();
  const { srv } = await startLsp({
    capabilities: { workspaceSymbolProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "workspace/symbol") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: [{ name: "Player", kind: 5, location: { uri: "res://player.gd", range: { start: { line: 3, character: 0 } } } }] });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_workspace_symbols")({ query: "Player" })) as ToolResultLike;
  assert.equal(res.isError, undefined);
  assert.deepEqual(res.structuredContent, { symbols: [{ name: "Player", kind: "class", uri: "res://player.gd", line: 3 }] });
  lsp.close();
  await srv.close();
});

test("gd_document_symbols maps LSP SymbolKind numbers to readable names", async () => {
  const projectPath = tmpProject({ "player.gd": "extends Node\nfunc _ready():\n\tpass\n" });
  const { srv } = await startLsp({
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/documentSymbol") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: [
          { name: "Player", kind: 5, range: { start: { line: 0, character: 0 } } },
          { name: "_ready", kind: 6, range: { start: { line: 1, character: 5 } } },
        ] });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_document_symbols")({ path: "player.gd" })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { symbols: [{ name: "Player", kind: "class", line: 0 }, { name: "_ready", kind: "method", line: 1 }] });
  lsp.close();
  await srv.close();
});

test("gd_diagnostics matches a publishDiagnostics URI spelled differently (res:// vs file://) via diagKey", async () => {
  const projectPath = tmpProject({ "player.gd": "extends Node\nvar x =\n" });
  const { srv } = await startLsp({
    onNotify: (msg, s) => {
      if (msg.method === "textDocument/didOpen") {
        // Publish under a res:// URI — a DIFFERENT spelling than the percent-encoded
        // file:// URI the client opened with. diagKey must still match them.
        writeFrame(s, { jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {
          uri: "res://player.gd",
          diagnostics: [{ severity: 1, message: "Expected expression", range: { start: { line: 1, character: 6 } } }],
        } });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_diagnostics")({ path: "player.gd", wait_ms: 1000 })) as ToolResultLike;
  const sc = res.structuredContent as { diagnostics: Array<{ severity: string; message: string; line: number }> };
  assert.equal(sc.diagnostics.length, 1);
  assert.equal(sc.diagnostics[0].severity, "error");
  assert.equal(sc.diagnostics[0].message, "Expected expression");
  assert.equal(sc.diagnostics[0].line, 1);
  lsp.close();
  await srv.close();
});

test("gd_rename dry-run (apply=false) returns the plan and writes nothing, without prompting", async () => {
  const projectPath = tmpProject({ "player.gd": "var speed = 10\n" });
  let elicited = 0;
  const { srv } = await startLsp({
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/rename") {
        const uri = (msg.params as { textDocument: { uri: string } }).textDocument.uri;
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: { changes: { [uri]: [{ range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } }, newText: "velocity" }] } } });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath, async () => { elicited++; return { action: "accept", content: { proceed: true } }; });
  const res = (await rec.handler("gd_rename")({ path: "player.gd", line: 0, character: 4, new_name: "velocity", apply: false })) as ToolResultLike;
  const sc = res.structuredContent as { edit_count: number; applied: boolean; written: string[] };
  assert.equal(sc.edit_count, 1);
  assert.equal(sc.applied, false);
  assert.deepEqual(sc.written, []);
  assert.equal(elicited, 0, "dry run must not prompt");
  assert.equal(fs.readFileSync(path.join(projectPath, "player.gd"), "utf8"), "var speed = 10\n");
  lsp.close();
  await srv.close();
});

test("gd_rename apply=true writes the edited text to disk (applyTextEdits/offsetOf end-to-end)", async () => {
  const projectPath = tmpProject({ "player.gd": "var speed = 10\n" });
  const { srv } = await startLsp({
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/rename") {
        const uri = (msg.params as { textDocument: { uri: string } }).textDocument.uri;
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: { changes: { [uri]: [{ range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } }, newText: "velocity" }] } } });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath, async () => ({ action: "accept", content: { proceed: true } }));
  const res = (await rec.handler("gd_rename")({ path: "player.gd", line: 0, character: 4, new_name: "velocity", apply: true, confirm: true })) as ToolResultLike;
  const sc = res.structuredContent as { applied: boolean; written: string[]; edit_count: number };
  assert.equal(sc.applied, true);
  assert.equal(sc.edit_count, 1);
  assert.equal(sc.written.length, 1);
  assert.equal(fs.readFileSync(path.join(projectPath, "player.gd"), "utf8"), "var velocity = 10\n");
  lsp.close();
  await srv.close();
});

test("gd_signature_help maps signatures, resolves [start,end] parameter labels, and reports active indices", async () => {
  const projectPath = tmpProject({ "player.gd": "func hit(dmg):\n\thit()\n" });
  const { srv } = await startLsp({
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/signatureHelp") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: {
          signatures: [{
            label: "hit(dmg: int) -> int",
            documentation: { kind: "markdown", value: "Apply damage." },
            parameters: [{ label: [4, 12], documentation: "the amount" }],
          }],
          activeSignature: 0,
          activeParameter: 0,
        } });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_signature_help")({ path: "player.gd", line: 1, character: 5 })) as ToolResultLike;
  assert.equal(res.isError, undefined);
  assert.deepEqual(res.structuredContent, {
    signatures: [{
      label: "hit(dmg: int) -> int",
      documentation: "Apply damage.",
      parameters: [{ label: "dmg: int", documentation: "the amount" }],
    }],
    active_signature: 0,
    active_parameter: 0,
  });
  lsp.close();
  await srv.close();
});

test("gd_code_action lists actions, flags which carry an edit, normalizes CodeAction+Command, and forwards range/only", async () => {
  const projectPath = tmpProject({ "player.gd": "var x = 1\n" });
  let sent: LspMsg | undefined;
  const { srv } = await startLsp({
    capabilities: { codeActionProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/codeAction") {
        sent = msg;
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: [
          { title: "Add type hint", kind: "quickfix", edit: { changes: {} } },
          { title: "Organize", kind: "source.organizeImports", command: { title: "Organize", command: "gdscript.organize" } },
          { title: "Run", command: "gdscript.run" },
        ] });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_code_action")({ path: "player.gd", start_line: 0, start_character: 0, only: ["quickfix"] })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { actions: [
    { title: "Add type hint", kind: "quickfix", has_edit: true, command: null },
    { title: "Organize", kind: "source.organizeImports", has_edit: false, command: "gdscript.organize" },
    { title: "Run", kind: "", has_edit: false, command: "gdscript.run" },
  ] });
  // end defaults to start (a caret, not a selection); `only` is forwarded in the context.
  const params = sent!.params as { range: { start: unknown; end: unknown }; context: { only?: string[] } };
  assert.deepEqual(params.range.start, { line: 0, character: 0 });
  assert.deepEqual(params.range.end, { line: 0, character: 0 });
  assert.deepEqual(params.context.only, ["quickfix"]);
  lsp.close();
  await srv.close();
});

test("gd_code_action returns 'unsupported' WITHOUT sending textDocument/codeAction when codeActionProvider is falsy (Godot 4.3 behavior)", async () => {
  const projectPath = tmpProject({ "player.gd": "var x = 1\n" });
  const { srv, received } = await startLsp({ capabilities: { codeActionProvider: false } });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_code_action")({ path: "player.gd", start_line: 0, start_character: 0 })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /unsupported/i);
  assert.ok(!received.some((m) => m.method === "textDocument/codeAction"), "must NOT send codeAction when the capability is absent");
  lsp.close();
  await srv.close();
});

// ---- Phase 1 LSP-depth: read-only navigation/inspection tools -------------

test("gd_type_definition maps locations when typeDefinitionProvider is advertised", async () => {
  const projectPath = tmpProject({ "player.gd": "extends Node\nvar hp := 3\n" });
  const { srv } = await startLsp({
    capabilities: { typeDefinitionProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/typeDefinition") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: [{ uri: "res://health.gd", range: { start: { line: 2, character: 0 } } }] });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_type_definition")({ path: "player.gd", line: 1, character: 4 })) as ToolResultLike;
  assert.equal(res.isError, undefined);
  assert.deepEqual(res.structuredContent, { locations: [{ uri: "res://health.gd", line: 2, character: 0 }] });
  lsp.close();
  await srv.close();
});

test("gd_type_definition returns 'unsupported' WITHOUT sending the request when the capability is absent", async () => {
  const projectPath = tmpProject({ "player.gd": "extends Node\n" });
  const { srv, received } = await startLsp({ capabilities: {} });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_type_definition")({ path: "player.gd", line: 0, character: 0 })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /unsupported/i);
  assert.ok(!received.some((m) => m.method === "textDocument/typeDefinition"), "must NOT send typeDefinition when the capability is absent");
  lsp.close();
  await srv.close();
});

test("gd_type_definition maps a -32601 (advertised-but-unimplemented) reply to 'unsupported' — the D7 belt-and-suspenders", async () => {
  const projectPath = tmpProject({ "player.gd": "extends Node\n" });
  const { srv } = await startLsp({
    capabilities: { typeDefinitionProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/typeDefinition") writeFrame(s, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_type_definition")({ path: "player.gd", line: 0, character: 0 })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /unsupported/i);
  lsp.close();
  await srv.close();
});

test("gd_implementation maps locations from the targetUri/targetSelectionRange form", async () => {
  const projectPath = tmpProject({ "player.gd": "extends Node\n" });
  const { srv } = await startLsp({
    capabilities: { implementationProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/implementation") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: [{ targetUri: "res://enemy.gd", targetSelectionRange: { start: { line: 9, character: 2 } } }] });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_implementation")({ path: "player.gd", line: 0, character: 0 })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { locations: [{ uri: "res://enemy.gd", line: 9, character: 2 }] });
  lsp.close();
  await srv.close();
});

test("gd_declaration maps a single-Location (non-array) result", async () => {
  const projectPath = tmpProject({ "player.gd": "extends Node\n" });
  const { srv } = await startLsp({
    capabilities: { declarationProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/declaration") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: { uri: "res://player.gd", range: { start: { line: 1, character: 4 } } } });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_declaration")({ path: "player.gd", line: 5, character: 8 })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { locations: [{ uri: "res://player.gd", line: 1, character: 4 }] });
  lsp.close();
  await srv.close();
});

test("gd_document_highlight maps ranges and DocumentHighlightKind numbers to write/read/text", async () => {
  const projectPath = tmpProject({ "player.gd": "var speed = 1\nspeed = 2\nprint(speed)\n" });
  const { srv } = await startLsp({
    capabilities: { documentHighlightProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/documentHighlight") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: [
          { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } }, kind: 3 },
          { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, kind: 2 },
          { range: { start: { line: 2, character: 6 }, end: { line: 2, character: 11 } } },
        ] });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_document_highlight")({ path: "player.gd", line: 0, character: 4 })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { highlights: [
    { line: 0, character: 4, end_line: 0, end_character: 9, kind: "write" },
    { line: 1, character: 0, end_line: 1, end_character: 5, kind: "read" },
    { line: 2, character: 6, end_line: 2, end_character: 11, kind: "text" },
  ] });
  lsp.close();
  await srv.close();
});

test("gd_document_highlight returns 'unsupported' without sending the request when the capability is absent", async () => {
  const projectPath = tmpProject({ "player.gd": "var x = 1\n" });
  const { srv, received } = await startLsp({ capabilities: {} });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_document_highlight")({ path: "player.gd", line: 0, character: 4 })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.ok(!received.some((m) => m.method === "textDocument/documentHighlight"));
  lsp.close();
  await srv.close();
});

test("gd_folding_ranges maps startLine/endLine and a defaulted (missing) kind", async () => {
  const projectPath = tmpProject({ "player.gd": "func a():\n\tpass\nfunc b():\n\tpass\n" });
  const { srv } = await startLsp({
    capabilities: { foldingRangeProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/foldingRange") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: [
          { startLine: 0, endLine: 1, kind: "region" },
          { startLine: 2, endLine: 3 },
        ] });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_folding_ranges")({ path: "player.gd" })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { ranges: [
    { start_line: 0, end_line: 1, kind: "region" },
    { start_line: 2, end_line: 3, kind: "" },
  ] });
  lsp.close();
  await srv.close();
});

test("gd_document_link maps ranges and targets", async () => {
  const projectPath = tmpProject({ "player.gd": "# see res://other.gd\n" });
  const { srv } = await startLsp({
    capabilities: { documentLinkProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/documentLink") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: [
          { range: { start: { line: 0, character: 6 }, end: { line: 0, character: 20 } }, target: "res://other.gd" },
        ] });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_document_link")({ path: "player.gd" })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { links: [
    { line: 0, character: 6, end_line: 0, end_character: 20, target: "res://other.gd" },
  ] });
  lsp.close();
  await srv.close();
});

test("gd_formatting applies the server's text edits and returns the formatted text WITHOUT writing to disk", async () => {
  const projectPath = tmpProject({ "player.gd": "var x=1\n" });
  let sent: LspMsg | undefined;
  const { srv } = await startLsp({
    capabilities: { documentFormattingProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/formatting") {
        sent = msg;
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: [
          { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } }, newText: "var x = 1" },
        ] });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_formatting")({ path: "player.gd" })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { edit_count: 1, formatted: "var x = 1\n" });
  // Read-only: the file on disk is untouched.
  assert.equal(fs.readFileSync(path.join(projectPath, "player.gd"), "utf8"), "var x=1\n");
  // Formatting options default to Godot's tabs (insertSpaces:false, tabSize:4).
  const opts = (sent!.params as { options: { tabSize: number; insertSpaces: boolean } }).options;
  assert.deepEqual(opts, { tabSize: 4, insertSpaces: false });
  lsp.close();
  await srv.close();
});

test("gd_formatting returns 'unsupported' without sending the request when documentFormattingProvider is absent", async () => {
  const projectPath = tmpProject({ "player.gd": "var x=1\n" });
  const { srv, received } = await startLsp({ capabilities: {} });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_formatting")({ path: "player.gd" })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.ok(!received.some((m) => m.method === "textDocument/formatting"));
  lsp.close();
  await srv.close();
});

test("gd_document_color maps ColorInformation ranges and 0..1 RGBA to components + #RRGGBBAA hex", async () => {
  const projectPath = tmpProject({ "player.gd": "var c = Color(1, 0, 0, 1)\nvar d = Color(0, 0.5, 1, 0.5)\n" });
  const { srv } = await startLsp({
    capabilities: { colorProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/documentColor") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: [
          { range: { start: { line: 0, character: 8 }, end: { line: 0, character: 24 } }, color: { red: 1, green: 0, blue: 0, alpha: 1 } },
          { range: { start: { line: 1, character: 8 }, end: { line: 1, character: 28 } }, color: { red: 0, green: 0.5, blue: 1, alpha: 0.5 } },
        ] });
      }
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_document_color")({ path: "player.gd" })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { colors: [
    { line: 0, character: 8, end_line: 0, end_character: 24, red: 1, green: 0, blue: 0, alpha: 1, hex: "#ff0000ff" },
    { line: 1, character: 8, end_line: 1, end_character: 28, red: 0, green: 0.5, blue: 1, alpha: 0.5, hex: "#0080ff80" },
  ] });
  lsp.close();
  await srv.close();
});

test("gd_document_color returns 'unsupported' without sending the request when colorProvider is absent", async () => {
  const projectPath = tmpProject({ "player.gd": "var x = 1\n" });
  const { srv, received } = await startLsp({ capabilities: {} });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_document_color")({ path: "player.gd" })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /unsupported/i);
  assert.ok(!received.some((m) => m.method === "textDocument/documentColor"), "must NOT send documentColor when the capability is absent");
  lsp.close();
  await srv.close();
});

test("gd_document_color maps a -32601 (advertised-but-unimplemented) reply to 'unsupported' — the D7 belt-and-suspenders", async () => {
  const projectPath = tmpProject({ "player.gd": "var x = Color(1,1,1,1)\n" });
  const { srv } = await startLsp({
    capabilities: { colorProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/documentColor") writeFrame(s, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
    },
  });
  const { lsp, rec } = lspToolHarness(srv.port, projectPath);
  const res = (await rec.handler("gd_document_color")({ path: "player.gd" })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /unsupported/i);
  lsp.close();
  await srv.close();
});

// ---- Direct LspClient protocol behavior -----------------------------------

test("getServerCapabilities reflects the initialize handshake result", async () => {
  const { srv } = await startLsp({ capabilities: { hoverProvider: true, workspaceSymbolProvider: false } });
  const lsp = new LspClient("127.0.0.1", srv.port, "file:///tmp/proj", 3000);
  const caps = await lsp.getServerCapabilities();
  assert.equal(caps.hoverProvider, true);
  assert.equal(caps.workspaceSymbolProvider, false);
  lsp.close();
  await srv.close();
});

test("a server->client request (e.g. client/registerCapability) is acked with a null result so the server never blocks", async () => {
  const clientResponses: LspMsg[] = [];
  const { srv, received } = await startLsp({});
  // After initialize, push a server->client request and watch for the client's ack.
  const lsp = new LspClient("127.0.0.1", srv.port, "file:///tmp/proj", 3000);
  await lsp.getServerCapabilities(); // forces the handshake and a live socket
  srv.sockets[0].on("data", () => {}); // ensure data flows
  writeFrame(srv.sockets[0], { jsonrpc: "2.0", id: 9001, method: "client/registerCapability", params: {} });
  await waitFor(() => received.some((m) => m.id === 9001 && "result" in m && m.method === undefined));
  const ack = received.find((m) => m.id === 9001 && m.method === undefined)!;
  assert.equal(ack.result, null);
  clientResponses.push(ack);
  lsp.close();
  await srv.close();
});

test("request() rejects with an LspError('timeout') when the server never answers a method", async () => {
  const { srv } = await startLsp({}); // answers initialize only
  const lsp = new LspClient("127.0.0.1", srv.port, "file:///tmp/proj", 3000);
  await assert.rejects(lsp.request("textDocument/hover", {}, 80), (e) => e instanceof LspError && e.code === "timeout");
  lsp.close();
  await srv.close();
});

test("request() surfaces an LspError with the server's error code on an error response", async () => {
  const { srv } = await startLsp({
    onRequest: (msg, s) => writeFrame(s, { jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "Invalid params" } }),
  });
  const lsp = new LspClient("127.0.0.1", srv.port, "file:///tmp/proj", 3000);
  await assert.rejects(lsp.request("textDocument/hover", {}), (e) => e instanceof LspError && e.code === -32602 && /Invalid params/.test((e as Error).message));
  lsp.close();
  await srv.close();
});
