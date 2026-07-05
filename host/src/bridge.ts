import net from "node:net";
import { randomUUID } from "node:crypto";
import { log } from "./logger.js";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class BridgeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

/**
 * TCP client for the in-editor Claude Bridge addon. Speaks newline-delimited
 * JSON. Requests are correlated to responses by `id`. Connects lazily and
 * transparently reconnects on the next request after a drop.
 */
export class BridgeClient {
  private socket: net.Socket | null = null;
  private connecting: Promise<net.Socket> | null = null;
  private buffer = "";
  private pending = new Map<string, Pending>();

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly defaultTimeoutMs: number,
    private readonly label = "editor bridge",
    private readonly hint = 'Is the editor open with the "Claude Bridge" plugin enabled?',
  ) {}

  private connect(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });

      socket.setNoDelay(true);
      socket.once("connect", () => {
        this.socket = socket;
        this.connecting = null;
        log(`bridge connected to ${this.host}:${this.port}`);
        resolve(socket);
      });
      socket.once("error", (err) => {
        this.connecting = null;
        reject(
          new BridgeError(
            "bridge_unavailable",
            `Cannot reach the Godot ${this.label} at ${this.host}:${this.port}. ${this.hint} (${err.message})`,
          ),
        );
      });
      socket.on("data", (chunk) => this.onData(chunk));
      socket.on("close", () => this.onClose());
    });

    return this.connecting;
  }

  private onData(chunk: Buffer | string): void {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let nl = this.buffer.indexOf("\n");
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.onMessage(line);
      nl = this.buffer.indexOf("\n");
    }
  }

  private onMessage(line: string): void {
    let msg: { id?: string; ok?: boolean; result?: unknown; error?: { code: string; message: string } };
    try {
      msg = JSON.parse(line);
    } catch {
      log("bridge sent non-JSON line:", line);
      return;
    }
    const id = msg.id;
    if (!id || !this.pending.has(id)) return;
    const p = this.pending.get(id)!;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (msg.ok) {
      p.resolve(msg.result ?? {});
    } else {
      const e = msg.error ?? { code: "unknown", message: "Unknown bridge error" };
      p.reject(new BridgeError(e.code, e.message));
    }
  }

  private onClose(): void {
    this.socket = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new BridgeError("bridge_closed", "Bridge connection closed before a response arrived"));
    }
    this.pending.clear();
  }

  /** Send one request and await its correlated response. */
  async request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<T> {
    const socket = await this.connect();
    const id = randomUUID();
    const payload = JSON.stringify({ id, method, params }) + "\n";

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError("timeout", `Bridge request '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      socket.write(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new BridgeError("write_failed", err.message));
        }
      });
    });
  }

  close(): void {
    if (this.socket) this.socket.destroy();
    this.socket = null;
  }
}
