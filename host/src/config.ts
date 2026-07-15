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
  /**
   * Group J — AI asset generation backend selection (the feature "flag").
   * `assetGenBackend` is one of "none" | "placeholder" | "command":
   *   - "none"        : OFF by default. The asset_gen_* tools degrade to a clear
   *                     "no generation backend configured" and return a request
   *                     spec the connected multimodal client can fulfil — the MCP
   *                     server never calls a model itself.
   *   - "placeholder" : deterministic, in-engine procedural stand-ins (no model).
   *   - "command"     : delegate to a configured local backend. `assetGenCommand`
   *                     is an argv TEMPLATE whose tokens {kind} {prompt} {output}
   *                     {width} {height} {format} are substituted per-argument (no
   *                     shell), and the command is responsible for writing the file
   *                     to {output}. Same bring-your-own-tool trust model as the
   *                     C# OmniSharp / netcoredbg commands above.
   * All are session-overridable at runtime via the asset_gen_configure tool.
   */
  assetGenBackend: string;
  assetGenCommand: string;
  assetGenProvider: string;
  assetGenTimeoutMs: number;
  /**
   * Plane/group toolset selection (BREAKPOINT_TOOLSETS). `null` = the full
   * surface (default, backward-compatible). A non-empty list enables only the
   * named register-groups — e.g. `runtime`, `editor`, `lsp` — or the plane
   * aliases `a`/`b`/`c`/`d` (and `csharp`, `semantic`, `all`). Lets a client
   * that can't defer tools, or a user who wants a smaller default menu, load
   * only the planes a project needs. See `selectToolsets`.
   */
  toolsets: string[] | null;
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
    bridgeHost: process.env.BREAKPOINT_BRIDGE_HOST ?? "127.0.0.1",
    bridgePort: Number.parseInt(process.env.BREAKPOINT_BRIDGE_PORT ?? "9080", 10),
    bridgeTimeoutMs: Number.parseInt(
      process.env.BREAKPOINT_BRIDGE_TIMEOUT_MS ?? "15000",
      10,
    ),
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
    runtimeHost: process.env.BREAKPOINT_RUNTIME_HOST ?? "127.0.0.1",
    runtimePort: Number.parseInt(process.env.BREAKPOINT_RUNTIME_PORT ?? "9081", 10),
    runtimeTimeoutMs: Number.parseInt(
      process.env.BREAKPOINT_RUNTIME_TIMEOUT_MS ?? "15000",
      10,
    ),
    // Group J: asset generation is OFF by default (backend "none" → tools degrade).
    assetGenBackend: process.env.BREAKPOINT_ASSETGEN_BACKEND ?? "none",
    assetGenCommand: process.env.BREAKPOINT_ASSETGEN_CMD ?? "",
    assetGenProvider: process.env.BREAKPOINT_ASSETGEN_PROVIDER ?? "",
    assetGenTimeoutMs: Number.parseInt(process.env.BREAKPOINT_ASSETGEN_TIMEOUT_MS ?? "120000", 10),
    toolsets: parseToolsets(process.env.BREAKPOINT_TOOLSETS),
  };
}

/** Parse the raw BREAKPOINT_TOOLSETS env into a normalized token list (or null
 *  for "unset" → full surface). Comma/whitespace separated, lower-cased. */
export function parseToolsets(raw: string | undefined): string[] | null {
  if (raw == null) return null;
  const toks = raw
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return toks.length ? toks : null;
}

/**
 * Plane/convenience aliases → concrete toolset ids. Kept here (not in
 * `toolsets.ts`) so selection has no dependency on the register* functions and
 * stays trivially unit-testable.
 */
export const TOOLSET_ALIASES: Record<string, string[]> = {
  a: ["editor"],
  b: ["cli"],
  c: ["runtime"],
  d: ["lsp", "cslsp", "dap", "csdap"],
  csharp: ["cslsp", "csdap"],
  semantic: ["lsp", "cslsp", "dap", "csdap"],
};

/**
 * Resolve a requested toolset list against the known ids.
 *  - `requested == null`  → every id (the default full surface).
 *  - aliases expand to their ids; unknown tokens are dropped (reported via
 *    `onUnknown`, so `index.ts` can warn without this being impure).
 *  - if nothing valid resolves, fall back to the full surface (a misconfigured
 *    filter must never silently yield an empty, useless server).
 * Returns a Set preserving membership only; the caller iterates the ordered
 * toolset list, so registration order is unaffected.
 */
export function selectToolsets(
  allIds: readonly string[],
  requested: string[] | null,
  onUnknown?: (tokens: string[]) => void,
): Set<string> {
  const known = new Set(allIds);
  if (requested == null) return new Set(allIds);
  const out = new Set<string>();
  const unknown: string[] = [];
  for (const tok of requested) {
    if (tok === "all") {
      for (const id of allIds) out.add(id);
    } else if (TOOLSET_ALIASES[tok]) {
      for (const id of TOOLSET_ALIASES[tok]) if (known.has(id)) out.add(id);
    } else if (known.has(tok)) {
      out.add(tok);
    } else {
      unknown.push(tok);
    }
  }
  if (unknown.length && onUnknown) onUnknown(unknown);
  return out.size ? out : new Set(allIds);
}
