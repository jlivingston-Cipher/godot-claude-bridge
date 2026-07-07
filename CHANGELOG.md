# Changelog

All notable changes to the Godot–Claude Bridge are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed — runtime bridge failed to load on Godot 4.3/4.4 (D6 regression)
- `runtime_bridge.gd` called the 4.5+ `OS.add_logger()` / `OS.remove_logger()` **directly**. GDScript
  resolves those at parse time, so on Godot 4.3/4.4 (where the methods don't exist) the whole script
  failed to compile and the runtime autoload never loaded — taking **all of Plane C** down, not just
  D6 capture, despite the `ClassDB.class_has_method` runtime guard (which never got the chance to run).
  They are now invoked dynamically via `OS.call("add_logger"/"remove_logger", …)`, so the script
  compiles on 4.3/4.4 and capture stays a clean no-op there while working on 4.5+. Surfaced by the new
  runtime-plane CI probe below.
- The example's `project.godot` referenced the runtime autoload by UID (`uid://…`), which Godot 4.3
  cannot resolve, so the autoload failed to instantiate even once the parse error was fixed. It now
  uses the `res://addons/claude_bridge/runtime_bridge.gd` path — exactly what `plugin.gd`'s
  `add_autoload_singleton` writes for real installs (so this only ever affected the bundled example,
  never users who enable the plugin), and which resolves on every Godot 4.x.
- `ADDON_VERSION` (and both `plugin.cfg`) **0.6.0 → 0.6.1**. No host/tool changes (still **70 tools**,
  **124 host tests**).

### Added — runtime-plane CI probe (live D6 zero-config console capture)
- New `runtime-plane` job in `.github/workflows/integration.yml` boots the example **game**
  headless (no editor / no GUI) and drives Plane C against the in-game `ClaudeRuntimeBridge`
  autoload (`:9081`), asserting the D6 contract against a LIVE engine: a real `print()` is captured
  into `runtime_get_log` via the scriptable `Logger`. This gives D6 a live regression guard rather
  than proving it only by a local one-off probe.
- Runs as a matrix across **4.3** (below the capture floor — the probe asserts the documented no-op:
  the bridge loads, `capture` is false, the `print()` is absent, and `push_log` entries are still
  served), **4.5** (the floor where `OS.add_logger` was introduced) and the newest stable **4.7** (on
  4.5/4.7 the live `print()` must be captured). The probe
  (`host/test-integration/runtime-capture.integration.mjs`) drives the host's own runtime tools
  (`runtime_get_log` / `runtime_call_method`) against the live game — the CLI-plane pattern, extended
  to Plane C — reads the `capture` flag, and is version-aware, asserting the correct behavior on each
  side of the 4.5 boundary. (The 4.3 arm depends on the runtime-bridge fix above.)
- Headless and deterministic (no Xvfb / GPU, unlike the editor/dap planes); a **required gate** like
  cli-plane — all three arms (4.3/4.5/4.7) must pass, and the three contexts are added to `main`'s
  branch-protection required checks. **No host/addon code, tool, resource, or version changes** —
  CI + test-only (tool count still **70**, host suite still **124**).

### Added — D4 C#/.NET plane scaffold (C1, experimental)
- First chunk of the **D4 C#/.NET language plane** (`DEFERRED_TRACKS_PLAN.md` Group C). New
  `example-csharp/` fixture — a minimal C# Godot project mirroring `example/` (`Player.cs` with
  `Counter` / `_Ready` / `_Process` / `TakeDamage`; `Godot.NET.Sdk/4.7.0`, `net8.0`). No
  `claude_bridge` addon by design (the C# plane uses OmniSharp / the Mono debugger, and it avoids a
  third `ADDON_VERSION` copy under `contract_check.py`).
- New experimental **`csharp-plane`** job in `integration.yml` (`continue-on-error`, never blocks a
  merge, like editor/dap-plane): downloads a Mono/.NET Godot build + the .NET 8 SDK, `dotnet build`s
  the fixture, imports + `--build-solutions`, and boots it headless asserting the C# `_Ready()` ran
  (`C#_PLANE_BOOT_OK`; markers `C#_PLANE_*`). Validated live on macOS **and** green on a real Linux
  CI runner (PR #24).
- Companion plan `docs/D4_CSHARP_PLAN.md` — chunked **C1 → C2** (OmniSharp `cs_*` LSP tools) **→ C3**
  (netcoredbg DAP), with version-alignment rules and a `gd_*`→`cs_*` mirror table. **Additive only —
  no host/tool/resource/version change** (still **70 tools**, **124 host tests**; contract check green).

### Added — D4 C2: C# semantic plane (`cs_*` via OmniSharp)
- Eight read-only **`cs_*`** tools mirroring the read-only `gd_*` LSP surface, driven by **OmniSharp**:
  `cs_completion`, `cs_hover`, `cs_definition`, `cs_references`, `cs_document_symbols`,
  `cs_workspace_symbols`, `cs_signature_help`, `cs_diagnostics`. Mutators (`cs_rename` /
  `cs_code_action`) are deferred to a later cut, exactly as the GDScript mutators were. Each tool is
  capability-gated with a `-32601` belt-and-suspenders, degrading to a clear "unsupported" message
  rather than a hang — the same discipline as the GDScript plane. (Unlike Godot's GDScript server,
  OmniSharp actually implements `workspace/symbol`, so `cs_workspace_symbols` returns real results.)
- **New stdio transport.** OmniSharp is a spawned stdio language server (not a TCP one like Godot's),
  so `host/src/stdio.ts` adds a `StdioChannel` that speaks LSP `Content-Length` framing over a child
  process. The framing primitives (`encodeFrame` / `FrameDecoder`) and the `JsonRpcChannel` interface
  are factored out of `framing.ts` and shared by both the TCP (`FramedConnection`) and stdio
  transports; the LSP tool reshaping helpers are factored into `tools/lsp-common.ts` and shared by the
  `gd_*` and `cs_*` planes. The C# client (`host/src/cslsp.ts`) is a transport-agnostic sibling of the
  GDScript `LspClient` (injected channel), so its protocol logic is unit-tested over the same loopback
  TCP mock harness while running over stdio in production. OmniSharp is spawned **lazily** on the first
  `cs_*` call, so a host without it installed starts and runs every other plane unaffected. New config
  (all env-overridable): `GODOT_CSLSP_CMD` (default `OmniSharp`), `GODOT_CSLSP_ARGS` (default `-lsp`),
  `GODOT_CSHARP_PROJECT` (the C# project root), `GODOT_CSLSP_TIMEOUT_MS` (default 30000).
- **Tool count 70 → 78**; `contract_check.py` + `registration.test.ts` updated in lockstep, and each
  new tool has a frozen `outputSchema` (`schemas.ts`) and a `docs/TOOL_CATALOG.md` entry. Host tests
  **124 → 139** (new `cslsp.test.ts`: the eight tools + client protocol behaviors over a TCP mock,
  **plus** an end-to-end pass through a real spawned `StdioChannel`, which also asserts a spawn failure
  surfaces a clear error instead of hanging).
- **CI.** The experimental `csharp-plane` job (still `continue-on-error`) gains a live `cs_*` probe:
  it installs OmniSharp, builds the host, and runs `csharp-lsp.integration.mjs` against a real
  OmniSharp over the `example-csharp` fixture, logging grep-able **`C#_LSP_*`** markers
  (`C#_LSP_REACHED`, `C#_LSP_CAPS`, per-tool `PROBE …`). No new required check — the plane stays
  non-blocking until proven green across a few runs, the way `runtime-plane` was promoted.

## [0.6.0] — 2026-07-06

### Added — D6: zero-config console capture in the runtime bridge (Godot 4.5+)
- The in-game runtime autoload (`runtime_bridge.gd`) now registers a scriptable `Logger`
  (`OS.add_logger`, Godot 4.5+) that funnels every `print()`, `push_warning`, `push_error`, and
  engine message into the same ring buffer `runtime_get_log` reads — so the host gets the game's full
  console with **no managed parent process** (`godot_run_managed` is no longer required just to see
  `print()` output; launch the game any way, incl. the editor's Play button, and read
  `godot://runtime/log`). The `Logger` subclass is **compiled at runtime**, so its `extends Logger`
  source is only ever parsed where the class exists — the addon stays parse-clean on Godot 4.3/4.4,
  where capture is simply absent (only explicit `push_log` entries appear, unchanged behavior).
- Captured log lines mark the log resource dirty; `godot://runtime/log` is pushed to subscribers
  (coalesced to one per frame), tying D6 into the D3 subscription path. `runtime.get_log` now returns
  a `capture` flag (host output schema updated, optional) so a client can feature-detect whether the
  zero-config hook is active and fall back to `godot_run_managed` when it isn't.
- Per the "GDScript now, native later" decision, the native GDExtension logger the plan originally
  scoped (godot-cpp / scons) is **deferred** — the 4.5 `Logger` API is scriptable and delivers the
  same capability with no native toolchain. See `BACKLOG.md` and the session-19 handoff.
- `ADDON_VERSION` (and both `plugin.cfg`) go **0.5.1 → 0.5.2**. Tool count unchanged (**still 70
  tools**); the host suite goes **123 → 124 tests** (the `godot://runtime/log` subscription push).

### Added — D3 follow-ups: runtime-side resource change events + host-side coalescing
- **Runtime SceneTree subscriptions.** The in-game runtime autoload (`runtime_bridge.gd`) now emits a
  `resource.changed` for `godot://runtime/tree` when the running game's live SceneTree gains, loses, or
  renames a node, so a subscriber is pushed `notifications/resources/updated` and re-reads the live
  tree. Emission is collapsed to at most one push per frame via a dirty flag, so a burst of node
  adds/removes in a single frame is a single event. The host side was already wired (the runtime
  `BridgeClient`'s `onResourceChanged` + `ensureConnected`); this adds the missing addon emitter,
  mirroring the editor `broadcast_event`. `ADDON_VERSION` (and both `plugin.cfg`) go **0.5.0 → 0.5.1**
  (host `package.json` unchanged until the next release cut).
- **Host-side coalescing.** `registerResourceSubscriptions` now throttles rapid `resources/updated`
  pushes per URI with a leading-edge + trailing-flush window: the first change pushes immediately, then
  further changes inside the window (default 50 ms, override via `CLAUDE_RESOURCE_COALESCE_MS`; `0`
  disables) collapse into at most one trailing push. This applies to every subscribed URI — editor and
  runtime — so a noisy source (e.g. continuous SceneTree churn) can't fan out as a flood. Multiple
  `updated` are spec-harmless (the client just re-reads), so this only trims volume.
- Tool count unchanged (**still 70 tools**); the host suite goes **121 → 123 tests** — a burst of rapid
  changes collapses to leading + one trailing push, and `coalesceMs = 0` restores one-push-per-change.

## [0.5.0] — 2026-07-06

### Added — resource subscriptions with live `notifications/resources/updated` (D3)
- Clients can now `resources/subscribe` / `resources/unsubscribe` to any `godot://…` resource and
  receive a `notifications/resources/updated` push when it changes. The change signal originates in
  the editor addon — `EditorSelection.selection_changed` and the `EditorPlugin` `scene_changed`
  signal broadcast a compact `{"event":"resource.changed","uri":…}` line over the existing bridge
  socket (no `id`, so it never collides with a request/response) — and the host fans it out with
  `server.server.sendResourceUpdated`, but only for URIs a client actually subscribed to.
  Non-subscribers keep the unchanged pull-only behavior. Selection / edited-scene changes map to
  `godot://editor-state` (plus `godot://scene-tree` when the edited scene changes).
- **Host** (`host/src/`): the server now also advertises the `resources.subscribe` capability; a new
  `host/src/subscriptions.ts` holds a `ResourceSubscriptions` registry, installs the
  subscribe/unsubscribe request handlers on the low-level server, keeps the relevant bridge
  connected so pushes flow, and routes `resource.changed` events to `notifications/resources/updated`.
  `BridgeClient` gained an `onResourceChanged` event path plus `ensureConnected()` with transparent
  re-dial so the push channel survives an editor restart.
- **Addon** (`bridge_server.gd` / `plugin.gd`, both copies): `broadcast_event(uri)` pushes the change
  line to every connected client; `plugin.gd` connects the selection / scene-changed signals on
  enable and disconnects them on disable. `ADDON_VERSION` (and both `plugin.cfg`) go
  **0.4.16 → 0.4.17** (host `package.json` unchanged; the version cut lands with the Group-A
  release). Tool count unchanged (**still 70 tools**); the host suite goes **115 → 121 tests** —
  subscribe→push→exactly-one-`updated`, un-subscribed URI ignored, unsubscribe silences, the
  runtime-bridge path, and a registry unit check.
- **CI**: the experimental `editor-plane` job gained a live probe
  (`test-integration/editor-subscriptions.integration.mjs`, `D3_SUB_*` markers) that subscribes,
  drives a real selection change over the addon bridge, and asserts a `resources/updated` push; it
  runs under `continue-on-error`, so live-engine timing never blocks a merge.

### Added — long jobs now use the formal MCP task-execution model (D2)
- `godot_export`, `godot_import`, and `godot_run_headless_script` — the three run-to-completion
  headless jobs — now register under the spec's **task model** (`server.experimental.tasks`,
  `@modelcontextprotocol/sdk@1.29.0`) instead of emitting ad-hoc `notifications/progress`. A
  task-aware client gets a handle immediately and drives the job with `tasks/get` (poll),
  `tasks/result` (await), and `tasks/cancel` (stop — which actually **kills the headless Godot
  process** via an `AbortController` wired into the store). Plain clients are unchanged: with
  `taskSupport: 'optional'` the SDK auto-creates a task, polls it to completion, and returns the
  result synchronously. The server now advertises the `tasks` capability and is constructed with a
  `GodotTaskStore` (extends the SDK `InMemoryTaskStore`, adding the cancel→abort hook); a new
  `host/src/tasks.ts` holds the store plus a `registerTaskTool` helper that re-applies the B1
  frozen output-schema check the SDK skips for task results. The ad-hoc `startProgress` helper is
  removed. No addon/schema change and the tool count is unchanged (**still 70 tools**); the host
  suite goes **109 → 115 tests** — a full create→poll→await→cancel lifecycle over an in-memory
  transport, the synchronous non-task path, a failed-worker path, plus cancel-abort and
  schema-injection unit checks.

### Added — CI: the editor/LSP-plane probe now runs against the newest stable (4.7) too — D7 resolved
- The experimental `editor-plane` job gained the same Godot-version matrix (`4.3-stable` +
  `4.7-stable`), so the D7 LSP probe (`D7_CAPS` / `D7_WS_RAW` / `D7_CAPS2`) characterizes both.
  Findings: **`workspace/symbol` still replies `-32601` through 4.7** — 4.3 advertised
  `workspaceSymbolProvider: true` yet failed every query; 4.7 honestly advertises it `false` and
  likewise replies `-32601`, so `gd_workspace_symbols` stays gated (D7 resolved: the
  "unsupported through 4.x" framing holds through 4.7). Bonus: **`gd_document_highlight` lights
  up on 4.7** — `documentHighlightProvider` flips `false → true` and the tool returns results
  live (3 highlights); it un-gates automatically via feature-detection, no code change.
  `type-definition`, `implementation`, `folding-ranges`, `formatting`, `document-color`, and
  `code-action` remain advertised-`false` / unsupported through 4.7; `signature-help`,
  `declaration`, and `document-link` work on both. CI-only; no tool/schema/host change (still
  **70 tools / 109 tests**).

### Added — CI: the DAP-plane probe now runs against the newest stable (4.7) too
- The experimental `dap-plane` integration job gained a Godot-version matrix (`4.3-stable` +
  `4.7-stable`), so the live D_DAP_* capability probe characterizes both the baseline and the
  newest stable in one run (4.7 is also the version the maintainer runs locally). Findings:
  **`dbg_evaluate` gains full expression evaluation on 4.7** (`counter + 1` → `101`; on 4.3 it
  does bare-name lookup only and returns empty for a compound expression), while
  **`dbg_set_variable` stays advertised-but-unanswered even on 4.7** (`supportsSetVariable=true`
  yet no reply) — the ~8 s fail-fast bound from `[0.4.16]` fires cleanly on 4.7, confirming it as
  permanent behavior rather than a 4.3-only workaround. The conditional / hit-count / logpoint
  breakpoint modifiers remain advertised-unsupported and ignored through 4.7. CI-only; no tool /
  schema / host change (still **70 tools / 109 tests**).

## [0.4.16] — 2026-07-06

### Changed — `dbg_watch` bounds its watch evaluate so a stalling watch fails fast
- `dbg_watch` re-evaluates its whole watch set at every stop via `DapClient.evaluateWatches`,
  which previously sent each `evaluate` with the full 20 s `dapTimeoutMs`. A single watch
  expression the adapter never answers (the advertised-but-unimplemented gap the `[0.4.15]` fix
  addressed for `dbg_evaluate` / `dbg_set_variable`) would therefore hang the full 20 s at
  **every stop**. The watch `evaluate` is now bounded by `dapEvaluateTimeoutMs` (default 8 s,
  `GODOT_DAP_EVALUATE_TIMEOUT_MS`), so a non-answering watch **fails fast on that entry** — its
  `error` carries the timeout — while the other watches still resolve. No tool/schema/addon
  change (still **70 tools**); host suite **108 → 109 tests**.

## [0.4.15] — 2026-07-06

### Changed — `dbg_set_variable` / `dbg_evaluate` fail fast on a non-answering adapter
- `dbg_set_variable` and `dbg_evaluate` now send their `setVariable` / `evaluate` request with a
  **short bounded deadline** (default 8 s, `GODOT_DAP_SETVAR_TIMEOUT_MS` /
  `GODOT_DAP_EVALUATE_TIMEOUT_MS`) instead of the full 20 s `dapTimeoutMs`. On timeout the tool
  returns a **clear message** — for `dbg_set_variable`, that the build advertises
  `supportsSetVariable` but does not implement it and **no change was made** — rather than a
  generic DAP timeout. This directly addresses the Godot 4.3 finding below: 4.3 advertises
  `supportsSetVariable=true` (so the capability short-circuit can't catch it) yet never answers
  the request. No tool/schema/addon change (still **70 tools**); host suite **106 → 108 tests**.

### Confirmed live — the mutating/gated DAP tools on Godot 4.3 (dap-plane probe)
- Extended `host/test-integration/editor-dap.integration.mjs` to drive the three
  gated/mutating DAP tools end-to-end against a live, **stopped** Godot 4.3 game
  (`confirm:true` bypasses the probe's auto-decline elicit stub). Test-infra only — no
  tool/schema/addon change (still **70 tools / 106 tests**). Ground truth from the CI log:
  - **`dbg_restart` works** via the native DAP restart path (`method="restart"`): it re-runs
    the scene and re-hits a buffered breakpoint (`D_DAP_RESTART` / `D_DAP_RESTART_REHIT`).
  - **`dbg_evaluate` resolves bare variable names** (`counter` → `100`, with or without a
    frame) **but returns empty for a compound expression** (`counter + 1`) — 4.3's
    repl-context evaluate does name lookup, not expression evaluation
    (`D_DAP_EVAL[name|name+frame|expr]`).
  - **`dbg_set_variable` is advertised but unimplemented on 4.3**: it advertises
    `supportsSetVariable=true` yet never answers the `setVariable` request (20 s timeout) and
    the value is unchanged (`D_DAP_SETVAR` / `D_DAP_SETVAR_READBACK counter=100`) — another
    advertised-but-unimplemented gap, like the 4.3 breakpoint modifiers. Corrects the earlier
    note that 4.3 offered a working live set-variable.

## [0.4.14] — 2026-07-06

### Changed — `dbg_set_breakpoints` feature-detects per-line modifiers
- `dbg_set_breakpoints` now **feature-detects** the `condition` / `hitCondition` /
  `logMessage` per-line modifiers: they are sent only when the connected adapter advertises
  `supportsConditionalBreakpoints` / `supportsHitConditionalBreakpoints` / `supportsLogPoints`.
  On an adapter that advertises them unsupported the modifier is **dropped** and the result
  carries `unsupported_modifiers` + a `warning`, so a "conditional" breakpoint can no longer
  silently halt unconditionally. Mirrors the `dbg_set_exception_breakpoints` / `dbg_goto` /
  `dbg_data_breakpoints` advertised-vs-implemented discipline. No surface change (still
  **70 tools**); host suite **105 → 106 tests**.

### Confirmed live — Godot 4.3 ignores breakpoint modifiers (new dap-plane probe)
- Added `host/test-integration/editor-dap-breakpoints.integration.mjs`, a second `dap-plane`
  probe that empirically settled the open question from the capability dump: Godot 4.3's
  adapter advertises the three modifier caps **false** AND **ignores** the fields —
  `D_DAP_MODIFIERS: condition=IGNORED hitCondition=IGNORED logMessage=IGNORED` (a breakpoint
  carrying any of them halts every time). This motivated the feature-detect above.

### Added — the dap-plane now lands a REAL debugger stop
- Reworked `host/test-integration/editor-dap.integration.mjs` and forced the example project
  onto the OpenGL (`gl_compatibility`) renderer so the game the debug adapter launches runs on
  GPU-less CI runners (the default Forward+/Vulkan renderer segfaulted on init). The `dap-plane`
  now lands a genuine breakpoint stop and exercises the full live surface — `dbg_stack_trace` /
  `dbg_scopes` / `dbg_variables` (`counter=100`) / `dbg_watch` / `dbg_step` / `dbg_continue` —
  the first time the DAP inspection tools have run against a live, stopped Godot game.
  `continue-on-error` / not a required check; no tool/schema change.

## [0.4.13] — 2026-07-06

### Added — DAP-plane CI smoke (infra, no tool change)
- New **experimental `dap-plane` integration job** (`.github/workflows/integration.yml`)
  and probe (`host/test-integration/editor-dap.integration.mjs`) that boots the real
  Godot editor under Xvfb and connects to its built-in **Debug Adapter (DAP, :6006)** —
  the first time any of the 15 `dbg_*` tools run against a live adapter. It runs the
  `initialize` handshake (the gate), then dumps the adapter's advertised capabilities
  (grep-able `D_DAP_CAPS` / `D_DAP_FILTERS` markers) so we finally learn which of
  `supportsRestartRequest` / `supportsGotoTargetsRequest` / `supportsDataBreakpoints` /
  `supportsSetVariable` / `exceptionBreakpointFilters` Godot 4.3 actually advertises —
  i.e. which of `dbg_restart` / `dbg_goto` / `dbg_data_breakpoints` / `dbg_set_variable`
  light up live vs. degrade to "unsupported". A best-effort scenario launches the
  example scene to a breakpoint in `_ready()` and reads stack / scopes / variables.
- Mirrors the LSP `editor-plane`: `continue-on-error` (never blocks a merge) and **not**
  a required check while live-adapter timing is new. No tool/schema change —
  surface stays **70 tools**; `contract_check.py` parity unchanged (70 ↔ 70).

### Confirmed live — first DAP ground truth (Godot 4.3-stable, from the new plane)
- The job's first run dumped the adapter's advertised capabilities:
  **`supportsRestartRequest=true`** (so `dbg_restart` uses the native DAP `restart`
  path rather than the terminate+relaunch fallback) and **`supportsSetVariable=true`**
  (`dbg_set_variable` is usable live), while **`supportsGotoTargetsRequest=false`** and
  **`supportsDataBreakpoints=false`** — so `dbg_goto` and `dbg_data_breakpoints`
  correctly degrade to "unsupported" on 4.3, exactly the advertised-vs-implemented
  discipline they were built with.
- Exception breakpoints are effectively unavailable on 4.3: the adapter advertises
  **`exceptionBreakpointFilters=[]`** and does **not respond to `setExceptionBreakpoints`**
  (the request times out). `dbg_set_exception_breakpoints` therefore has no filters to
  offer and currently blocks until timeout on this build — a candidate for a
  short-circuit feature-detect (advertise-none → return "unsupported" without sending).
- The best-effort launch→breakpoint scenario did **not** settle under CI software
  rendering (`D_DAP_STOP: breakpoint_hit=false`), so live stack/scopes/variables remain
  unproven; the capability dump is the confirmed result. Getting the launched game to
  reliably reach a breakpoint under Xvfb is the next increment.

### Fixed — `dbg_set_exception_breakpoints` short-circuit (motivated by the live probe)
- `dbg_set_exception_breakpoints` now **feature-detects**: when the connected adapter
  advertises no `exceptionBreakpointFilters`, it returns a clear "unsupported" message
  **without** sending `setExceptionBreakpoints`. On Godot 4.3 that request is never
  answered (it timed out after 20 s in the DAP-plane probe), so the tool previously
  hung until timeout — it now returns instantly. Matches the advertised-vs-implemented
  discipline already used by `dbg_goto` / `dbg_data_breakpoints` / `dbg_set_variable`.
  No output-schema change; **+1 loopback test (104 → 105)**; `contract_check` still 70 ↔ 70.

## [0.4.12] — 2026-07-06

### Added — DAP debugger-depth track (three tools)
- **`dbg_restart`** — restart the current debug session. Uses the DAP `restart`
  request when the adapter advertises `supportsRestartRequest`, otherwise falls
  back to `terminate` + a fresh launch/attach handshake, so it works on **every**
  adapter regardless of the advertised capability. Reuses the last
  `dbg_launch`/`dbg_attach` parameters; `scene` / `stop_on_entry` override them for
  a launched session. The result's `method` reports which path ran
  (`restart` vs `relaunch`).
- **`dbg_goto`** — 'set next statement': move the program counter within the
  current stopped frame (DAP `gotoTargets` + `goto`). Called with `path` + `line`
  it lists the valid goto targets; with a single target (or an explicit
  `target_id`) it jumps. **Destructive** (skips/repeats code) → elicitation-gated.
  Feature-detected on `supportsGotoTargetsRequest`: an adapter that does not
  advertise it gets a clear "unsupported" message **without prompting**.
- **`dbg_data_breakpoints`** — set (replace) data breakpoints / watchpoints that
  halt when a variable's value changes (DAP `dataBreakpointInfo` +
  `setDataBreakpoints`). Resolves each requested variable to a `dataId`, arms all
  resolvable ones in one call, and reports the armed `breakpoints` plus any
  `unresolved` variables. Not gated (it only configures the debugger).
  Feature-detected on `supportsDataBreakpoints`.
- Surface **67 → 70 tools** (DAP 12 → 15). Frozen output schemas (B1), the
  registration meta-test (→ 70), `docs/TOOL_CATALOG.md` (entries + index + summary)
  and `README.md` updated in lockstep. **+10 loopback mock-server tests → 104
  total.** `contract_check.py` green (70 ↔ 70).
- Same **advertised ≠ implemented** discipline as the LSP-depth tools: `dbg_goto`
  and `dbg_data_breakpoints` degrade to "unsupported" where Godot's adapter does
  not advertise the capability (not live-probed this session — DAP-plane CI smoke
  is still pending), while `dbg_restart` is useful on every adapter via its
  terminate+relaunch fallback.

## [0.4.11] — 2026-07-06

### Added
- **`gd_document_color`** — a read-only LSP tool wrapping `textDocument/documentColor`:
  the color literals the GDScript language server recognizes in a script (the
  `Color(...)` values an editor draws an inline swatch for), each with its source
  range, RGBA components (floats 0..1) and a convenience `#RRGGBBAA` hex (Godot's
  `Color.to_html()` ordering). Same feature-detect + `-32601` belt-and-suspenders
  as the other Phase-1 LSP-depth tools, so an advertised-but-unimplemented build
  degrades to a clear "unsupported" message rather than a raw JSON-RPC error.
- Surface **66 → 67 tools** (LSP 17 → 18). Frozen output schema (B1), the
  registration meta-test (→ 67), `docs/TOOL_CATALOG.md` (entry + index + summary)
  and `README.md` updated in lockstep. **+3 loopback mock-server tests → 94 total.**
  `contract_check.py` green (67 ↔ 67, 57 catalog JSON blocks).

### Validated (live editor CI — the D7 probe, extended to gd_document_color)
- Against real **Godot 4.3-stable**: `colorProvider` appears among the `initialize`
  capability keys but with the value **`false`** (`D7_CAPS2 → color=false`), so
  `gd_document_color` correctly returns "unsupported" — joining
  `gd_document_highlight` / `gd_type_definition` / `gd_implementation` /
  `gd_folding_ranges` / `gd_formatting` in the advertised-but-not-honoured group
  (`gd_declaration` + `gd_document_link` remain the only read-only providers that
  return live on 4.3). Validates the feature-detect + `-32601` design once more.

### Note
- No functional addon (GDScript) change since v0.4.8 — only the `ADDON_VERSION`
  stamp bumps; any of v0.4.8–v0.4.11 is a coherent *addon* release. The npm publish
  (needs 2FA) and the Asset Library submission remain maintainer actions.

## [0.4.10] — 2026-07-06

### Added
- **Phase 1 LSP-depth — seven read-only navigation/inspection tools.** Each wraps
  a provider Godot's GDScript language server lists in its `initialize`
  capabilities, feature-detecting the capability and keeping a `-32601`
  belt-and-suspenders so an advertised-but-unimplemented provider degrades to a
  clear "unsupported" message instead of a raw JSON-RPC error:
  - `gd_document_highlight` — occurrences of the symbol at a position within one
    file, tagged read / write / text (`textDocument/documentHighlight`).
  - `gd_type_definition` — the type of the symbol at a position
    (`textDocument/typeDefinition`).
  - `gd_implementation` — implementation location(s) (`textDocument/implementation`).
  - `gd_declaration` — declaration location(s) (`textDocument/declaration`).
  - `gd_folding_ranges` — foldable regions of a script (`textDocument/foldingRange`).
  - `gd_document_link` — links embedded in a script with targets
    (`textDocument/documentLink`).
  - `gd_formatting` — a **read-only** whole-file format *preview*: returns the
    formatted text, never writes to disk (`textDocument/formatting`).
- Surface **59 → 66 tools** (LSP 10 → 17). Frozen output schemas (B1), the
  registration meta-test (→ 66), `docs/TOOL_CATALOG.md` (entries + index + summary)
  and `README.md` updated in lockstep. **+11 loopback mock-server tests → 91 total.**
  `contract_check.py` green (66 ↔ 66, 56 catalog JSON blocks).

### Validated (live editor CI — the D7 probe, extended to the new tools)
- Against real **Godot 4.3-stable**: `gd_declaration` returns a location and
  `gd_document_link` is implemented (empty list for a link-free file). The other
  five — `gd_document_highlight`, `gd_type_definition`, `gd_implementation`,
  `gd_folding_ranges`, `gd_formatting` — are advertised **`false`** on 4.3 and
  correctly return "unsupported", validating the feature-detect + `-32601` design
  end-to-end. The probe logs `D7_CAPS2` / `PROBE …` markers so a future Godot's
  real behavior is captured in CI.

### Note
- The **addon (GDScript) is unchanged** since v0.4.8; this is a host-only release.
  npm publish of the host still needs the maintainer's 2FA.

## [0.4.9] — 2026-07-05

### Added
- **Phase 1 LSP-depth — two new semantic tools.**
  - `gd_signature_help` — call-signature / active-parameter hints at a position
    (`textDocument/signatureHelp`), resolving `[start,end]` parameter labels
    against the signature label. **Confirmed returning signatures live in CI**
    against a real Godot 4.3-stable editor.
  - `gd_code_action` — the lightbulb menu (`textDocument/codeAction`): quick
    fixes / refactors for a range, listed read-only with a `has_edit` flag and
    any attached `command` (both CodeAction and bare Command shapes normalized).
- **Phase 1 debugger-depth — two new DAP tools.**
  - `dbg_set_exception_breakpoints` — enable/replace the adapter's exception
    breakpoint filters (`setExceptionBreakpoints`) and report the
    `available_filters` it advertises. Config-only, not gated.
  - `dbg_set_variable` — change a variable's value in a stopped frame
    (`setVariable`). **Elicitation-gated** (destructive) and feature-detected:
    returns a clear "unsupported" message without prompting when the adapter
    advertises `supportsSetVariable: false`.
- **Live D7 probe in the editor-plane integration job.** Reports, against a real
  editor, whether `workspace/symbol` returns results and smokes the new LSP
  tools (grep-able `D7_CAPS` / `D7_WS_RAW` / `PROBE` markers; log-only, never
  gates a merge).

### Changed
- **`gd_code_action` degrades gracefully (D7 finding).** The CI probe showed
  Godot 4.3-stable advertises `codeActionProvider: false` and replies `-32601`,
  so the tool now feature-detects (mirroring `gd_workspace_symbols`) and returns
  a clear "unsupported" message instead of leaking a raw JSON-RPC error.
- **`gd_workspace_symbols` framing re-confirmed (D7).** The same probe showed 4.3
  advertises `workspaceSymbolProvider: true` yet still replies `-32601` to every
  query — validating the existing "unsupported" handling and its
  belt-and-suspenders `-32601` catch. Documented in `README.md` /
  `docs/TOOL_CATALOG.md`.
- Surface **55 → 59 tools** (8 → 10 LSP, 10 → 12 DAP). The registration meta-test,
  frozen output schemas, `docs/TOOL_CATALOG.md` (entries + index + gating list),
  and `README.md` were updated in lockstep; `contract_check.py` stays green
  (59 ↔ 59, 52 catalog JSON blocks). +8 loopback mock-server tests (**80 total**).
- Version realigned to **0.4.9** across `host/package.json` (+ lockfile), both
  `plugin.cfg`s, and both `ADDON_VERSION`s (canonical + `example/` vendored copy).

## [0.4.8] — 2026-07-05

### Added
- **Plugin icon shipped inside the addon (`addons/claude_bridge/icon.png`).** A
  128×128 icon (a Godot-blue node bridged to a Claude-terracotta node) added for
  the Godot Asset Library listing. It was committed to `main` after the `v0.4.7`
  tag, so it was absent from the `v0.4.7` tag tree; this release tags it in-tree
  so an Asset Library install now drops the icon into a user's
  `res://addons/claude_bridge/` alongside the addon. Non-functional asset — no
  code or tool behavior changes.

### Changed
- Version realigned to **0.4.8** across `host/package.json` (+ lockfile), both
  `plugin.cfg`s, and both `ADDON_VERSION`s (canonical + `example/` vendored copy).
  This is the tag the Asset Library submission should reference.

## [0.4.7] — 2026-07-05

### Changed
- **Asset Library layout (D5, option A).** Moved the canonical addon from the
  nested `addon/addons/claude_bridge/` to **`addons/claude_bridge/`** at the repo
  root (`git mv addon/addons addons`; the empty `addon/` was removed). This is the
  layout the Godot Asset Library installer expects, so an AssetLib "install" now
  drops `addons/claude_bridge/` into a user's `res://addons/` with no manual step.
  Every path reference was updated to match: `scripts/contract_check.py`,
  `scripts/validate.sh`, `README.md` (layout + setup), and `docs/DISTRIBUTION.md`
  (which now records option A as resolved). `contract_check.py` stays green
  (54 tools, 47/47 catalog JSON) and the real SDK build + `npm pack --dry-run`
  (37-file tarball) are unaffected. The `example/addons/claude_bridge/` vendored
  copy is unchanged in place.
- Version realigned to **0.4.7** across `host/package.json` (+ lockfile), both
  `plugin.cfg`s, and both `ADDON_VERSION`s (canonical + `example/` vendored copy).

## [0.4.6] — 2026-07-05

### Changed
- **npm publish-prep for the host.** Renamed the package
  `godot-claude-bridge-host` → **`godot-claude-bridge`** (the `bin` command was
  already `godot-claude-bridge`; the name was confirmed free on npm), added
  `license`/`repository`/`homepage`/`bugs`/`keywords`/`author` metadata, a
  `prepublishOnly: npm run build` guard so a publish can never ship stale `dist/`,
  and bundled `LICENSE` + a package `README.md` (`files` now lists them). Verified
  with `npm pack --dry-run`. The `npm publish` itself is intentionally left to the
  maintainer (needs npm auth).
- **Root README freshness pass.** Dropped the "Phases 0–4" title and the stale
  "0.4.1 pre-live-run / reference scaffold / not exercised in CI / validated by
  inspection" framing — the project is live-validated with CI running the real
  build. Reworked the Verification, Validating, and Status sections accordingly,
  documented the `gd_workspace_symbols` engine gap, and pointed install at the
  npm package.
- Version realigned to **0.4.6** across `host/package.json`, both `plugin.cfg`s,
  and both `ADDON_VERSION`s (canonical + `example/` vendored copy).

## [0.4.5] — 2026-07-05

### Changed
- **`gd_workspace_symbols` now degrades gracefully.** Godot's GDScript language
  server (through 4.7) has no `workspace/symbol` method and replies
  `-32601 Method not found`, which the tool previously surfaced as a raw
  `LSP error [-32601]: …`. The host now feature-detects the gap: `LspClient`
  captures the server's advertised capabilities from the `initialize` handshake
  (`getServerCapabilities()`), and the tool skips the request when
  `workspaceSymbolProvider` is absent — still catching a `-32601` (or "method not
  found") from builds that advertise the capability but don't honour it — and
  returns an explicit `isError` message pointing at `gd_document_symbols` as the
  working alternative. The success-path `symbols` output shape is unchanged, so
  the tool will start returning results unmodified on a future Godot build that
  implements the method. Output-schema enforcement is unaffected (the MCP SDK
  exempts `isError` results from `outputSchema` validation).

- **Aligned addon version metadata for distribution.** `addon/…/plugin.cfg` was
  still `version="0.1.0"` with a "Phase 0-1 scaffold" description (the file the
  Asset Library and the Godot plugin list actually read), while
  `operations.gd`'s `ADDON_VERSION` said `0.4.3`. Bumped both to **0.4.5** and
  rewrote the stale plugin/README descriptions to the shipped four-plane reality,
  so a plugin-list entry and an Asset Library submission read correctly. Repo-wide
  tags mean host and addon share the one repo version at each tag.

### Added
- **D5 — distribution guide (`docs/DISTRIBUTION.md`).** Documents publishing the
  host to npm and the addon to the Godot Asset Library, and states the remote
  caveat honestly: a cloud sandbox cannot see a local editor and frame capture
  needs a GPU/Xvfb, so a remote deployment is a degraded subset without a local
  relay. No code depends on this; it captures the decisions and steps.

## [0.4.4] — 2026-07-05

### Changed
- **D1 — pinned the SDK floor.** Raised `@modelcontextprotocol/sdk` from
  `^1.10.0` to `^1.17.0` so a lockfile-less `npm install` can no longer resolve a
  pre-elicitation SDK. The confirmation gate needs `server.server.elicitInput`
  and the tools need `registerTool({ inputSchema, outputSchema })`; verified that
  1.17.0 exposes both. The committed lockfile still pins the live-validated
  **1.29.0**, so `npm ci` (and CI) resolve exactly as before — this only tightens
  the floor for fresh, lockfile-less installs.

## [0.4.3] — 2026-07-05

First live-validated **and** hardened build. Exercised end-to-end against a real
Godot 4.7 editor and a real npm-installed `@modelcontextprotocol/sdk@1.29.0`
(resolved from `^1.10.0`); the full Go/No-Go checklist is GO
(see `LIVE_VALIDATION_SIGNOFF.md`). 54 tools + 5 resources across all four planes.

### Added
- **B1 — enforced output schemas.** `host/src/schemas.ts` freezes the
  `structuredContent` shape of every data tool (52 tools) and
  `applyOutputSchemas()` injects each as the tool's `outputSchema`, so the MCP
  SDK now validates every success result at runtime. Shapes were frozen from the
  v0.4.2 live run (47 exercised live, 0 mismatches). Image tools
  (`screenshot_editor`, `runtime_screenshot`) are intentionally excluded.
- **B2 — CI.** `.github/workflows/ci.yml` runs the real
  `npm ci && npm run build && npm run typecheck` plus `scripts/contract_check.py`
  on Node 18/20/22, and asserts the SDK resolves to a 1.x line.
  `.github/workflows/sdk-drift.yml` is a weekly early-warning for SDK major bumps.
- `CHANGELOG.md` (this file).

### Changed
- **B3 — TOOL_CATALOG doc-drift cleanup.** Reconciled `docs/TOOL_CATALOG.md`
  against the shipped code and the now-enforced `schemas.ts`:
  - `runtime_inject_input` input now documents `strength`, `button`, and
    `relative` (host schema and GDScript handler already supported them);
    output documents `kind`.
  - `dbg_evaluate` output documents `variables_ref`.
  - `gd_diagnostics` input documents `wait_ms` and marks `path` required; output
    corrected to a top-level `uri` (was shown per-diagnostic).
  - `gd_rename` input documents `apply`/`confirm`; output documents
    `applied`/`written`.
  - `gd_references` input corrected `includeDeclaration` → `include_declaration`.
  - `dbg_launch`/`dbg_attach`/`dbg_set_breakpoints`/`dbg_stack_trace`/
    `runtime_get_log` schemas reconciled to the shipped shapes.
  - Design note updated to reflect that output schemas are now enforced (B1).
- `ADDON_VERSION` bumped `0.1.0` → `0.4.3` in `operations.gd` (addon and example
  copies) so `editor_ping.addon_version` is meaningful.
- `host/package-lock.json` refreshed after the version bump so `npm ci` is
  deterministic (records `@modelcontextprotocol/sdk@1.29.0`).

### Known limitations
- `gd_workspace_symbols` is non-functional against Godot 4.7: the GDScript
  language server replies `-32601 Method not found` to `workspace/symbol`. The
  gap is in the engine, not the host; the tool's contract is correct and it is
  retained for forward compatibility. (Backlog: feature-detect and hide, or
  return a clearer "unsupported" message.)
- `godot_launch_editor` (detached) does not start Godot's LSP (6005) / DAP (6006)
  servers; use a foreground `godot --editor --path …` when those planes are
  needed.

## [0.4.2] — 2026-07-05

First live-validated build. Gate 0 (the real SDK build, which no static authoring
environment could run) surfaced exactly one real defect, now fixed.

### Fixed
- **`ToolResult` type (`host/src/confirm.ts`).** The confirmation-gate result
  typed `content` as optional/untyped, which compiled against the modeled SDK
  shims but broke against SDK 1.29's `registerTool`, producing nine `TS2345`
  errors across the nine elicitation-gated tools (`dap.ts`, `editor.ts`,
  `lsp.ts`, `runtime.ts`). Retyped `content` as a required
  `Array<{ type: "text"; text: string }>` with an index signature to satisfy
  `CallToolResult`. No logic changed; rebuild clean.

## [0.4.1] — 2026-07-04

Pre-live scaffold with two fixes later confirmed working during the live run.

### Fixed
- **Diagnostics URI key (`host/src/lsp.ts`).** `gd_diagnostics` now matches
  published diagnostics by a normalized `diagKey`, so a diagnostic published
  under a `%20`-encoded `file://` URI is still matched to the opened document
  instead of silently returning empty after the timeout.
- **DAP step/continue await-the-stop (`host/src/tools/dap.ts`).** `dbg_step` and
  `dbg_continue` now wait for the next `stopped`/`terminated` event and return
  the real resulting state, instead of returning an instant `running` reply that
  the caller had to poll.

[0.4.4]: #044--2026-07-05
[0.4.3]: #043--2026-07-05
[0.4.2]: #042--2026-07-05
[0.4.1]: #041--2026-07-04
