import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { FrameDecoder, encodeFrame, type FramedMessage, type JsonRpcChannel } from "./framing.js";
import { log } from "./logger.js";

/**
 * A `JsonRpcChannel` backed by a spawned subprocess speaking LSP over stdio —
 * the transport OmniSharp (and other CLI language servers) use, unlike Godot's
 * TCP LSP. Frames are `Content-Length`-delimited on the child's stdin/stdout
 * (reusing `FrameDecoder`/`encodeFrame`), so a protocol client written against
 * `JsonRpcChannel` works over stdio exactly as it does over TCP.
 *
 * The process is spawned LAZILY on the first `send()` — like `FramedConnection`
 * connects lazily — so a host with no C# language server installed pays nothing
 * and never fails at startup; only a cs_* tool call actually launches it. A spawn
 * failure (e.g. the binary isn't on PATH) rejects the send with an actionable
 * hint rather than hanging.
 */
export class StdioChannel implements JsonRpcChannel {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<ChildProcessWithoutNullStreams> | null = null;
  private decoder: FrameDecoder;
  private messageCb: (msg: FramedMessage) => void = () => {};
  private closeCb: () => void = () => {};

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly cwd: string,
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

  private start(): Promise<ChildProcessWithoutNullStreams> {
    if (this.child && this.child.exitCode === null && !this.child.killed) return Promise.resolve(this.child);
    if (this.starting) return this.starting;

    this.starting = new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.command, this.args, { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"] });
      } catch (err) {
        this.starting = null;
        reject(new Error(`${this.label} could not spawn '${this.command}'. ${this.unavailableHint} (${(err as Error).message})`));
        return;
      }

      child.once("spawn", () => {
        this.child = child;
        this.starting = null;
        log(`${this.label} spawned '${this.command} ${this.args.join(" ")}' (cwd=${this.cwd})`);
        resolve(child);
      });
      child.once("error", (err) => {
        this.starting = null;
        this.child = null;
        reject(new Error(`${this.label} could not spawn '${this.command}'. ${this.unavailableHint} (${err.message})`));
      });
      child.stdout.on("data", (chunk: Buffer) => this.decoder.push(chunk));
      // The server's own logging goes to stderr (LSP frames are stdout-only); surface
      // it in the host log, trimmed, so a misbehaving server is diagnosable.
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8").trimEnd();
        if (text) log(`${this.label} stderr: ${text.length > 500 ? text.slice(0, 500) + "…" : text}`);
      });
      child.on("exit", (code, signal) => {
        log(`${this.label} exited (code=${code ?? "null"} signal=${signal ?? "null"})`);
        this.child = null;
        this.decoder.reset();
        this.closeCb();
      });
    });
    return this.starting;
  }

  async send(msg: FramedMessage): Promise<void> {
    const child = await this.start();
    child.stdin.write(encodeFrame(msg));
  }

  close(): void {
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* already gone */
      }
    }
    this.child = null;
  }
}
