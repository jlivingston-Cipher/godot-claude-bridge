import { EventEmitter } from "node:events";
import type { FramedMessage, JsonRpcChannel } from "./framing.js";
import { DapError, type DapState, type WatchResult } from "./dap.js";

interface Pending {
  command: string;
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface BufferedBreakpoints {
  path: string;
  lines: number[];
  /** Per-line condition expressions (DAP `condition`), aligned to `lines`. */
  conditions?: (string | null)[];
}

/**
 * Minimal DAP client for the C#/.NET debugging plane (D4 C3) — the debugger
 * analogue of the C2 `CsLspClient`. Transport-agnostic: it drives any
 * `JsonRpcChannel`, so production spawns **netcoredbg** (Samsung, MIT) over
 * stdio (`StdioChannel`) while unit tests point it at a loopback TCP mock
 * (`FramedConnection`) — exactly the way the GDScript `DapClient` tests and the
 * `CsLspClient` tests do.
 *
 * It is deliberately a sibling of `DapClient` rather than a shared base class —
 * matching the codebase's one-client-per-protocol precedent (dap.ts / lsp.ts,
 * and now cslsp.ts) — but reuses `DapError` / `DapState` and the framing
 * primitives so the protocol plumbing isn't re-invented. The only C#-specific
 * behaviors are the `coreclr` adapterID and pointing launch/attach at a .NET
 * program/process; everything else is standard DAP the same way Godot's built-in
 * debug adapter is. On top of read/inspect + a gated `setVariable`, it carries the
 * GDScript extras netcoredbg actually backs — persistent watches and a `restart()`
 * (terminate + relaunch, since netcoredbg advertises no `supportsRestartRequest`).
 * The exception-breakpoint extra needs no client method (the tool drives `request`
 * + capabilities directly). `goto` / data breakpoints are intentionally NOT ported:
 * netcoredbg advertises neither `supportsGotoTargetsRequest` nor
 * `supportsDataBreakpoints`, so those tools would be dead surface here.
 */
export class CsDapClient extends EventEmitter {
  private seq = 1;
  private pending = new Map<number, Pending>();
  private breakpoints = new Map<string, BufferedBreakpoints>();
  private configured = false;
  /** Persistent watch expressions, re-evaluated at each stop (see evaluateWatches). */
  private watches: string[] = [];
  private lastStartMode: "launch" | "attach" | null = null;
  private lastStartArgs: Record<string, unknown> | null = null;

  capabilities: Record<string, unknown> | null = null;
  state: DapState = "disconnected";
  lastStoppedThreadId: number | null = null;
  lastStoppedReason: string | null = null;

  constructor(
    private readonly channel: JsonRpcChannel,
    private readonly timeoutMs: number,
  ) {
    super();
    this.channel.onMessage((m) => this.onMessage(m));
    this.channel.onClose(() => {
      this.state = "terminated";
      this.configured = false;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new DapError(p.command, "C# DAP connection closed"));
      }
      this.pending.clear();
      this.emit("closed");
    });
  }

  private onMessage(msg: FramedMessage): void {
    const type = msg["type"];
    if (type === "response") {
      const reqSeq = msg["request_seq"] as number;
      const p = this.pending.get(reqSeq);
      if (!p) return;
      this.pending.delete(reqSeq);
      clearTimeout(p.timer);
      if (msg["success"]) {
        p.resolve((msg["body"] ?? {}) as Record<string, unknown>);
      } else {
        p.reject(new DapError(String(msg["command"] ?? p.command), String(msg["message"] ?? "C# DAP request failed")));
      }
    } else if (type === "event") {
      this.onEvent(String(msg["event"]), (msg["body"] ?? {}) as Record<string, unknown>);
    } else if (type === "request") {
      // Reverse request (e.g. runInTerminal). Ack success so the adapter never stalls.
      void this.channel.send({
        seq: this.seq++,
        type: "response",
        request_seq: msg["seq"],
        success: true,
        command: msg["command"],
      });
    }
  }

  private onEvent(event: string, body: Record<string, unknown>): void {
    switch (event) {
      case "initialized":
        this.emit("initialized");
        break;
      case "stopped":
        this.state = "stopped";
        this.lastStoppedThreadId = (body["threadId"] as number) ?? this.lastStoppedThreadId ?? 1;
        this.lastStoppedReason = (body["reason"] as string) ?? null;
        this.emit("stopped", body);
        break;
      case "continued":
        this.state = "running";
        break;
      case "terminated":
      case "exited":
        this.state = "terminated";
        this.emit("terminated", body);
        break;
      case "output":
        this.emit("output", body);
        break;
      default:
        break;
    }
  }

  request<T extends Record<string, unknown> = Record<string, unknown>>(
    command: string,
    args: unknown = {},
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const seq = this.seq++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new DapError(command, `C# DAP '${command}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(seq, { command, resolve: resolve as (v: Record<string, unknown>) => void, reject, timer });
      this.channel.send({ seq, type: "request", command, arguments: args }).catch((err: Error) => {
        clearTimeout(timer);
        this.pending.delete(seq);
        reject(err);
      });
    });
  }

  private waitEvent(name: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.removeListener(name, onEvent);
        resolve();
      }, timeoutMs);
      const onEvent = () => {
        clearTimeout(timer);
        resolve();
      };
      this.once(name, onEvent);
    });
  }

  /** Store breakpoints; apply immediately if the session is already configured, else buffer until launch/attach. */
  async setBreakpoints(path: string, lines: number[], conditions?: (string | null)[]): Promise<Record<string, unknown>> {
    this.breakpoints.set(path, { path, lines, conditions });
    if (this.configured) return this.applyBreakpoints(path);
    return { buffered: true, path, lines };
  }

  private applyBreakpoints(path: string): Promise<Record<string, unknown>> {
    const bp = this.breakpoints.get(path);
    if (!bp) return Promise.resolve({});
    return this.request("setBreakpoints", {
      source: { path },
      breakpoints: bp.lines.map((line, i) => {
        const b: { line: number; condition?: string } = { line };
        const condition = bp.conditions?.[i];
        if (condition) b.condition = condition;
        return b;
      }),
    });
  }

  // ---- Watch expressions ---------------------------------------------------

  /** Add expressions to the persistent watch set (deduped, order-preserving). */
  addWatches(expressions: string[]): void {
    for (const e of expressions) if (e && !this.watches.includes(e)) this.watches.push(e);
  }

  /** Remove specific expressions from the watch set. */
  removeWatches(expressions: string[]): void {
    const drop = new Set(expressions);
    this.watches = this.watches.filter((e) => !drop.has(e));
  }

  /** Clear all watch expressions. */
  clearWatches(): void {
    this.watches = [];
  }

  /** The current watch set (a copy). */
  listWatches(): string[] {
    return [...this.watches];
  }

  /**
   * Evaluate every watch expression in the context of a stopped frame and return
   * the results. Each is evaluated with DAP `context: "watch"` (the side-effect-free
   * context IDEs use for watch panels). A single bad expression yields an `error` on
   * that entry instead of failing the whole call. `timeoutMs` bounds each individual
   * `evaluate` (callers pass the shorter `csDapEvaluateTimeoutMs`) so a watch the
   * adapter never answers fails fast on that entry rather than hanging the full DAP
   * timeout at every stop — mirroring `cs_dbg_evaluate` and the GDScript `DapClient`.
   */
  async evaluateWatches(frameId?: number, timeoutMs = this.timeoutMs): Promise<WatchResult[]> {
    const results: WatchResult[] = [];
    for (const expression of this.watches) {
      try {
        const body = await this.request("evaluate", { expression, frameId, context: "watch" }, timeoutMs);
        results.push({ expression, value: String(body["result"] ?? ""), type: String(body["type"] ?? ""), error: null });
      } catch (err) {
        const e = err as { message?: string };
        results.push({ expression, value: "", type: "", error: e.message ?? String(err) });
      }
    }
    return results;
  }

  private async applyAllBreakpoints(): Promise<void> {
    for (const path of this.breakpoints.keys()) {
      await this.applyBreakpoints(path).catch(() => undefined);
    }
  }

  /** Full handshake: initialize → launch/attach → (breakpoints) → configurationDone. */
  async start(mode: "launch" | "attach", args: Record<string, unknown>): Promise<void> {
    this.lastStartMode = mode;
    this.lastStartArgs = args;
    // Listen for `initialized` before we ask, so we cannot miss it.
    const onInit = this.waitEvent("initialized", Math.min(this.timeoutMs, 5000));
    this.capabilities = await this.request("initialize", {
      clientID: "godot-claude-bridge",
      clientName: "Godot Claude Bridge",
      adapterID: "coreclr",
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
    });
    this.state = "initialized";

    // Send launch/attach but don't await it yet — many adapters (netcoredbg included)
    // only resolve it after configurationDone.
    const startReq = this.request(mode, args);
    await onInit;
    await this.applyAllBreakpoints();
    await this.request("configurationDone", {}).catch(() => undefined);
    this.configured = true;
    this.state = "running";
    // Surface a launch/attach failure if one occurs, but don't hang on success.
    startReq.catch((err) => this.emit("error", err));
  }

  threadId(): number {
    return this.lastStoppedThreadId ?? 1;
  }

  /**
   * Issue a resume command (continue / next / stepIn / stepOut) and wait for the
   * program to settle again — the next `stopped` (hit a breakpoint / step landed)
   * or `terminated` event — before returning. The stop listener is armed BEFORE
   * the command is sent so a fast stop can't be missed. If nothing settles within
   * `waitMs` (e.g. `continue` runs on with no further breakpoint), it resolves with
   * the current state ("running").
   */
  async resume(
    command: string,
    args: Record<string, unknown>,
    waitMs: number,
  ): Promise<{ state: DapState; reason: string | null }> {
    const settled = new Promise<{ state: DapState; reason: string | null }>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.removeListener("stopped", onStop);
        this.removeListener("terminated", onTerm);
        resolve({ state: this.state, reason: this.lastStoppedReason });
      };
      const onStop = () => finish();
      const onTerm = () => finish();
      const timer = setTimeout(() => {
        this.removeListener("stopped", onStop);
        this.removeListener("terminated", onTerm);
        resolve({ state: this.state, reason: this.lastStoppedReason });
      }, waitMs);
      this.once("stopped", onStop);
      this.once("terminated", onTerm);
    });
    // Optimistically mark running so a stale "stopped" isn't reported back.
    this.state = "running";
    await this.request(command, args);
    return settled;
  }

  /**
   * Resolve when the program next settles (`stopped`/`terminated`) or `waitMs`
   * elapses — the shared wait used after a restart. Listeners are armed by the
   * caller BEFORE the triggering request is sent so a fast settle can't be missed.
   */
  private settle(waitMs: number): Promise<{ state: DapState; reason: string | null }> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.removeListener("stopped", onStop);
        this.removeListener("terminated", onTerm);
        resolve({ state: this.state, reason: this.lastStoppedReason });
      };
      const onStop = () => finish();
      const onTerm = () => finish();
      const timer = setTimeout(() => {
        this.removeListener("stopped", onStop);
        this.removeListener("terminated", onTerm);
        resolve({ state: this.state, reason: this.lastStoppedReason });
      }, waitMs);
      this.once("stopped", onStop);
      this.once("terminated", onTerm);
    });
  }

  /**
   * Restart the debug session. If the adapter advertises `supportsRestartRequest`,
   * issue a single DAP `restart` (carrying the launch/attach args); otherwise fall
   * back to `terminate` + a fresh handshake, so restart works on every adapter.
   * netcoredbg advertises no `supportsRestartRequest`, so in practice the relaunch
   * path runs. Reuses the last cs_dbg_launch/cs_dbg_attach params; `overrideArgs`
   * (e.g. a new `stopAtEntry`) are merged over them. `method` tells the caller which
   * path ran. C# sessions have no scene, so — unlike the GDScript `DapClient` — this
   * returns no `scene`.
   */
  async restart(
    overrideArgs: Record<string, unknown> = {},
    waitMs = 15000,
  ): Promise<{ method: "restart" | "relaunch"; state: DapState; reason: string | null }> {
    if (!this.lastStartMode || !this.lastStartArgs) {
      throw new DapError("restart", "no C# debug session to restart — call cs_dbg_launch or cs_dbg_attach first");
    }
    const args = { ...this.lastStartArgs, ...overrideArgs };
    if (this.capabilities?.["supportsRestartRequest"] === true) {
      // Arm the settle listener before issuing restart so a fast stop isn't missed.
      const settled = this.settle(waitMs);
      this.state = "running";
      await this.request("restart", { arguments: args });
      this.lastStartArgs = args;
      const r = await settled;
      return { method: "restart", state: r.state, reason: r.reason };
    }
    // Fallback: ask the debuggee to terminate (best-effort), then re-run the full
    // initialize → launch/attach → configurationDone handshake with the same args.
    await this.request("terminate", {}).catch(() => undefined);
    await this.start(this.lastStartMode, args);
    return { method: "relaunch", state: this.state, reason: this.lastStoppedReason };
  }

  close(): void {
    this.channel.close();
    this.state = "disconnected";
    this.configured = false;
  }
}
