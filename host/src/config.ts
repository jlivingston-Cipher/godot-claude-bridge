import { pathToFileURL } from "node:url";

/**
 * Runtime configuration, all overridable via environment variables so the same
 * binary works across projects and machines without code changes.
 */
export interface Config {
  /** Path to the Godot editor binary (e.g. "godot", or an absolute path). */
  godotBin: string;
  /** Absolute path to the Godot project directory (contains project.godot). */
  projectPath: string;
  /** `file://` URI of the project root (for the LSP workspace). */
  projectUri: string;
  /** Editor bridge (addon) host/port + per-request timeout. */
  bridgeHost: string;
  bridgePort: number;
  bridgeTimeoutMs: number;
  /** GDScript language server (LSP) host/port + timeout. */
  lspHost: string;
  lspPort: number;
  lspTimeoutMs: number;
  /**
   * C#/.NET semantic plane (D4 C2). The C# language server (OmniSharp) is SPAWNED
   * by the host over stdio — unlike Godot's TCP LSP — so it's a command + args +
   * a working directory (the C# project root) rather than a host/port. All
   * env-overridable; the server is launched lazily on the first cs_* tool call,
   * so a host without OmniSharp installed pays nothing.
   */
  csLspCmd: string;
  csLspArgs: string[];
  csLspProjectPath: string;
  csLspProjectUri: string;
  csLspTimeoutMs: number;
  /** Debug Adapter (DAP) host/port + timeout. */
  dapHost: string;
  dapPort: number;
  dapTimeoutMs: number;
  /**
   * Shorter bounded deadlines for the setVariable / evaluate DAP requests. These are
   * control requests a compliant adapter answers near-instantly, but Godot 4.3 advertises
   * `supportsSetVariable=true` and then never answers `setVariable` — without a bound the
   * tool would hang the full `dapTimeoutMs` (20 s). Kept separate + env-overridable so
   * tests can drive them to a few hundred ms.
   */
  dapSetVarTimeoutMs: number;
  dapEvaluateTimeoutMs: number;
  /**
   * C#/.NET debugging plane (D4 C3). The .NET debug adapter (netcoredbg, MIT) is
   * SPAWNED by the host over stdio — like OmniSharp, and unlike Godot's TCP DAP —
   * so it's a command + args + a working directory rather than a host/port. It is
   * launched lazily on the first cs_dbg_* call, so a host without netcoredbg
   * installed pays nothing. `csDapProgram` is the program cs_dbg_launch launches
   * by default (the Mono/.NET Godot binary). The setVariable / evaluate deadlines
   * mirror the DAP F1 discipline: a short bound so a non-answering adapter fails
   * fast instead of hanging the full timeout. All env-overridable.
   */
  csDapCmd: string;
  csDapArgs: string[];
  csDapProgram: string;
  csDapProjectPath: string;
  csDapTimeoutMs: number;
  csDapSetVarTimeoutMs: number;
  csDapEvaluateTimeoutMs: number;
  /** Runtime bridge (in-game autoload) host/port + timeout. */
  runtimeHost: string;
  runtimePort: number;
  runtimeTimeoutMs: number;
}

export function loadConfig(): Config {
  const projectPath = process.env.GODOT_PROJECT ?? process.cwd();
  // The C# project defaults to the main project, but is usually pointed at a
  // dedicated C# project (e.g. the example-csharp fixture) via GODOT_CSHARP_PROJECT.
  const csLspProjectPath = process.env.GODOT_CSHARP_PROJECT ?? projectPath;
  return {
    godotBin: process.env.GODOT_BIN ?? "godot",
    projectPath,
    projectUri: pathToFileURL(projectPath).href,
    bridgeHost: process.env.CLAUDE_BRIDGE_HOST ?? "127.0.0.1",
    bridgePort: Number.parseInt(process.env.CLAUDE_BRIDGE_PORT ?? "9080", 10),
    bridgeTimeoutMs: Number.parseInt(process.env.CLAUDE_BRIDGE_TIMEOUT_MS ?? "15000", 10),
    lspHost: process.env.GODOT_LSP_HOST ?? "127.0.0.1",
    lspPort: Number.parseInt(process.env.GODOT_LSP_PORT ?? "6005", 10),
    lspTimeoutMs: Number.parseInt(process.env.GODOT_LSP_TIMEOUT_MS ?? "15000", 10),
    csLspCmd: process.env.GODOT_CSLSP_CMD ?? "OmniSharp",
    csLspArgs: (process.env.GODOT_CSLSP_ARGS ?? "-lsp").split(/\s+/).filter(Boolean),
    csLspProjectPath,
    csLspProjectUri: pathToFileURL(csLspProjectPath).href,
    csLspTimeoutMs: Number.parseInt(process.env.GODOT_CSLSP_TIMEOUT_MS ?? "30000", 10),
    dapHost: process.env.GODOT_DAP_HOST ?? "127.0.0.1",
    dapPort: Number.parseInt(process.env.GODOT_DAP_PORT ?? "6006", 10),
    dapTimeoutMs: Number.parseInt(process.env.GODOT_DAP_TIMEOUT_MS ?? "20000", 10),
    dapSetVarTimeoutMs: Number.parseInt(process.env.GODOT_DAP_SETVAR_TIMEOUT_MS ?? "8000", 10),
    dapEvaluateTimeoutMs: Number.parseInt(process.env.GODOT_DAP_EVALUATE_TIMEOUT_MS ?? "8000", 10),
    csDapCmd: process.env.GODOT_CSDAP_CMD ?? "netcoredbg",
    csDapArgs: (process.env.GODOT_CSDAP_ARGS ?? "--interpreter=vscode").split(/\s+/).filter(Boolean),
    // The default program cs_dbg_launch launches is the Mono/.NET Godot binary. GODOT_CSHARP_BIN
    // overrides it; it otherwise falls back to GODOT_BIN (the standard editor binary), which the
    // caller can also override per-call via cs_dbg_launch's `program` arg.
    csDapProgram: process.env.GODOT_CSHARP_BIN ?? process.env.GODOT_BIN ?? "godot",
    csDapProjectPath: csLspProjectPath,
    csDapTimeoutMs: Number.parseInt(process.env.GODOT_CSDAP_TIMEOUT_MS ?? "20000", 10),
    csDapSetVarTimeoutMs: Number.parseInt(process.env.GODOT_CSDAP_SETVAR_TIMEOUT_MS ?? "8000", 10),
    csDapEvaluateTimeoutMs: Number.parseInt(process.env.GODOT_CSDAP_EVALUATE_TIMEOUT_MS ?? "8000", 10),
    runtimeHost: process.env.CLAUDE_RUNTIME_HOST ?? "127.0.0.1",
    runtimePort: Number.parseInt(process.env.CLAUDE_RUNTIME_PORT ?? "9081", 10),
    runtimeTimeoutMs: Number.parseInt(process.env.CLAUDE_RUNTIME_TIMEOUT_MS ?? "15000", 10),
  };
}
