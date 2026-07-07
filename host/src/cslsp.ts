import { fileURLToPath } from "node:url";
import type { FramedMessage, JsonRpcChannel } from "./framing.js";
import { LspError, type Diagnostic } from "./lsp.js";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Minimal LSP client for the C#/.NET semantic plane (D4 C2). Transport-agnostic:
 * it drives any `JsonRpcChannel`, so production spawns OmniSharp over stdio
 * (`StdioChannel`) while unit tests point it at a loopback TCP mock (`FramedConnection`)
 * exactly as the GDScript `LspClient` tests do.
 *
 * It is deliberately a sibling of `LspClient` rather than a shared base class —
 * matching the codebase's one-client-per-protocol precedent (lsp.ts / dap.ts) —
 * but reuses `LspError`, `Diagnostic`, and the framing primitives so the protocol
 * plumbing isn't re-invented. The only C#-specific behaviors are the `csharp`
 * `languageId` on didOpen and pointing at the C# project root; everything else is
 * standard LSP the same way Godot's GDScript server is.
 */
export class CsLspClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private initialized: Promise<unknown> | null = null;
  private serverCapabilities: Record<string, unknown> | null = null;
  private opened = new Set<string>();
  private diagnostics = new Map<string, Diagnostic[]>();
  private diagWaiters = new Map<string, Array<() => void>>();
  /** Absolute project root path (no trailing slash), used to canonicalize URIs. */
  private readonly rootFsPath: string;

  constructor(
    private readonly channel: JsonRpcChannel,
    private readonly rootUri: string,
    private readonly timeoutMs: number,
  ) {
    let root = "";
    try {
      root = fileURLToPath(rootUri);
    } catch {
      root = rootUri.replace(/^file:\/\//, "");
    }
    this.rootFsPath = root.replace(/[\\/]+$/, "");
    this.channel.onMessage((m) => this.onMessage(m));
    this.channel.onClose(() => this.onClose());
  }

  /**
   * Reduce any document URI to a stable, project-relative key (e.g. "Player.cs")
   * so a published-diagnostics URI matches the one we opened the file with,
   * regardless of how the server spells it (percent-encoded vs literal `file://`).
   * Mirrors LspClient.diagKey; OmniSharp uses `file://` URIs, but keeping the
   * `res://` branch costs nothing and keeps the two clients uniform.
   */
  private diagKey(uri: string): string {
    let s = uri;
    try {
      s = decodeURIComponent(uri);
    } catch {
      /* keep raw on malformed encoding */
    }
    if (s.startsWith("res://")) return s.slice("res://".length).replace(/^[\\/]+/, "");
    if (s.startsWith("file://")) s = s.slice("file://".length);
    if (this.rootFsPath && s.startsWith(this.rootFsPath)) s = s.slice(this.rootFsPath.length);
    return s.replace(/\\/g, "/").replace(/^\/+/, "");
  }

  private onMessage(msg: FramedMessage): void {
    const id = msg["id"];
    const method = msg["method"];

    // Response to one of our requests.
    if (typeof id === "number" && method === undefined) {
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      clearTimeout(p.timer);
      if (msg["error"]) {
        const e = msg["error"] as { code?: number; message?: string };
        p.reject(new LspError(e.code ?? -1, e.message ?? "LSP error"));
      } else {
        p.resolve(msg["result"] ?? null);
      }
      return;
    }

    // Server -> client notification.
    if (typeof method === "string" && id === undefined) {
      if (method === "textDocument/publishDiagnostics") {
        const params = (msg["params"] ?? {}) as { uri?: string; diagnostics?: unknown[] };
        const uri = params.uri ?? "";
        const diags: Diagnostic[] = (params.diagnostics ?? []).map((d) => {
          const dd = d as { severity?: number; message?: string; range?: { start?: { line?: number; character?: number } } };
          return {
            severity: dd.severity ?? 1,
            message: dd.message ?? "",
            line: dd.range?.start?.line ?? 0,
            character: dd.range?.start?.character ?? 0,
          };
        });
        const key = this.diagKey(uri);
        this.diagnostics.set(key, diags);
        const waiters = this.diagWaiters.get(key);
        if (waiters) {
          this.diagWaiters.delete(key);
          for (const w of waiters) w();
        }
      }
      return;
    }

    // Server -> client request (e.g. client/registerCapability, or OmniSharp's
    // window/workDoneProgress/create): ack with null so the server never blocks
    // waiting for us.
    if (typeof method === "string" && typeof id === "number") {
      void this.channel.send({ jsonrpc: "2.0", id, result: null });
    }
  }

  private onClose(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new LspError("closed", "C# LSP connection closed"));
    }
    this.pending.clear();
    this.initialized = null;
    this.serverCapabilities = null;
    this.opened.clear();
  }

  private rawRequest<T = unknown>(method: string, params: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LspError("timeout", `C# LSP '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.channel.send({ jsonrpc: "2.0", id, method, params }).catch((err: Error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  private notify(method: string, params: unknown): Promise<void> {
    return this.channel.send({ jsonrpc: "2.0", method, params });
  }

  private ensureInitialized(): Promise<unknown> {
    if (!this.initialized) {
      this.initialized = (async () => {
        const result = (await this.rawRequest("initialize", {
          processId: process.pid,
          rootUri: this.rootUri,
          rootPath: decodeURIComponent(this.rootUri.replace(/^file:\/\//, "")),
          capabilities: {
            textDocument: {
              synchronization: { didSave: true, dynamicRegistration: false },
              completion: { completionItem: { snippetSupport: false } },
              hover: { contentFormat: ["plaintext", "markdown"] },
              definition: {},
              references: {},
              documentSymbol: { hierarchicalDocumentSymbolSupport: true },
              signatureHelp: {},
              publishDiagnostics: {},
            },
            workspace: { symbol: {}, workspaceFolders: true },
          },
          workspaceFolders: [{ uri: this.rootUri, name: "csharp-project" }],
          clientInfo: { name: "godot-claude-bridge", version: "0.2.0" },
        })) as { capabilities?: Record<string, unknown> } | null;
        this.serverCapabilities = result?.capabilities ?? {};
        await this.notify("initialized", {});
        return result;
      })();
    }
    return this.initialized;
  }

  async request<T = unknown>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    await this.ensureInitialized();
    return this.rawRequest<T>(method, params, timeoutMs);
  }

  /**
   * The server's advertised capabilities from the `initialize` handshake (an
   * empty object if none). Lets a cs_* tool feature-detect an optional LSP method
   * before calling it, instead of surfacing a raw `-32601 Method not found`.
   */
  async getServerCapabilities(): Promise<Record<string, unknown>> {
    await this.ensureInitialized();
    return this.serverCapabilities ?? {};
  }

  async ensureOpen(uri: string, text: string): Promise<void> {
    if (this.opened.has(uri)) return;
    await this.ensureInitialized();
    this.opened.add(uri);
    await this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "csharp", version: 1, text },
    });
  }

  /** Return cached diagnostics for a URI, waiting up to timeoutMs for the first publish. */
  waitForDiagnostics(uri: string, timeoutMs: number): Promise<Diagnostic[]> {
    const key = this.diagKey(uri);
    if (this.diagnostics.has(key)) return Promise.resolve(this.diagnostics.get(key)!);
    return new Promise<Diagnostic[]>((resolve) => {
      const timer = setTimeout(() => resolve(this.diagnostics.get(key) ?? []), timeoutMs);
      const arr = this.diagWaiters.get(key) ?? [];
      arr.push(() => {
        clearTimeout(timer);
        resolve(this.diagnostics.get(key) ?? []);
      });
      this.diagWaiters.set(key, arr);
    });
  }

  close(): void {
    this.channel.close();
  }
}
