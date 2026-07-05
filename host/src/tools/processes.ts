import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { log } from "../logger.js";

interface LogLine {
  seq: number;
  stream: "stdout" | "stderr";
  text: string;
}

interface Managed {
  id: string;
  child: ChildProcess;
  lines: LogLine[];
  seq: number;
  exited: boolean;
  exitCode: number | null;
}

const LINE_CAP = 5000;

/**
 * Runs Godot as a MANAGED child (piped stdio) so the host captures ALL stdout/
 * stderr — including every `print()` and engine error — which the pure-GDScript
 * runtime bridge cannot hook. Complements runtime_get_log with transparent,
 * zero-instrumentation output capture.
 */
export class ProcessRegistry {
  private procs = new Map<string, Managed>();
  private counter = 0;

  run(cfg: Config, extraArgs: string[]): Managed {
    const id = `godot-${++this.counter}`;
    const child = spawn(cfg.godotBin, ["--path", cfg.projectPath, ...extraArgs], {
      cwd: cfg.projectPath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const m: Managed = { id, child, lines: [], seq: 0, exited: false, exitCode: null };
    const ingest = (stream: "stdout" | "stderr") => (buf: Buffer | string) => {
      const text = typeof buf === "string" ? buf : buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (line.length === 0) continue;
        m.seq += 1;
        m.lines.push({ seq: m.seq, stream, text: line });
        if (m.lines.length > LINE_CAP) m.lines.shift();
      }
    };
    child.stdout?.on("data", ingest("stdout"));
    child.stderr?.on("data", ingest("stderr"));
    child.on("exit", (code) => {
      m.exited = true;
      m.exitCode = code;
      log(`managed process ${id} exited (${code})`);
    });
    this.procs.set(id, m);
    return m;
  }

  get(id: string): Managed | undefined {
    return this.procs.get(id);
  }

  killAll(): void {
    for (const m of this.procs.values()) {
      try {
        m.child.kill();
      } catch {
        /* ignore */
      }
    }
  }
}

function textResult(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj as Record<string, unknown>,
  };
}

export function registerProcessTools(server: McpServer, cfg: Config): ProcessRegistry {
  const registry = new ProcessRegistry();

  server.registerTool(
    "godot_run_managed",
    {
      title: "Run project (managed, captured output)",
      description:
        "Run the project as a managed child process with captured stdout/stderr, so godot_output can read ALL print()/error output. " +
        "Returns a process id. Use this instead of godot_run_project when you want the game's console log.",
      inputSchema: { scene: z.string().optional().describe("Optional res:// scene to run") },
    },
    async ({ scene }) => {
      const m = registry.run(cfg, scene ? [scene] : []);
      return textResult({ id: m.id, pid: m.child.pid ?? null, running: true, scene: scene ?? null });
    },
  );

  server.registerTool(
    "godot_output",
    {
      title: "Read managed process output",
      description: "Read captured console output for a managed process (from godot_run_managed). Use since_seq for incremental reads.",
      inputSchema: {
        id: z.string().describe("Process id from godot_run_managed"),
        since_seq: z.number().int().optional().describe("Only lines with seq greater than this (default 0)"),
        stream: z.enum(["stdout", "stderr", "both"]).optional().describe("Filter by stream (default both)"),
      },
    },
    async ({ id, since_seq, stream }) => {
      const m = registry.get(id);
      if (!m) return { isError: true, content: [{ type: "text", text: `No managed process with id "${id}"` }] };
      const since = since_seq ?? 0;
      const want = stream ?? "both";
      const lines = m.lines.filter((l) => l.seq > since && (want === "both" || l.stream === want));
      return textResult({ id, exited: m.exited, exit_code: m.exitCode, latest_seq: m.seq, lines });
    },
  );

  server.registerTool(
    "godot_stop",
    {
      title: "Stop managed process",
      description: "Terminate a managed process started by godot_run_managed.",
      inputSchema: { id: z.string().describe("Process id from godot_run_managed") },
    },
    async ({ id }) => {
      const m = registry.get(id);
      if (!m) return { isError: true, content: [{ type: "text", text: `No managed process with id "${id}"` }] };
      try {
        m.child.kill();
      } catch {
        /* ignore */
      }
      return textResult({ id, stopped: true });
    },
  );

  return registry;
}
