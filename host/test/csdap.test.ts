import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CsDapClient } from "../src/csdap.js";
import { FramedConnection } from "../src/framing.js";
import { StdioChannel } from "../src/stdio.js";
import { registerCsDapTools } from "../src/tools/csdap.js";
import { loadConfig, type Config } from "../src/config.js";
import { makeRecordingServer, type ToolResultLike, type ElicitFn } from "./helpers/recording-server.js";
import { startTcpServer, makeFrameParser, writeFrame, type TcpServer } from "./helpers/tcp.js";

interface DapMsg { seq: number; type: string; command?: string; arguments?: Record<string, unknown>; request_seq?: number; success?: boolean; event?: string; body?: unknown }

function dapResponse(s: net.Socket, req: DapMsg, body: Record<string, unknown> = {}, success = true): void {
  writeFrame(s, { seq: 0, type: "response", request_seq: req.seq, success, command: req.command, body });
}
function dapEvent(s: net.Socket, event: string, body: Record<string, unknown> = {}): void {
  writeFrame(s, { seq: 0, type: "event", event, body });
}

/** Handle the initialize/launch/attach/configurationDone handshake. Returns true if consumed. */
function handshake(msg: DapMsg, s: net.Socket, caps: Record<string, unknown> = { supportsConfigurationDoneRequest: true }): boolean {
  switch (msg.command) {
    case "initialize":
      dapResponse(s, msg, caps);
      dapEvent(s, "initialized", {});
      return true;
    case "launch":
    case "attach":
      dapResponse(s, msg, {});
      return true;
    case "configurationDone":
      dapResponse(s, msg, {});
      return true;
  }
  return false;
}

async function startDap(handle: (msg: DapMsg, s: net.Socket) => void): Promise<{ srv: TcpServer; received: DapMsg[] }> {
  const received: DapMsg[] = [];
  const srv = await startTcpServer((s) => {
    const parse = makeFrameParser((m) => { const msg = m as unknown as DapMsg; received.push(msg); handle(msg, s); });
    s.on("data", (c) => parse(Buffer.from(c)));
  });
  return { srv, received };
}

/** Full Config whose C# project root is a real temp dir (so toFsPath resolves). */
function makeConfig(projectPath: string): Config {
  const saved = process.env.GODOT_CSHARP_PROJECT;
  process.env.GODOT_CSHARP_PROJECT = projectPath;
  try { return loadConfig(); } finally {
    if (saved === undefined) delete process.env.GODOT_CSHARP_PROJECT; else process.env.GODOT_CSHARP_PROJECT = saved;
  }
}

function tmpDir(): string { return fs.mkdtempSync(path.join(os.tmpdir(), "gcb-csdap-")); }

/** Wire a CsDapClient (over a loopback TCP channel) to the cs_dbg_* tools on a recording server. */
function csDapHarness(port: number, elicit?: ElicitFn) {
  const cfg = makeConfig(tmpDir());
  const channel = new FramedConnection("127.0.0.1", port, "CS-DAP", "test channel");
  const dap = new CsDapClient(channel, 3000);
  const rec = makeRecordingServer(elicit);
  registerCsDapTools(rec.server as unknown as Parameters<typeof registerCsDapTools>[0], dap, cfg);
  return { dap, rec, cfg };
}

test("cs_dbg_launch runs the handshake and reports state 'running'", async () => {
  const { srv, received } = await startDap((m, s) => { handshake(m, s); });
  const { dap, rec } = csDapHarness(srv.port);
  const res = (await rec.handler("cs_dbg_launch")({})) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { session_id: "csharp", state: "running" });
  // Default launch config points at the C# project with the coreclr adapterID.
  const init = received.find((m) => m.command === "initialize");
  assert.equal((init!.arguments as { adapterID: string }).adapterID, "coreclr");
  const launch = received.find((m) => m.command === "launch");
  assert.ok(Array.isArray((launch!.arguments as { args: string[] }).args));
  dap.close();
  await srv.close();
});

test("cs_dbg_attach forwards the process id to the DAP attach request", async () => {
  const { srv, received } = await startDap((m, s) => { handshake(m, s); });
  const { dap, rec } = csDapHarness(srv.port);
  const res = (await rec.handler("cs_dbg_attach")({ process_id: 4242 })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { session_id: "csharp", state: "running" });
  const attach = received.find((m) => m.command === "attach");
  assert.deepEqual(attach!.arguments, { processId: 4242 });
  dap.close();
  await srv.close();
});

test("cs_dbg_set_breakpoints buffers before a session is configured", async () => {
  const { srv } = await startDap((m, s) => { handshake(m, s); });
  const { dap, rec } = csDapHarness(srv.port);
  const res = (await rec.handler("cs_dbg_set_breakpoints")({ path: "Player.cs", lines: [30] })) as ToolResultLike;
  const sc = res.structuredContent as { buffered: boolean; breakpoints: unknown[] };
  assert.equal(sc.buffered, true);
  assert.deepEqual(sc.breakpoints, []);
  dap.close();
  await srv.close();
});

test("cs_dbg_set_breakpoints applies immediately once the session is configured (Player.cs:30)", async () => {
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "setBreakpoints") dapResponse(s, m, { breakpoints: [{ line: 30, verified: true }] });
  });
  const { dap, rec } = csDapHarness(srv.port);
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_set_breakpoints")({ path: "Player.cs", lines: [30] })) as ToolResultLike;
  const sc = res.structuredContent as { buffered: boolean; breakpoints: Array<{ line: number; verified: boolean }> };
  assert.equal(sc.buffered, false);
  assert.deepEqual(sc.breakpoints, [{ line: 30, verified: true }]);
  dap.close();
  await srv.close();
});

test("cs_dbg_set_breakpoints forwards a condition when the adapter advertises supportsConditionalBreakpoints", async () => {
  let bpReq: DapMsg | undefined;
  const { srv } = await startDap((m, s) => {
    if (m.command === "initialize") { dapResponse(s, m, { supportsConfigurationDoneRequest: true, supportsConditionalBreakpoints: true }); dapEvent(s, "initialized", {}); return; }
    if (m.command === "launch" || m.command === "configurationDone") { dapResponse(s, m, {}); return; }
    if (m.command === "setBreakpoints") { bpReq = m; dapResponse(s, m, { breakpoints: [{ line: 30, verified: true }] }); }
  });
  const { dap, rec } = csDapHarness(srv.port);
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_set_breakpoints")({ path: "Player.cs", lines: [30], conditions: ["Counter < 50"] })) as ToolResultLike;
  const sc = res.structuredContent as { unsupported_modifiers?: string[] };
  assert.equal(sc.unsupported_modifiers, undefined);
  const bps = (bpReq!.arguments as { breakpoints: Array<Record<string, unknown>> }).breakpoints;
  assert.equal(bps[0].line, 30);
  assert.equal(bps[0].condition, "Counter < 50");
  dap.close();
  await srv.close();
});

test("cs_dbg_set_breakpoints drops the condition and warns when the adapter does not advertise supportsConditionalBreakpoints", async () => {
  // Default handshake advertises no supportsConditionalBreakpoints.
  let bpReq: DapMsg | undefined;
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "setBreakpoints") { bpReq = m; dapResponse(s, m, { breakpoints: [{ line: 30, verified: true }] }); }
  });
  const { dap, rec } = csDapHarness(srv.port);
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_set_breakpoints")({ path: "Player.cs", lines: [30], conditions: ["Counter < 50"] })) as ToolResultLike;
  const sc = res.structuredContent as { unsupported_modifiers?: string[]; warning?: string };
  assert.deepEqual(sc.unsupported_modifiers, ["condition"]);
  assert.match(sc.warning ?? "", /halt unconditionally/i);
  const bps = (bpReq!.arguments as { breakpoints: Array<Record<string, unknown>> }).breakpoints;
  assert.equal(bps[0].condition, undefined);
  dap.close();
  await srv.close();
});

test("cs_dbg_continue waits for the next 'stopped' event and returns its reason", async () => {
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "continue") { dapResponse(s, m, {}); dapEvent(s, "stopped", { reason: "breakpoint", threadId: 1 }); }
  });
  const { dap, rec } = csDapHarness(srv.port);
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_continue")({})) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { state: "stopped", stopped_reason: "breakpoint" });
  dap.close();
  await srv.close();
});

test("cs_dbg_step over issues 'next' and awaits the landing stop", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "next") { dapResponse(s, m, {}); dapEvent(s, "stopped", { reason: "step", threadId: 1 }); }
  });
  const { dap, rec } = csDapHarness(srv.port);
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_step")({ kind: "over" })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { state: "stopped", stopped_reason: "step" });
  assert.ok(received.some((m) => m.command === "next"), "step:over must issue the DAP 'next' command");
  dap.close();
  await srv.close();
});

test("cs_dbg_stack_trace maps DAP stackFrames to the tool's frame shape", async () => {
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "stackTrace") dapResponse(s, m, { stackFrames: [{ id: 1000, name: "Player.TakeDamage", source: { path: "/p/Player.cs" }, line: 30 }] });
  });
  const { dap, rec } = csDapHarness(srv.port);
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_stack_trace")({})) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { frames: [{ id: 1000, name: "Player.TakeDamage", source: "/p/Player.cs", line: 30 }] });
  dap.close();
  await srv.close();
});

test("cs_dbg_scopes maps DAP scopes to name + variables_ref", async () => {
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "scopes") dapResponse(s, m, { scopes: [{ name: "Locals", variablesReference: 1001 }] });
  });
  const { dap, rec } = csDapHarness(srv.port);
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_scopes")({ frame_id: 1000 })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { scopes: [{ name: "Locals", variables_ref: 1001 }] });
  dap.close();
  await srv.close();
});

test("cs_dbg_variables maps DAP variables (e.g. Counter) to the tool shape", async () => {
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "variables") dapResponse(s, m, { variables: [{ name: "Counter", value: "95", type: "int", variablesReference: 0 }] });
  });
  const { dap, rec } = csDapHarness(srv.port);
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_variables")({ variables_ref: 1001 })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { variables: [{ name: "Counter", value: "95", type: "int", variables_ref: 0 }] });
  dap.close();
  await srv.close();
});

test("a failed DAP request surfaces as an isError result", async () => {
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "stackTrace") dapResponse(s, m, { message: "no stack while running" }, false);
  });
  const { dap, rec } = csDapHarness(srv.port);
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_stack_trace")({})) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /C# DAP error/);
  dap.close();
  await srv.close();
});

// ---- cs_dbg_evaluate (gated) ----------------------------------------------

test("cs_dbg_evaluate proceeds with confirm:true and returns the evaluated result", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "evaluate") dapResponse(s, m, { result: "95", type: "int", variablesReference: 0 });
  });
  const { dap, rec } = csDapHarness(srv.port, async () => ({ action: "decline" }));
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_evaluate")({ expression: "Counter", confirm: true })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { result: "95", type: "int", variables_ref: 0 });
  assert.ok(received.some((m) => m.command === "evaluate"));
  dap.close();
  await srv.close();
});

test("cs_dbg_evaluate is blocked (and sends no evaluate) when the user declines confirmation", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "evaluate") dapResponse(s, m, { result: "should-not-happen" });
  });
  const { dap, rec } = csDapHarness(srv.port, async () => ({ action: "decline" }));
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_evaluate")({ expression: "DeleteEverything()" })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.ok(!received.some((m) => m.command === "evaluate"), "a declined evaluate must never reach the adapter");
  dap.close();
  await srv.close();
});

test("cs_dbg_evaluate fails fast with a clear message when the adapter never answers evaluate", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    // evaluate: deliberately never respond
  });
  process.env.GODOT_CSDAP_EVALUATE_TIMEOUT_MS = "200";
  const { dap, rec } = csDapHarness(srv.port, async () => ({ action: "accept", content: { proceed: true } }));
  delete process.env.GODOT_CSDAP_EVALUATE_TIMEOUT_MS;
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_evaluate")({ expression: "Counter", confirm: true })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /did not answer the evaluate request within 200ms/i);
  assert.ok(received.some((m) => m.command === "evaluate"), "the tool must send evaluate before the bounded deadline fires");
  dap.close();
  await srv.close();
});

// ---- cs_dbg_set_variable (gated) ------------------------------------------

test("cs_dbg_set_variable proceeds with confirm:true and returns the adapter's updated value", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "setVariable") dapResponse(s, m, { value: "0", type: "int", variablesReference: 0 });
  });
  const { dap, rec } = csDapHarness(srv.port, async () => ({ action: "decline" }));
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_set_variable")({ variables_ref: 1001, name: "Counter", value: "0", confirm: true })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { name: "Counter", value: "0", type: "int", variables_ref: 0 });
  const sv = received.find((m) => m.command === "setVariable");
  assert.deepEqual(sv!.arguments, { variablesReference: 1001, name: "Counter", value: "0" });
  dap.close();
  await srv.close();
});

test("cs_dbg_set_variable is blocked (and sends no setVariable) when the user declines confirmation", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "setVariable") dapResponse(s, m, { value: "should-not-happen" });
  });
  const { dap, rec } = csDapHarness(srv.port, async () => ({ action: "decline" }));
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_set_variable")({ variables_ref: 1001, name: "Counter", value: "0" })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.ok(!received.some((m) => m.command === "setVariable"), "a declined setVariable must never reach the adapter");
  dap.close();
  await srv.close();
});

test("cs_dbg_set_variable returns 'unsupported' WITHOUT prompting when the adapter advertises supportsSetVariable:false", async () => {
  let elicited = 0;
  const { srv, received } = await startDap((m, s) => {
    if (m.command === "initialize") { dapResponse(s, m, { supportsConfigurationDoneRequest: true, supportsSetVariable: false }); dapEvent(s, "initialized", {}); return; }
    if (m.command === "launch" || m.command === "configurationDone") { dapResponse(s, m, {}); return; }
    if (m.command === "setVariable") dapResponse(s, m, { value: "nope" });
  });
  const { dap, rec } = csDapHarness(srv.port, async () => { elicited++; return { action: "accept", content: { proceed: true } }; });
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_set_variable")({ variables_ref: 1, name: "Counter", value: "0" })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /unsupported/i);
  assert.equal(elicited, 0, "must not prompt when the capability is unsupported");
  assert.ok(!received.some((m) => m.command === "setVariable"));
  dap.close();
  await srv.close();
});

test("cs_dbg_set_variable fails fast with a clear message when the adapter never answers setVariable", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    // setVariable: deliberately never respond
  });
  process.env.GODOT_CSDAP_SETVAR_TIMEOUT_MS = "200";
  const { dap, rec } = csDapHarness(srv.port, async () => ({ action: "accept", content: { proceed: true } }));
  delete process.env.GODOT_CSDAP_SETVAR_TIMEOUT_MS;
  await rec.handler("cs_dbg_launch")({});
  const res = (await rec.handler("cs_dbg_set_variable")({ variables_ref: 1, name: "Counter", value: "0", confirm: true })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /did not answer the setVariable request within 200ms/i);
  assert.match(res.content![0].text!, /no change was made/i);
  assert.ok(received.some((m) => m.command === "setVariable"), "the tool must send setVariable before the bounded deadline fires");
  dap.close();
  await srv.close();
});

// ---- StdioChannel end-to-end (the transport netcoredbg actually uses) ------
// Drives CsDapClient through a REAL spawned subprocess speaking DAP over stdio,
// so the stdio framing/spawn path is exercised in the unit suite, not only in CI.

test("CsDapClient over StdioChannel: the launch handshake round-trips against a spawned stdio adapter", async () => {
  const mock = `
    let buf = Buffer.alloc(0);
    const send = (o) => { const b = JSON.stringify(o); process.stdout.write("Content-Length: " + Buffer.byteLength(b) + "\\r\\n\\r\\n" + b); };
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
        if (body.type === "request") {
          if (body.command === "initialize") {
            send({ seq: 0, type: "response", request_seq: body.seq, success: true, command: "initialize", body: { supportsConfigurationDoneRequest: true } });
            send({ seq: 0, type: "event", event: "initialized", body: {} });
          } else {
            send({ seq: 0, type: "response", request_seq: body.seq, success: true, command: body.command, body: {} });
          }
        }
      }
    });
  `;
  const channel = new StdioChannel(process.execPath, ["-e", mock], os.tmpdir(), "CS-DAP-stdio", "test");
  const dap = new CsDapClient(channel, 4000);
  await dap.start("launch", { program: "godot", args: ["--path", "."] });
  assert.equal(dap.state, "running");
  assert.equal(dap.capabilities?.supportsConfigurationDoneRequest, true);
  dap.close();
});

test("StdioChannel surfaces a spawn failure (bad command) as a clear error rather than hanging", async () => {
  const channel = new StdioChannel("gcb-nonexistent-netcoredbg-xyz", ["--interpreter=vscode"], os.tmpdir(), "CS-DAP-stdio", "Install netcoredbg.");
  const dap = new CsDapClient(channel, 2000);
  await assert.rejects(dap.start("launch", {}), (e) => /could not spawn/i.test((e as Error).message));
  dap.close();
});
