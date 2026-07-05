import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DapClient } from "../src/dap.js";
import { registerDapTools } from "../src/tools/dap.js";
import { loadConfig, type Config } from "../src/config.js";
import { makeRecordingServer, type ToolResultLike } from "./helpers/recording-server.js";
import { startTcpServer, makeFrameParser, writeFrame, type TcpServer } from "./helpers/tcp.js";

interface DapMsg { seq: number; type: string; command?: string; arguments?: Record<string, unknown>; request_seq?: number; success?: boolean; event?: string; body?: unknown }

function dapResponse(s: net.Socket, req: DapMsg, body: Record<string, unknown> = {}, success = true): void {
  writeFrame(s, { seq: 0, type: "response", request_seq: req.seq, success, command: req.command, body });
}
function dapEvent(s: net.Socket, event: string, body: Record<string, unknown> = {}): void {
  writeFrame(s, { seq: 0, type: "event", event, body });
}

/** Handle the initialize/launch/attach/configurationDone handshake. Returns true if consumed. */
function handshake(msg: DapMsg, s: net.Socket): boolean {
  switch (msg.command) {
    case "initialize":
      dapResponse(s, msg, { supportsConfigurationDoneRequest: true });
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

function makeConfig(projectPath: string): Config {
  const saved = process.env.GODOT_PROJECT;
  process.env.GODOT_PROJECT = projectPath;
  try { return loadConfig(); } finally {
    if (saved === undefined) delete process.env.GODOT_PROJECT; else process.env.GODOT_PROJECT = saved;
  }
}

function tmpDir(): string { return fs.mkdtempSync(path.join(os.tmpdir(), "gcb-dap-")); }

function dapHarness(port: number, elicit?: Parameters<typeof makeRecordingServer>[0]) {
  const cfg = makeConfig(tmpDir());
  const dap = new DapClient("127.0.0.1", port, 3000);
  const rec = makeRecordingServer(elicit);
  registerDapTools(rec.server as unknown as Parameters<typeof registerDapTools>[0], dap, cfg);
  return { dap, rec, cfg };
}

test("dbg_launch runs the handshake and reports state 'running'", async () => {
  const { srv } = await startDap((m, s) => { handshake(m, s); });
  const { dap, rec } = dapHarness(srv.port);
  const res = (await rec.handler("dbg_launch")({ scene: "main" })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { session_id: "godot", state: "running", scene: "main" });
  dap.close();
  await srv.close();
});

test("dbg_continue waits for the next 'stopped' event and returns its reason", async () => {
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "continue") {
      dapResponse(s, m, {});
      dapEvent(s, "stopped", { reason: "breakpoint", threadId: 1 });
    }
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_continue")({})) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { state: "stopped", stopped_reason: "breakpoint" });
  dap.close();
  await srv.close();
});

test("dbg_step over issues 'next' and awaits the landing stop", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "next") {
      dapResponse(s, m, {});
      dapEvent(s, "stopped", { reason: "step", threadId: 1 });
    }
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_step")({ kind: "over" })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { state: "stopped", stopped_reason: "step" });
  assert.ok(received.some((m) => m.command === "next"), "step:over must issue the DAP 'next' command");
  dap.close();
  await srv.close();
});

test("resume() resolves with state 'running' when nothing settles within the wait window", async () => {
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "continue") dapResponse(s, m, {}); // respond, but never emit stopped
  });
  const { dap } = dapHarness(srv.port);
  await dap.start("launch", { project: "/p", scene: "main" });
  const r = await dap.resume("continue", { threadId: 1 }, 80);
  assert.equal(r.state, "running");
  dap.close();
  await srv.close();
});

test("dbg_set_breakpoints buffers before a session is configured", async () => {
  const { srv } = await startDap((m, s) => { handshake(m, s); });
  const { dap, rec } = dapHarness(srv.port);
  const res = (await rec.handler("dbg_set_breakpoints")({ path: "player.gd", lines: [10, 20] })) as ToolResultLike;
  const sc = res.structuredContent as { buffered: boolean; breakpoints: unknown[] };
  assert.equal(sc.buffered, true);
  assert.deepEqual(sc.breakpoints, []);
  dap.close();
  await srv.close();
});

test("dbg_set_breakpoints applies immediately once the session is configured", async () => {
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "setBreakpoints") dapResponse(s, m, { breakpoints: [{ line: 10, verified: true }, { line: 20, verified: false }] });
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_set_breakpoints")({ path: "player.gd", lines: [10, 20] })) as ToolResultLike;
  const sc = res.structuredContent as { buffered: boolean; breakpoints: Array<{ line: number; verified: boolean }> };
  assert.equal(sc.buffered, false);
  assert.deepEqual(sc.breakpoints, [{ line: 10, verified: true }, { line: 20, verified: false }]);
  dap.close();
  await srv.close();
});

test("dbg_evaluate proceeds with confirm:true and returns the evaluated result", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "evaluate") dapResponse(s, m, { result: "42", type: "int", variablesReference: 0 });
  });
  const { dap, rec } = dapHarness(srv.port, async () => ({ action: "decline" }));
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_evaluate")({ expression: "1 + 41", confirm: true })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { result: "42", type: "int", variables_ref: 0 });
  assert.ok(received.some((m) => m.command === "evaluate"));
  dap.close();
  await srv.close();
});

test("dbg_evaluate is blocked (and sends no evaluate) when the user declines confirmation", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "evaluate") dapResponse(s, m, { result: "should-not-happen" });
  });
  const { dap, rec } = dapHarness(srv.port, async () => ({ action: "decline" }));
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_evaluate")({ expression: "delete_everything()" })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.ok(!received.some((m) => m.command === "evaluate"), "a declined evaluate must never reach the adapter");
  dap.close();
  await srv.close();
});

test("dbg_stack_trace maps DAP stackFrames to the tool's frame shape", async () => {
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "stackTrace") dapResponse(s, m, { stackFrames: [{ id: 1, name: "_ready", source: { path: "/p/player.gd" }, line: 12 }] });
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_stack_trace")({})) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { frames: [{ id: 1, name: "_ready", source: "/p/player.gd", line: 12 }] });
  dap.close();
  await srv.close();
});

test("a failed DAP request surfaces as an isError result", async () => {
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "stackTrace") dapResponse(s, m, { message: "no stack while running" }, false);
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_stack_trace")({})) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /DAP error/);
  dap.close();
  await srv.close();
});

// ---- dbg_watch (watch expressions) ----------------------------------------

test("dbg_watch adds expressions, evaluates them in 'watch' context, and reports per-expression errors", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "evaluate") {
      const expr = (m.arguments as { expression: string }).expression;
      // DAP error responses carry a TOP-LEVEL `message`, not one inside `body`.
      if (expr === "bogus") { writeFrame(s, { seq: 0, type: "response", request_seq: m.seq, success: false, command: m.command, message: "not in scope" }); return; }
      dapResponse(s, m, { result: `${expr}=7`, type: "int" });
    }
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_watch")({ add: ["hp", "bogus"] })) as ToolResultLike;
  const sc = res.structuredContent as { watches: Array<{ expression: string; value: string; type: string; error: string | null }> };
  assert.equal(sc.watches.length, 2);
  assert.deepEqual(sc.watches[0], { expression: "hp", value: "hp=7", type: "int", error: null });
  assert.equal(sc.watches[1].expression, "bogus");
  assert.match(sc.watches[1].error ?? "", /not in scope/);
  const ev = received.find((m) => m.command === "evaluate");
  assert.equal((ev!.arguments as { context: string }).context, "watch", "watches must evaluate in the side-effect-free 'watch' context");
  dap.close();
  await srv.close();
});

test("dbg_watch persists the set and re-evaluates on a bare call (after a step/continue)", async () => {
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "evaluate") dapResponse(s, m, { result: "v", type: "int" });
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  await rec.handler("dbg_watch")({ add: ["a", "b"] });
  const res = (await rec.handler("dbg_watch")({})) as ToolResultLike; // no mutation → re-read
  const sc = res.structuredContent as { watches: Array<{ expression: string }> };
  assert.deepEqual(sc.watches.map((w) => w.expression), ["a", "b"]);
  dap.close();
  await srv.close();
});

test("dbg_watch remove and clear mutate the persistent set", async () => {
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "evaluate") dapResponse(s, m, { result: "v", type: "T" });
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  await rec.handler("dbg_watch")({ add: ["a", "b", "c"] });
  let sc = ((await rec.handler("dbg_watch")({ remove: ["b"] })) as ToolResultLike).structuredContent as { watches: Array<{ expression: string }> };
  assert.deepEqual(sc.watches.map((w) => w.expression), ["a", "c"]);
  sc = ((await rec.handler("dbg_watch")({ clear: true, add: ["z"] })) as ToolResultLike).structuredContent as { watches: Array<{ expression: string }> };
  assert.deepEqual(sc.watches.map((w) => w.expression), ["z"]);
  dap.close();
  await srv.close();
});

test("dbg_set_breakpoints forwards conditions, hit conditions, and log messages to the adapter (aligned by line)", async () => {
  let bpReq: DapMsg | undefined;
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "setBreakpoints") { bpReq = m; dapResponse(s, m, { breakpoints: [{ line: 10, verified: true }, { line: 20, verified: true }] }); }
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  await rec.handler("dbg_set_breakpoints")({
    path: "player.gd",
    lines: [10, 20],
    conditions: ["hp < 0"],
    hit_conditions: [null, ">3"],
    log_messages: [null, "hit {hp}"],
  });
  const bps = (bpReq!.arguments as { breakpoints: Array<Record<string, unknown>> }).breakpoints;
  assert.equal(bps[0].line, 10);
  assert.equal(bps[0].condition, "hp < 0");
  assert.equal(bps[0].hitCondition, undefined);
  assert.equal(bps[0].logMessage, undefined);
  assert.equal(bps[1].line, 20);
  assert.equal(bps[1].condition, undefined);
  assert.equal(bps[1].hitCondition, ">3");
  assert.equal(bps[1].logMessage, "hit {hp}");
  dap.close();
  await srv.close();
});
