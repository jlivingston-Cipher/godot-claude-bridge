/**
 * Capability groups — a risk-based axis that cuts ACROSS the plane/feature
 * toolsets (`BREAKPOINT_TOOLSETS`). Two groups, both OFF by default:
 *
 *   • `code-execution` — tools that run arbitrary GDScript, invoke arbitrary
 *     methods, evaluate an expression in a paused debug frame, or run a local
 *     asset-gen *command* backend.
 *   • `network` — tools that egress beyond loopback: the Group M backend SDK.
 *
 * Where toolsets filter whole planes, capability groups tag INDIVIDUAL tools and
 * DROP them at registration when their group isn't enabled — so a default
 * session's advertised surface omits the high-blast tools entirely
 * (least-privilege by construction, mirroring `godot-agent-loop`). The full
 * 282-tool surface loads only when `BREAKPOINT_PRIVILEGED_GROUPS` opts the
 * groups back in; the secure-default surface is 282 − 14 = 268 tools.
 *
 * A tool with NO capability tag is always registered. Semantics are a UNION: a
 * tool tagged with more than one group is registered when ANY of its groups is
 * enabled. (No tool is multi-tagged today; the asset-gen generators were formerly
 * `code-execution` + `network`, but their `network` path — an external *provider*
 * backend — is not implemented, so they are `code-execution`-only until it ships.)
 *
 * This is defense-in-depth + a legible least-privilege default over a surface
 * that is already typed, schema-frozen, undoable, and destructive-op
 * elicitation-gated — NOT the closing of an open hole. The dropped tools never
 * become a silent gap: the always-on `godot://capabilities` resource lists every
 * group, its state, the tools it gates, and exactly how to enable it.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type CapabilityGroup = "code-execution" | "network";

/** The two groups, in display order. */
export const CAPABILITY_GROUPS: readonly CapabilityGroup[] = ["code-execution", "network"];

/** One-line human description per group (shown by `doctor` and the resource). */
export const GROUP_DESCRIBE: Record<CapabilityGroup, string> = {
  "code-execution":
    "Run arbitrary GDScript, invoke arbitrary methods, evaluate an expression in a paused debug frame, or run a local asset-gen command backend.",
  network: "Egress beyond loopback — the Group M backend SDK.",
};

/**
 * Tool → capability group(s). A tool absent from this map is unprivileged and
 * always registered. This is the single source of truth for the risk tagging,
 * asserted total-and-correct by `capabilities.test.ts`.
 */
export const TOOL_CAPABILITIES: Readonly<Record<string, readonly CapabilityGroup[]>> = {
  // code-execution — arbitrary execution / invocation / paused-frame evaluation
  godot_run_headless_script: ["code-execution"],
  godot_run_managed: ["code-execution"],
  node_call_method: ["code-execution"],
  runtime_call_method: ["code-execution"],
  dbg_evaluate: ["code-execution"],
  cs_dbg_evaluate: ["code-execution"],
  // asset generation — the local command backend (code-execution) is the only
  // privileged path. Formerly also tagged `network` for an external provider
  // backend, but that backend is not implemented, so the network tag is dropped
  // until it ships — keeps the advertised capability matching the real surface.
  asset_gen_configure: ["code-execution"],
  asset_gen_icon: ["code-execution"],
  asset_gen_sprite: ["code-execution"],
  asset_gen_texture: ["code-execution"],
  asset_gen_model: ["code-execution"],
  asset_gen_audio_sfx: ["code-execution"],
  // network — Group M backend SDK (egress to a backend provider)
  backend_configure: ["network"],
  backend_detect: ["network"],
};

/**
 * Parse the raw BREAKPOINT_PRIVILEGED_GROUPS env into a normalized token list
 * (or null for "unset" → no groups → the safe-default surface). Comma/whitespace
 * separated, lower-cased. Mirrors `parseToolsets`.
 */
export function parsePrivilegedGroups(raw: string | undefined): string[] | null {
  if (raw == null) return null;
  const toks = raw
    .split(/[,\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return toks.length ? toks : null;
}

/**
 * Resolve normalized tokens to the enabled group set. Unknown tokens are
 * reported via `onUnknown` and ignored (a typo never silently enables a group).
 * `null`/empty → the empty set (safe default). `all` enables every group.
 */
export function selectPrivilegedGroups(
  tokens: string[] | null,
  onUnknown?: (unknown: string[]) => void,
): Set<CapabilityGroup> {
  const enabled = new Set<CapabilityGroup>();
  if (!tokens) return enabled;
  const known = new Set<string>(CAPABILITY_GROUPS);
  const unknown: string[] = [];
  for (const t of tokens) {
    if (t === "all") {
      for (const g of CAPABILITY_GROUPS) enabled.add(g);
    } else if (known.has(t)) {
      enabled.add(t as CapabilityGroup);
    } else {
      unknown.push(t);
    }
  }
  if (unknown.length && onUnknown) onUnknown(unknown);
  return enabled;
}

/** Is a tool allowed given the enabled groups? Untagged tools are always allowed. */
export function toolAllowed(name: string, enabled: ReadonlySet<CapabilityGroup>): boolean {
  const groups = TOOL_CAPABILITIES[name];
  if (!groups || groups.length === 0) return true;
  return groups.some((g) => enabled.has(g));
}

/** The sorted set of privileged tool names dropped when `enabled` groups are active. */
export function droppedTools(enabled: ReadonlySet<CapabilityGroup>): string[] {
  return Object.keys(TOOL_CAPABILITIES)
    .filter((name) => !toolAllowed(name, enabled))
    .sort();
}

/**
 * Wrap `server.registerTool` to DROP any tool whose capability group isn't
 * enabled, so a disabled group's tools never reach `tools/list`. Mirrors
 * `applyOutputSchemas`' wrapping; call once, right AFTER `applyOutputSchemas`
 * (so the schema-injection wrapper stays innermost) and before any
 * `register*Tools()` call. A dropped tool returns a harmless stub handle so the
 * calling register* code proceeds unchanged.
 */
export function applyCapabilities(server: McpServer, enabled: ReadonlySet<CapabilityGroup>): void {
  const gate =
    (raw: (name: string, config: unknown, handler: unknown) => unknown) =>
    (name: string, config: unknown, handler: unknown) => {
      if (!toolAllowed(name, enabled)) {
        // Not registered — omitted from tools/list entirely (least-privilege).
        return { name } as unknown;
      }
      return raw(name, config, handler);
    };

  const s = server as unknown as {
    registerTool: (name: string, config: unknown, handler: unknown) => unknown;
    experimental?: { tasks?: { registerToolTask?: (name: string, config: unknown, handler: unknown) => unknown } };
  };

  s.registerTool = gate(s.registerTool.bind(server) as never);

  // D2 task-model tools (long jobs like `godot_run_headless_script`) register
  // through server.experimental.tasks.registerToolTask, NOT registerTool — gate
  // that path too, or a privileged task tool would slip past the drop filter.
  const tasks = s.experimental?.tasks;
  if (tasks?.registerToolTask) {
    tasks.registerToolTask = gate(tasks.registerToolTask.bind(tasks) as never);
  }
}

/**
 * Register the always-on `godot://capabilities` resource: a read-only listing of
 * the capability groups, their enabled/disabled state, exactly which tools each
 * gates, the dropped set, and the env one-liner to enable them. Registered
 * UNCONDITIONALLY (not behind the `resources` toolset), so the dropped privileged
 * tools are never a silent gap — an agent can always see what exists-but-is-
 * disabled and how to turn it on.
 */
export function registerCapabilitiesResource(server: McpServer, enabled: ReadonlySet<CapabilityGroup>): void {
  server.registerResource(
    "capabilities",
    "godot://capabilities",
    {
      title: "Capability groups",
      description:
        "Higher-trust tool groups, their enabled/disabled state, the tools each gates, and how to enable them.",
      mimeType: "application/json",
    },
    async (uri) => {
      const groups = CAPABILITY_GROUPS.map((g) => ({
        id: g,
        enabled: enabled.has(g),
        describe: GROUP_DESCRIBE[g],
        tools: Object.keys(TOOL_CAPABILITIES)
          .filter((name) => (TOOL_CAPABILITIES[name] ?? []).includes(g))
          .sort(),
      }));
      const payload = {
        summary:
          "Two higher-trust tool groups are OFF by default. A disabled group's tools are not registered (omitted from tools/list). Enable a group to load its tools.",
        default_secure: enabled.size === 0,
        enabled_groups: [...enabled].sort(),
        dropped_tools: droppedTools(enabled),
        how_to_enable:
          "Set BREAKPOINT_PRIVILEGED_GROUPS in the MCP server env (comma-separated): 'code-execution', 'network', 'code-execution,network', or 'all'. Or re-run `npx breakpoint-mcp init` for a guided setup.",
        groups,
      };
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
