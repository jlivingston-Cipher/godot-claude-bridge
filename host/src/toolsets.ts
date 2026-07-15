/**
 * Toolset registry — the single source of truth for how the tool surface is
 * grouped, used by BOTH `index.ts` (to register the live surface) and the
 * registration tests (to assert the surface). Keeping one ordered list here
 * means the two can never drift.
 *
 * The A/B/C/D planes already ARE the grouping; a toolset is just a named handle
 * on one register*Tools group so an operator can enable only the planes a
 * project needs (GitHub-MCP `--toolsets` style). This does not shrink the
 * catalog — every tool is still typed, validated and undoable — it lets a
 * client that can't filter (or a user who wants an even smaller default menu)
 * load only the groups they use. On Claude Code, Tool Search already defers the
 * whole catalog for free; toolsets are the open, in-the-server complement for
 * every other client.
 */
import type { Config } from "./config.js";
import { registerCliTools } from "./tools/cli.js";
import { registerEditorTools } from "./tools/editor.js";
import { registerLspTools } from "./tools/lsp.js";
import { registerCsLspTools } from "./tools/cslsp.js";
import { registerDapTools } from "./tools/dap.js";
import { registerCsDapTools } from "./tools/csdap.js";
import { registerRuntimeTools } from "./tools/runtime.js";
import { registerProcessTools } from "./tools/processes.js";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerVcsTools } from "./tools/vcs.js";
import { registerAssetGenTools } from "./tools/assetgen.js";
import { registerNetcodeTools } from "./tools/netcode.js";
import { registerBackendTools } from "./tools/backend.js";
import { registerTabletopTools } from "./tools/tabletop.js";
import { registerResources } from "./tools/resources.js";

/** A minimal shape for whichever clients the register* funcs receive. */
type AnyClient = never;

export interface ToolsetDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: any;
  bridge: unknown;
  runtime: unknown;
  lsp: unknown;
  csLsp: unknown;
  dap: unknown;
  csDap: unknown;
  config: Config;
  /** Called with the managed-process handle so the caller can wire shutdown. */
  onProcesses?: (handle: ReturnType<typeof registerProcessTools>) => void;
}

export interface Toolset {
  /** Stable id used in BREAKPOINT_TOOLSETS (also the register-group name). */
  id: string;
  /** One-line human description (shown by `doctor`, docs). */
  describe: string;
  /** Register this group's tools onto the server. */
  run: () => void;
}

/**
 * Build the ordered toolset list. Order matches `index.ts` exactly so the live
 * tool list is byte-identical whether or not filtering is applied. `resources`
 * here registers only the MCP resources; resource *subscriptions* are wired by
 * the caller after selection (they add no tools, only notification plumbing).
 */
export function buildToolsets(d: ToolsetDeps): Toolset[] {
  const s = d.server;
  const c = d.config;
  const stub = <T,>(v: unknown) => v as T;
  return [
    { id: "cli", describe: "Plane B — headless CLI (no editor required)", run: () => registerCliTools(s, c) },
    { id: "editor", describe: "Plane A — live editor authoring (addon bridge)", run: () => registerEditorTools(s, stub<AnyClient>(d.bridge)) },
    { id: "lsp", describe: "Plane D — GDScript language server (LSP)", run: () => registerLspTools(s, stub<AnyClient>(d.lsp), c) },
    { id: "cslsp", describe: "Plane D — C# language server (OmniSharp)", run: () => registerCsLspTools(s, stub<AnyClient>(d.csLsp), c) },
    { id: "dap", describe: "Plane D — GDScript debug adapter (DAP)", run: () => registerDapTools(s, stub<AnyClient>(d.dap), c) },
    { id: "csdap", describe: "Plane D — C# debug adapter (netcoredbg)", run: () => registerCsDapTools(s, stub<AnyClient>(d.csDap), c) },
    { id: "runtime", describe: "Plane C — running-game runtime + verification family", run: () => registerRuntimeTools(s, stub<AnyClient>(d.runtime)) },
    { id: "processes", describe: "Managed run + captured console output", run: () => { const h = registerProcessTools(s, c); d.onProcesses?.(h); } },
    { id: "knowledge", describe: "Group K — host-side project grep / symbol & idiom lookup", run: () => registerKnowledgeTools(s, c) },
    { id: "vcs", describe: "Group L — read-only version control (git) over the project", run: () => registerVcsTools(s, c) },
    { id: "assetgen", describe: "Group J — AI asset generation (degrades to a spec when off)", run: () => registerAssetGenTools(s, stub<AnyClient>(d.bridge), c) },
    { id: "netcode", describe: "Group M — multiplayer scaffolding (mp_*)", run: () => registerNetcodeTools(s, stub<AnyClient>(d.bridge), c) },
    { id: "backend", describe: "Group M — backend-SDK integration scaffolding", run: () => registerBackendTools(s, stub<AnyClient>(d.bridge), c) },
    { id: "tabletop", describe: "Group N — card/board/piece authoring composites", run: () => registerTabletopTools(s, stub<AnyClient>(d.bridge), c) },
    { id: "resources", describe: "MCP resources (scene tree, editor/runtime state, ClassDB)", run: () => registerResources(s, stub<AnyClient>(d.bridge), stub<AnyClient>(d.runtime)) },
  ];
}
