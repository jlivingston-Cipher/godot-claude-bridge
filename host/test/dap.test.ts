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

test("dbg_set_breakpoints forwards conditions, hit conditions, and log messages when the adapter advertises support for them", async () => {
  let bpReq: DapMsg | undefined;
  const { srv } = await startDap((m, s) => {
    if (m.command === "initialize") {
      dapResponse(s, m, { supportsConfigurationDoneRequest: true, supportsConditionalBreakpoints: true, supportsHitConditionalBreakpoints: true, supportsLogPoints: true });
      dapEvent(s, "initialized", {});
      return;
    }
    if (m.command === "launch" || m.command === "configurationDone") { dapResponse(s, m, {}); return; }
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

test("dbg_set_breakpoints drops condition/hitCondition/logMessage and warns when the adapter advertises them unsupported", async () => {
  // The default handshake advertises NONE of the modifier caps — like Godot 4.3, which
  // also IGNORES the fields (verified live), so a "conditional" breakpoint would halt every
  // time. The tool must drop the modifiers, send only plain line breakpoints, and warn.
  let bpReq: DapMsg | undefined;
  const { srv } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "setBreakpoints") { bpReq = m; dapResponse(s, m, { breakpoints: [{ line: 10, verified: true }, { line: 20, verified: true }] }); }
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_set_breakpoints")({
    path: "player.gd",
    lines: [10, 20],
    conditions: ["hp < 0"],
    hit_conditions: [null, ">3"],
    log_messages: [null, "hit {hp}"],
  })) as ToolResultLike;
  const sc = res.structuredContent as { unsupported_modifiers?: string[]; warning?: string; breakpoints: unknown[] };
  assert.deepEqual(sc.unsupported_modifiers, ["condition", "hitCondition", "logMessage"]);
  assert.match(sc.warning ?? "", /unsupported|halt unconditionally/i);
  // The dropped modifiers must NOT reach the adapter — only plain line breakpoints do.
  const bps = (bpReq!.arguments as { breakpoints: Array<Record<string, unknown>> }).breakpoints;
  assert.deepEqual(bps.map((b) => b.line), [10, 20]);
  assert.equal(bps[0].condition, undefined);
  assert.equal(bps[1].hitCondition, undefined);
  assert.equal(bps[1].logMessage, undefined);
  dap.close();
  await srv.close();
});

// ---- dbg_set_exception_breakpoints ----------------------------------------

test("dbg_set_exception_breakpoints forwards filters and reports the adapter's advertised available_filters", async () => {
  let bpReq: DapMsg | undefined;
  const { srv } = await startDap((m, s) => {
    if (m.command === "initialize") {
      dapResponse(s, m, { supportsConfigurationDoneRequest: true, exceptionBreakpointFilters: [
        { filter: "raise", label: "Runtime errors" }, { filter: "assert", label: "Assertion failures" },
      ] });
      dapEvent(s, "initialized", {});
      return;
    }
    if (m.command === "launch" || m.command === "configurationDone") { dapResponse(s, m, {}); return; }
    if (m.command === "setExceptionBreakpoints") { bpReq = m; dapResponse(s, m, { breakpoints: [{ verified: true }] }); }
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_set_exception_breakpoints")({ filters: ["raise"] })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, {
    filters: ["raise"],
    available_filters: [{ filter: "raise", label: "Runtime errors" }, { filter: "assert", label: "Assertion failures" }],
    breakpoints: [{ verified: true }],
  });
  assert.deepEqual((bpReq!.arguments as { filters: string[] }).filters, ["raise"]);
  dap.close();
  await srv.close();
});

test("dbg_set_exception_breakpoints returns 'unsupported' without sending the request when the adapter advertises no filters", async () => {
  // The default handshake advertises NO exceptionBreakpointFilters (like Godot 4.3,
  // which also never answers setExceptionBreakpoints — it would time out). The tool
  // must short-circuit to a clear message instead of sending a request that hangs.
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "setExceptionBreakpoints") dapResponse(s, m, {});
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_set_exception_breakpoints")({ filters: ["raise"] })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /unsupported/i);
  assert.ok(!received.some((m) => m.command === "setExceptionBreakpoints"), "must not send setExceptionBreakpoints when no filters are advertised");
  dap.close();
  await srv.close();
});

test("dbg_set_exception_breakpoints clears filters (filters: []) when the adapter advertises some", async () => {
  let bpReq: DapMsg | undefined;
  const { srv } = await startDap((m, s) => {
    if (m.command === "initialize") {
      dapResponse(s, m, { supportsConfigurationDoneRequest: true, exceptionBreakpointFilters: [
        { filter: "raise", label: "Runtime errors" },
      ] });
      dapEvent(s, "initialized", {});
      return;
    }
    if (m.command === "launch" || m.command === "configurationDone") { dapResponse(s, m, {}); return; }
    if (m.command === "setExceptionBreakpoints") { bpReq = m; dapResponse(s, m, { breakpoints: [] }); }
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_set_exception_breakpoints")({})) as ToolResultLike;
  assert.deepEqual(res.structuredContent, {
    filters: [],
    available_filters: [{ filter: "raise", label: "Runtime errors" }],
    breakpoints: [],
  });
  assert.deepEqual((bpReq!.arguments as { filters: string[] }).filters, []);
  dap.close();
  await srv.close();
});

// ---- dbg_set_variable (gated) ---------------------------------------------

test("dbg_set_variable proceeds with confirm:true and returns the adapter's updated value", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "setVariable") dapResponse(s, m, { value: "5", type: "int", variablesReference: 0 });
  });
  const { dap, rec } = dapHarness(srv.port, async () => ({ action: "decline" }));
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_set_variable")({ variables_ref: 1001, name: "hp", value: "5", confirm: true })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { name: "hp", value: "5", type: "int", variables_ref: 0 });
  const sv = received.find((m) => m.command === "setVariable");
  assert.deepEqual(sv!.arguments, { variablesReference: 1001, name: "hp", value: "5" });
  dap.close();
  await srv.close();
});

test("dbg_set_variable is blocked (and sends no setVariable) when the user declines confirmation", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    if (m.command === "setVariable") dapResponse(s, m, { value: "should-not-happen" });
  });
  const { dap, rec } = dapHarness(srv.port, async () => ({ action: "decline" }));
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_set_variable")({ variables_ref: 1001, name: "hp", value: "0" })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.ok(!received.some((m) => m.command === "setVariable"), "a declined setVariable must never reach the adapter");
  dap.close();
  await srv.close();
});

test("dbg_set_variable returns 'unsupported' WITHOUT prompting when the adapter advertises supportsSetVariable:false", async () => {
  let elicited = 0;
  const { srv, received } = await startDap((m, s) => {
    if (m.command === "initialize") { dapResponse(s, m, { supportsConfigurationDoneRequest: true, supportsSetVariable: false }); dapEvent(s, "initialized", {}); return; }
    if (m.command === "launch" || m.command === "configurationDone") { dapResponse(s, m, {}); return; }
    if (m.command === "setVariable") dapResponse(s, m, { value: "nope" });
  });
  const { dap, rec } = dapHarness(srv.port, async () => { elicited++; return { action: "accept", content: { proceed: true } }; });
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_set_variable")({ variables_ref: 1, name: "hp", value: "5" })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /unsupported/i);
  assert.equal(elicited, 0, "must not prompt when the capability is unsupported");
  assert.ok(!received.some((m) => m.command === "setVariable"));
  dap.close();
  await srv.close();
});

// Godot 4.3 advertises supportsSetVariable=true (so the caps short-circuit does NOT fire)
// but then never answers the setVariable request. Without a bounded deadline the tool would
// hang the full dapTimeoutMs; these assert the fast, clear failure via GODOT_DAP_*_TIMEOUT_MS.
test("dbg_set_variable fails fast with a clear message when the adapter advertises supportsSetVariable but never answers", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (m.command === "initialize") { dapResponse(s, m, { supportsConfigurationDoneRequest: true, supportsSetVariable: true }); dapEvent(s, "initialized", {}); return; }
    if (m.command === "launch" || m.command === "configurationDone") { dapResponse(s, m, {}); return; }
    // setVariable: deliberately never respond (mirrors Godot 4.3's advertised-but-unimplemented gap)
  });
  process.env.GODOT_DAP_SETVAR_TIMEOUT_MS = "200";
  const { dap, rec } = dapHarness(srv.port, async () => ({ action: "accept", content: { proceed: true } }));
  delete process.env.GODOT_DAP_SETVAR_TIMEOUT_MS;
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_set_variable")({ variables_ref: 1, name: "hp", value: "5", confirm: true })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /did not answer the setVariable request within 200ms/i);
  assert.match(res.content![0].text!, /no change was made/i);
  assert.ok(received.some((m) => m.command === "setVariable"), "the tool must actually send setVariable (caps advertise it) before the bounded deadline fires");
  dap.close();
  await srv.close();
});

test("dbg_evaluate fails fast with a clear message when the adapter never answers evaluate", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (handshake(m, s)) return;
    // evaluate: deliberately never respond
  });
  process.env.GODOT_DAP_EVALUATE_TIMEOUT_MS = "200";
  const { dap, rec } = dapHarness(srv.port, async () => ({ action: "accept", content: { proceed: true } }));
  delete process.env.GODOT_DAP_EVALUATE_TIMEOUT_MS;
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_evaluate")({ expression: "1 + 1", confirm: true })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /did not answer the evaluate request within 200ms/i);
  assert.ok(received.some((m) => m.command === "evaluate"), "the tool must send evaluate before the bounded deadline fires");
  dap.close();
  await srv.close();
});

// ---- dbg_restart -----------------------------------------------------------

test("dbg_restart uses the DAP restart request when the adapter advertises supportsRestartRequest", async () => {
  let restarted = false;
  const { srv, received } = await startDap((m, s) => {
    if (m.command === "initialize") { dapResponse(s, m, { supportsConfigurationDoneRequest: true, supportsRestartRequest: true }); dapEvent(s, "initialized", {}); return; }
    if (m.command === "launch" || m.command === "configurationDone") { dapResponse(s, m, {}); return; }
    if (m.command === "restart") { restarted = true; dapResponse(s, m, {}); dapEvent(s, "stopped", { reason: "entry", threadId: 1 }); }
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_restart")({})) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { session_id: "godot", method: "restart", state: "stopped", scene: "main" });
  assert.ok(restarted, "must issue the DAP 'restart' command");
  assert.ok(!received.some((m) => m.command === "terminate"), "a native restart must not terminate the session");
  dap.close();
  await srv.close();
});

test("dbg_restart falls back to terminate + relaunch when the adapter does not support restart (scene overridable)", async () => {
  let initializes = 0; let terminated = false;
  const { srv, received } = await startDap((m, s) => {
    if (m.command === "initialize") { initializes++; dapResponse(s, m, { supportsConfigurationDoneRequest: true }); dapEvent(s, "initialized", {}); return; }
    if (m.command === "launch" || m.command === "configurationDone") { dapResponse(s, m, {}); return; }
    if (m.command === "terminate") { terminated = true; dapResponse(s, m, {}); return; }
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_restart")({ scene: "current" })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { session_id: "godot", method: "relaunch", state: "running", scene: "current" });
  assert.ok(terminated, "the fallback must terminate the old session");
  assert.equal(initializes, 2, "the fallback must re-run the initialize handshake");
  assert.ok(!received.some((m) => m.command === "restart"), "must not send restart when unsupported");
  dap.close();
  await srv.close();
});

test("dbg_restart errors when there is no session to restart", async () => {
  const { srv } = await startDap((m, s) => { handshake(m, s); });
  const { dap, rec } = dapHarness(srv.port);
  const res = (await rec.handler("dbg_restart")({})) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /no debug session/i);
  dap.close();
  await srv.close();
});

// ---- dbg_goto (gotoTargets + goto, gated) ----------------------------------

test("dbg_goto lists gotoTargets and does not jump when the line has multiple targets", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (m.command === "initialize") { dapResponse(s, m, { supportsConfigurationDoneRequest: true, supportsGotoTargetsRequest: true }); dapEvent(s, "initialized", {}); return; }
    if (m.command === "launch" || m.command === "configurationDone") { dapResponse(s, m, {}); return; }
    if (m.command === "gotoTargets") { dapResponse(s, m, { targets: [{ id: 1, label: "line 12 a", line: 12 }, { id: 2, label: "line 12 b", line: 12 }] }); }
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_goto")({ path: "player.gd", line: 12 })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, {
    targets: [{ id: 1, label: "line 12 a", line: 12 }, { id: 2, label: "line 12 b", line: 12 }],
    jumped: false, target_id: null,
  });
  assert.ok(!received.some((m) => m.command === "goto"), "listing targets must not jump");
  dap.close();
  await srv.close();
});

test("dbg_goto jumps to the sole target with confirm:true and issues DAP goto", async () => {
  let gotoArgs: Record<string, unknown> | undefined;
  const { srv } = await startDap((m, s) => {
    if (m.command === "initialize") { dapResponse(s, m, { supportsConfigurationDoneRequest: true, supportsGotoTargetsRequest: true }); dapEvent(s, "initialized", {}); return; }
    if (m.command === "launch" || m.command === "configurationDone") { dapResponse(s, m, {}); return; }
    if (m.command === "gotoTargets") { dapResponse(s, m, { targets: [{ id: 7, label: "line 20", line: 20 }] }); return; }
    if (m.command === "goto") { gotoArgs = m.arguments; dapResponse(s, m, {}); }
  });
  const { dap, rec } = dapHarness(srv.port, async () => ({ action: "decline" }));
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_goto")({ path: "player.gd", line: 20, confirm: true })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { targets: [{ id: 7, label: "line 20", line: 20 }], jumped: true, target_id: 7 });
  assert.deepEqual(gotoArgs, { threadId: 1, targetId: 7 });
  dap.close();
  await srv.close();
});

test("dbg_goto is blocked (and issues no goto) when the user declines confirmation", async () => {
  const { srv, received } = await startDap((m, s) => {
    if (m.command === "initialize") { dapResponse(s, m, { supportsConfigurationDoneRequest: true, supportsGotoTargetsRequest: true }); dapEvent(s, "initialized", {}); return; }
    if (m.command === "launch" || m.command === "configurationDone") { dapResponse(s, m, {}); return; }
    if (m.command === "gotoTargets") { dapResponse(s, m, { targets: [{ id: 7, label: "line 20", line: 20 }] }); return; }
    if (m.command === "goto") { dapResponse(s, m, {}); }
  });
  const { dap, rec } = dapHarness(srv.port, async () => ({ action: "decline" }));
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_goto")({ path: "player.gd", line: 20 })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.ok(!received.some((m) => m.command === "goto"), "a declined goto must never reach the adapter");
  dap.close();
  await srv.close();
});

test("dbg_goto returns 'unsupported' WITHOUT prompting when the adapter lacks supportsGotoTargetsRequest", async () => {
  let elicited = 0;
  const { srv, received } = await startDap((m, s) => { if (handshake(m, s)) return; if (m.command === "gotoTargets") dapResponse(s, m, { targets: [] }); });
  const { dap, rec } = dapHarness(srv.port, async () => { elicited++; return { action: "accept", content: { proceed: true } }; });
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_goto")({ path: "player.gd", line: 20 })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /unsupported/i);
  assert.equal(elicited, 0, "must not prompt when the capability is unsupported");
  assert.ok(!received.some((m) => m.command === "gotoTargets"), "must not query targets when unsupported");
  dap.close();
  await srv.close();
});

// ---- dbg_data_breakpoints (dataBreakpointInfo + setDataBreakpoints) --------

test("dbg_data_breakpoints resolves dataIds and arms them, reporting verified + unresolved", async () => {
  let setArgs: Record<string, unknown> | undefined;
  const { srv } = await startDap((m, s) => {
    if (m.command === "initialize") { dapResponse(s, m, { supportsConfigurationDoneRequest: true, supportsDataBreakpoints: true }); dapEvent(s, "initialized", {}); return; }
    if (m.command === "launch" || m.command === "configurationDone") { dapResponse(s, m, {}); return; }
    if (m.command === "dataBreakpointInfo") {
      const name = (m.arguments as { name: string }).name;
      if (name === "hp") { dapResponse(s, m, { dataId: "hp@1", description: "hp" }); return; }
      dapResponse(s, m, { dataId: null, description: "not watchable" }); return;
    }
    if (m.command === "setDataBreakpoints") { setArgs = m.arguments; dapResponse(s, m, { breakpoints: [{ verified: true }] }); }
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_data_breakpoints")({ watch: [{ name: "hp", variables_ref: 1001, access_type: "write" }, { name: "nope" }] })) as ToolResultLike;
  assert.deepEqual(res.structuredContent, {
    breakpoints: [{ name: "hp", data_id: "hp@1", verified: true }],
    unresolved: [{ name: "nope", reason: "not watchable" }],
  });
  assert.deepEqual(setArgs, { breakpoints: [{ dataId: "hp@1", accessType: "write" }] });
  dap.close();
  await srv.close();
});

test("dbg_data_breakpoints with no watches clears all data breakpoints", async () => {
  let setArgs: Record<string, unknown> | undefined;
  const { srv, received } = await startDap((m, s) => {
    if (m.command === "initialize") { dapResponse(s, m, { supportsConfigurationDoneRequest: true, supportsDataBreakpoints: true }); dapEvent(s, "initialized", {}); return; }
    if (m.command === "launch" || m.command === "configurationDone") { dapResponse(s, m, {}); return; }
    if (m.command === "setDataBreakpoints") { setArgs = m.arguments; dapResponse(s, m, { breakpoints: [] }); }
  });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_data_breakpoints")({})) as ToolResultLike;
  assert.deepEqual(res.structuredContent, { breakpoints: [], unresolved: [] });
  assert.deepEqual(setArgs, { breakpoints: [] });
  assert.ok(!received.some((m) => m.command === "dataBreakpointInfo"), "clearing needs no dataBreakpointInfo");
  dap.close();
  await srv.close();
});

test("dbg_data_breakpoints returns 'unsupported' without sending requests when the adapter lacks supportsDataBreakpoints", async () => {
  const { srv, received } = await startDap((m, s) => { handshake(m, s); });
  const { dap, rec } = dapHarness(srv.port);
  await rec.handler("dbg_launch")({ scene: "main" });
  const res = (await rec.handler("dbg_data_breakpoints")({ watch: [{ name: "hp" }] })) as ToolResultLike;
  assert.equal(res.isError, true);
  assert.match(res.content![0].text!, /unsupported/i);
  assert.ok(!received.some((m) => m.command === "dataBreakpointInfo" || m.command === "setDataBreakpoints"), "no DAP requests when unsupported");
  dap.close();
  await srv.close();
});
