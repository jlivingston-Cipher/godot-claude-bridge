import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { FramedConnection, type FramedMessage } from "../src/framing.js";
import { startTcpServer, encodeFrame, writeFrame, makeFrameParser, waitFor } from "./helpers/tcp.js";

/** Connect a FramedConnection to a fresh loopback server; hand back both ends. */
async function connectPair() {
  let resolveSock!: (s: net.Socket) => void;
  const sockP = new Promise<net.Socket>((r) => (resolveSock = r));
  const srv = await startTcpServer((s) => resolveSock(s));
  const conn = new FramedConnection("127.0.0.1", srv.port, "TEST", "unavailable hint");
  const messages: FramedMessage[] = [];
  conn.onMessage((m) => messages.push(m));
  await conn.connect();
  const serverSocket = await sockP;
  return { srv, conn, serverSocket, messages, teardown: async () => { conn.close(); await srv.close(); } };
}

test("parses a single Content-Length frame", async () => {
  const { serverSocket, messages, teardown } = await connectPair();
  writeFrame(serverSocket, { jsonrpc: "2.0", id: 1, result: { ok: true } });
  await waitFor(() => messages.length === 1);
  assert.deepEqual(messages[0], { jsonrpc: "2.0", id: 1, result: { ok: true } });
  await teardown();
});

test("parses multiple frames delivered in one chunk", async () => {
  const { serverSocket, messages, teardown } = await connectPair();
  serverSocket.write(Buffer.concat([encodeFrame({ id: 1 }), encodeFrame({ id: 2 }), encodeFrame({ id: 3 })]));
  await waitFor(() => messages.length === 3);
  assert.deepEqual(messages.map((m) => m.id), [1, 2, 3]);
  await teardown();
});

test("reassembles a frame split across two chunks", async () => {
  const { serverSocket, messages, teardown } = await connectPair();
  const full = encodeFrame({ id: 7, method: "split" });
  const cut = Math.floor(full.length / 2);
  serverSocket.write(full.subarray(0, cut));
  await new Promise((r) => setTimeout(r, 15)); // deliver the tail as a separate TCP segment
  serverSocket.write(full.subarray(cut));
  await waitFor(() => messages.length === 1);
  assert.deepEqual(messages[0], { id: 7, method: "split" });
  await teardown();
});

test("resyncs past a malformed header block (no Content-Length) and delivers the next valid frame", async () => {
  const { serverSocket, messages, teardown } = await connectPair();
  serverSocket.write(Buffer.concat([Buffer.from("GARBAGE-HEADER\r\n\r\n", "ascii"), encodeFrame({ id: 99 })]));
  await waitFor(() => messages.length === 1);
  assert.deepEqual(messages[0], { id: 99 });
  await teardown();
});

test("skips a frame with an unparseable JSON body without dropping the stream", async () => {
  const { serverSocket, messages, teardown } = await connectPair();
  const badBody = Buffer.from("{ not json", "utf8");
  const badFrame = Buffer.concat([Buffer.from(`Content-Length: ${badBody.length}\r\n\r\n`, "ascii"), badBody]);
  serverSocket.write(badFrame);
  serverSocket.write(encodeFrame({ id: "after-bad" }));
  await waitFor(() => messages.length === 1);
  assert.deepEqual(messages[0], { id: "after-bad" });
  await teardown();
});

test("send() writes a well-formed Content-Length frame the peer can parse", async () => {
  const received: Record<string, unknown>[] = [];
  const raw: Buffer[] = [];
  let resolveSock!: (s: net.Socket) => void;
  const sockP = new Promise<net.Socket>((r) => (resolveSock = r));
  const srv = await startTcpServer((s) => {
    resolveSock(s);
    const parse = makeFrameParser((m) => received.push(m));
    s.on("data", (c) => { raw.push(Buffer.from(c)); parse(Buffer.from(c)); });
  });
  const conn = new FramedConnection("127.0.0.1", srv.port, "TEST", "hint");
  await conn.connect();
  await sockP;
  await conn.send({ jsonrpc: "2.0", id: 5, method: "initialize" });
  await waitFor(() => received.length === 1);
  assert.deepEqual(received[0], { jsonrpc: "2.0", id: 5, method: "initialize" });
  const header = Buffer.concat(raw).toString("utf8");
  assert.match(header, /^Content-Length: \d+\r\n\r\n/);
  conn.close();
  await srv.close();
});

test("connect() rejects with the unavailable hint when nothing is listening", async () => {
  // Bind then immediately release a port to get one that is (almost certainly) closed.
  const tmp = await startTcpServer(() => {});
  const deadPort = tmp.port;
  await tmp.close();
  const conn = new FramedConnection("127.0.0.1", deadPort, "TEST", "the hint text");
  await assert.rejects(conn.connect(), /the hint text/);
});
