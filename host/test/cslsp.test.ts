import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CsLspClient } from "../src/cslsp.js";
import { LspError } from "../src/lsp.js";
import { FramedConnection } from "../src/framing.js";
import { StdioChannel } from "../src/stdio.js";
import { registerCsLspTools } from "../src/tools/cslsp.js";
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

/** A mock C# language server (OmniSharp stand-in): answers `initialize`, delegates the rest. */
async function startCs(opts: MockOpts): Promise<{ srv: TcpServer; received: LspMsg[] }> {
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
    });
    s.on("data", (c) => parse(Buffer.from(c)));
  });
  return { srv, received };
}

/** Full Config whose C# project root is a real temp dir. */
function makeConfig(projectPath: string): Config {
  const saved = process.env.GODOT_CSHARP_PROJECT;
  process.env.GODOT_CSHARP_PROJECT = projectPath;
  try { return loadConfig(); } finally {
    if (saved === undefined) delete process.env.GODOT_CSHARP_PROJECT; else process.env.GODOT_CSHARP_PROJECT = saved;
  }
}

function tmpProject(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcb-cslsp-"));
  for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), content, "utf8");
  return dir;
}

/** Wire a CsLspClient (over a loopback TCP channel) to the cs_* tools on a recording server. */
function csToolHarness(srvPort: number, projectPath: string) {
  const cfg = makeConfig(projectPath);
  const channel = new FramedConnection("127.0.0.1", srvPort, "CS-LSP", "test channel");
  const cslsp = new CsLspClient(channel, cfg.csLspProjectUri, 3000);
  const rec = makeRecordingServer();
  registerCsLspTools(rec.server as unknown as Parameters<typeof registerCsLspTools>[0], cslsp, cfg);
  return { cslsp, rec, cfg };
}

test("cs_definition maps definition locations", async () => {
  const projectPath = tmpProject({ "Player.cs": "public partial class Player : Node2D {}\n" });
  const { srv } = await startCs({
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/definition") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: [{ uri: "file:///proj/Player.cs", range: { start: { line: 26, character: 15 } } }] });
      }
    },
  });
  const { cslsp, rec } = csToolHarness(srv.port, projectPath);
  const res = (await rec.handler("cs_definition")({ path: "Player.cs", line: 30, character: 12 })) as ToolResultLike;
  assert.equal(res.isError, undefined);
  assert.deepEqual(res.structuredContent, { locations: [{ uri: "file:///proj/Player.cs", line: 26, character: 15 }] });
  cslsp.close();
  await srv.close();
});

test("cs_hover returns the MarkupContent value (e.g. the Counter : int type)", async () => {
  const projectPath = tmpProject({ "Player.cs": "public int Counter { get; set; }\n" });
  const { srv } = await startCs({
    capabilities: { hoverProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/hover") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: { contents: { kind: "markdown", value: "```csharp\nint Player.Counter { get; set; }\n```" } } });
      }
    },
  });
  const { cslsp, rec } = csToolHarness(srv.port, projectPath);
  const res = (await rec.handler("cs_hover")({ path: "Player.cs", line: 0, character: 11 })) as ToolResultLike;
  const sc = res.structuredContent as { contents: string };
  assert.match(sc.contents, /int Player\.Counter/);
  cslsp.close();
  await srv.close();
});

test("cs_completion maps items and CompletionItemKind numbers to readable names", async () => {
  const projectPath = tmpProject({ "Player.cs": "class P {}\n" });
  const { srv } = await startCs({
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/completion") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: { items: [
          { label: "TakeDamage", kind: 2, detail: "int Player.TakeDamage(int amount)", insertText: "TakeDamage" },
          { label: "Counter", kind: 10 },
        ] } });
      }
    },
  });
  const { cslsp, rec } = csToolHarness(srv.port, projectPath);
  const res = (await rec.handler("cs_completion")({ path: "Player.cs", line: 0, character: 0 })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { items: [
    { label: "TakeDamage", kind: "method", detail: "int Player.TakeDamage(int amount)", insertText: "TakeDamage" },
    { label: "Counter", kind: "property", detail: "", insertText: "Counter" },
  ] });
  cslsp.close();
  await srv.close();
});

test("cs_references forwards includeDeclaration and maps locations", async () => {
  const projectPath = tmpProject({ "Player.cs": "int Counter;\n" });
  let sent: LspMsg | undefined;
  const { srv } = await startCs({
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/references") {
        sent = msg;
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: [
          { uri: "file:///proj/Player.cs", range: { start: { line: 13, character: 15 } } },
          { uri: "file:///proj/Player.cs", range: { start: { line: 23, character: 8 } } },
        ] });
      }
    },
  });
  const { cslsp, rec } = csToolHarness(srv.port, projectPath);
  const res = (await rec.handler("cs_references")({ path: "Player.cs", line: 13, character: 15, include_declaration: false })) as ToolResultLike;
  const sc = res.structuredContent as { locations: unknown[] };
  assert.equal(sc.locations.length, 2);
  assert.equal((sent!.params as { context: { includeDeclaration: boolean } }).context.includeDeclaration, false);
  cslsp.close();
  await srv.close();
});

test("cs_document_symbols maps LSP SymbolKind numbers to readable names", async () => {
  const projectPath = tmpProject({ "Player.cs": "public partial class Player {}\n" });
  const { srv } = await startCs({
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/documentSymbol") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: [
          { name: "Player", kind: 5, range: { start: { line: 11, character: 0 } } },
          { name: "Counter", kind: 7, range: { start: { line: 13, character: 15 } } },
          { name: "TakeDamage", kind: 6, range: { start: { line: 26, character: 15 } } },
        ] });
      }
    },
  });
  const { cslsp, rec } = csToolHarness(srv.port, projectPath);
  const res = (await rec.handler("cs_document_symbols")({ path: "Player.cs" })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { symbols: [
    { name: "Player", kind: "class", line: 11 },
    { name: "Counter", kind: "property", line: 13 },
    { name: "TakeDamage", kind: "method", line: 26 },
  ] });
  cslsp.close();
  await srv.close();
});

test("cs_workspace_symbols returns mapped symbols on OmniSharp (which implements workspace/symbol)", async () => {
  const projectPath = tmpProject();
  const { srv } = await startCs({
    capabilities: { workspaceSymbolProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "workspace/symbol") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: [
          { name: "Player", kind: 5, location: { uri: "file:///proj/Player.cs", range: { start: { line: 11, character: 0 } } } },
        ] });
      }
    },
  });
  const { cslsp, rec } = csToolHarness(srv.port, projectPath);
  const res = (await rec.handler("cs_workspace_symbols")({ query: "Player" })) as ToolResultLike;
  assert.equal(res.isError, undefined);
  assert.deepEqual(res.structuredContent, { symbols: [{ name: "Player", kind: "class", uri: "file:///proj/Player.cs", line: 11 }] });
  cslsp.close();
  await srv.close();
});

test("cs_workspace_symbols returns 'unsupported' WITHOUT sending the request when the capability is absent", async () => {
  const projectPath = tmpProject();
  const { srv, received } = await startCs({ capabilities: {} });
  const { cslsp, rec } = csToolHarness(srv.port, projectPath);
  const res = (await rec.handler("cs_workspace_symbols")({ query: "Player" })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /unsupported/i);
  assert.ok(!received.some((m) => m.method === "workspace/symbol"), "must NOT send workspace/symbol when the capability is absent");
  cslsp.close();
  await srv.close();
});

test("cs_workspace_symbols maps a -32601 reply to 'unsupported' (belt-and-suspenders)", async () => {
  const projectPath = tmpProject();
  const { srv } = await startCs({
    capabilities: { workspaceSymbolProvider: true },
    onRequest: (msg, s) => {
      if (msg.method === "workspace/symbol") writeFrame(s, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
    },
  });
  const { cslsp, rec } = csToolHarness(srv.port, projectPath);
  const res = (await rec.handler("cs_workspace_symbols")({ query: "Player" })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /unsupported/i);
  cslsp.close();
  await srv.close();
});

test("cs_signature_help maps signatures, resolves [start,end] parameter labels, and reports active indices", async () => {
  const projectPath = tmpProject({ "Player.cs": "TakeDamage();\n" });
  const { srv } = await startCs({
    onRequest: (msg, s) => {
      if (msg.method === "textDocument/signatureHelp") {
        writeFrame(s, { jsonrpc: "2.0", id: msg.id, result: {
          signatures: [{
            label: "int Player.TakeDamage(int amount)",
            documentation: { kind: "markdown", value: "Apply damage." },
            parameters: [{ label: [22, 32], documentation: "the amount" }],
          }],
          activeSignature: 0,
          activeParameter: 0,
        } });
      }
    },
  });
  const { cslsp, rec } = csToolHarness(srv.port, projectPath);
  const res = (await rec.handler("cs_signature_help")({ path: "Player.cs", line: 0, character: 11 })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, {
    signatures: [{
      label: "int Player.TakeDamage(int amount)",
      documentation: "Apply damage.",
      parameters: [{ label: "int amount", documentation: "the amount" }],
    }],
    active_signature: 0,
    active_parameter: 0,
  });
  cslsp.close();
  await srv.close();
});

test("cs_diagnostics matches a publishDiagnostics URI via diagKey and maps severities; opens with languageId 'csharp'", async () => {
  const projectPath = tmpProject({ "Player.cs": "int x =\n" });
  const { srv, received } = await startCs({
    onNotify: (msg, s) => {
      if (msg.method === "textDocument/didOpen") {
        const uri = (msg.params as { textDocument: { uri: string } }).textDocument.uri;
        writeFrame(s, { jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {
          uri,
          diagnostics: [{ severity: 1, message: "; expected", range: { start: { line: 0, character: 7 } } }],
        } });
      }
    },
  });
  const { cslsp, rec } = csToolHarness(srv.port, projectPath);
  const res = (await rec.handler("cs_diagnostics")({ path: "Player.cs", wait_ms: 1000 })) as ToolResultLike;
  const sc = res.structuredContent as { diagnostics: Array<{ severity: string; message: string; line: number }> };
  assert.equal(sc.diagnostics.length, 1);
  assert.equal(sc.diagnostics[0].severity, "error");
  assert.equal(sc.diagnostics[0].message, "; expected");
  // The C# plane must open documents as C#, not GDScript.
  const didOpen = received.find((m) => m.method === "textDocument/didOpen");
  assert.equal((didOpen!.params as { textDocument: { languageId: string } }).textDocument.languageId, "csharp");
  cslsp.close();
  await srv.close();
});

// ---- Direct CsLspClient protocol behavior ---------------------------------

test("getServerCapabilities reflects the initialize handshake result", async () => {
  const { srv } = await startCs({ capabilities: { hoverProvider: true, workspaceSymbolProvider: true } });
  const cslsp = new CsLspClient(new FramedConnection("127.0.0.1", srv.port, "CS-LSP", "test"), "file:///proj", 3000);
  const caps = await cslsp.getServerCapabilities();
  assert.equal(caps.hoverProvider, true);
  assert.equal(caps.workspaceSymbolProvider, true);
  cslsp.close();
  await srv.close();
});

test("a server->client request (e.g. window/workDoneProgress/create) is acked with null so OmniSharp never blocks", async () => {
  const { srv, received } = await startCs({});
  const cslsp = new CsLspClient(new FramedConnection("127.0.0.1", srv.port, "CS-LSP", "test"), "file:///proj", 3000);
  await cslsp.getServerCapabilities();
  writeFrame(srv.sockets[0], { jsonrpc: "2.0", id: 7001, method: "window/workDoneProgress/create", params: {} });
  await waitFor(() => received.some((m) => m.id === 7001 && "result" in m && m.method === undefined));
  const ack = received.find((m) => m.id === 7001 && m.method === undefined)!;
  assert.equal(ack.result, null);
  cslsp.close();
  await srv.close();
});

test("request() rejects with an LspError('timeout') when the server never answers a method", async () => {
  const { srv } = await startCs({});
  const cslsp = new CsLspClient(new FramedConnection("127.0.0.1", srv.port, "CS-LSP", "test"), "file:///proj", 3000);
  await assert.rejects(cslsp.request("textDocument/hover", {}, 80), (e) => e instanceof LspError && e.code === "timeout");
  cslsp.close();
  await srv.close();
});

// ---- StdioChannel end-to-end (the transport OmniSharp actually uses) -------
// Drives CsLspClient through a REAL spawned subprocess speaking LSP over stdio,
// so the stdio framing/spawn path is exercised in the unit suite, not only in CI.

test("CsLspClient over StdioChannel: initialize round-trips against a spawned stdio server", async () => {
  const mock = `
    let buf = Buffer.alloc(0);
    process.stdin.on("data", (c) => {
      buf = Buffer.concat([buf, c]);
      for (;;) {
        const i = buf.indexOf("\\r\\n\\r\\n");
        if (i === -1) break;
        const m = /Content-Length:\\s*(\\d+)/i.exec(buf.subarray(0, i).toString("ascii"));
        if (!m) { buf = buf.subarray(i + 4); continue; }
        const len = Number(m[1]); const start = i + 4;
        if (buf.length < start + len) break;
        const body = JSON.parse(buf.subarray(start, start + len).toString("utf8"));
        buf = buf.subarray(start + len);
        if (body.method === "initialize") {
          const res = JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { capabilities: { hoverProvider: true, workspaceSymbolProvider: true } } });
          process.stdout.write("Content-Length: " + Buffer.byteLength(res) + "\\r\\n\\r\\n" + res);
        }
      }
    });
  `;
  const channel = new StdioChannel(process.execPath, ["-e", mock], os.tmpdir(), "CS-LSP-stdio", "test");
  const cslsp = new CsLspClient(channel, "file:///proj", 4000);
  const caps = await cslsp.getServerCapabilities();
  assert.equal(caps.hoverProvider, true);
  assert.equal(caps.workspaceSymbolProvider, true);
  cslsp.close();
});

test("StdioChannel surfaces a spawn failure (bad command) as a clear error rather than hanging", async () => {
  const channel = new StdioChannel("gcb-nonexistent-omnisharp-xyz", ["-lsp"], os.tmpdir(), "CS-LSP-stdio", "Install OmniSharp.");
  const cslsp = new CsLspClient(channel, "file:///proj", 2000);
  await assert.rejects(cslsp.getServerCapabilities(), (e) => /could not spawn/i.test((e as Error).message));
  cslsp.close();
});
