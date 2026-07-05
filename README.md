# Godot–Claude Bridge (Phases 0–4)

> **0.4.1 (pre-live-run hardening).** Two fixes targeting the failures most likely to surface on the first live run, ahead of the go/no-go pass in `docs/GO_NO_GO_CHECKLIST.md`:
> - **`gd_diagnostics` URI matching** — diagnostics are now cached under a project-relative key (`player.gd`) instead of the exact `file://` URI string, so a published-diagnostics URI matches the opened document even when the language server echoes an un-encoded `file://` path or a bare `res://` URI. Previously this could silently return empty on any project whose path needed percent-encoding.
> - **`dbg_step` / `dbg_continue` now await the next stop** — they wait for the program to settle (next breakpoint / step landing / termination) and return the real resulting state and stop reason, instead of returning immediately with a stale state.
>
> Still validated by typecheck + inspection only — see `docs/VALIDATION_REPORT.md`.

Brings Godot into the Claude development ecosystem via MCP. It ships **all four** capability planes from the design evaluation plus the Phase 4 safety/UX polish (**54 tools + 5 MCP resources**):

- **Plane B — Headless CLI** (`godot_*` tools): launch the editor, run the project, export, import, run headless scripts/tests. Works with no editor open.
- **Plane A — Live Editor Bridge** (`editor_*`, `scene_*`, `node_*`, … tools): a Godot `EditorPlugin` opens a loopback TCP/JSON server that the MCP host drives — scene/node/resource CRUD **with full undo/redo**, project settings, `ClassDB` introspection, selection, and editor-viewport screenshots.
- **Plane D — Semantic & Debugging** (`gd_*`, `dbg_*` tools): the host connects as a client to Godot's **built-in GDScript language server (LSP, 6005)** and **Debug Adapter (DAP, 6006)** — type-aware completion, hover, definition/references, rename, symbols, and **diagnostics**; plus real debugging: breakpoints, stepping, stack/scopes/variables, and expression evaluation. Reuses Godot's own protocol servers rather than reimplementing them.
- **Plane C — Runtime Bridge** (`runtime_*` tools): an autoload (`ClaudeRuntimeBridge`) the plugin auto-registers into every run opens a loopback TCP server inside the **running game** — live SceneTree, runtime property get/set, method calls, signal emission, input injection for play-testing, Performance monitors (incl. audio), and in-game frame capture.

Together these turn Claude from a scaffolder into a co-developer that can author scenes, write type-checked GDScript, run it, watch it, debug it, and drive the live game.

**Phase 4 polish (all implemented):** destructive tools are **elicitation-gated** (a client-side confirmation prompt, with a `confirm: true` override and a safe block when the client can't prompt); long jobs (`godot_export`/`godot_import`/`godot_run_headless_script`) stream **progress notifications**; `godot_run_managed` + `godot_output` capture the game's full `print()`/error console host-side; and five **MCP resources** (`godot://scene-tree`, `godot://editor-state`, `godot://runtime/tree`, `godot://runtime/log`, `godot://class/{name}`) expose pull-on-demand context.

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
addon/addons/claude_bridge/   # drop into your Godot project (or symlink)
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
Copy `addon/addons/claude_bridge/` into your project's `addons/` folder, then enable **Project → Project Settings → Plugins → Claude Bridge**. On enable it listens on `127.0.0.1:9080` (override with the `CLAUDE_BRIDGE_PORT` environment variable before launching Godot). Requires **Godot 4.2+** (4.4+ recommended).

Godot's **language server** (LSP, port 6005) and **debug adapter** (DAP, port 6006) are built in and enabled by default while the editor is open — the `gd_*` and `dbg_*` tools use them directly, no addon required. Ports are configurable under **Editor → Editor Settings → Network → Language Server / Debug Adapter** (and via `GODOT_LSP_PORT` / `GODOT_DAP_PORT` on the host).

Enabling the plugin also auto-registers the **runtime autoload** (`ClaudeRuntimeBridge`), so the `runtime_*` tools work as soon as the project runs — it listens on `127.0.0.1:9081` inside the game (override via `CLAUDE_RUNTIME_PORT`). No manual autoload setup needed.

### 2. Build the host
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
- Handlers run on the editor **main thread** (polled from `_process`), so no threading hazards in this scaffold.
- Destructive tools are **elicitation-gated**: the host prompts for confirmation before executing (`node_delete`, `project_set_setting`, `scene_new`, `gd_rename` with apply, `dbg_evaluate`, and the four `runtime_*` mutators). Pass `confirm: true` to auto-approve; if the client can't prompt, the tool blocks rather than acting silently.
- Mutations go through the editor API (preserving UIDs/refs), not raw file writes.

## Verification done
- `host/` **typechecks clean** under TypeScript against the SDK-1.x `registerTool` contract and `@types/node` (`npm run typecheck`, and an offline variant `tsconfig.typecheck.json` used where the registry is unreachable).
- The GDScript targets the stable Godot 4.x editor API (`EditorInterface`, `EditorUndoRedoManager`, `ClassDB`, `TCPServer`). It requires a running editor to execute and so is validated by inspection here, not by CI.
- The LSP/DAP clients use raw-TCP `Content-Length` framing (Godot moved its language server off WebSockets to TCP; the debug adapter is TCP too). The protocol handshakes follow the LSP/DAP specs and Godot's documented behavior; they require a running editor to exercise and so are validated by inspection + typecheck, not by CI.
- The runtime autoload reuses the editor bridge's exact wire protocol, so the host reuses `BridgeClient` for it. It requires the game to be running to exercise and is validated by inspection.

## Validating it
Static checks run anywhere (no Godot/registry needed):
```bash
cd host && npx tsc -p tsconfig.typecheck.json   # host typechecks clean
cd .. && python3 scripts/contract_check.py       # host<->addon<->catalog agree
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
All four capability planes plus the Phase 4 polish are implemented: elicitation gating, progress streaming, host-side console capture (`godot_run_managed`/`godot_output`, which sidesteps the GDScript "can't hook `print()`" limit — `ClaudeRuntimeBridge.push_log` remains available for in-game structured logging), and MCP resources.

Genuinely future work (not yet done): moving progress onto the formal MCP **task** execution model (vs. progress notifications); resource **subscriptions** with live `notifications/resources/updated` pushes; C#/.NET debugging via the OmniSharp path; and a small GDExtension logger if you want zero-config in-process capture without a managed parent process. This remains a **reference scaffold** — validated by typecheck and inspection, not yet exercised against a live editor in CI.

MIT licensed.
