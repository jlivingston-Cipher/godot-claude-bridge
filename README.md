# Godot–Claude Bridge

> **Status: v0.6.0 — live-validated and hardened.** All four capability planes were
> exercised end-to-end against a real Godot 4.7 editor and a real npm-installed
> `@modelcontextprotocol/sdk@1.29.0`; the Go/No-Go checklist is GO (see
> `LIVE_VALIDATION_SIGNOFF.md`). Output schemas are enforced (B1), the SDK floor is
> pinned to `^1.17.0` (D1), and CI runs the real build **plus a 124-test host suite
> and real-Godot integration smokes (CLI, LSP and DAP planes)** on Node 18/20/22 — the
> DAP plane lands a **real breakpoint stop** and reads live stack/scopes/variables, and the
> request-driven `dbg_*` paths — `set_variable`, `evaluate`, and `dbg_watch`'s per-stop watch
> evaluation — **fail fast** (bounded to ~8 s) on adapters that advertise a capability but never
> answer it (Godot 4.3's `setVariable`), instead of hanging the full 20 s DAP timeout. Full
> history in `CHANGELOG.md`; publishing steps and the remote caveat in `docs/DISTRIBUTION.md`.

Brings Godot into the Claude development ecosystem via MCP. It ships **all four** capability planes from the design evaluation plus the Phase 4 safety/UX polish (**70 tools + 5 MCP resources**):

- **Plane B — Headless CLI** (`godot_*` tools): launch the editor, run the project, export, import, run headless scripts/tests. Works with no editor open.
- **Plane A — Live Editor Bridge** (`editor_*`, `scene_*`, `node_*`, … tools): a Godot `EditorPlugin` opens a loopback TCP/JSON server that the MCP host drives — scene/node/resource CRUD **with full undo/redo**, project settings, `ClassDB` introspection, selection, and editor-viewport screenshots.
- **Plane D — Semantic & Debugging** (`gd_*`, `dbg_*` tools): the host connects as a client to Godot's **built-in GDScript language server (LSP, 6005)** and **Debug Adapter (DAP, 6006)** — type-aware completion, hover, definition/references, rename, symbols, **signature help**, **diagnostics**, plus read-only navigation/inspection (**go-to declaration** and **document links** work on Godot 4.3; **document-highlight** joins them on **Godot 4.7**, advertised `false` / unsupported on 4.3; **type-definition / implementation / folding-ranges / format-preview / document-color** and **workspace-symbol** — the last still replying `-32601` — remain unimplemented through 4.7, shipped and feature-detected so they light up automatically once a build implements them); plus real debugging: conditional/hit-count/logpoint **and exception** breakpoints (feature-detected per adapter — Godot 4.3 and 4.7 both advertise and honor none of these modifiers, so they are dropped with a warning), stepping, stack/scopes/variables, **watch expressions**, **set-variable**, and expression evaluation (live-verified in CI on Godot 4.3 **and 4.7**: `dbg_set_variable` is advertised (`supportsSetVariable=true`) but unanswered on both, so it is bounded to ~8 s and fails fast with a clear message; `dbg_evaluate` does bare-name lookup only on 4.3 but **gains full expression evaluation on 4.7**, where `counter + 1` → `101` — empty on 4.3). Reuses Godot's own protocol servers rather than reimplementing them.
- **Plane C — Runtime Bridge** (`runtime_*` tools): an autoload (`ClaudeRuntimeBridge`) the plugin auto-registers into every run opens a loopback TCP server inside the **running game** — live SceneTree, runtime property get/set, method calls, signal emission, input injection for play-testing, Performance monitors (incl. audio), and in-game frame capture. On **Godot 4.5+** it also **captures the game's console** (`print()`, warnings, errors) with zero configuration via a scriptable `Logger`, so `godot://runtime/log` / `runtime_get_log` return the live console **without a managed parent process** (D6).

Together these turn Claude from a scaffolder into a co-developer that can author scenes, write type-checked GDScript, run it, watch it, debug it, and drive the live game.

**Safety & UX polish (all implemented):** destructive tools are **elicitation-gated** (a client-side confirmation prompt, with a `confirm: true` override and a safe block when the client can't prompt); long jobs (`godot_export`/`godot_import`/`godot_run_headless_script`) run under the formal **MCP task model** (D2) — a task-aware client creates the job, then polls (`tasks/get`), awaits (`tasks/result`), or cancels (`tasks/cancel`) it, while plain clients still get today's blocking result; `godot_run_managed` + `godot_output` capture the game's full `print()`/error console host-side (and on **Godot 4.5+** the runtime bridge additionally captures the same console *inside* the game via a scriptable `Logger` — no managed parent required — surfaced through `godot://runtime/log` / `runtime_get_log`, D6); and five **MCP resources** (`godot://scene-tree`, `godot://editor-state`, `godot://runtime/tree`, `godot://runtime/log`, `godot://class/{name}`) expose pull-on-demand context — and a client can **subscribe** (`resources/subscribe`) to be pushed `notifications/resources/updated` when a subscribed resource changes (D3): the editor selection or edited scene, and the running game's live SceneTree (`godot://runtime/tree`). Rapid changes are coalesced per URI (leading-edge + trailing flush, overridable via `CLAUDE_RESOURCE_COALESCE_MS`).

## Why this one

There are a dozen Godot MCP servers. Most are *scene builders* — they create and edit nodes, and the better ones can also read a running game. **godot-claude-bridge is the only one that also gives the AI a real IDE loop over GDScript: type-aware code intelligence *and* a genuine step-debugger** — both by speaking Godot's own **LSP** and **Debug Adapter** protocols rather than reimplementing them. In practice the agent can autocomplete and jump to a definition while writing code, then set a conditional breakpoint, step through the failure, watch an expression, and read live variables from real program state — the loop a human developer actually uses, not just "edit the scene and hope."

The table compares the capabilities that separate these tools (as of July 2026, from each project's own docs/source — corrections welcome via an issue):

| | Step-debugger¹ | GDScript LSP² | Live runtime | Local-only | License |
|---|:--:|:--:|:--:|:--:|---|
| **godot-claude-bridge** | ● full | ● full | ● | ● | MIT |
| Godot MCP Native | ● full | ◐ custom index³ | ● | ● | MIT |
| Godot .NET MCP | ◐ partial⁴ | ○ diagnostics only | ◐ | ● | MIT |
| Wick (C#) | ○ inspect only⁵ | ● GDScript + C# | ● | ● | MIT |
| Godot MCP Pro | ○ | ○ | ● | ● | Proprietary |
| Godot-MCP (C#) | ○ | ○ reflection | ◐ | ○ cloud default | Apache-2.0 |

¹ real breakpoints **and** stepping, not just reading paused state.  ² completion / hover / go-to-definition via Godot's language server.  ³ hand-rolled symbol index — navigation only, no completion or hover.  ⁴ `step_over` only, no variable scopes.  ⁵ can read a paused stack but cannot set a breakpoint or step.

*(The other servers in the Asset Library — Beckett, Godot MCP Enhanced, and several more — have neither a step-debugger nor a language server; they run a "play the game and read the logs" loop.)*

Only godot-claude-bridge pairs a **complete** step-debugger with **true language-server** intelligence, and does it locally with enforced output schemas and confirmation-gated destructive tools. If you write **C#**, Wick or Godot .NET MCP will serve you better today; if you want the deepest **GDScript** authoring-and-debugging loop, this is the one.

```
┌───────────────────── Claude (Code / Desktop) ─────────────────────┐
│                        MCP over stdio                              │
└─────────────────────────────┬──────────────────────────────────────┘
                      host/ (TypeScript MCP server)
   ┌────────────┬──────────────┬──────────────┬────────────┬───────────┐
 spawn CLI   TCP :9080      TCP :9081       TCP :6005    TCP :6006
 (headless)  editor addon   in-game         Godot LSP    Godot DAP
             scenes/nodes   autoload        completion,  breakpoints,
             /undo          live SceneTree  diagnostics  stepping, eval
                            /monitors/input
```

## Layout

```
addons/claude_bridge/         # drop into your Godot project (or symlink)
  plugin.cfg  plugin.gd        # plugin registers the editor server + runtime autoload
  bridge_server.gd  operations.gd   # Plane A: editor-side server + handlers
  runtime_bridge.gd             # Plane C: in-game autoload server + handlers
  variant_json.gd               # shared Variant <-> JSON codec
host/                         # the MCP server Claude connects to
  src/index.ts  config.ts  logger.ts  paths.ts
  src/bridge.ts              # Plane A & C: TCP/JSON client (editor + runtime)
  src/framing.ts             # shared Content-Length framing (LSP + DAP)
  src/lsp.ts  src/dap.ts     # Plane D: LSP + DAP protocol clients
  src/confirm.ts             # Phase 4: elicitation gate for destructive tools
  src/tools/{cli,editor,lsp,dap,runtime,processes,resources}.ts
docs/TOOL_CATALOG.md          # every tool, input + output JSON Schemas
docs/RUNBOOK.md               # step-by-step live validation checklist
docs/VALIDATION_REPORT.md     # what's statically verified vs. needs a live run
example/                      # throwaway project to validate the bridge against
scripts/validate.sh           # automated setup + smoke steps
scripts/contract_check.py     # static host<->addon<->catalog consistency check
```

## Setup

### 1. Install the editor addon
Copy `addons/claude_bridge/` into your project's `addons/` folder, then enable **Project → Project Settings → Plugins → Claude Bridge**. On enable it listens on `127.0.0.1:9080` (override with the `CLAUDE_BRIDGE_PORT` environment variable before launching Godot). Requires **Godot 4.2+** (4.4+ recommended).

Godot's **language server** (LSP, port 6005) and **debug adapter** (DAP, port 6006) are built in and enabled by default while the editor is open — the `gd_*` and `dbg_*` tools use them directly, no addon required. Ports are configurable under **Editor → Editor Settings → Network → Language Server / Debug Adapter** (and via `GODOT_LSP_PORT` / `GODOT_DAP_PORT` on the host).

Enabling the plugin also auto-registers the **runtime autoload** (`ClaudeRuntimeBridge`), so the `runtime_*` tools work as soon as the project runs — it listens on `127.0.0.1:9081` inside the game (override via `CLAUDE_RUNTIME_PORT`). No manual autoload setup needed.

### 2. Get the host
The host is packaged for npm as **`godot-claude-bridge`** (see
[`host/README.md`](host/README.md)); once published you can run it with
`npx godot-claude-bridge`. To build from source:
```bash
cd host
npm install      # needs registry access; see "SDK version" note below
npm run build    # tsc -> dist/
```

### 3. Register with Claude

**Claude Code:**
```bash
claude mcp add godot -- node /abs/path/to/host/dist/index.js
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": ["/abs/path/to/host/dist/index.js"],
      "env": {
        "GODOT_BIN": "/abs/path/to/Godot",
        "GODOT_PROJECT": "/abs/path/to/your/project",
        "CLAUDE_BRIDGE_PORT": "9080"
      }
    }
  }
}
```

## Configuration (environment variables)

| Var | Default | Meaning |
|---|---|---|
| `GODOT_BIN` | `godot` | Path to the Godot editor binary |
| `GODOT_PROJECT` | cwd | Project directory (contains `project.godot`) |
| `CLAUDE_BRIDGE_HOST` | `127.0.0.1` | Editor-bridge host |
| `CLAUDE_BRIDGE_PORT` | `9080` | Editor-bridge port (must match the addon) |
| `CLAUDE_BRIDGE_TIMEOUT_MS` | `15000` | Per-request timeout for editor tools |
| `GODOT_LSP_HOST` / `GODOT_LSP_PORT` | `127.0.0.1` / `6005` | GDScript language server |
| `GODOT_DAP_HOST` / `GODOT_DAP_PORT` | `127.0.0.1` / `6006` | Debug adapter |
| `GODOT_LSP_TIMEOUT_MS` / `GODOT_DAP_TIMEOUT_MS` | `15000` / `20000` | LSP / DAP timeouts |
| `CLAUDE_RUNTIME_HOST` / `CLAUDE_RUNTIME_PORT` | `127.0.0.1` / `9081` | In-game runtime bridge (must match the autoload) |
| `CLAUDE_RUNTIME_TIMEOUT_MS` | `15000` | Runtime request timeout |

## Typical flow
1. `godot_launch_editor` (or open the project yourself).
2. `editor_ping` → confirm the bridge is live.
3. `scene_get_tree`, `classdb_get_class` → understand the scene / API.
4. `node_add`, `node_set_property`, … → make changes (all undoable).
5. `gd_completion` / `gd_diagnostics` → write GDScript with type awareness and catch errors *before* running.
6. `screenshot_editor` → let Claude *see* the result.
7. `dbg_set_breakpoints` → `dbg_launch` → `dbg_stack_trace` / `dbg_variables` / `dbg_evaluate` → debug a live bug from real state.
8. `godot_run_project` → `runtime_get_tree` / `runtime_set_property` / `runtime_inject_input` / `runtime_get_monitors` / `runtime_screenshot` → drive and observe the *running* game.
9. `godot_run_headless_script` → run tests.

## Safety model (built in)
- Every edit-time mutation is wrapped in `EditorUndoRedoManager` — **Ctrl-Z reverts anything Claude did.**
- The bridge binds to **loopback only**.
- Handlers run on the editor **main thread** (polled from `_process`), so no threading hazards.
- Destructive tools are **elicitation-gated**: the host prompts for confirmation before executing (`node_delete`, `project_set_setting`, `scene_new`, `gd_rename` with apply, `dbg_evaluate`, and the four `runtime_*` mutators). Pass `confirm: true` to auto-approve; if the client can't prompt, the tool blocks rather than acting silently.
- Mutations go through the editor API (preserving UIDs/refs), not raw file writes.

## Verification
- **Live-validated end to end.** All four planes were exercised against a real Godot 4.7 editor and a real npm-installed `@modelcontextprotocol/sdk@1.29.0`; the Go/No-Go checklist is GO (`LIVE_VALIDATION_SIGNOFF.md`). B1's enforced output schemas were exercised live with zero mismatches.
- **CI runs the real build** on every change — `npm ci && npm run build && npm run typecheck` against the published SDK on Node 18/20/22, plus `contract_check.py` host↔addon↔catalog parity (`.github/workflows/ci.yml`). This is the one gate static authoring can't do; it caught the `ToolResult` defect at v0.4.2.
- **Known engine gaps (both handled gracefully):** `gd_workspace_symbols` and `gd_code_action`. Godot's GDScript LSP replies `-32601` to `workspace/symbol` (through 4.7) and advertises `codeActionProvider: false` — both **re-confirmed live in CI on 4.3-stable** — so each tool feature-detects and returns a clear "unsupported" message instead of a raw error. `gd_signature_help` was confirmed **returning signatures** in the same CI run. The Phase-1 read-only navigation/inspection tools apply the same discipline — each feature-detects its capability and keeps a `-32601` fallback. The editor-plane CI probe (`D7_CAPS2` / `PROBE …`) ran them live against Godot 4.3-stable: **`gd_declaration` and `gd_document_link` return results**, while **`gd_document_highlight`, `gd_type_definition`, `gd_implementation`, `gd_folding_ranges` and `gd_formatting` are advertised `false`** on 4.3 and correctly degrade to a clear "unsupported" message (they light up on a build that implements them). See `CHANGELOG.md` / `docs/TOOL_CATALOG.md`.
- **DAP-plane CI (experimental).** A `dap-plane` integration job boots the editor under Xvfb and connects to Godot's built-in **Debug Adapter** (:6006) — the first live exercise of the `dbg_*` tools. It runs the `initialize` handshake (the gate) and logs the adapter's advertised capabilities (`D_DAP_CAPS` / `D_DAP_FILTERS`), so the advertised-vs-implemented status of `dbg_restart` / `dbg_goto` / `dbg_data_breakpoints` / `dbg_set_variable` on a given Godot build is visible in CI, then best-effort launches the example scene to a breakpoint. Like the LSP editor-plane it is `continue-on-error` and never gates a merge. The probe now lands a real breakpoint stop and **live-drives** the `dbg_*` tools, so their advertised-vs-implemented status on 4.3-stable is verified end-to-end rather than read from capabilities: **`dbg_restart` works** (native restart re-runs the scene and re-hits the breakpoint); `dbg_stack_trace` / `dbg_scopes` / `dbg_variables` / `dbg_watch` / `dbg_step` / `dbg_continue` return live values; **`dbg_evaluate` resolves bare variable names but returns empty for compound expressions**; and — despite advertising `supportsSetVariable=true` — **`dbg_set_variable` is unimplemented on 4.3** (the `setVariable` request times out and the value is unchanged). `supportsGotoTargetsRequest` / `supportsDataBreakpoints` are **false** (`dbg_goto` / `dbg_data_breakpoints` degrade to "unsupported"); 4.3 advertises no exception filters and does not answer `setExceptionBreakpoints`.
- **Runtime-plane CI (D6 capture, live).** A `runtime-plane` integration job boots the example **game** headless — no editor, no GUI (Plane C runs inside the running game) — and drives the `runtime_*` tools against the in-game `ClaudeRuntimeBridge` autoload (:9081) to verify **D6 zero-config console capture** against a live engine: a real `print()` must reach `runtime_get_log` via the scriptable `Logger`. It runs as a matrix across **4.3** (below the 4.5 floor — capture is a documented no-op: the bridge loads, `capture` is false, the `print()` is absent, and `push_log` entries are still served), **4.5** (the floor where `OS.add_logger` was introduced) and the newest stable **4.7** (on 4.5/4.7 the live `print()` must be captured). Headless and deterministic (no Xvfb/GPU); a **required gate** like the CLI plane — all three arms (4.3/4.5/4.7) must pass.

## Validating it
Static checks (what CI runs; the parity check needs no Godot or registry):
```bash
python3 scripts/contract_check.py               # host<->addon<->catalog agree
cd host && npm ci && npm run build && npm run typecheck   # real SDK build, 0 errors
```
For the full end-to-end run against the bundled `example/` project, use `scripts/validate.sh` (automated setup) then follow the per-plane checklist in `docs/RUNBOOK.md`. What is and isn't covered by static checks is spelled out in `docs/VALIDATION_REPORT.md`.

## SDK version note (important)
The host is written against the **stable `@modelcontextprotocol/sdk` 1.x** high-level API:
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
server.registerTool(name, { title, description, inputSchema /* zod raw shape */ }, handler);
```
If you install the newer **SDK v2** (`@modelcontextprotocol/server`, `import * as z from "zod/v4"`, `inputSchema: z.object({...})`), adjust the three import lines and wrap each `inputSchema` shape in `z.object(...)`. The tool logic is unchanged. See the SDK's server guide for the exact v2 surface.

## Status & what's next
All four capability planes plus the safety/UX polish are implemented and live-validated: elicitation gating, the formal MCP **task model** for long jobs (D2 — create/poll/await/cancel), host-side console capture (`godot_run_managed`/`godot_output`, which sidesteps the GDScript "can't hook `print()`" limit — `ClaudeRuntimeBridge.push_log` remains available for in-game structured logging), enforced output schemas, MCP resources, and live resource **subscriptions** (D3 — `resources/subscribe` + `notifications/resources/updated`).

Backlog (see `BACKLOG.md`): C#/.NET debugging via the OmniSharp path (D4); and an optional GDExtension logger for zero-config in-process capture without a managed parent process (D6). **D2 — the formal MCP task execution model for long jobs — is now implemented** (`godot_export`/`godot_import`/`godot_run_headless_script`), and **D3 — resource subscriptions — is now implemented** (`resources/subscribe`/`resources/unsubscribe` + `notifications/resources/updated` pushed on editor selection / edited-scene change); the end-to-end push is validated live by the non-blocking `editor-plane` CI probe.

MIT licensed.
