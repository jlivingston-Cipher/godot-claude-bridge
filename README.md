# Breakpoint MCP

> A [Model Context Protocol](https://modelcontextprotocol.io) server that brings the
> **Godot game engine** into an AI assistant's development loop — authoring scenes,
> writing type-checked GDScript, running the project, and debugging the live game.
> Developed and tested with **Claude**; MCP is an open protocol, so other clients can
> connect too (see [Compatibility](#compatibility)).
>
> **v0.17.0 · 242 tools + 5 MCP resources · MIT.** The host builds against the stable
> `@modelcontextprotocol/sdk` 1.x API and is exercised by a 223-test suite plus
> real-Godot integration jobs on Node 18/20/22.

Breakpoint MCP connects an MCP-compatible AI assistant to a running Godot editor and
game. Instead of only scaffolding files, the assistant can open a scene, add and wire
nodes with full undo/redo, write GDScript with type-aware completion and diagnostics,
set a breakpoint and step through a failure from real program state, and then drive the
running game — the same inner loop a human developer uses.

It speaks Godot's **own** protocols — the editor plugin's loopback bridge, and Godot's
built-in **language server (LSP)** and **debug adapter (DAP)** — rather than
reimplementing them, so behavior tracks the engine you already have.

## What it does

Breakpoint MCP is organized into four capability **planes** (242 tools + 5 resources):

- **Plane A — Live Editor Bridge** (~145 tools: `editor_*`, `scene_*`, `node_*`,
  `signal_*`, `resource_*`, `filesystem_*`, `anim_*`, and more): a Godot `EditorPlugin`
  opens a loopback server the host drives for scene/node/resource CRUD **with full
  undo/redo**, project settings, `ClassDB` introspection, selection, and editor
  screenshots. This plane also includes native multiplayer authoring (`mp_*`),
  backend-SDK integration scaffolding (`backend_*`, `leaderboard_scaffold`,
  `cloudsave_scaffold`, `auth_scaffold`), AI asset generation (`asset_*`), and a
  read-only documentation / code-lookup family.

- **Plane B — Headless CLI** (`godot_*`): launch the editor, run the project, export,
  import, and run headless scripts or tests — no editor window required. Long-running
  jobs (`godot_export`, `godot_import`, `godot_run_headless_script`) run on the formal
  MCP **task model** (create → poll → await → cancel), while simpler clients still get a
  blocking result. `godot_run_managed` / `godot_output` capture the game's full console.

- **Plane C — Runtime Bridge** (`runtime_*`): an autoload (`BreakpointRuntimeBridge`) the
  plugin registers into every run opens a loopback server **inside the running game** —
  live SceneTree, runtime property get/set, method calls, signal emission, input
  injection for play-testing, performance monitors, and in-game frame capture. On Godot
  4.5+ it also captures the game's console (`print()`, warnings, errors) with zero
  configuration.

- **Plane D — Semantic & Debugging** (`gd_*`, `dbg_*`, plus C# `cs_*` / `cs_dbg_*`): the
  host connects as a client to Godot's built-in **GDScript language server** (port 6005)
  and **debug adapter** (port 6006) — completion, hover, definition/references, rename,
  symbols, signature help, diagnostics, plus real debugging: breakpoints, stepping,
  stack/scopes/variables, watch expressions, and expression evaluation. A parallel C#
  plane speaks OmniSharp (LSP) and netcoredbg (DAP). Capabilities are **feature-detected
  per engine build** and degrade to a clear "unsupported" message rather than erroring.

Five **MCP resources** (`godot://scene-tree`, `godot://editor-state`,
`godot://runtime/tree`, `godot://runtime/log`, `godot://class/{name}`) expose
pull-on-demand context, and clients can **subscribe** to be pushed updates when the
editor selection, edited scene, or the live SceneTree changes.

## Highlights

- **Undo-safe by construction.** Every edit-time mutation is wrapped in
  `EditorUndoRedoManager` — Ctrl-Z reverts anything the assistant did.
- **Confirmation-gated destructive tools.** Anything that deletes, overwrites, or writes
  a file prompts for confirmation first (with a `confirm: true` override, and a safe
  block when the client can't prompt).
- **Enforced output schemas.** Tool results are validated against frozen output schemas.
- **Local by design.** All planes talk to `127.0.0.1`; screenshots render real frames.

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

## Requirements

- **Node ≥ 18** (for the host).
- **Godot 4.2+** for the editor addon (4.4+ recommended). A few runtime features use
  Godot 4.5+, and some language-server / debug-adapter capabilities light up on newer
  builds as the engine implements them.

## Installation

### 1. Install the editor addon

Copy `addons/breakpoint_mcp/` into your project's `addons/` folder, then enable it under
**Project → Project Settings → Plugins → Breakpoint MCP**. On enable it listens on
`127.0.0.1:9080` (override with `CLAUDE_BRIDGE_PORT` before launching Godot).

Enabling the plugin also auto-registers the **runtime autoload**
(`BreakpointRuntimeBridge`), so the `runtime_*` tools work as soon as the project runs
(it listens on `127.0.0.1:9081` inside the game). No manual autoload setup needed.

Godot's **language server** (port 6005) and **debug adapter** (port 6006) are built in
and enabled by default while the editor is open — the `gd_*` and `dbg_*` tools use them
directly, no addon required. Ports are configurable under **Editor → Editor Settings →
Network → Language Server / Debug Adapter**.

### 2. Get the host

The host is published to npm as **`breakpoint-mcp`**:

```bash
npx breakpoint-mcp        # run on demand
# or
npm i -g breakpoint-mcp   # install the `breakpoint-mcp` command
```

To build from source instead:

```bash
cd host
npm install
npm run build   # tsc -> dist/
```

### 3. Register with your MCP client

Claude is the primary, tested client. **Claude Code:**

```bash
claude mcp add godot -- npx -y breakpoint-mcp
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "godot": {
      "command": "npx",
      "args": ["-y", "breakpoint-mcp"],
      "env": {
        "GODOT_BIN": "/abs/path/to/Godot",
        "GODOT_PROJECT": "/abs/path/to/your/project"
      }
    }
  }
}
```

Using a different MCP client (Cursor, VS Code, Windsurf, …)? See
[Compatibility](#compatibility) below — the command is the same, only the config file
and wrapper key differ.

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

The full, annotated configuration reference is in the [User Guide](docs/USER_GUIDE.md).

## Compatibility

Breakpoint MCP is a standard MCP server that talks over stdio, so in principle it works
with **any MCP-compatible client**. It is developed and tested with **Claude** (Claude
Code and Claude Desktop) — that's the supported path today. Other clients such as
Cursor, VS Code (Copilot agent mode), and Windsurf should work with the same command and
environment variables, but they are **not yet tested** with this server. If you try
Breakpoint MCP with another client — or a different model behind it — we'd genuinely love
to hear how it goes: please [open an issue](https://github.com/jlivingston-Cipher/godot-claude-bridge/issues)
describing your client and what worked or didn't.

Every client launches the host the same way: the command `npx -y breakpoint-mcp` with the
environment variables from the table above. Only the config file location and the wrapper
key differ.

| Client | Config file | Wrapper key | Notes |
|---|---|---|---|
| **Claude Code** | — | — | `claude mcp add godot -- npx -y breakpoint-mcp` |
| **Claude Desktop** | `claude_desktop_config.json` | `mcpServers` | see example above |
| **Cursor** | `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project) | `mcpServers` | same shape as Claude Desktop |
| **VS Code** (Copilot agent mode) | `.vscode/mcp.json` | `servers` | each entry also needs `"type": "stdio"` |
| **Windsurf** (Cascade) | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` | same shape as Claude Desktop |
| **Any other MCP client** | per its docs | — | point it at `npx -y breakpoint-mcp` as a stdio server + pass the env vars |

VS Code uses a slightly different shape (`servers`, with an explicit transport `type`):

```json
{
  "servers": {
    "godot": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "breakpoint-mcp"],
      "env": {
        "GODOT_BIN": "/abs/path/to/Godot",
        "GODOT_PROJECT": "/abs/path/to/your/project"
      }
    }
  }
}
```

Because the tool descriptions were tuned with Claude, another model may drive the tools
differently; if you notice rough edges with a particular client or model, an issue with
details helps us improve the experience for everyone.

## A typical session

1. `godot_launch_editor` (or open the project yourself).
2. `editor_ping` → confirm the bridge is live.
3. `scene_get_tree`, `classdb_get_class` → understand the scene and API.
4. `node_add`, `node_set_property`, … → make changes (all undoable).
5. `gd_completion` / `gd_diagnostics` → write GDScript with type awareness and catch
   errors *before* running.
6. `screenshot_editor` → let Claude *see* the result.
7. `dbg_set_breakpoints` → `dbg_launch` → `dbg_stack_trace` / `dbg_variables` /
   `dbg_evaluate` → debug from real program state.
8. `godot_run_project` → `runtime_get_tree` / `runtime_set_property` /
   `runtime_inject_input` / `runtime_screenshot` → drive and observe the *running* game.
9. `godot_run_headless_script` → run tests.

The [User Guide](docs/USER_GUIDE.md) walks through this end to end.

## Safety & trust model

Breakpoint MCP is a **local co-development tool** and is built to keep you in control:

- Every edit-time mutation goes through `EditorUndoRedoManager` — **Ctrl-Z reverts
  anything the assistant did** — and through the editor API (preserving UIDs/refs),
  never raw file writes.
- All sockets bind to **loopback (`127.0.0.1`) only**; handlers run on the editor **main
  thread**, so there are no threading hazards.
- **Destructive tools are elicitation-gated:** the host asks the client to confirm before
  executing (for example `node_delete`, `project_set_setting`, `scene_new`, `gd_rename`
  with apply, the file/resource/script writers, and the `runtime_*` mutators). Pass
  `confirm: true` to auto-approve; if the client can't prompt, the tool blocks rather
  than acting silently.
- **Higher-trust surfaces, stated plainly:** `godot_run_headless_script` and
  `godot_run_managed` execute GDScript, and the optional `asset_generate` **command**
  backend runs a local command you configure (via `BREAKPOINT_ASSETGEN_CMD` or the tool
  argument). These are opt-in and gated — point them only at code you trust.

Security policy and how to report a vulnerability: see [SECURITY.md](SECURITY.md).

## Documentation

- **[User Guide](docs/USER_GUIDE.md)** — the full manual: install, configure, concepts,
  workflows, troubleshooting, and FAQ.
- **[Tool Catalog](docs/TOOL_CATALOG.md)** — every tool with its input and output JSON
  Schemas.
- **[Runbook](docs/RUNBOOK.md)** — step-by-step live-validation checklist.
- **[Changelog](CHANGELOG.md)** — release history.
- **[Contributing](CONTRIBUTING.md)** · **[Security](SECURITY.md)** ·
  **[Code of Conduct](CODE_OF_CONDUCT.md)**

## Development

```bash
# static checks (no Godot or registry needed for the parity check)
python3 scripts/contract_check.py                 # host <-> addon <-> catalog agree
cd host && npm ci && npm run build && npm run typecheck && npm test
```

CI runs the real build and test suite on Node 18/20/22 plus the parity check, and
exercises the CLI, runtime, C#, and editor/debug planes against a real Godot engine.
See [CONTRIBUTING.md](CONTRIBUTING.md) to get set up.

**SDK note:** the host targets the stable `@modelcontextprotocol/sdk` **1.x** high-level
API (`server.registerTool(name, { title, description, inputSchema }, handler)`). If you
prefer the newer SDK v2 surface, adjust the import lines and wrap each `inputSchema` in
`z.object(...)`; the tool logic is unchanged.

## Trademarks

Godot and the Godot logo are trademarks of the Godot Foundation. Claude and Anthropic
are trademarks of Anthropic, PBC. SilentWolf, Nakama (Heroic Labs), PlayFab (Microsoft),
and Photon (Exit Games) are trademarks of their respective owners. Breakpoint MCP is an
independent, community-built project and is not affiliated with, sponsored by, or
endorsed by any of them; their names are used only to describe interoperability.

## License

MIT — see [LICENSE](LICENSE).
