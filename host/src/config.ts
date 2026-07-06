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
  /** Runtime bridge (in-game autoload) host/port + timeout. */
  runtimeHost: string;
  runtimePort: number;
  runtimeTimeoutMs: number;
}

export function loadConfig(): Config {
  const projectPath = process.env.GODOT_PROJECT ?? process.cwd();
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
    dapHost: process.env.GODOT_DAP_HOST ?? "127.0.0.1",
    dapPort: Number.parseInt(process.env.GODOT_DAP_PORT ?? "6006", 10),
    dapTimeoutMs: Number.parseInt(process.env.GODOT_DAP_TIMEOUT_MS ?? "20000", 10),
    dapSetVarTimeoutMs: Number.parseInt(process.env.GODOT_DAP_SETVAR_TIMEOUT_MS ?? "8000", 10),
    dapEvaluateTimeoutMs: Number.parseInt(process.env.GODOT_DAP_EVALUATE_TIMEOUT_MS ?? "8000", 10),
    runtimeHost: process.env.CLAUDE_RUNTIME_HOST ?? "127.0.0.1",
    runtimePort: Number.parseInt(process.env.CLAUDE_RUNTIME_PORT ?? "9081", 10),
    runtimeTimeoutMs: Number.parseInt(process.env.CLAUDE_RUNTIME_TIMEOUT_MS ?? "15000", 10),
  };
}
