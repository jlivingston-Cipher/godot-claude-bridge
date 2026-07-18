# Breakpoint MCP

> A [Model Context Protocol](https://modelcontextprotocol.io) server that brings the
> **Godot game engine** into an AI assistant's development loop — authoring scenes,
> writing type-checked GDScript, running the project, and debugging the live game.
> Developed and tested with **Claude**; MCP is an open protocol, so other clients can
> connect too (see [Compatibility](#compatibility)).
>
> **npm 1.18.1 · addon 1.7.0 · full 276 / secure-default 262 tools · 6 MCP resources · MIT.** The host builds against
> the stable `@modelcontextprotocol/sdk` 1.x API and is exercised by a 431-test suite plus
> real-Godot integration jobs on Node 18/20/22.

Breakpoint MCP connects an MCP-compatible AI assistant to a running Godot editor and
game. Instead of only scaffolding files, the assistant can open a scene, add and wire
nodes with full undo/redo, write GDScript with type-aware completion and diagnostics,
set a breakpoint and step through a failure from real program state, and then drive the
running game — the same inner loop a human developer uses.

It speaks Godot's **own** protocols — the editor plugin's loopback bridge, and Godot's
built-in **language server (LSP)** and **debug adapter (DAP)** — rather than
reimplementing them, so behavior tracks the engine you already have.

## Why Breakpoint?

Breakpoint is an MCP server that drives Godot through the engine's *own* interfaces: the
editor plugin's loopback bridge for scene/node/resource work, a runtime bridge inside the
running game, the headless CLI, and — the part that sets it apart — Godot's built-in
**language server (LSP)** and **debug adapter (DAP)**, to which Breakpoint speaks as a real
client. Most Godot MCP servers stop at the first group: they create and edit scenes and
scripts, take screenshots, and read the output log. That covers authoring, but it observes a
running game only from the outside.

Two differentiating capabilities are the reason to reach for Breakpoint:

- **A step-debugger for GDScript and C#.** Set a breakpoint, step, read the real call stack
  and variable values, watch expressions, and evaluate in the paused frame — over Godot's
  Debug Adapter (and `netcoredbg` for C#). This is the difference between inspecting state
  and reading logs: the assistant can stop at the failure and look at actual values instead
  of inferring them from `print()` output and re-runs. A runnable example lives in
  [`example/demo/`](example/demo/): a buggy heal-on-hit combat scene where the debugger stops
  on `hp -= effective` and reveals `effective = -2` — a light hit *healing* instead of hurting.
  The same bug is mirrored in C# at [`example-csharp/demo/`](example-csharp/demo/)
  (`DemoCombat.TakeHit`), diagnosed the same way over `netcoredbg` — and *verified* the
  same way on both tracks: the read-only assertion family below proves the one-line clamp
  over the runtime bridge (`HealedEver == false`, `"YOU DIED"` on screen), a check that
  fails before the fix and passes after.
- **A language-server client for GDScript and C#.** Completion, hover, go-to-definition, find
  references, rename, and diagnostics — over Godot's LSP (and OmniSharp for C#). Edits are
  symbol-accurate rather than text-substituted, and type errors surface before the project
  runs.

Around those, the editing surface is built to be safe to hand to an agent: every edit goes
through `EditorUndoRedoManager` (Ctrl-Z reverts anything the assistant did), destructive
tools are confirmation-gated, and every tool result is validated against a frozen output
schema. A read-only verification family (assert node state, scene structure, on-screen text,
performance baselines, and screenshot diffs) lets the assistant check a running game the way
a test would — and because the same server also debugs, a failed assertion is one step from
the state that caused it. The editor, LSP, DAP, and runtime bridges are exercised together
against a real headless Godot in CI.

### When Breakpoint is the right tool — and when it isn't

It earns its keep on work that needs program state or real symbols:

- **Diagnosing a live failure** — a wrong value, a null reference, a crash in a signal
  handler: breakpoint, step, and read the actual variables in the paused frame instead of
  instrumenting with prints and re-running.
- **Refactoring against real symbols** — rename a method or property project-wide, or find
  every reference, over the LSP, so it's accurate rather than a text search.
- **Type-aware authoring** — write GDScript or C# with completion and diagnostics, catching
  type errors before the game runs.
- **C#/.NET projects** — the LSP and DAP paths cover C# as well as GDScript.
- **Verifying a running game in a loop** — assert node/scene/screen/performance state after a
  change, with a failed assertion one step from the debugger.

If you only need scene and script edits from inside the editor — scaffolding a scene,
generating a script from a prompt, quick one-shot changes — there are other good alternatives
to Breakpoint available in the Godot Asset Library. Breakpoint's value shows up when you need
to *step through* a bug, *refactor against real symbols*, or work in *C#*.

### Why a Node host?

Breakpoint runs a small Node process on purpose: it is what lets the server act as a real LSP
and DAP client (the two capabilities above), run long jobs on the MCP task model, and connect
from any stdio MCP client. The host is the price of the debugger and the language server, not
incidental plumbing. Setup is one command to install and one to verify:

```bash
npx breakpoint-mcp init     # copies + enables the addon and writes your MCP-client config
npx breakpoint-mcp doctor   # verifies the Godot binary and all four bridges are live
```

If you never step through a bug or refactor against real symbols, you may not need the host;
if you do, that is exactly what it buys.

## What it does

Breakpoint MCP is organized into four capability **planes** (full **276 tools**, or **262** with the two privileged capability groups off by default — see [Safety & trust model](#safety--trust-model) — plus **6 resources**):

- **Plane A — Live Editor Bridge** (~145 tools: `editor_*`, `scene_*`, `node_*`,
  `signal_*`, `resource_*`, `filesystem_*`, `anim_*`, and more): a Godot `EditorPlugin`
  opens a loopback server the host drives for scene/node/resource CRUD **with full
  undo/redo**, project settings, `ClassDB` introspection, selection, and editor
  screenshots. This plane also includes native multiplayer authoring (`mp_*`),
  backend-SDK integration scaffolding (`backend_*`, `leaderboard_scaffold`,
  `cloudsave_scaffold`, `auth_scaffold`), AI asset generation (`asset_*`), and a
  read-only documentation / code-lookup family.

- **Plane B — Headless CLI & host-side tools** (`godot_*`, `vcs_*`, project search):
  launch the editor, run the project, export, import, and run headless scripts or tests —
  no editor window required. Long-running jobs (`godot_export`, `godot_import`,
  `godot_run_headless_script`) run on the formal MCP **task model** (create → poll → await
  → cancel), while simpler clients still get a blocking result. `godot_run_managed` /
  `godot_output` capture the game's full console. **Version control (`vcs_*`)** reads the
  project's git repository (status, log, diff, show, branches, blame) and performs safe
  local git actions (stage, commit, restore, stash, branch, switch) — destructive ops are
  confirmation-gated, and no network operations are exposed (push/pull stay manual).

- **Plane C — Runtime Bridge** (`runtime_*`): an autoload (`BreakpointRuntimeBridge`) the
  plugin registers into every run opens a loopback server **inside the running game** —
  live SceneTree, runtime property get/set, method calls, signal emission, input
  injection for play-testing, performance monitors, and in-game frame capture — plus a
  read-only verification family (`runtime_assert_*` and `runtime_screenshot_diff`) for
  checking node state, scene structure, on-screen text, performance baselines, and
  screenshot diffs against a running game. On Godot
  4.5+ it also captures the game's console (`print()`, warnings, errors) with zero
  configuration.

- **Plane D — Semantic & Debugging** (`gd_*`, `dbg_*`, plus C# `cs_*` / `cs_dbg_*`): the
  host connects as a client to Godot's built-in **GDScript language server** (port 6005)
  and **debug adapter** (port 6006) — completion, hover, definition/references, rename,
  symbols, signature help, diagnostics, plus real debugging: breakpoints, stepping,
  stack/scopes/variables, watch expressions, and expression evaluation. A parallel C#
  plane speaks OmniSharp (LSP) and netcoredbg (DAP). Capabilities are **feature-detected
  per engine build** and degrade to a clear "unsupported" message rather than erroring.

Six **MCP resources** (`godot://scene-tree`, `godot://editor-state`,
`godot://runtime/tree`, `godot://runtime/log`, `godot://class/{name}`, and the always-on
`godot://capabilities`) expose pull-on-demand context, and clients can **subscribe** to be
pushed updates when the editor selection, edited scene, or the live SceneTree changes.

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

### Quick start (recommended)

From your Godot project folder, one command installs and enables the editor addon and
prints your MCP-client config:

```bash
npx breakpoint-mcp init
```

Then open the project in Godot and verify everything is wired up:

```bash
npx breakpoint-mcp doctor
```

`init` copies the addon into `addons/breakpoint_mcp/`, enables it in `project.godot`, and
prints the client config snippet — pass `--client claude-desktop|cursor|windsurf|vscode`
to write it into that client's config directly, or `--client claude-code` to get the
`claude mcp add` command. By default `init` installs the addon bundled in the package; add
`--from-github [ref]` to fetch it from GitHub instead (e.g. `--from-github main` for the
latest, or a tag like `--from-github v1.3.0`; `--repo <owner/repo>` targets a fork).
`doctor` checks the Godot binary, the addon, and the four bridges
(add `--require-live` once the editor is open to require them; `--json` for a machine-readable
report). The manual steps below do the same thing by hand.

### 1. Install the editor addon (manual)

These by-hand steps are for working from a checkout of this repository, or if you would
rather do it yourself. If you installed from npm, `npx breakpoint-mcp init` does all of
this for you — the addon ships bundled in the package, so you don't need the repository.

Copy `addons/breakpoint_mcp/` into your project's `addons/` folder, then enable it under
**Project → Project Settings → Plugins → Breakpoint MCP**. On enable it listens on
`127.0.0.1:9080` (override with `BREAKPOINT_BRIDGE_PORT` before launching Godot).

Enabling the plugin also auto-registers the **runtime autoload**
(`BreakpointRuntimeBridge`), so the `runtime_*` tools work as soon as the project runs
(it listens on `127.0.0.1:9081` inside the game). No manual autoload setup needed.

Once enabled, a **Breakpoint MCP** dock appears on the right-hand side of the editor. It
shows the live health of all four bridges (editor / runtime / GDScript LSP / DAP), the
configured ports and project path, and a one-click **Copy MCP-client config** button — the
in-editor twin of `doctor` + `init`. It is status/config only: the assistant still runs in
your MCP client, not in the editor.

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

Using a different MCP client (Cursor, VS Code, Windsurf, etc.)? See
[Compatibility](#compatibility) below — the command is the same, only the config file
and wrapper key differ.

## Configuration (environment variables)

| Var | Default | Meaning |
|---|---|---|
| `GODOT_BIN` | `godot` | Path to the Godot editor binary |
| `GODOT_PROJECT` | cwd | Project directory (contains `project.godot`) |
| `BREAKPOINT_BRIDGE_HOST` | `127.0.0.1` | Editor-bridge host |
| `BREAKPOINT_BRIDGE_PORT` | `9080` | Editor-bridge port (must match the addon) |
| `BREAKPOINT_BRIDGE_TIMEOUT_MS` | `15000` | Per-request timeout for editor tools |
| `GODOT_LSP_HOST` / `GODOT_LSP_PORT` | `127.0.0.1` / `6005` | GDScript language server |
| `GODOT_DAP_HOST` / `GODOT_DAP_PORT` | `127.0.0.1` / `6006` | Debug adapter |
| `GODOT_LSP_TIMEOUT_MS` / `GODOT_DAP_TIMEOUT_MS` | `15000` / `20000` | LSP / DAP timeouts |
| `BREAKPOINT_RUNTIME_HOST` / `BREAKPOINT_RUNTIME_PORT` | `127.0.0.1` / `9081` | In-game runtime bridge (must match the autoload) |
| `BREAKPOINT_RUNTIME_TIMEOUT_MS` | `15000` | Runtime request timeout |
| `BREAKPOINT_TOOLSETS` | *(unset → all)* | Comma/space list of tool groups or planes to enable — see [Toolsets](#toolsets-optional--load-only-the-planes-you-need) |
| `BREAKPOINT_PRIVILEGED_GROUPS` | *(unset → none)* | Comma/space list of the default-OFF capability groups to enable: `code-execution`, `network`, or `all`. Off → secure-default **262** tools; opting in loads the **full 276** — see [Safety & trust model](#safety--trust-model) |

> **Renamed from `CLAUDE_*`:** the `BREAKPOINT_*` variables above (plus `BREAKPOINT_RESOURCE_COALESCE_MS`) were named `CLAUDE_*` in earlier versions. The legacy `CLAUDE_*` names were honoured with a one-time deprecation warning in `1.0.0` and **removed in `1.1.0`** — use the `BREAKPOINT_*` names. `GODOT_*` variables are unchanged.

The full, annotated configuration reference is in the [User Guide](docs/USER_GUIDE.md).

### Toolsets (optional — load only the planes you need)

By default the server registers the full surface (276 tools). On Claude Code that costs
nothing at decision time: **Tool Search** defers the catalog and loads each schema on demand
(a measured **~86–98% upfront token reduction** — the model never sees all 276 at once). For
clients that can't defer tools, or when you just want a smaller default menu, set
`BREAKPOINT_TOOLSETS` to a comma- or space-separated list of groups; only those register. The
four **planes already are the grouping**, so the aliases mirror them:

| Token | Enables |
|---|---|
| `a` | Plane A — live editor authoring (`editor`) |
| `b` | Plane B — headless CLI (`cli`) |
| `c` | Plane C — running-game runtime + verification family (`runtime`) |
| `d` | Plane D — GDScript & C# LSP/DAP (`lsp,cslsp,dap,csdap`) |
| `csharp` | The C# language-server + debugger groups (`cslsp,csdap`) |
| `all` | The full surface (the default) |

…or any of the concrete group ids: `cli editor lsp cslsp dap csdap runtime processes
knowledge vcs assetgen netcode backend tabletop resources`.

Examples: `BREAKPOINT_TOOLSETS=c` → 14 runtime tools; `a,b` → 152 (editor + CLI);
`editor,runtime,vcs` → 172. Unknown tokens are ignored, and a filter that resolves to nothing
falls back to the full surface — a typo never yields an empty server. This is a **menu filter,
not a capability cut**: every tool that loads is the same typed, schema-validated, undoable
tool it always was.

## Recipes (free, curated task workflows)

Breakpoint ships a set of **recipes** — short, opinionated workflows that drive its own
enforced tools to accomplish a common Godot task and then *verify* it. They're exposed as
standard **MCP prompts** (discoverable via `prompts/list`), so a client can pull one on demand:

- **`recipe_2d_player_controller`** — a movable `CharacterBody2D` with input actions + camera, then a runtime check that it actually moved.
- **`recipe_wire_signal_and_assert`** — connect a signal and prove at runtime the handler fired.
- **`recipe_debug_inspect_variable`** — set a breakpoint, launch under the debugger, read real call-stack values.
- **`recipe_screenshot_regression`** — golden-image check for a scene via `runtime_screenshot_diff`.
- **`recipe_type_safe_edit`** — edit GDScript with the language server (symbols, references, diagnostics) before running.
- **`recipe_csharp_fix_and_debug`** — the same inspect → fix → debug loop for C# via OmniSharp + netcoredbg.

A recipe is the same idea as a paid "skill pack", with two differences that matter: it's
**free** (MIT, shipped in the server) and it sits **over typed, schema-validated, undoable
tools** — so the contract is executed by the server, not merely described in prose the model
might misapply. Recipes add **no tools** (the count stays 276) and cost nothing until pulled.

## Compatibility

Breakpoint MCP is a standard MCP server that talks over stdio, so in principle it works
with **any MCP-compatible client**. It is developed and tested with **Claude** (Claude
Code and Claude Desktop) — that's the supported path today. Other clients such as
Cursor, VS Code (Copilot agent mode), and Windsurf should work with the same command and
environment variables, but they are **not yet tested** with this server. If you try
Breakpoint MCP with another client — or a different model behind it — we'd genuinely love
to hear how it goes: please [open an issue](https://github.com/jlivingston-Cipher/godot-breakpoint-mcp/issues)
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
- **Both bridges require a per-project shared secret** (default-on since **1.17.0**). The
  addon mints a 64-char hex secret into the engine-managed, git-ignored `res://.godot/`, and
  the host authenticates as the first frame on connect — so another local process on a shared
  machine can neither drive the bridge nor bypass the confirmation gate. The secret is
  compared in **constant time** and a bad handshake is refused without echoing it. Opt out
  with `BREAKPOINT_BRIDGE_INSECURE=1`.
- **Destructive tools are elicitation-gated:** the host asks the client to confirm before
  executing (for example `node_delete`, `project_set_setting`, `scene_new`, `gd_rename`
  with apply, the file/resource/script writers, and the `runtime_*` mutators). Pass
  `confirm: true` to auto-approve; if the client can't prompt, the tool blocks rather
  than acting silently.
- **Least-privilege by default — capability groups (since 1.18.0).** The higher-blast tools are
  partitioned into two **default-OFF** groups: `code-execution` (runs GDScript, invokes arbitrary
  methods, evaluates in a paused frame, or spawns the local asset-gen `command` backend) and
  `network` (egress beyond loopback — the Group M backend-SDK scaffolding). With both off, those
  tools are **dropped at registration** and never appear in `tools/list`, so the secure-default
  surface is **262 tools**; opt in with `BREAKPOINT_PRIVILEGED_GROUPS=code-execution,network` (or
  `all`, or `breakpoint-mcp init --trust full`) to load the full **276**. The always-on
  **`godot://capabilities`** resource lists every group, its state, and the exact tools it gates,
  so a disabled tool is discoverable rather than a silent gap. Defense-in-depth and a legible
  least-privilege story over an already typed / undoable / gated surface — not the closing of an
  open hole.
- **Pause the agent on demand — two layered controls.** In the editor, the Breakpoint status
  dock has a **"Pause Agent"** toggle: while engaged, the editor and runtime bridges reject new
  commands on those two planes (an op already running finishes; a bare liveness `ping` still
  answers), so one click freezes what the assistant can do to your project and the running game.
  Headless or scripted, the host also honors **`SIGUSR1` (pause) / `SIGUSR2` (resume)** — a finer
  latch that holds only *mutating* actions but across the **whole** tool surface, with
  `BREAKPOINT_START_PAUSED=1` to start held. Neither is an "emergency stop": both hold *entry* to
  a new action and never interrupt one already in flight, and the per-tool confirmation above
  stays the primary control for destructive ops.
- **Higher-trust surfaces, stated plainly:** `godot_run_headless_script` and
  `godot_run_managed` execute GDScript, and the optional asset-gen **command**
  backend runs a local command you configure (via `BREAKPOINT_ASSETGEN_CMD` or the tool
  argument). These sit in the default-OFF `code-execution` group above and stay
  elicitation-gated even once enabled — point them only at code you trust.

Security policy and how to report a vulnerability: see [SECURITY.md](SECURITY.md).

### What the automation actually verifies (W/R/E)

Breakpoint is explicit about *what kind of evidence* a result carries, using a three-tier
honesty vocabulary:

| Tier | Question | Evidence Breakpoint produces | Who asserts |
|---|---|---|---|
| **W — Wired** | Did the action actually happen? | Schema-frozen results, reversible via `EditorUndoRedoManager` | Automation |
| **R — Runtime** | Does the running program behave? | Live assertions (`runtime_assert_*`), `runtime_screenshot_diff`, and a real DAP paused stack + variable values (GDScript **and** C#) | Automation |
| **E — Experience** | Is it any good — fun, legible, the right feel? | Human perception; automation hands over evidence and leaves the verdict open | **Human only** |

Most of the field proves R with a screenshot or a console line; Breakpoint proves it with an
assertion, a diff, and a paused stack frame — and never lets automation claim **E**.

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
