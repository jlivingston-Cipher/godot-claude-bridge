# Live Validation Runbook

Exercises all four planes end-to-end against the `example/` project. Run this in an environment with **Node 18+ (npm registry access)** and **Godot 4.4+ with a real display/GL** — a developer machine (the bridge's intended home), not a headless CI box (screenshots and the editor GUI need a display).

Estimated time: ~15 minutes.

## 0. Prerequisites
- Godot 4.4+ installed; note its path (or put it on `PATH` as `godot`).
- Node 18+ and npm.
- Ports free: **9080** (editor bridge), **9081** (runtime bridge), **6005** (LSP), **6006** (DAP).
- Claude Code (or Claude Desktop) configured for MCP.

## 1. Automated setup
```bash
export GODOT_BIN=/path/to/godot        # if not on PATH
bash scripts/validate.sh
```
This runs the static contract check, copies the addon into `example/addons/`, builds the host (`host/dist/index.js`), and imports the project. Fix anything it flags before continuing.

## 2. Start the editor + bridge
1. Open the `example/` project in the Godot editor.
2. **Project → Project Settings → Plugins →** enable **Breakpoint MCP**.
3. In the **Output** panel confirm: `[breakpoint_mcp] listening on 127.0.0.1:9080`.
4. Confirm the language server and debug adapter are on under **Editor → Editor Settings → Network → Language Server** (6005) and **Debug Adapter** (6006). They're on by default.

## 3. Register the MCP host with Claude
```bash
claude mcp add godot -- node "$(pwd)/host/dist/index.js"
```
Set env for the server (Claude Code: `--env`, or the Desktop JSON block):
`GODOT_BIN=/path/to/godot`, `GODOT_PROJECT=$(pwd)/example`.

Restart/refresh so Claude sees the `godot_*`, `editor_*`, `scene_*`, `node_*`, `gd_*`, `dbg_*`, `runtime_*` tools and `godot://…` resources.

## 4. Per-plane checklist
Ask Claude to run each; mark pass/fail.

### Plane B — CLI (editor not required)
| # | Tool call | Expected |
|---|---|---|
| B1 | `godot_version` | version string like `4.x.stable` |
| B2 | `godot_run_headless_script` on a trivial script | exit_code 0, stdout captured |

### Plane A — Editor bridge (editor open, plugin enabled)
| # | Tool call | Expected |
|---|---|---|
| A1 | `editor_ping` | `{ pong: true, godot: "4.x" }` |
| A2 | `editor_get_state` | `has_open_scene: true`, root type `Node2D` |
| A3 | `scene_get_tree` | tree with `Main` → `Sprite2D` |
| A4 | `classdb_get_class` `AudioStreamPlayer3D` | methods/properties/signals listed |
| A5 | `node_add` `{parent_path:".", type:"AudioStreamPlayer3D", name:"SFX"}` | new node path `SFX`; appears in editor |
| A6 | `node_set_property` `{path:"Sprite2D", property:"position", value:{"__type__":"Vector2","x":10,"y":20}}` | position updates; **Ctrl-Z reverts it** |
| A7 | `node_delete` `{path:"SFX"}` | elicitation prompt → accept → node removed |
| A8 | `screenshot_editor` `{viewport:"2d"}` | image returned (2D editor tab active) |

### Plane D — LSP (semantic)
| # | Tool call | Expected |
|---|---|---|
| D1 | `gd_completion` in `player.gd` inside `take_damage` (e.g. after `count`) | suggests `counter` |
| D2 | `gd_hover` on `counter` | shows `int` type |
| D3 | `gd_definition` on `take_damage` usage | resolves to its declaration line |
| D4 | `gd_diagnostics` `player.gd` | empty (or expected) diagnostics; introduce a typo and re-run to see an error |

### Plane D — DAP (debugging)
| # | Tool call | Expected |
|---|---|---|
| E1 | `dbg_set_breakpoints` `{path:"res://player.gd", lines:[38]}` (the `counter -= amount` line) | breakpoint buffered/verified |
| E2 | `dbg_launch` | game starts; session running |
| E3 | trigger `take_damage` (via `runtime_call_method`, see C-plane) | `stopped` at the breakpoint |
| E4 | `dbg_stack_trace` → `dbg_scopes` → `dbg_variables` | see `amount`, `counter` locals |
| E5 | `dbg_evaluate` `{expression:"counter"}` | elicitation → accept → returns value |
| E6 | `dbg_continue` | resumes |

### Plane C — Runtime bridge (game running)
| # | Tool call | Expected |
|---|---|---|
| C1 | `godot_run_managed` | returns a process id; game window opens |
| C2 | `godot_output` `{id}` | includes `[example] player ready` |
| C3 | `runtime_get_tree` | live tree with `Main` |
| C4 | `runtime_get_property` `{path:".", property:"counter"}` | `100` |
| C5 | `runtime_call_method` `{path:".", method:"take_damage", args:[10]}` | elicitation → accept → returns `90` |
| C6 | `runtime_get_monitors` `{keys:["time/fps","audio/output_latency"]}` | numeric values |
| C7 | `runtime_screenshot` | game frame image |
| C8 | `runtime_get_log` | includes the `push_log` entries |
| C9 | `godot_stop` `{id}` | process terminates |

### Resources
| # | Read resource | Expected |
|---|---|---|
| R1 | `godot://scene-tree` | edited scene JSON |
| R2 | `godot://class/AudioStreamPlayer3D` | ClassDB JSON |
| R3 | `godot://runtime/log` (while running) | log entries |

### Safety (elicitation)
| # | Check | Expected |
|---|---|---|
| S1 | Call a gated tool (e.g. `node_delete`) and **decline** the prompt | returns "cancelled", no change |
| S2 | Call it again with `{confirm:true}` | proceeds without a prompt |
| S3 | On a client without elicitation | tool blocks and asks for `confirm:true` |

## 5. Teardown
- `godot_stop` any managed processes; `dbg_continue` to let a debug session finish.
- Disable the plugin (this removes the runtime autoload entry it added).
- `claude mcp remove godot` if desired.

## Troubleshooting
- **`editor_ping` fails** — plugin not enabled, or port 9080 taken (set `CLAUDE_BRIDGE_PORT` before launching Godot **and** `CLAUDE_BRIDGE_PORT` in the host env).
- **`gd_*` fail** — LSP not running or wrong port; check Editor Settings → Network → Language Server, set `GODOT_LSP_PORT`.
- **`dbg_*` fail** — Debug Adapter disabled or port mismatch; set `GODOT_DAP_PORT`. `stepOut` may be unsupported on older Godot.
- **`runtime_*` fail** — game not running, or the autoload didn't register (re-enable the plugin, confirm `BreakpointRuntimeBridge listening on 127.0.0.1:9081` in the game's Output).
- **Screenshots blank** — the matching editor tab (2D/3D) must be active and rendered; headless has no GPU.
- **SDK type/API mismatch at build** — if on SDK v2, adjust the three imports per `README.md` (SDK version note).
