/**
 * `breakpoint-mcp doctor` — a verifiable health check for a Breakpoint MCP
 * install, the CLI-side analogue of the planned in-editor status dock.
 *
 * It reports, for the configured project + environment:
 *   - the Godot binary (GODOT_BIN) runs and its version               [required]
 *   - the editor addon is installed + enabled in project.godot        [required, if a project is present]
 *   - the four bridges are reachable: editor 9080, runtime 9081,
 *     GDScript LSP 6005, GDScript DAP 6006                             [info; --require-live promotes to required]
 *   - optionally, OmniSharp / netcoredbg are on PATH (C# planes)       [info; --include-csharp]
 *
 * The exit code is 0 iff no *required* check failed, so `doctor` doubles as a
 * pre-flight gate. Bridges default to informational because the editor/game
 * may legitimately not be running when a user checks their install; pass
 * `--require-live` when you expect them up (e.g. after opening the editor).
 *
 * Configuration is read via loadConfig(), so the same env overrides the server
 * honours (GODOT_BIN, GODOT_PROJECT, and the BREAKPOINT_ / GODOT_ ports) apply here.
 */
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, type Config } from "../config.js";
import { parseArgs } from "./args.js";

export type CheckStatus = "ok" | "fail" | "skip";

export interface Check {
  name: string;
  status: CheckStatus;
  severity: "required" | "info";
  detail: string;
  hint?: string;
}

export interface DoctorReport {
  checks: Check[];
  /** True when no required check failed. */
  ok: boolean;
}

export interface DoctorOptions {
  timeoutMs: number;
  requireLive: boolean;
  includeCsharp: boolean;
}

const ADDON_REL = "addons/breakpoint_mcp";
const PLUGIN_CFG_RES = "res://addons/breakpoint_mcp/plugin.cfg";

/** Resolve after a TCP connect succeeds (true) or the port is closed/times out (false). */
function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function readText(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Is the Breakpoint MCP plugin listed in project.godot's [editor_plugins] enabled array? */
export function isPluginEnabled(projectGodotText: string): boolean {
  const lines = projectGodotText.split(/\r?\n/);
  let inPlugins = false;
  for (const raw of lines) {
    const s = raw.trim();
    if (s.startsWith("[") && s.endsWith("]")) {
      inPlugins = s === "[editor_plugins]";
      continue;
    }
    if (inPlugins && s.startsWith("enabled") && s.includes(PLUGIN_CFG_RES)) return true;
  }
  return false;
}

function checkGodotBinary(bin: string, timeoutMs: number): Check {
  const res = spawnSync(bin, ["--version"], { timeout: timeoutMs, encoding: "utf8" });
  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code ?? res.error.message;
    return {
      name: "godot-binary",
      status: "fail",
      severity: "required",
      detail: `'${bin}' is not runnable (${code})`,
      hint: "Install Godot 4.2+ and put it on PATH, or set GODOT_BIN to its absolute path.",
    };
  }
  const version = (res.stdout ?? "").trim().split(/\r?\n/)[0] || "(no version output)";
  return {
    name: "godot-binary",
    status: "ok",
    severity: "required",
    detail: `${bin} → ${version}`,
  };
}

function checkAddon(projectPath: string): Check[] {
  const projText = readText(path.join(projectPath, "project.godot"));
  if (projText === null) {
    return [
      {
        name: "project",
        status: "skip",
        severity: "info",
        detail: `no project.godot at ${projectPath}`,
        hint: "Pass --project <dir> pointing at your Godot project, or run from the project root.",
      },
    ];
  }

  const checks: Check[] = [];
  const cfgText = readText(path.join(projectPath, ADDON_REL, "plugin.cfg"));
  if (cfgText === null) {
    checks.push({
      name: "addon-installed",
      status: "fail",
      severity: "required",
      detail: `not found at ${ADDON_REL}/plugin.cfg`,
      hint: "Run 'breakpoint-mcp init' to install the editor addon into this project.",
    });
  } else {
    const m = /version\s*=\s*"([^"]*)"/.exec(cfgText);
    checks.push({
      name: "addon-installed",
      status: "ok",
      severity: "required",
      detail: `${ADDON_REL} (version ${m ? m[1] : "?"})`,
    });
  }

  checks.push(
    isPluginEnabled(projText)
      ? {
          name: "addon-enabled",
          status: "ok",
          severity: "required",
          detail: "enabled in project.godot",
        }
      : {
          name: "addon-enabled",
          status: "fail",
          severity: "required",
          detail: "not listed under [editor_plugins] enabled",
          hint: "Enable 'Breakpoint MCP' under Project → Project Settings → Plugins (or run 'breakpoint-mcp init').",
        },
  );
  return checks;
}

/** Locate an executable on PATH without launching it (used for the C# info checks). */
function whichSync(cmd: string): string | null {
  if (path.isAbsolute(cmd)) {
    try {
      fs.accessSync(cmd, fs.constants.X_OK);
      return cmd;
    } catch {
      return null;
    }
  }
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase())
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        /* keep scanning */
      }
    }
  }
  return null;
}

function checkCsharpTool(name: string, cmd: string): Check {
  const found = whichSync(cmd);
  return found
    ? { name, status: "ok", severity: "info", detail: `${cmd} → ${found}` }
    : {
        name,
        status: "skip",
        severity: "info",
        detail: `${cmd} not on PATH (C# plane inactive until installed)`,
      };
}

export async function runDoctorChecks(config: Config, opts: DoctorOptions): Promise<DoctorReport> {
  const checks: Check[] = [];

  // Godot binary (give the version probe a floor so a slow cold start isn't a false negative).
  checks.push(checkGodotBinary(config.godotBin, Math.max(opts.timeoutMs, 3000)));

  // Editor addon install + enable.
  checks.push(...checkAddon(config.projectPath));

  // The four bridges.
  const severity: Check["severity"] = opts.requireLive ? "required" : "info";
  const bridges: Array<{ name: string; host: string; port: number; hint: string }> = [
    {
      name: "editor-bridge",
      host: config.bridgeHost,
      port: config.bridgePort,
      hint: 'Open the editor with the "Breakpoint MCP" plugin enabled.',
    },
    {
      name: "runtime-bridge",
      host: config.runtimeHost,
      port: config.runtimePort,
      hint: "Launch the project (godot_run_project / dbg_launch) with the plugin enabled — it auto-registers the runtime autoload.",
    },
    {
      name: "gdscript-lsp",
      host: config.lspHost,
      port: config.lspPort,
      hint: "Godot's language server runs while the editor is open (Editor → Editor Settings → Network → Language Server).",
    },
    {
      name: "gdscript-dap",
      host: config.dapHost,
      port: config.dapPort,
      hint: "Godot's debug adapter runs while the editor is open (Editor → Editor Settings → Network → Debug Adapter).",
    },
  ];
  const bridgeChecks = await Promise.all(
    bridges.map(async (b): Promise<Check> => {
      const ok = await probeTcp(b.host, b.port, opts.timeoutMs);
      return {
        name: b.name,
        status: ok ? "ok" : "fail",
        severity,
        detail: `${b.host}:${b.port} ${ok ? "reachable" : "unreachable"}`,
        hint: ok ? undefined : b.hint,
      };
    }),
  );
  checks.push(...bridgeChecks);

  // Optional C# tooling.
  if (opts.includeCsharp) {
    checks.push(checkCsharpTool("csharp-lsp", config.csLspCmd));
    checks.push(checkCsharpTool("csharp-dap", config.csDapCmd));
  }

  const ok = checks.every((c) => c.severity !== "required" || c.status !== "fail");
  return { checks, ok };
}

function glyph(status: CheckStatus): string {
  return status === "ok" ? "✓" : status === "fail" ? "✗" : "–";
}

function printReport(report: DoctorReport): void {
  const width = Math.max(...report.checks.map((c) => c.name.length));
  const out: string[] = ["breakpoint-mcp doctor", ""];
  for (const c of report.checks) {
    out.push(`  ${glyph(c.status)} ${c.name.padEnd(width)}  ${c.detail}`);
    if (c.status === "fail" && c.hint) out.push(`      ↳ ${c.hint}`);
  }
  out.push("");
  out.push(
    report.ok
      ? "All required checks passed."
      : "Some required checks failed — see the ↳ hints above.",
  );
  process.stdout.write(out.join("\n") + "\n");
}

/** Entry point for `breakpoint-mcp doctor`. Returns the process exit code. */
export async function runDoctor(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv, ["json", "require-live", "include-csharp"]);

  if (typeof flags.project === "string") process.env.GODOT_PROJECT = flags.project;
  const timeoutRaw = typeof flags.timeout === "string" ? Number.parseInt(flags.timeout, 10) : NaN;
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 1500;

  const config = loadConfig();
  const report = await runDoctorChecks(config, {
    timeoutMs,
    requireLive: flags["require-live"] === true,
    includeCsharp: flags["include-csharp"] === true,
  });

  if (flags.json === true) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    printReport(report);
  }
  return report.ok ? 0 : 1;
}
