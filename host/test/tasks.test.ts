import { test, after } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  taskStore,
  TASK_CAPABILITIES,
  registerTaskTool,
  GodotTaskStore,
  type TaskWorker,
} from "../src/tasks.js";

/**
 * D2 — the formal MCP task model. These drive the real SDK task plumbing over an
 * in-memory transport (create -> poll -> await -> cancel), plus focused unit
 * checks on the store's cancel hook and the tool registration.
 */

const CLIENT_CAPS = { capabilities: { tasks: { requests: { tools: { call: {} } } } } };

/** Stand up a task-capable server exposing one controllable long-running tool. */
function makeServer(name: string, worker: TaskWorker<{ label?: string }>): McpServer {
  const server = new McpServer(
    { name: "task-test", version: "0.0.0" },
    { capabilities: TASK_CAPABILITIES, taskStore },
  );
  registerTaskTool(
    server,
    name,
    { title: "t", description: "d", inputSchema: { label: z.string().optional() } },
    worker,
  );
  return server;
}

async function connect(server: McpServer): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "task-test-client", version: "0.0.0" }, CLIENT_CAPS);
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

// The InMemoryTaskStore schedules non-unref'd TTL cleanup timers per task, which
// would keep the event loop (and `npm test`) alive for the full TTL after the
// suite finishes. Clear them so the process exits promptly.
after(() => taskStore.cleanup());

/** Poll a task until it leaves 'working', or time out. */
async function waitForStatus(client: Client, taskId: string, timeoutMs = 4000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const t = await client.experimental.tasks.getTask(taskId);
    if (t.status !== "working" || Date.now() > deadline) return t.status;
    await new Promise((r) => setTimeout(r, 15));
  }
}

test("lifecycle: returns a handle, poll reports working -> completed, result retrievable", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const server = makeServer("job_ok", async ({ label }) => {
    await gate;
    return { content: [{ type: "text", text: "done" }], structuredContent: { echo: label ?? "" } };
  });
  const client = await connect(server);

  const created = (await client.callTool(
    { name: "job_ok", arguments: { label: "hi" } },
    CallToolResultSchema,
    { task: { ttl: 60000 } },
  )) as unknown as { task: { taskId: string; status: string } };
  const taskId = created.task.taskId;
  assert.ok(taskId, "a task handle must be returned");
  assert.equal(created.task.status, "working");

  // Still running until we release the gate.
  assert.equal((await client.experimental.tasks.getTask(taskId)).status, "working");

  release();
  assert.equal(await waitForStatus(client, taskId), "completed");

  const result = (await client.experimental.tasks.getTaskResult(taskId, CallToolResultSchema)) as {
    content: Array<{ text: string }>;
    structuredContent?: Record<string, unknown>;
  };
  assert.equal(result.content[0].text, "done");
  assert.deepEqual(result.structuredContent, { echo: "hi" });

  await client.close();
});

test("cancel: tasks/cancel aborts the running worker and marks the task cancelled", async () => {
  let aborted = false;
  let started!: () => void;
  const running = new Promise<void>((r) => { started = r; });
  const server = makeServer(
    "job_cancel",
    (_args, signal) =>
      new Promise((resolve) => {
        started();
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve({ content: [{ type: "text", text: "interrupted" }] });
        });
      }),
  );
  const client = await connect(server);

  const created = (await client.callTool(
    { name: "job_cancel", arguments: {} },
    CallToolResultSchema,
    { task: { ttl: 60000 } },
  )) as unknown as { task: { taskId: string } };
  const taskId = created.task.taskId;
  await running; // worker is in flight

  const cancelled = (await client.experimental.tasks.cancelTask(taskId)) as { status: string };
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await client.experimental.tasks.getTask(taskId)).status, "cancelled");

  await new Promise((r) => setTimeout(r, 25));
  assert.equal(aborted, true, "the worker must observe the abort signal");

  await client.close();
});

test("non-task clients still get a synchronous result (SDK auto task polling)", async () => {
  const server = makeServer("job_sync", async ({ label }) => ({
    content: [{ type: "text", text: "sync-done" }],
    structuredContent: { echo: label ?? "" },
  }));
  const client = await connect(server);

  const result = (await client.callTool({ name: "job_sync", arguments: { label: "z" } })) as {
    content: Array<{ text: string }>;
    structuredContent?: Record<string, unknown>;
  };
  assert.equal(result.content[0].text, "sync-done");
  assert.deepEqual(result.structuredContent, { echo: "z" });

  await client.close();
});

test("a throwing worker produces a failed task with an error result", async () => {
  const server = makeServer("job_fail", async () => {
    throw new Error("boom-xyz");
  });
  const client = await connect(server);

  const created = (await client.callTool(
    { name: "job_fail", arguments: {} },
    CallToolResultSchema,
    { task: { ttl: 60000 } },
  )) as unknown as { task: { taskId: string } };
  const taskId = created.task.taskId;

  assert.equal(await waitForStatus(client, taskId), "failed");
  const result = (await client.experimental.tasks.getTaskResult(taskId, CallToolResultSchema)) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /boom-xyz/);

  await client.close();
});

test("registerTaskTool advertises taskSupport 'optional' and injects the frozen output schema", () => {
  let captured: { config: Record<string, unknown> } | undefined;
  const fakeServer = {
    experimental: {
      tasks: {
        registerToolTask(name: string, config: Record<string, unknown>) {
          captured = { config };
          return { name };
        },
      },
    },
  } as unknown as McpServer;

  registerTaskTool(
    fakeServer,
    "godot_export",
    { title: "t", description: "d", inputSchema: { preset: z.string(), output_path: z.string() } },
    async () => ({ content: [] }),
  );

  const config = captured?.config as { execution?: { taskSupport?: string }; outputSchema?: unknown; inputSchema?: Record<string, unknown> };
  assert.equal(config.execution?.taskSupport, "optional");
  assert.ok(config.outputSchema, "godot_export must carry its frozen output schema");
  assert.ok(config.inputSchema?.preset, "inputSchema is forwarded to the SDK");
});

test("GodotTaskStore.updateTaskStatus('cancelled') aborts the registered job and blocks late results", async () => {
  const store = new GodotTaskStore();
  const task = await store.createTask({ ttl: 60000 }, "req-1", { method: "tools/call", params: {} });
  const controller = new AbortController();
  store.registerJob(task.taskId, controller);
  assert.equal(store.isTracked(task.taskId), true);

  await store.updateTaskStatus(task.taskId, "cancelled", "bye");
  assert.equal(controller.signal.aborted, true, "cancel must abort the job controller");
  assert.equal(store.isTracked(task.taskId), false);

  await assert.rejects(
    store.storeTaskResult(task.taskId, "completed", { content: [] }),
    /terminal/i,
    "a result cannot be stored after cancellation",
  );
  store.cleanup(); // clear this store's TTL timer so the process can exit
});
