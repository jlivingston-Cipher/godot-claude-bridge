import { InMemoryTaskStore, isTerminal } from "@modelcontextprotocol/sdk/experimental/tasks";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Result, Task } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { outputSchemas } from "./schemas.js";
import { log } from "./logger.js";

/**
 * D2 — the formal MCP task-execution model for long-running Godot jobs.
 *
 * Long, run-to-completion tools (headless export / import / script runs) used to
 * emit ad-hoc `notifications/progress`. They now register under the spec's task
 * model: a call creates a task, returns a handle immediately, and the client
 * drives it with tasks/get (poll), tasks/result (await), and tasks/cancel
 * (stop). Plain, non-task clients are unaffected — the SDK auto-creates a task,
 * polls it to completion, and returns the result synchronously.
 */

/** How long a finished task's status + result stay retrievable (ms). */
export const TASK_TTL_MS = 15 * 60 * 1000;

/** Default poll cadence (ms); also the added latency of the synchronous path. */
export const TASK_POLL_INTERVAL_MS = 500;

/**
 * Server capabilities advertising the task-execution model for tools/call.
 * Passed to the McpServer constructor so the SDK installs the tasks/get,
 * tasks/result, tasks/list and tasks/cancel request handlers.
 */
export const TASK_CAPABILITIES = {
  tasks: { requests: { tools: { call: {} } } },
} as const;

/** Result shape a task worker returns (a CallToolResult). */
export interface TaskWorkerResult {
  content: Array<{ type: "text"; text: string; [k: string]: unknown }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** The core of a long job: do the work, honoring `signal` for cancellation. */
export type TaskWorker<Args> = (args: Args, signal: AbortSignal) => Promise<TaskWorkerResult>;

/**
 * A TaskStore whose cancellation actually STOPS the running job.
 *
 * The SDK's Protocol handles `tasks/cancel` by calling `updateTaskStatus(id,
 * 'cancelled')` on this store — which only records the status, it does not
 * interrupt the in-flight work. We keep a per-task AbortController and trip it
 * the instant a task transitions to 'cancelled', so a headless Godot run is
 * really killed rather than left orphaned.
 */
export class GodotTaskStore extends InMemoryTaskStore {
  private aborters = new Map<string, AbortController>();

  /** Bind a running job's AbortController to its task id (call in createTask). */
  registerJob(taskId: string, controller: AbortController): void {
    this.aborters.set(taskId, controller);
  }

  /** Test/introspection helper: is a job still tracked as cancellable? */
  isTracked(taskId: string): boolean {
    return this.aborters.has(taskId);
  }

  override async updateTaskStatus(
    taskId: string,
    status: Task["status"],
    statusMessage?: string,
    sessionId?: string,
  ): Promise<void> {
    // Abort BEFORE recording the terminal status so the worker's own
    // signal.aborted guard trips ahead of any late storeTaskResult().
    if (status === "cancelled") {
      const c = this.aborters.get(taskId);
      if (c && !c.signal.aborted) c.abort();
    }
    await super.updateTaskStatus(taskId, status, statusMessage, sessionId);
    if (isTerminal(status)) this.aborters.delete(taskId);
  }

  override async storeTaskResult(
    taskId: string,
    status: "completed" | "failed",
    result: Result,
    sessionId?: string,
  ): Promise<void> {
    await super.storeTaskResult(taskId, status, result, sessionId);
    this.aborters.delete(taskId);
  }
}

/** The one store the server and every task tool share. */
export const taskStore = new GodotTaskStore();

// The per-request task store the SDK injects as `extra.taskStore`.
interface RequestTaskStoreLike {
  createTask(opts: { ttl?: number | null; pollInterval?: number }): Promise<Task>;
  getTask(taskId: string): Promise<Task>;
  getTaskResult(taskId: string): Promise<Result>;
  storeTaskResult(taskId: string, status: "completed" | "failed", result: Result): Promise<void>;
}
interface TaskExtra {
  taskStore: RequestTaskStoreLike;
  taskId: string;
}

function errorResult(message: string): TaskWorkerResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Wrap a plain worker into the SDK's { createTask, getTask, getTaskResult }
 * ToolTaskHandler. createTask registers the task, launches the work in the
 * background, and returns the handle immediately; the background settle stores
 * the result — which the SDK turns into a notifications/tasks/status update and
 * uses to satisfy any pending tasks/result long-poll.
 */
function makeTaskHandler<Args>(name: string, worker: TaskWorker<Args>) {
  const shape = outputSchemas[name];
  const outSchema = shape ? z.object(shape) : undefined;

  return {
    createTask: async (args: Args, extra: TaskExtra) => {
      const task = await extra.taskStore.createTask({
        ttl: TASK_TTL_MS,
        pollInterval: TASK_POLL_INTERVAL_MS,
      });
      const taskId = task.taskId;
      const controller = new AbortController();
      taskStore.registerJob(taskId, controller);

      void (async () => {
        let settled: { status: "completed" | "failed"; result: Result };
        try {
          const result = await worker(args, controller.signal);
          if (controller.signal.aborted) return; // cancelled: store already terminal
          // Preserve the B1 invariant the SDK skips for task results: a
          // successful structured result must match its frozen output schema.
          if (outSchema && !result.isError) {
            if (!result.structuredContent) {
              throw new Error(`tool ${name} produced no structuredContent`);
            }
            outSchema.parse(result.structuredContent);
          }
          settled = {
            status: result.isError ? "failed" : "completed",
            result: result as unknown as Result,
          };
        } catch (err) {
          if (controller.signal.aborted) return;
          const msg = err instanceof Error ? err.message : String(err);
          settled = { status: "failed", result: errorResult(`Error: ${msg}`) as unknown as Result };
        }
        try {
          await extra.taskStore.storeTaskResult(taskId, settled.status, settled.result);
        } catch (storeErr) {
          // Benign if the task was cancelled in the same tick (terminal guard).
          const m = storeErr instanceof Error ? storeErr.message : String(storeErr);
          log(`task ${taskId} (${name}) result store skipped: ${m}`);
        }
      })();

      return { task };
    },
    getTask: async (_args: Args, extra: TaskExtra) => extra.taskStore.getTask(extra.taskId),
    getTaskResult: async (_args: Args, extra: TaskExtra) => extra.taskStore.getTaskResult(extra.taskId),
  };
}

/**
 * Register a long-running tool under the formal MCP task model.
 *
 * With `taskSupport: 'optional'`, task-aware clients get the full
 * create -> poll -> await -> cancel lifecycle, while plain clients keep today's
 * blocking semantics (the SDK auto-creates a task, polls to completion, and
 * returns the result synchronously). The frozen output schema in schemas.ts is
 * applied here, mirroring applyOutputSchemas' handling of registerTool.
 */
export function registerTaskTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  config: { title?: string; description?: string; inputSchema: Shape },
  worker: TaskWorker<z.infer<z.ZodObject<Shape>>>,
): void {
  const shape = outputSchemas[name];
  server.experimental.tasks.registerToolTask(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
      ...(shape ? { outputSchema: shape } : {}),
      execution: { taskSupport: "optional" },
    },
    makeTaskHandler(name, worker) as never,
  );
}
