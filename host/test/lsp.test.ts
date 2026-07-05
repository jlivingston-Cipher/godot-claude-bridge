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
