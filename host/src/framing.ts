import net from "node:net";
import { log } from "./logger.js";

export type FramedMessage = Record<string, unknown>;

/**
 * The narrow surface an LSP/DAP client needs from its transport: send a JSON
 * message, be told when one arrives or the link drops, and close. Both the
 * raw-TCP `FramedConnection` (Godot's LSP/DAP) and the subprocess-backed
 * `StdioChannel` (OmniSharp, spawned over stdio) satisfy it, so a protocol
 * client can be written once against the interface and unit-tested over TCP
 * while running over stdio in production.
 */
export interface JsonRpcChannel {
  onMessage(cb: (msg: FramedMessage) => void): void;
  onClose(cb: () => void): void;
  send(msg: FramedMessage): Promise<void>;
  close(): void;
}

/** Serialize a JSON message as an LSP/DAP `Content-Length` frame. */
export function encodeFrame(msg: FramedMessage): Buffer {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
  return Buffer.concat([header, body]);
}

/**
 * Incremental `Content-Length` frame decoder. Feed it chunks (from a socket or a
 * child process's stdout) with `push`; it invokes `onMessage` for every complete
 * JSON body and buffers the remainder. A malformed header block is skipped so the
 * stream resyncs rather than wedging. Factored out of `FramedConnection` so the
 * stdio transport reuses the exact same, tested, framing.
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(
    private readonly onMessage: (msg: FramedMessage) => void,
    private readonly label: string,
  ) {}

  push(chunk: Buffer | string): void {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    this.buffer = Buffer.concat([this.buffer, buf]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Malformed header block — skip it and resync.
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number.parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return; // wait for the rest
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        this.onMessage(JSON.parse(body) as FramedMessage);
      } catch {
        log(`${this.label} received unparseable frame (${length} bytes)`);
      }
    }
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

/**
 * Raw-TCP transport with LSP/DAP `Content-Length` framing:
 *
 *   Content-Length: <n>\r\n\r\n<n bytes of UTF-8 JSON>
 *
 * Godot serves BOTH its GDScript language server (LSP, JSON-RPC 2.0) and its
 * Debug Adapter (DAP, seq/type/command) this way, so this one class underpins
 * both protocol clients. Connects lazily on first send; reconnects after drop.
 */
export class FramedConnection implements JsonRpcChannel {
  private socket: net.Socket | null = null;
  private connecting: Promise<net.Socket> | null = null;
  private decoder: FrameDecoder;
  private messageCb: (msg: FramedMessage) => void = () => {};
  private closeCb: () => void = () => {};

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly label: string,
    private readonly unavailableHint: string,
  ) {
    this.decoder = new FrameDecoder((m) => this.messageCb(m), label);
  }

  onMessage(cb: (msg: FramedMessage) => void): void {
    this.messageCb = cb;
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  connect(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      socket.setNoDelay(true);
      socket.once("connect", () => {
        this.socket = socket;
        this.connecting = null;
        log(`${this.label} connected to ${this.host}:${this.port}`);
        resolve(socket);
      });
      socket.once("error", (err) => {
        this.connecting = null;
        reject(new Error(`${this.label} unavailable at ${this.host}:${this.port}. ${this.unavailableHint} (${err.message})`));
      });
      socket.on("data", (chunk) => this.decoder.push(chunk));
      socket.on("close", () => {
        this.socket = null;
        this.decoder.reset();
        this.closeCb();
      });
    });
    return this.connecting;
  }

  async send(msg: FramedMessage): Promise<void> {
    const socket = await this.connect();
    socket.write(encodeFrame(msg));
  }

  close(): void {
    if (this.socket) this.socket.destroy();
    this.socket = null;
  }
}
