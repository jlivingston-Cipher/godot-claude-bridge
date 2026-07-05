import net from "node:net";
import { log } from "./logger.js";

export type FramedMessage = Record<string, unknown>;

/**
 * Raw-TCP transport with LSP/DAP `Content-Length` framing:
 *
 *   Content-Length: <n>\r\n\r\n<n bytes of UTF-8 JSON>
 *
 * Godot serves BOTH its GDScript language server (LSP, JSON-RPC 2.0) and its
 * Debug Adapter (DAP, seq/type/command) this way, so this one class underpins
 * both protocol clients. Connects lazily on first send; reconnects after drop.
 */
export class FramedConnection {
  private socket: net.Socket | null = null;
  private connecting: Promise<net.Socket> | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private messageCb: (msg: FramedMessage) => void = () => {};
  private closeCb: () => void = () => {};

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly label: string,
    private readonly unavailableHint: string,
  ) {}

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
      socket.on("data", (chunk) => this.onData(chunk));
      socket.on("close", () => {
        this.socket = null;
        this.buffer = Buffer.alloc(0);
        this.closeCb();
      });
    });
    return this.connecting;
  }

  private onData(chunk: Buffer | string): void {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    this.buffer = Buffer.concat([this.buffer, buf]);
    // Drain as many complete frames as are buffered.
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
        this.messageCb(JSON.parse(body) as FramedMessage);
      } catch {
        log(`${this.label} received unparseable frame (${length} bytes)`);
      }
    }
  }

  async send(msg: FramedMessage): Promise<void> {
    const socket = await this.connect();
    const body = Buffer.from(JSON.stringify(msg), "utf8");
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
    socket.write(Buffer.concat([header, body]));
  }

  close(): void {
    if (this.socket) this.socket.destroy();
    this.socket = null;
  }
}
