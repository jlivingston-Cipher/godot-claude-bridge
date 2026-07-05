import { test } from "node:test";
import assert from "node:assert/strict";
import { gate } from "../src/confirm.js";

type Server = Parameters<typeof gate>[0];
type ElicitResult = { action: string; content?: Record<string, unknown> };

/** Build a fake McpServer whose elicitInput returns/throws as configured. */
function fakeServer(elicit: (req: unknown) => Promise<ElicitResult>): { server: Server; calls: unknown[] } {
  const calls: unknown[] = [];
  const server = {
    server: {
      elicitInput: async (req: unknown) => {
        calls.push(req);
        return elicit(req);
      },
    },
  } as unknown as Server;
  return { server, calls };
}

test("gate returns null immediately when confirm:true (skips the prompt)", async () => {
  const { server, calls } = fakeServer(async () => ({ action: "accept", content: { proceed: true } }));
  const result = await gate(server, true, "delete node /root/Foo");
  assert.equal(result, null);
  assert.equal(calls.length, 0, "elicitInput must not be called when confirm:true");
});

test("gate returns null when the user accepts and proceed:true", async () => {
  const { server } = fakeServer(async () => ({ action: "accept", content: { proceed: true } }));
  assert.equal(await gate(server, undefined, "delete node"), null);
});

test("gate blocks when the user accepts but proceed:false", async () => {
  const { server } = fakeServer(async () => ({ action: "accept", content: { proceed: false } }));
  const r = await gate(server, undefined, "delete node /root/Foo");
  assert.ok(r, "expected a blocking result");
  assert.equal(r?.isError, true);
  assert.match(r!.content[0].text, /did not approve/i);
  assert.match(r!.content[0].text, /delete node \/root\/Foo/);
});

test("gate blocks when the user declines/cancels the elicitation", async () => {
  const { server } = fakeServer(async () => ({ action: "decline" }));
  const r = await gate(server, undefined, "overwrite scene");
  assert.ok(r);
  assert.equal(r?.isError, true);
  assert.match(r!.content[0].text, /did not approve/i);
});

test("gate blocks with a 'confirm: true' hint when the client cannot elicit", async () => {
  const { server } = fakeServer(async () => {
    throw new Error("Method not found: elicitation/create");
  });
  const r = await gate(server, undefined, "rename symbol");
  assert.ok(r);
  assert.equal(r?.isError, true);
  assert.match(r!.content[0].text, /confirm: true/);
  assert.match(r!.content[0].text, /rename symbol/);
});

test("gate passes the summary into the elicitation prompt message", async () => {
  const { server, calls } = fakeServer(async () => ({ action: "accept", content: { proceed: true } }));
  await gate(server, false, "SUMMARY-XYZ");
  const req = calls[0] as { message?: string };
  assert.match(req.message ?? "", /SUMMARY-XYZ/);
});
