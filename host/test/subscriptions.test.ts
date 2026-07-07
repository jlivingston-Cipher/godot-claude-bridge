import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { BridgeClient } from "../src/bridge.js";
import { registerResources } from "../src/tools/resources.js";
import {
  RESOURCE_CAPABILITIES,
  ResourceSubscriptions,
  registerResourceSubscriptions,
} from "../src/subscriptions.js";
import { startTcpServer, writeLine, waitFor, delay, type TcpServer } from "./helpers/tcp.js";

/**
 * D3 — resource subscriptions. These drive the real SDK subscribe/unsubscribe +
 * notifications/resources/updated plumbing over an in-memory client<->server
 * transport, with the host's editor/runtime BridgeClients wired to a mock TCP
 * bridge that PUSHES "resource.changed" events the way the addon does.
 */

interface Harness {
  client: Client;
  bridge: TcpServer;
  editor: BridgeClient;
  runtime: BridgeClient;
  updated: string[];
  close(): Promise<void>;
}

async function makeHarness(opts: { coalesceMs?: number } = {}): Promise<Harness> {
  // A mock editor/runtime bridge: accept connections and hold them so we can
  // push unsolicited change events down the same socket the host reads.
  const bridge = await startTcpServer(() => {});
  const editor = new BridgeClient("127.0.0.1", bridge.port, 2000);
  const runtime = new BridgeClient("127.0.0.1", bridge.port, 2000, "runtime bridge");

  const server = new McpServer(
    { name: "sub-test", version: "0.0.0" },
    { capabilities: RESOURCE_CAPABILITIES },
  );
  registerResources(server, editor, runtime);
  registerResourceSubscriptions(server, editor, runtime, undefined, opts);

  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "sub-test-client", version: "0.0.0" });
  const updated: string[] = [];
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
    updated.push(n.params.uri);
  });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);

  return {
    client,
    bridge,
    editor,
    runtime,
    updated,
    async close() {
      await client.close();
      editor.close();
      runtime.close();
      await bridge.close();
    },
  };
}

/** Push a "resource.changed" event from the mock bridge's first accepted socket. */
async function pushChange(bridge: TcpServer, uri: string): Promise<void> {
  await waitFor(() => bridge.sockets.length > 0);
  writeLine(bridge.sockets[0], { event: "resource.changed", uri });
}

test("the server advertises the resources.subscribe capability", async () => {
  const h = await makeHarness();
  const caps = h.client.getServerCapabilities();
  assert.equal(caps?.resources?.subscribe, true);
  await h.close();
});

test("subscribe: a pushed change yields exactly one resources/updated for that URI", async () => {
  const h = await makeHarness();
  await h.client.subscribeResource({ uri: "godot://editor-state" });
  // Subscribing opens the push channel (ensureConnected); wait for the socket.
  await waitFor(() => h.bridge.sockets.length > 0);
  await pushChange(h.bridge, "godot://editor-state");
  await waitFor(() => h.updated.length >= 1);
  await delay(30); // give any (erroneous) duplicate time to arrive
  assert.deepEqual(h.updated, ["godot://editor-state"]);
  await h.close();
});

test("a change to an un-subscribed URI is ignored (pull path unchanged for non-subscribers)", async () => {
  const h = await makeHarness();
  await h.client.subscribeResource({ uri: "godot://editor-state" });
  await waitFor(() => h.bridge.sockets.length > 0);
  await pushChange(h.bridge, "godot://scene-tree"); // subscribed to editor-state only
  await delay(50);
  assert.deepEqual(h.updated, []);
  await h.close();
});

test("unsubscribe silences further updates for that URI", async () => {
  const h = await makeHarness();
  await h.client.subscribeResource({ uri: "godot://editor-state" });
  await waitFor(() => h.bridge.sockets.length > 0);
  await pushChange(h.bridge, "godot://editor-state");
  await waitFor(() => h.updated.length >= 1);

  await h.client.unsubscribeResource({ uri: "godot://editor-state" });
  await pushChange(h.bridge, "godot://editor-state");
  await delay(50);
  assert.equal(h.updated.length, 1, "no further updates after unsubscribe");
  await h.close();
});

test("a subscribed runtime resource is updated through the runtime bridge", async () => {
  const h = await makeHarness();
  await h.client.subscribeResource({ uri: "godot://runtime/tree" });
  await waitFor(() => h.bridge.sockets.length > 0);
  await pushChange(h.bridge, "godot://runtime/tree");
  await waitFor(() => h.updated.length >= 1);
  assert.deepEqual(h.updated, ["godot://runtime/tree"]);
  await h.close();
});

test("ResourceSubscriptions tracks add / remove / has / size", () => {
  const s = new ResourceSubscriptions();
  assert.equal(s.has("godot://editor-state"), false);
  s.subscribe("godot://editor-state");
  s.subscribe("godot://scene-tree");
  s.subscribe("godot://editor-state"); // idempotent
  assert.equal(s.size, 2);
  assert.equal(s.has("godot://editor-state"), true);
  s.unsubscribe("godot://editor-state");
  assert.equal(s.has("godot://editor-state"), false);
  assert.equal(s.size, 1);
});

test("rapid changes to a subscribed URI coalesce into far fewer updates", async () => {
  const h = await makeHarness({ coalesceMs: 100 });
  await h.client.subscribeResource({ uri: "godot://runtime/tree" });
  await waitFor(() => h.bridge.sockets.length > 0);
  // Fire a burst of 6 changes synchronously — the way one frame of many SceneTree
  // mutations arrives from the runtime bridge's per-frame emitter.
  for (let i = 0; i < 6; i++) {
    writeLine(h.bridge.sockets[0], { event: "resource.changed", uri: "godot://runtime/tree" });
  }
  await waitFor(() => h.updated.length >= 1); // leading edge is immediate
  await delay(300); // let the window close and any trailing flush settle
  // Leading push + one trailing flush = 2, regardless of the 6 that arrived.
  assert.equal(h.updated.length, 2, "6 rapid changes collapse to leading + one trailing");
  assert.deepEqual(new Set(h.updated), new Set(["godot://runtime/tree"]));
  await h.close();
});

test("coalesceMs = 0 disables coalescing — every change pushes", async () => {
  const h = await makeHarness({ coalesceMs: 0 });
  await h.client.subscribeResource({ uri: "godot://editor-state" });
  await waitFor(() => h.bridge.sockets.length > 0);
  for (let i = 0; i < 4; i++) {
    writeLine(h.bridge.sockets[0], { event: "resource.changed", uri: "godot://editor-state" });
  }
  await waitFor(() => h.updated.length >= 4);
  await delay(30);
  assert.equal(h.updated.length, 4, "no coalescing: one update per change");
  await h.close();
});

test("a subscribed runtime log resource is pushed when the game logs (D6)", async () => {
  const h = await makeHarness();
  await h.client.subscribeResource({ uri: "godot://runtime/log" });
  await waitFor(() => h.bridge.sockets.length > 0);
  await pushChange(h.bridge, "godot://runtime/log");
  await waitFor(() => h.updated.length >= 1);
  assert.deepEqual(h.updated, ["godot://runtime/log"]);
  await h.close();
});
