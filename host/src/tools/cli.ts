import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { log } from "../logger.js";

const execFileAsync = promisify(execFile);

interface CapturedResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run the Godot binary to completion, capturing stdout/stderr. */
async function runCaptured(
  cfg: Config,
  args: string[],
  timeoutMs: number,
): Promise<CapturedResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cfg.godotBin, args, {
      cwd: cfg.projectPath,
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr, timedOut: false };
  } catch (err: unknown) {
    const e = err as { code?: number; killed?: boolean; signal?: string; stdout?: string; stderr?: string; message?: string };
    return {
      code: typeof e.code === "number" ? e.code : null,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? "",
      timedOut: Boolean(e.killed) && e.signal === "SIGTERM",
    };
  }
}

/** Launch the Godot binary detached (for long-lived editor/game processes). */
function launchDetached(cfg: Config, args: string[]): number | null {
  const child = spawn(cfg.godotBin, args, {
    cwd: cfg.projectPath,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child.pid ?? null;
}

/** Truncate long output so a single tool result stays reasonable. */
function tail(s: string, max = 8000): string {
  if (s.length <= max) return s;
  return "…(truncated)…\n" + s.slice(s.length - max);
}

function textResult(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj as Record<string, unknown>,
  };
}

/**
 * Emit periodic progress notifications while a long tool runs, if the caller
 * supplied a progressToken. Returns a stop function. Fully defensive: never
 * throws and no-ops when progress isn't supported.
 */
function startProgress(extra: unknown, message: string): () => void {
  const e = extra as { _meta?: { progressToken?: unknown }; sendNotification?: (n: unknown) => unknown } | undefined;
  const token = e?._meta?.progressToken;
  const send = e?.sendNotification;
  if (token === undefined || typeof send !== "function") return () => {};
  let n = 0;
  const timer = setInterval(() => {
    n += 1;
    try {
      Promise.resolve(
        send({ method: "notifications/progress", params: { progressToken: token, progress: n, message: `${message}… (${n * 2}s)` } }),
      ).catch(() => {});
    } catch {
      /* ignore */
    }
  }, 2000);
  return () => clearInterval(timer);
}

export function registerCliTools(server: McpServer, cfg: Config): void {
  server.registerTool(
    "godot_version",
    {
      title: "Godot version",
      description: "Return the version string of the configured Godot binary.",
      inputSchema: {},
    },
    async () => {
      const r = await runCaptured(cfg, ["--version"], 15000);
      return textResult({ version: r.stdout.trim() || r.stderr.trim(), raw: r });
    },
  );

  server.registerTool(
    "godot_launch_editor",
    {
      title: "Launch editor",
      description:
        "Open the Godot editor for the configured project (detached). Needed before any editor_* bridge tool can be used.",
      inputSchema: {},
    },
    async () => {
      const pid = launchDetached(cfg, ["-e", "--path", cfg.projectPath]);
      log(`launched editor pid=${pid}`);
      return textResult({ launched: true, pid, project: cfg.projectPath });
    },
  );

  server.registerTool(
    "godot_run_project",
    {
      title: "Run project",
      description:
        "Run the project (detached). Optionally start from a specific scene path (res://...). Returns the process id.",
      inputSchema: {
        scene: z.string().optional().describe("Optional scene to run, e.g. res://levels/test.tscn"),
      },
    },
    async ({ scene }) => {
      const args = ["--path", cfg.projectPath];
      if (scene) args.push(scene);
      const pid = launchDetached(cfg, args);
      return textResult({ running: true, pid, scene: scene ?? null });
    },
  );

  server.registerTool(
    "godot_export",
    {
      title: "Export project",
      description:
        "Headless export using an export preset. Runs to completion and returns exit code + logs. Can be slow.",
      inputSchema: {
        preset: z.string().describe("Export preset name as defined in export_presets.cfg"),
        output_path: z.string().describe("Output file path for the exported build"),
        debug: z.boolean().optional().describe("Export a debug build instead of release (default false)"),
        timeout_ms: z.number().int().positive().optional().describe("Max run time (default 600000)"),
      },
    },
    async ({ preset, output_path, debug, timeout_ms }, extra) => {
      const flag = debug ? "--export-debug" : "--export-release";
      const stop = startProgress(extra, `Exporting "${preset}"`);
      try {
        const r = await runCaptured(
          cfg,
          ["--headless", "--path", cfg.projectPath, flag, preset, output_path],
          timeout_ms ?? 600000,
        );
        return textResult({
          preset,
          output_path,
          exit_code: r.code,
          timed_out: r.timedOut,
          stdout: tail(r.stdout),
          stderr: tail(r.stderr),
        });
      } finally {
        stop();
      }
    },
  );

  server.registerTool(
    "godot_import",
    {
      title: "Import assets",
      description: "Headless (re)import of project assets. Runs to completion and returns exit code + logs.",
      inputSchema: {
        timeout_ms: z.number().int().positive().optional().describe("Max run time (default 600000)"),
      },
    },
    async ({ timeout_ms }, extra) => {
      const stop = startProgress(extra, "Importing assets");
      try {
        const r = await runCaptured(
          cfg,
          ["--headless", "--path", cfg.projectPath, "--import"],
          timeout_ms ?? 600000,
        );
        return textResult({ exit_code: r.code, timed_out: r.timedOut, stdout: tail(r.stdout), stderr: tail(r.stderr) });
      } finally {
        stop();
      }
    },
  );

  server.registerTool(
    "godot_run_headless_script",
    {
      title: "Run headless script",
      description:
        "Run a GDScript in headless mode (godot --headless -s <script>). Use this to invoke test runners " +
        "(GdUnit4 / GUT) or any batch tool. Returns exit code + logs.",
      inputSchema: {
        script_path: z.string().describe("Script to execute, e.g. res://addons/gdUnit4/bin/GdUnitCmdTool.gd"),
        args: z.array(z.string()).optional().describe("Extra CLI args passed after the script"),
        timeout_ms: z.number().int().positive().optional().describe("Max run time (default 600000)"),
      },
    },
    async ({ script_path, args, timeout_ms }, extra) => {
      const stop = startProgress(extra, `Running ${script_path}`);
      try {
        const r = await runCaptured(
          cfg,
          ["--headless", "--path", cfg.projectPath, "-s", script_path, ...(args ?? [])],
          timeout_ms ?? 600000,
        );
        return textResult({
          script_path,
          exit_code: r.code,
          timed_out: r.timedOut,
          stdout: tail(r.stdout),
          stderr: tail(r.stderr),
        });
      } finally {
        stop();
      }
    },
  );
}
