import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { BridgeClient, BridgeError } from "../src/bridge.js";
import { startTcpServer, makeLineParser, writeLine, type TcpServer } from "./helpers/tcp.js";

interface BridgeReq { id: string; method: string; params: Record<string, unknown> }

/** Start a mock editor-bridge server that runs `handler` for each request line. */
async function startBridge(handler: (req: BridgeReq, socket: net.Socket) => void): Promise<TcpServer> {
  return startTcpServer((s) => {
    const parse = makeLineParser((line) => handler(JSON.parse(line) as BridgeReq, s));
    s.on("data", (c) => parse(Buffer.from(c)));
  });
}

const isBridgeError = (code: string) => (e: unknown) =>
  e instanceof BridgeError && e.code === code;

test("request() resolves with the correlated result on ok:true", async () => {
  const srv = await startBridge((req, s) => writeLine(s, { id: req.id, ok: true, result: { echo: req.method, params: req.params } }));
  const client = new BridgeClient("127.0.0.1", srv.port, 5000);
  const r = await client.request<{ echo: string; params: unknown }>("editor.ping", { x: 1 });
  assert.deepEqual(r, { echo: "editor.ping", params: { x: 1 } });
  client.close();
  await srv.close();
});

test("request() defaults a missing result to {}", async () => {
  const srv = await startBridge((req, s) => writeLine(s, { id: req.id, ok: true }));
  const client = new BridgeClient("127.0.0.1", srv.port, 5000);
  assert.deepEqual(await client.request("noop"), {});
  client.close();
  await srv.close();
});

test("request() rejects with a coded BridgeError on ok:false", async () => {
  const srv = await startBridge((req, s) => writeLine(s, { id: req.id, ok: false, error: { code: "bad_path", message: "no such node" } }));
  const client = new BridgeClient("127.0.0.1", srv.port, 5000);
  await assert.rejects(client.request("node.delete"), (e) => isBridgeError("bad_path")(e) && /no such node/.test((e as Error).message));
  client.close();
  await srv.close();
});

test("concurrent requests are correlated by id even when answered out of order", async () => {
  const pending: Array<{ req: BridgeReq; s: net.Socket }> = [];
  const srv = await startBridge((req, s) => {
    pending.push({ req, s });
    if (pending.length === 2) {
      // Answer the SECOND request first to prove id-correlation, not ordering.
      writeLine(pending[1].s, { id: pending[1].req.id, ok: true, result: { tag: pending[1].req.method } });
      writeLine(pending[0].s, { id: pending[0].req.id, ok: true, result: { tag: pending[0].req.method } });
    }
  });
  const client = new BridgeClient("127.0.0.1", srv.port, 5000);
  const [r1, r2] = await Promise.all([
    client.request<{ tag: string }>("m1"),
    client.request<{ tag: string }>("m2"),
  ]);
  assert.equal(r1.tag, "m1");
  assert.equal(r2.tag, "m2");
  client.close();
  await srv.close();
});

test("request() rejects with code 'timeout' when no response arrives", async () => {
  const srv = await startBridge(() => { /* never respond */ });
  const client = new BridgeClient("127.0.0.1", srv.port, 5000);
  await assert.rejects(client.request("hang", {}, 60), isBridgeError("timeout"));
  client.close();
  await srv.close();
});

test("a non-JSON line from the bridge is ignored; a following valid line still resolves", async () => {
  const srv = await startBridge((req, s) => {
    s.write("this-is-not-json\n");
    writeLine(s, { id: req.id, ok: true, result: { recovered: true } });
  });
  const client = new BridgeClient("127.0.0.1", srv.port, 5000);
  assert.deepEqual(await client.request("x"), { recovered: true });
  client.close();
  await srv.close();
});

test("a response split across TCP chunks is buffered until the newline", async () => {
  const srv = await startBridge((req, s) => {
    const resp = JSON.stringify({ id: req.id, ok: true, result: { chunked: true } });
    s.write(resp.slice(0, 6));
    setTimeout(() => s.write(resp.slice(6) + "\n"), 10);
  });
  const client = new BridgeClient("127.0.0.1", srv.port, 5000);
  assert.deepEqual(await client.request("x"), { chunked: true });
  client.close();
  await srv.close();
});

test("pending requests reject with 'bridge_closed' if the connection drops first", async () => {
  const srv = await startBridge((_req, s) => s.destroy());
  const client = new BridgeClient("127.0.0.1", srv.port, 5000);
  await assert.rejects(client.request("x"), isBridgeError("bridge_closed"));
  client.close();
  await srv.close();
});

test("request() rejects with 'bridge_unavailable' when nothing is listening", async () => {
  const tmp = await startTcpServer(() => {});
  const deadPort = tmp.port;
  await tmp.close();
  const client = new BridgeClient("127.0.0.1", deadPort, 5000);
  await assert.rejects(client.request("x"), isBridgeError("bridge_unavailable"));
});

// ---- loopback-auth handshake (host side) -----------------------------------

test("prepends an auth line as the FIRST frame when a secret provider returns one", async () => {
  const seen: BridgeReq[] = [];
  const srv = await startBridge((req, s) => {
    seen.push(req);
    // The real addon marks the peer authed on a valid secret and awaits no reply
    // for the auth line; only the following request gets a response.
    if (req.method === "auth") return;
    writeLine(s, { id: req.id, ok: true, result: {} });
  });
  const client = new BridgeClient("127.0.0.1", srv.port, 5000, "editor bridge", undefined, () => "hex-secret");
  await client.request("editor.ping");
  assert.equal(seen[0].method, "auth", "the auth line must precede the first request");
  assert.deepEqual(seen[0].params, { secret: "hex-secret" });
  assert.equal(seen[1].method, "editor.ping");
  client.close();
  await srv.close();
});

test("sends NO auth line when the secret provider yields null (backward-compatible)", async () => {
  const seen: BridgeReq[] = [];
  const srv = await startBridge((req, s) => {
    seen.push(req);
    writeLine(s, { id: req.id, ok: true, result: {} });
  });
  const client = new BridgeClient("127.0.0.1", srv.port, 5000, "editor bridge", undefined, () => null);
  await client.request("editor.ping");
  assert.equal(seen.length, 1, "no auth line should be sent when there is no secret");
  assert.equal(seen[0].method, "editor.ping");
  client.close();
  await srv.close();
});
