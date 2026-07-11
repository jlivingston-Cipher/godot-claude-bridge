# Changelog

All notable changes to Breakpoint MCP are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.6.0] — 2026-07-11

Feature release — **Group N, second increment (the Board slice)**: two composites that build the spatial frame the card/piece instances sit on — `board_create`, `board_place` — carrying the surface from **248 to 250 tools**. Host-only: like the Card slice, each composite is a scripted sequence of already-audited editor-bridge primitives (`scene.new` / `node.add` / `node.set_property` / `node.add_to_group` / `node.reparent` / `scene.save`) emitted through an injectable emit-sink, so **no addon method is added** and both `addons/breakpoint_mcp/` copies stay byte-identical. Version `1.5.0` → `1.6.0`.

### Added — Group N board-authoring composites (2 tools, 248 → 250)
- **`board_create` — build a board scene with addressable cells from a layout spec** (writes files; elicitation-gated). Cells are `Marker2D` (or `Control`) anchors, each a `cell_<id>` node in the `board_cells` group, laid out by one of three general-purpose modes — `ring{cells:[ids]}` (evenly around a circle), `grid{rows,cols}` (ids `"<row>_<col>"`), or explicit `cells:[{id,x,y}]` — with an optional `background` (solid `color` or a `res://` `art` texture). Emits `scene.new` → background → per-cell `node.add` + `node.set_property(position)` + `node.add_to_group("board_cells")` → `scene.save`, and returns the `cell_id → node_path + position` map.
- **`board_place` — parent/snap an existing node onto a cell by id** (undoable node authoring). Reparents the node under `<board>/cell_<cell>` and sets its local position to the `align` offset (default centred on the anchor); returns the node's new path.
- **General-purpose by construction.** The tools build *structure* only — cells carry nothing but caller-supplied ids; the game-neutrality guard test is extended so no game-specific vocabulary can slip in. `tile`-backed cells (a Group D `TileMapLayer`) are a deferred fast-follow.
- **Same quality bar:** frozen `outputSchema` entries in `host/src/schemas.ts` for both tools; `contract_check.py` parity (`docs/TOOL_CATALOG.md` gains the two board tools + index rows; the current-surface tool-count references in `README.md` / `host/README.md` / `docs/USER_GUIDE.md` / `CONTRIBUTING.md` are reconciled 248 → 250); registration meta-test `EXPECTED_TOOL_COUNT` 248 → 250; 8 new op-sequence cases in `host/test/tabletop.test.ts` (ring / grid / explicit layouts, background ordering, `cell_kind` / `root_type`, duplicate/malformed-id rejection, `board_place` reparent+snap) plus the pure ring/grid math; and a new headless `example/tests/board_build_smoke.gd` (build → PackedScene round-trip → cell group/position survival → `board_place` snap, `BOARD_BUILD_*` markers) wired into the `gdscript-unit` CI lane. Host-only change — both `addons/breakpoint_mcp/` copies are untouched.

## [1.5.0] — 2026-07-11

Feature release — **Group N, the card-authoring composite lane**, first increment (the **Card slice**): four composites that build and data-bind Godot card scenes from a spec — `card_template_create`, `card_instance`, `card_hand_layout`, `card_deck_from_table` — carrying the surface from **244 to 248 tools**. Host-only: each composite is a scripted sequence of already-audited editor-bridge primitives (scene / control / node / theme / resource) emitted through an injectable emit-sink, so **no addon method is added** and both `addons/breakpoint_mcp/` copies stay byte-identical. Version `1.4.1` → `1.5.0`.

### Added — Group N card-authoring composites (4 tools, 244 → 248)
- **`card_template_create` — build a reusable card `PackedScene` from a slot spec** (writes files; elicitation-gated). Named slots (`label` / `rich_text` / `texture` / `panel` / `badge`) become the card's regions, with optional per-slot rect/anchor/align/wrap/font-size, an inline theme (StyleBoxFlat + `theme_*`), and a two-sided card back. Emits `scene.new` → a `Face` container → one node per slot → a generated script-backed `set_data()` / `set_face()` (`resource.create` GDScript + `node.set_property` script) → `scene.save`, and returns the slot→node map.
- **`card_instance` — instance a template into the open scene and bind data to its slots** via the template's `set_data()` (undoable node authoring). Surfaces which data keys bound and which had no matching slot (`bound` / `unbound`).
- **`card_hand_layout` — instance N cards under a container and arrange them** as a `row`, `fan`, `stack`, or `grid`, with `spacing` / `overlap` / `fan_angle` / `columns` / `align` / `origin` knobs. The layout math is pure and unit-tested.
- **`card_deck_from_table` — stamp one card per row of a CSV/JSON table**, binding columns to slots via a `column_map` of bare `{column}` references or composed `"{a} · {b}"` templates, with an optional row `filter`, `limit`, `art_column`, and `layout`. Columns no slot referenced are surfaced (`unmapped_columns`), never silently dropped.
- **General-purpose by construction.** The composites build and data-bind *structure* and invent no game rules, values, or names — all data flows in from the caller. They decompose entirely onto existing, already-audited primitives, so they inherit that verification story and add no engine-facing risk.
- **Same quality bar:** frozen `outputSchema` entries in `host/src/schemas.ts` for all four tools; `contract_check.py` parity (`docs/TOOL_CATALOG.md` gains a `## Group N` section + 4 index rows; the current-surface tool-count references in `README.md` / `host/README.md` / `docs/USER_GUIDE.md` / `CONTRIBUTING.md` are reconciled 244 → 248); registration meta-test `EXPECTED_TOOL_COUNT` 244 → 248; new `host/test/tabletop.test.ts` covering per-tool op-sequences, the `{placeholder}` column resolver (bare / composed / missing → error), the layout math, CSV/JSON parsing, and a game-neutrality guard; and a new headless `example/tests/card_build_smoke.gd` (build → PackedScene round-trip → setter behaviour, `CARD_BUILD_*` markers) wired into the `gdscript-unit` CI lane. Host-only change — both `addons/breakpoint_mcp/` copies are untouched.

## [1.4.1] — 2026-07-10

Patch release — adds the `init --from-github` addon-source escape hatch to the onboarding CLI: `breakpoint-mcp init --from-github [ref]` sources the editor addon from GitHub instead of the copy bundled in the npm tarball (for a missing/corrupt bundle, or to install a different ref than the installed package shipped). Host-CLI only — no addon, schema, catalog, or contract change; still **244 tools**, and the editor addon is byte-identical to 1.4.0 (its `plugin.cfg` / `ADDON_VERSION` stay at 1.4.0). Version `1.4.0` → `1.4.1`.

### Added — `init --from-github` addon-source escape hatch (host CLI; no new tools, still 244)
- **`breakpoint-mcp init --from-github [ref]` fetches the editor addon from GitHub instead of the copy bundled in the npm tarball.** The bundled copy stays the default (offline, version-matched by construction); `--from-github` is the escape hatch for when the bundle is missing/corrupt, or to install a different ref than the installed package shipped — e.g. `--from-github main` for the latest, or `--from-github v1.3.0` for an older addon. Without an explicit ref it defaults to this package's own version tag (`v<version>`), so it mirrors the bundled addon but sourced from GitHub. `--repo <owner/repo>` overrides the source repository (default `jlivingston-Cipher/godot-breakpoint-mcp`) for forks.
- **Dependency-free and offline-testable.** One GitHub `git/trees` API call lists the `addons/breakpoint_mcp/**` blobs at the ref, then each file is downloaded from `raw.githubusercontent.com` (a CDN that does not count against the REST rate limit) into a temp dir that is removed once the addon is installed — so a `--from-github` run costs a single API request. It uses Node 18+'s global `fetch` (no new dependency; the package stays SDK-and-zod-only) behind an injected seam, so the whole path is unit-tested with a fake fetch. It honours `GITHUB_TOKEN` / `GH_TOKEN` when set (higher rate limit / private forks). `--dry-run` prints the plan and makes no network call. Clear errors on a bad repo/ref (404), rate-limiting (403, which hints `GITHUB_TOKEN`), a ref with no addon, or a download failure — each pointing back to the bundled default.
- **No tool-surface or addon change.** Host-CLI only — `EXPECTED_TOOL_COUNT`, `contract_check.py`, the catalog, `schemas.ts`, and both `addons/breakpoint_mcp/` copies are untouched; still **244 tools**. New `host/src/cli/github.ts`; +10 host tests (`host/test/cli_github.test.ts` plus three `runInit --from-github` cases in `cli_init.test.ts`) cover the happy path, byte-exact binary download, the 404 / 403 / no-addon / truncated-tree / failed-download errors, and the dry-run "no network" guarantee.

## [1.4.0] — 2026-07-10

Feature release — the **in-editor status/config dock**: a thin editor panel (the GUI twin of `doctor` + `init`) that reports bridge health across the editor / runtime / GDScript-LSP / DAP planes, shows the ports and project path, and offers a one-click **Copy MCP-client config**. Addon-only — the tool surface is unchanged at **244 tools**, with no configuration or behaviour change to the server or any existing tool. This release also fixes the long-standing cosmetic addon-version drift: `ADDON_VERSION` in `operations.gd` moves `1.0.0` → `1.4.0` to match `plugin.cfg` and the package (surfaced in `editor_ping.addon_version`). Version `1.3.0` → `1.4.0`.

### Added — in-editor status/config dock (Phase-4 adoption; addon-only, still 244 tools)
- **A thin "Breakpoint MCP" editor dock — the in-editor twin of `doctor` + `init`.** Enabling the plugin now adds a compact panel to the editor's right dock that reports the live health of all four bridges — **editor** (read in-process from the bridge server: listening state, port, connected-client count), **runtime**, **GDScript LSP**, and **DAP** (short, non-blocking `StreamPeerTCP` probes on a ~2 s refresh, with the LSP/DAP ports read from `EditorSettings` so the dock reflects the user's actual configuration, not just the defaults) — alongside the project path and a one-click **Copy MCP-client config** button that puts the exact `mcpServers → godot` snippet `breakpoint-mcp init` prints onto the clipboard. It closes the known setup-friction weakness and gives the bundled-UX feel of the chat-style addons *without* becoming a chat app: scope is connection / status / config only; the assistant still runs in the user's MCP client. New `addons/breakpoint_mcp/status_dock.gd` (with pure, editor-free static helpers for the config snippet and status formatting); a read-only `get_status()` added to `bridge_server.gd`; `plugin.gd` adds/removes the dock in `_enter_tree` / `_exit_tree`. No new MCP tools and no dispatcher changes — **still 244 tools**, `contract_check.py` unchanged. +16 assertions in the socket-free GDScript unit suite (`example/tests/ops_unit_test.gd`, now 180) pin the snippet's parity with the host `init` CLI and the status glyph / row formatting; both tracked addon copies stay byte-identical.

## [1.3.0] — 2026-07-10

Feature release — the **LSP-depth tail**: two new read-only GDScript LSP tools (`gd_call_hierarchy`, `gd_semantic_tokens`), carrying the surface from **242 to 244 tools**. No addon logic, configuration, or existing-tool behaviour change; both new tools feature-detect their Godot capability and degrade gracefully, so no client sees a new failure mode. Version `1.2.1` → `1.3.0`.

### Added — LSP-depth tail: call hierarchy + semantic tokens (2 tools, 242 → 244)
- **`gd_call_hierarchy` — find a function's callers or callees over the GDScript language server.** Resolves the symbol at a position with `textDocument/prepareCallHierarchy`, then queries `callHierarchy/incomingCalls` (who calls this — the default `direction`) or `callHierarchy/outgoingCalls` (`direction: "outgoing"`, what this calls), returning each related function (`name`, `kind`, `uri`, position, `detail`) with the call-site `ranges`. Read-only.
- **`gd_semantic_tokens` — the semantic-highlighting tokens for a whole script.** Requests `textDocument/semanticTokens/full` and decodes the LSP packed-integer form (delta-encoded 5-tuples of line/char/length/type/modifiers) through the server's advertised legend into absolute tokens, each with its position, `length`, `type` and `modifiers`. Read-only.
- **Engine reality (the D7 lesson).** Godot's GDScript language server does not advertise `callHierarchyProvider` or `semanticTokensProvider` (observed through 4.7), so both tools **feature-detect the capability and return a clear "unsupported" message** rather than provoking a raw `-32601`, and keep a `-32601` belt-and-suspenders for a build that advertises one but still answers "method not found" — the same graceful-degradation contract as `gd_workspace_symbols` / `gd_code_action`. If a future Godot build implements either provider, the tool un-gates automatically via feature-detection. The experimental editor-plane CI probe (`test-integration/editor-lsp.integration.mjs`) gains a `D7_CAPS3` marker plus two live probes so the per-build truth is recorded across the 4.3 / 4.7 matrix.
- **Same quality bar:** frozen `outputSchema` entries in `host/src/schemas.ts` for both tools; `contract_check.py` parity (`docs/TOOL_CATALOG.md` gains the two detail blocks + 2 index rows; the current-surface tool-count references in `README.md` / `host/README.md` / `docs/USER_GUIDE.md` / `CONTRIBUTING.md` are reconciled 242 → 244); registration meta-test `EXPECTED_TOOL_COUNT` 242 → 244; +7 host tests in `lsp.test.ts` covering the supported incoming/outgoing and packed-token-decode paths and the capability-absent / `-32601` "unsupported" paths, plus representative shape validations in `schemas.test.ts`. Host-only change — both `addons/breakpoint_mcp/` copies are untouched (LSP tools speak to Godot's own language server, not the addon).

## [1.2.1] — 2026-07-10

Patch release — republishes the package so its npm page reflects the `init` / `doctor` onboarding docs. npm READMEs are immutable per published version, so the `host/README.md` parity fix only reaches npmjs.com on a new publish. No code, tool, schema, or configuration change — still **242 tools**; version `1.2.0` → `1.2.1`.

### Documentation
- Brought the npm-published `host/README.md` to parity with the repository README: it now documents the `breakpoint-mcp init` and `doctor` onboarding commands and notes that the editor addon ships **inside the package** (so users who install from npm do not need the repository to get the addon). Also clarified in the root `README.md` that the by-hand "Install the editor addon (manual)" steps are the from-source route, and that npm users can use `init` instead. No code, tool, schema, or version change (still **242 tools** at 1.2.0). The npm package page reflects this on the next publish, since a version's README is immutable once published.

## [1.2.0] — 2026-07-10

Onboarding release — a one-command install (`breakpoint-mcp init`) and a health-check (`breakpoint-mcp doctor`), with the editor addon now shipped inside the npm package so `init` works offline. Host + packaging only: the tool surface is unchanged at **242 tools**, and there is no configuration or behaviour change to the server or any existing tool. Version `1.1.0` → `1.2.0`.

### Added
- **`breakpoint-mcp doctor` — a CLI health-check for an install (the first half of the onboarding/adoption work).** The `bin` now dispatches on the first argument: `breakpoint-mcp doctor` and `breakpoint-mcp --help` are handled, while any other invocation — including no arguments, which is how every MCP client launches the server — falls through to the unchanged stdio MCP server, so the server's launch contract is untouched. `doctor` probes the Godot binary (`GODOT_BIN --version`), the editor addon (installed at `addons/breakpoint_mcp/plugin.cfg` and enabled in `project.godot`), and the four bridges (editor 9080, runtime 9081, GDScript LSP 6005, DAP 6006), printing an aligned status table with actionable hints or, with `--json`, a structured report. The four bridges are informational by default (the editor/game may legitimately not be running when you check an install); `--require-live` promotes them to required, and `--include-csharp` additionally probes OmniSharp / netcoredbg on PATH. The exit code is 0 iff no required check failed, so `doctor` doubles as a pre-flight gate. New host-only files `host/src/cli/args.ts` (a dependency-free flag parser) and `host/src/cli/doctor.ts`; +14 host tests (`cli_args.test.ts`, `cli_doctor.test.ts`) exercising the bridges against loopback TCP stubs and a POSIX shell Godot fixture; a new `ci.yml` build-job smoke runs the built `dist` and asserts the subcommand routes (marker `ONBOARD_DOCTOR_OK`). No new MCP tools — still **242 tools**; `contract_check.py` unchanged. (The `init` installer plus the README / User-Guide onboarding rewrite land next.)
- **`breakpoint-mcp init` — one-command onboarding; the editor addon now ships in the npm tarball.** `breakpoint-mcp init` installs the editor addon into a target project (`addons/breakpoint_mcp/`), enables it in `project.godot` (creating the `[editor_plugins]` section or appending to the existing `enabled=PackedStringArray(...)` without dropping other plugins), and wires the MCP client — printing the `mcpServers` snippet by default, or writing/merging it into a client's config with `--client claude-code|claude-desktop|cursor|windsurf|vscode` (existing configs are backed up to `.bak`; a config that is not valid JSON is left untouched). Idempotent and non-destructive: an already-installed addon is skipped unless `--force`, an already-enabled plugin is a no-op, `--dry-run` previews without writing, and `--project <dir>` targets a specific project. To make `init` work offline from `npx`, the addon — whose source of truth is the repo-root `addons/breakpoint_mcp/`, outside the `host/` package — is staged into `host/addon/` at `prepublishOnly` (new `host/scripts/stage-addon.mjs`, `npm run stage-addon`) and included via `package.json` `files`; `init` resolves the bundled copy in the published package and falls back to the repo-root copy in the dev tree. New `host/src/cli/init.ts` + `host/src/cli/clients.ts`; +14 host tests (`cli_init.test.ts`) covering the `project.godot` edit cases, addon install/skip/overwrite, client-config merge, and the end-to-end command; two new `ci.yml` build-job smokes assert `init` installs + enables into a throwaway project (`ONBOARD_INIT_OK`) and that the addon is present in the packed tarball (`ONBOARD_PACK_OK`). No new MCP tools — still **242 tools**.

## [1.1.0] — 2026-07-10

### Removed
- **Removed the backward-compatible `CLAUDE_*` environment-variable deprecation shim.** The `CLAUDE_*` → `BREAKPOINT_*` rename shipped in `1.0.0` with a one-cycle compatibility fallback: both the host (`envCompat` in `host/src/config.ts`) and the addon (`_env_compat` in `bridge_server.gd` / `runtime_bridge.gd`) read the `BREAKPOINT_*` name first and fell back to a set `CLAUDE_*` with a one-time deprecation warning. That fallback is now gone — the seven overrides (`BREAKPOINT_BRIDGE_{HOST,PORT,TIMEOUT_MS}`, `BREAKPOINT_RUNTIME_{HOST,PORT,TIMEOUT_MS}`, `BREAKPOINT_RESOURCE_COALESCE_MS`) are read directly from the `BREAKPOINT_*` names only, and a set `CLAUDE_*` is now ignored. **Migration:** if you still set any `CLAUDE_*` variable, rename it to its `BREAKPOINT_*` equivalent; `GODOT_*` variables are unaffected. Treated as a **minor** bump rather than a major: the `CLAUDE_*` names were only ever shipped as an already-deprecated compatibility alias (added in `1.0.0` explicitly scheduled for removal after one cycle — `BREAKPOINT_*` has been the canonical, documented interface since `1.0.0`), so their removal does not break the documented public configuration surface. Tests were updated to pin the new behaviour: host `config.test.ts` drops the two compat/precedence cases and adds a regression test asserting a set `CLAUDE_*` is ignored, and the GDScript unit suite drops `_test_runtime_env_compat` (the `_env_compat` helper it exercised no longer exists), moving the suite from **167 → 164 assertions**. Both `addons/breakpoint_mcp/` copies stay byte-identical; still **242 tools**. Version `1.0.0` → `1.1.0`.

### Changed
- **Test-coverage hardening** (no behaviour, tool, schema, or version change): extended the editor-free GDScript unit suite (`example/tests/ops_unit_test.gd`) from 55 to **111 assertions**. New coverage — all still headless, no editor / bridge / GUI: the `variant_json` codec's previously-untested `encode` branches (non-`Resource` `Object` → `{__type__:"Object"}`, `Resource` → `{__type__:"Resource"}`, the `Unsupported` fallback for unhandled Variant types such as `Transform3D`, element-wise packed-array encoding, and `Rect2` tag fields) and its `decode` fallbacks (unknown `__type__` → `null`, `Object` / missing-`Resource` tags → `null`, and the `Color`-alpha / `Quaternion`-`w` / integer-vector `int()` defaults); the pure `operations.gd` helper `_resource_class_ok`; and the FIRST unit coverage of `runtime_bridge.gd`'s editor-free helpers, exercised WITHOUT entering the SceneTree so no TCP server opens — the `{ok}`/`{err}` envelope, `_dispatch`'s `ping` and unknown-method paths, `_get_monitors` key filtering, the `CLAUDE_*` → `BREAKPOINT_*` `_env_compat` shim (including its legacy-fallback deprecation warning), and the `push_log` / `_get_log` ring buffer (`since_seq` + level filtering and `LOG_CAP` eviction). Runs under the existing headless `gdscript-unit` CI job, still gated on the `OPS_UNIT_SUMMARY` / `OPS_UNIT_FAIL` markers (validated locally against Godot 4.7 — 111/111). No addon logic changed and both `addons/breakpoint_mcp/` copies stay byte-identical; still 242 tools at 1.0.0.
- **Test-coverage hardening** (no behaviour, tool, schema, or version change): extended the editor-free GDScript unit suite (`example/tests/ops_unit_test.gd`) from **111 to 153 assertions**. New coverage — still headless, no editor / bridge / GUI: the `_base()`-dependent `runtime_bridge.gd` handlers, reached via a `_FixtureRuntimeBridge` subclass that overrides `_base()` with an in-memory scene fixture so the handlers run WITHOUT entering the live `SceneTree` (an instance added to a real tree would fire `_ready()` and open the runtime TCP server). Covers `_get_tree` (the `no_scene` error, node serialization incl. the `visible` field and `max_depth` truncation), `_resolve` / `_path_of`, `_get_property` / `_set_property` (Variant⇄JSON codec round-trip through the tagged-object form, plus `bad_path`), `_call_method` (`callv` return, `no_method`, `bad_path`), `_emit_signal` (a scripted-signal success with decoded args, plus `no_signal` / `bad_path`), and `_inject_input` (`bad_kind` plus the action / key / mouse-button / mouse-motion paths on a plain instance), each with the matching `_dispatch` routing. Runs under the existing headless `gdscript-unit` CI job, still gated on the `OPS_UNIT_SUMMARY` / `OPS_UNIT_FAIL` markers (validated locally against Godot 4.7 — 153/153). No addon logic changed and both `addons/breakpoint_mcp/` copies stay byte-identical; still 242 tools at 1.0.0.
- **Internal refactor** (no behaviour, tool, schema, or version change): split the ~2,600-line `registerEditorTools` in `host/src/tools/editor.ts` — a single function that registered all **145** Plane A (live-editor) tools — into a new `host/src/tools/editor/` directory of **16 per-domain modules** (`core`, `scene`, `node`, `signal`, `introspection`, `resource`, `filesystem`, `animation`, `tiles`, `physics`, `particles`, `shader`, `audio`, `ui`, `spatial`, `project_input_test`) plus a shared `common.ts` (the `Bridge error` success/`fail` envelope and the `makeCall` bridge-call factory exported as the `EditorCall` type). `editor.ts` is now a 46-line dispatcher that builds the shared `call` helper once and invokes each group **in its original order**, so the registered tool set and registration order are byte-identical — verified independently that the ordered 145-name sequence is unchanged. Each module is a contiguous, verbatim slice of the original `registerTool` blocks: no tool definition, input/output schema, description, or confirmation-gating changed. `scripts/contract_check.py` now discovers tool source recursively (`glob` → `rglob`) and scans the `editor/` directory for host bridge calls. Build + typecheck green, host test suite unchanged, and `contract_check.py` still passes ALL HARD CHECKS (**242 tools · 220 input / 209 output shapes · 436 JSON blocks, 0 invalid**). Both `addons/breakpoint_mcp/` copies are untouched (host-only change). Still 242 tools at 1.0.0.
- **Test-coverage hardening** (no behaviour, tool, schema, or version change): extended the editor-free GDScript unit suite (`example/tests/ops_unit_test.gd`) from **153 to 167 assertions**, closing the last editor-free gaps the session-69 handoff flagged as needing a live `SceneTree`. New hermetic coverage (still in `_initialize`, no editor / bridge / GUI): the pure `operations.gd` `_resource_props` helper (its `PROPERTY_USAGE_EDITOR` filter and result shape, exercised over a scripted `@export`-bearing `Resource`) and `runtime_bridge.gd` `_screenshot`'s `no_viewport` guard (a detached instance short-circuits before the renderer is touched). Plus a small new **live-tree phase** that runs in `_process` on the first frame — where the SceneTree `root` is active so nodes added to it actually enter the tree — reaching branches the hermetic phase cannot: `runtime_bridge._resolve`'s absolute (`/root/…`) branch via `get_node_or_null`, `operations._resolve`'s absolute path through `has_node` / `get_node`, and `_screenshot` with a real viewport (under the headless dummy renderer `get_image()` returns null so it degrades cleanly to `no_image`; on a GPU it returns a PNG). The suite stays **socket-free** despite iterating a frame: `_initialize` frees the example's `BreakpointRuntimeBridge` autoload before that frame (it is parented to `root` but not yet `_ready`), so its runtime TCP server never opens — the hermetic, deterministic, no-socket property the suite guards. Runs under the existing headless `gdscript-unit` CI job, still gated on the `OPS_UNIT_SUMMARY` / `OPS_UNIT_FAIL` markers (validated locally against Godot 4.7 — 167/167). No addon logic changed and both `addons/breakpoint_mcp/` copies stay byte-identical; still 242 tools at 1.0.0.

### Fixed
- `scripts/contract_check.py` now strips `//` line and `/* */` block comments (string/backtick-aware) before extracting an object literal's top-level keys and spreads, so a code comment inside a `host/src/schemas.ts` schema literal can no longer be misread as a pinned output field. The `// D6: …` note inside the `runtime_get_log` `outputSchemas` entry was previously parsed as a phantom `D6` field — harmless while that tool's catalog Output stays an inline code span, but a latent false-positive that would break shape-check #7 ("field pinned in schemas.ts but absent from the catalog Output block") the moment `runtime.ts`'s Output blocks are fenced. No behaviour, tool, schema, or version change (still 242 tools; all hard checks pass, coverage unchanged at 215 input / 204 output shapes).

## [1.0.0] — 2026-07-10

First stable public release. The tool surface — **242 tools + 5 MCP resources** — and all behaviour are identical to the built-but-never-published `0.17.0` tree; this cut only advances the version stamps and consolidates the accumulated `[Unreleased]` history into the 1.0 line. The project now commits to [Semantic Versioning](https://semver.org/): subsequent breaking changes to the tool surface, output schemas, or configuration will bump the major version. The `CLAUDE_*` → `BREAKPOINT_*` environment-variable migration ships with its backward-compatible deprecation shim intact — legacy names are still honoured for one release cycle with a one-time warning.

### Changed
- Documentation and repository-readiness pass for the first public release. Rewrote the README with a self-focused overview and no third-party comparisons; added a full **User Guide** (`docs/USER_GUIDE.md`), a **SECURITY.md** trust model with a private disclosure channel, **CONTRIBUTING.md**, **CODE_OF_CONDUCT.md**, GitHub issue/PR templates, and a **Trademarks** notice. Reconciled tool counts and version references across both READMEs, fixed broken links, scrubbed internal shorthand from shipped text, narrowed the npm `files` glob to drop source maps, hardened `.gitignore`, and removed stale internal planning docs. No tool, schema, or version change (still 242 tools at 0.17.0).
- Trimmed the public `docs/` to what users and contributors need: removed the internal `docs/D4_CSHARP_PLAN.md` (design plan) and `docs/DISTRIBUTION.md` (maintainer publishing steps), leaving the User Guide, Tool Catalog, and validation Runbook. Added `.gitignore` rules so internal design/development artifacts (handoffs, plans, backlogs) can't be committed.
- Internal code hygiene (no behaviour, tool, schema, or version change): de-duplicated the MCP success-envelope helper. Six tool modules that each re-declared an identical `ok()` (`editor`, `csdap`, `dap`, `runtime`) or identically bodied `textResult()` (`processes`, `cli`) now import the single exported `ok()` from `host/src/tools/lsp-common.ts`. Still 242 tools at 0.17.0; host tests 223/223.
- Test-coverage hardening (no behaviour, tool, schema, or version change): added host unit behaviour tests for four previously-untested planes — `editor.ts` (145 tools), `runtime.ts`, `processes.ts`, and `cli.ts`. The editor and runtime suites pin the safety contract: every destructive tool is confirmation-gated (blocks on decline and **never reaches the bridge**, bypasses on `confirm: true`), and an unreachable bridge degrades to a friendly `isError` envelope instead of throwing. The 42 unconditionally-gated editor tools are asserted by name (so adding a destructive tool without a gate fails loudly), and `editorsettings_get_set`'s read-passes / write-gates conditional is pinned. The process suite covers captured stdout/stderr stream + `since_seq` filtering and the 5000-line ring-buffer cap; the CLI suite covers stdout capture, missing-binary and non-zero-exit degradation, and detached launch. Host tests 223 → 246. Still 242 tools at 0.17.0.
- Renamed the GitHub repository slug `jlivingston-Cipher/godot-claude-bridge` → **`jlivingston-Cipher/godot-breakpoint-mcp`** to match the **Breakpoint MCP** brand and improve discoverability against the crowded `godot-mcp` field. GitHub keeps automatic redirects from the old URL, so existing links and clones continue to work. Updated the in-tree `repository` / `homepage` / `bugs` URLs in `host/package.json`, the README and host-README links, and the issue-template contact links to the new slug; historical changelog entries are left as written. No behaviour, tool, schema, or version change (still 242 tools at 0.17.0); the npm package name stays `breakpoint-mcp`.
- **Renamed the `CLAUDE_*` environment variables to `BREAKPOINT_*`** and finished the client-agnostic addon rebrand. The six bridge/runtime overrides (`BREAKPOINT_BRIDGE_{HOST,PORT,TIMEOUT_MS}`, `BREAKPOINT_RUNTIME_{HOST,PORT,TIMEOUT_MS}`) and `BREAKPOINT_RESOURCE_COALESCE_MS` were previously `CLAUDE_*`; the Group J asset-gen vars were already `BREAKPOINT_*`, so this completes the migration. **Backward-compatible via a one-cycle deprecation shim:** both the host (`envCompat` in `config.ts`) and the addon (`_env_compat` in `bridge_server.gd` / `runtime_bridge.gd`) read the new name first and fall back to a set `CLAUDE_*` with a one-time deprecation warning (stderr / `push_warning`); `GODOT_*` variables are unchanged. Also neutralized the remaining "Claude"-as-actor references so the runtime artifacts are client-agnostic: the 68 `create_action("Claude: …")` editor-undo labels → `"Breakpoint: …"`, the `[claude_runtime]` runtime-log prefix → `[breakpoint_runtime]`, the runtime-bridge header, and the "so Claude can see …" screenshot tool descriptions → "so the assistant can see …". Legitimate client references (Claude Desktop / Claude Code setup instructions, "developed and tested with Claude") are kept as written. Updated the README and User Guide configuration tables with a migration note; historical changelog entries left as written. Added host compat + precedence unit tests (host tests 246 → **248**). Both `operations.gd` copies byte-identical. No tool, schema, or version change (still 242 tools at 0.17.0).
- Extended `scripts/contract_check.py` from name-parity to **param/return SHAPE parity** (no behaviour, tool, schema, or version change). Three new static checks run without Godot or Node: (6) every tool the catalog documents with an `**Input**` block has documented params matching its `inputSchema` param names — shared schemas (`inputSchema: posSchema`), `{ ...spread }` composition, and the universal `confirm` gate param are resolved/ignored so there are no false positives; (7) every field a tool pins in `host/src/schemas.ts` `outputSchemas` (inline **and** the shared IIFE-spread envelopes `assetGenResult` / `netcodeScaffold` / `backendScaffold`) appears in that tool's catalog `**Output**` block; (8) `outputSchemas` names no non-existent tool, and any registered tool missing an output schema is surfaced (only the two image tools, `screenshot_editor` / `runtime_screenshot`, are expected). Currently 54 input shapes and 41 output shapes are cross-checked against the catalog with zero drift; the checks were fault-injection-tested to confirm they fail on real drift. Still 242 tools at 0.17.0.
- Added a **GDScript unit-test suite for the addon's editor-free logic** plus a headless CI job to run it (no behaviour, tool, schema, or version change). `example/tests/ops_unit_test.gd` runs directly under `godot --headless --script` — no editor, bridge, or GUI — and covers the parts a live engine is not needed to exercise: the `variant_json` codec's Variant⇄JSON round-trips (Vector2/2i/3/3i/4, Color, Rect2, Quaternion, NodePath, nested containers) and the pure `operations.gd` helpers (the `{ok}`/`{err}` envelope, `_resolve`/`_path_of` node-path resolution, `_serialize_node`/`_descendants` SceneTree serialization incl. `max_depth` truncation, the doc-URL / type-name helpers, and `_ping`). The editor-**coupled** mutators stay covered end-to-end by the authoring-plane probe. 55 assertions; a new headless `gdscript-unit` job in `integration.yml` gates on the `OPS_UNIT_SUMMARY` / `OPS_UNIT_FAIL` markers (validated locally against Godot 4.7). Still 242 tools at 0.17.0.

## [0.17.0] — 2026-07-09

### Added — Group M (second half): backend-SDK integration scaffolding (5 tools, 237 → 242)
- Completes Group M with the plugin-detected backend-SDK family (new `host/src/tools/backend.ts`, `registerBackendTools`), carrying the count to **242**. Same "host nothing, scaffold everything" stance as the `mp_*` half: running a leaderboard DB, a save-store or an auth service is a SaaS, but generating the integration against the game's *installed* SDK — SilentWolf / Nakama / PlayFab / Photon — is in scope. **We host nothing.**
  - **One detection tool** (Plane A / Editor, read-only): **`backend_detect`** reports which of the four known SDKs are installed and how each was found — an enabled autoload, an addon directory under `res://addons`, or a global `class_name` (a new `backend.detect` bridge handler).
  - **Four codegen tools** (Plane A / Editor + host, each writing a `res://…gd`): **`backend_configure`** (an SDK config/bootstrap autoload), **`leaderboard_scaffold`** (submit/fetch), **`cloudsave_scaffold`** (save/load), and **`auth_scaffold`** (login/register/logout). The GDScript is built host-side (so the templates are unit-tested) and written by the editor's `FileAccess` through the existing `mp.write_script` bridge method.
- Every codegen tool is **feature-detected two ways, and never a dead call**: if the SDK provides no such API (Photon is realtime transport — no leaderboard/cloud-save/auth), it degrades to `status: "unsupported_feature"`; if the SDK is not installed in the project, it degrades to `status: "sdk_missing"` ("install <SDK> first"). Both degrades write nothing and are not errors. Only a capable + installed SDK reaches the (elicitation-**gated**) writer.
- Same quality bar: frozen `outputSchema` entries in `host/src/schemas.ts` (a `backend_detect` shape + one shared scaffold envelope validating the `written` / `sdk_missing` / `unsupported_feature` outcomes); contract-check parity (`EXPECTED_TOOL_COUNT` 237 → 242, `contract_check.py` now scans `backend.ts`, `docs/TOOL_CATALOG.md` gains the Group M backend detail blocks + 5 index rows). Both `operations.gd` copies byte-identical (new `backend.detect` handler).
- Unit-tested the host codegen + capability matrix + detect/degrade forwarding in `host/test/backend.test.ts` (per-SDK config/auth/leaderboard/cloud-save templates, the `unsupported_feature` and `sdk_missing` degrades with their exact bridge-call counts, and the installed-SDK write path). Added a live-engine `AUTH_BACKEND` probe family to the authoring-plane integration probe (detect over the clean example, then an in-memory autoload simulates an installed SDK so the real write path + both degrades are exercised against a real editor, with the autoload removed afterward).
- No version bump — feature PRs leave the version stamps equal (a later release cut re-stamps them together). A `0.17.0` cut can now roll both Group M halves (`mp_*` + backend) together.

### Added — Group M: native multiplayer scaffolding (7 tools, 230 → 237)
- Adds the first half of Group M — the "game backend" question resolved as **authoring, not hosting**. Godot 4's built-in high-level multiplayer is a first-class engine feature and a top game-dev request, but running a relay / leaderboard-DB / save-store is a SaaS, not editor control. So the `mp_*` family **hosts nothing and scaffolds everything**: it only adds nodes, scripts, and config, carrying the count to **237**. (The plugin-detected backend-SDK integration tools — `backend_configure` / `leaderboard_scaffold` / … — remain a separate follow-up PR.)
  - **Three node-authoring tools** (Plane A / Editor, undoable via `EditorUndoRedoManager` exactly like every `node_*`): **`mp_add_spawner`** (a `MultiplayerSpawner` with an optional `spawn_path` and registered `spawnable_scenes`), **`mp_add_synchronizer`** (a `MultiplayerSynchronizer`, building a `SceneReplicationConfig` from a property list + replication mode), and **`mp_set_authority`** (`set_multiplayer_authority(peer_id, recursive)`, capturing the prior authority for undo).
  - **Four codegen tools** (Plane A / Editor + host, each writing a `res://…gd`): **`mp_setup_enet_peer`** (an `ENetMultiplayerPeer` host/join helper), **`mp_setup_webrtc_peer`** (a `WebRTCMultiplayerPeer` mesh helper), **`mp_wire_rpc`** (insert/replace an `@rpc(...)` annotation on a function in an existing script, appending a stub when absent), and **`mp_scaffold_lobby`** (a lobby controller with host/join + `peer_connected`/`peer_disconnected` tracking and lobby signals). The GDScript is built host-side (so the templates are unit-tested) and written by the editor's `FileAccess` through a new `mp.write_script` bridge method that rescans the filesystem.
- Same quality bar: frozen `outputSchema` entries in `host/src/schemas.ts` (three node shapes + one shared codegen envelope validating the `written` / `unsupported` outcomes); the three node mutators are **undoable**; every code-writing tool is confirmation-**gated** (writing a `.gd` is destructive, the `resource_create` model); **feature-detection** is first-class — `mp_setup_webrtc_peer` degrades to a clear `unsupported` result (nothing written) when the WebRTC module is absent, never a dead call; contract-check parity (`EXPECTED_TOOL_COUNT` 230 → 237, `contract_check.py` now scans `netcode.ts`, `docs/TOOL_CATALOG.md` gains a Group M family section + 7 index rows). Both `operations.gd` copies byte-identical (new `mp.add_spawner` / `mp.add_synchronizer` / `mp.set_authority` / `mp.write_script` bridge handlers).
- Unit-tested the host codegen + `@rpc` transform + node/degrade forwarding in `host/test/netcode.test.ts` (script templates, annotation formatting, insert-above / replace-existing / append-stub, the WebRTC degrade path, and a real on-disk `mp_wire_rpc` round-trip). Added a live-engine `AUTH_MP` probe family to the authoring-plane integration probe (spawner/synchronizer/authority created + undone/redone against a real editor, ENet/lobby scripts written + loaded back, `@rpc` wired into a real script, and the WebRTC feature-detect).
- No version bump — feature PRs leave the version stamps equal (a later release cut re-stamps them together).

## [0.16.0] — 2026-07-09

### Added — Group J: AI asset generation (7 tools, 223 → 230)
- Adds the asset-generation family, carrying the count to **230**. **MCP-native framing: the server never bundles or calls a model.** Each generator writes an asset to a `res://` path, imports it through the editor bridge, and returns a schema'd result; where the bytes come from is delegated.
  - **`asset_gen_configure`** (Plane B / host) selects the session backend — the feature flag: **`none`** (default) makes the generators **degrade** to a clear "no generation backend configured" result carrying a `request` spec the connected multimodal client can fulfil (no file written, not an error); **`placeholder`** writes deterministic, in-engine procedural stand-ins; **`command`** delegates to a configured local command (argv template with `{kind} {prompt} {output} {width} {height} {format}` tokens substituted per-argument, no shell — the command writes the file, the host imports it). Env-seeded via `BREAKPOINT_ASSETGEN_BACKEND` / `_CMD` / `_PROVIDER` / `_TIMEOUT_MS`; off by default.
  - **`asset_gen_placeholder`** (Plane A / Editor) always mints a deterministic stand-in regardless of the backend, as a native Godot resource (`.tres`) that loads synchronously — a hashed-colour `ImageTexture` (`sprite` / `texture` / `icon`), an `AudioStreamWAV` decaying-sine blip (`audio_sfx`), or a `BoxMesh` / primitive (`model`) — colour / frequency / size derived from a hash of the prompt, so the same prompt always yields the same asset (CI-assertable).
  - **`asset_gen_sprite`** / **`asset_gen_texture`** / **`asset_gen_icon`** / **`asset_gen_audio_sfx`** / **`asset_gen_model`** (Plane A / Editor) are the five typed generators. They branch on the backend (degrade / placeholder / command) and accept `placeholder: true` to force an in-engine stand-in even when a real backend is configured. They share one result envelope validating all three outcomes (`placeholder` / `generated` / `no_backend`).
- Same quality bar: frozen `outputSchema` entries in `host/src/schemas.ts` (a config shape + one shared generator envelope); every file-writing path is confirmation-**gated** (writing a new asset is destructive/irreversible — the `resource_create` model, not scene-undoable); the degrade path writes nothing and is not an error; feature-detection is the default state (no backend → a clear request spec, never a hang); contract-check parity (`EXPECTED_TOOL_COUNT` 223 → 230, `contract_check.py` now scans `assetgen.ts`, `docs/TOOL_CATALOG.md` gains a Group J family section + 7 index rows). Both `operations.gd` copies byte-identical (new `asset.gen_placeholder` / `asset.import` bridge handlers).
- Unit-tested the host branching in `host/test/assetgen.test.ts` (configure get/set/validation, the no-backend degrade, the placeholder bridge call + extension handling, and the command backend running a real fixture generator + importing its output). Added a live-engine `AUTH_ASSETGEN` probe family to the authoring-plane integration probe (placeholder sprite/texture/icon/audio/model minted + imported/loaded against a real editor, the degrade path, and a command-backend round-trip through a fixture generator).
- No version bump — feature PRs leave the version stamps equal (a later release cut re-stamps them together).

## [0.15.0] — 2026-07-09

### Changed — Renamed to Breakpoint MCP
- Rebrands the project from "godot-claude-bridge" / "Claude Bridge" to **Breakpoint MCP** (tagline: *Now Godot waits for you.*) across the host, the addon, and the docs. **No behaviour change** — every tool, schema, bridge method and CI probe is byte-for-byte the same; the surface stays at **223** tools and the version stamps stay `0.14.0` (rename PR, not a release).
  - **Host / npm:** package name `godot-claude-bridge` → `breakpoint-mcp` (+ the `bin` name), MCP `serverInfo.name` → `breakpoint-mcp`, the LSP/DAP `clientInfo`/`clientID` and the stderr log tag `[godot-claude-bridge]` → `[breakpoint-mcp]`.
  - **Addon:** directory `addons/claude_bridge/` → `addons/breakpoint_mcp/` (both the root and the bundled `example/` copy), plugin display name `Claude Bridge` → **Breakpoint MCP**, editor log prefix `[claude_bridge]` → `[breakpoint_mcp]`, internal server node `ClaudeBridgeServer` → `BreakpointBridgeServer`, and the new mark applied to `icon.png`.
  - **Runtime autoload:** `ClaudeRuntimeBridge` → `BreakpointRuntimeBridge` (the `/root/…` singleton the `runtime_*` tools and game code reach); the example `project.godot` autoload + enabled-plugin path and `player.gd`'s lookup were updated to match, so the runtime plane stays wired end-to-end.
  - **Docs:** README (root + host), `TOOL_CATALOG`, `DISTRIBUTION`, `RUNBOOK`, `contract_check.py` and `validate.sh` rebranded; `contract_check`'s addon path follows the move.
- The GitHub repository slug (`jlivingston-Cipher/godot-claude-bridge`) is intentionally **kept** this pass, so every `repository` / `homepage` / `bugs` URL is unchanged; a repo rename can follow as a separate deliberate step. Historical changelog entries below are left as written (they name the paths/identifiers accurate at the time).

### Added — Group K: knowledge & search (6 tools, 217 → 223)
- Adds the read-only "where / what / how" docs-lookup + code-index family, carrying the count to **223**.
  - **Four host-side tools** (Plane B, new `host/src/tools/knowledge.ts` — they read the project files directly, so they answer with nothing running): **`project_search`** (ripgrep-style literal/regex full-text search across the project, res:// paths + 1-based line/column, binary + cache dirs skipped), **`find_symbol`** (project-wide GDScript declaration index — `class_name` / `class` / `func` / `signal` / `enum` / `const` / `var` — the workspace-symbol answer Godot's LSP does not implement, cf. `gd_workspace_symbols` returning *unsupported*), **`find_usages`** (word-boundary identifier occurrences project-wide, the build-independent complement to the position-based `gd_references`), and **`example_snippet`** (curated GDScript idiom lookup — signals, autoload singletons, input, tweens, timers, scene changes, save/load, RNG, groups, state machines, HTTP, `@onready`).
  - **Two ClassDB-backed tools** (Plane A, over the editor bridge): **`class_reference`** (full class reference — method signatures with typed args + return, signal signatures, typed properties — the detailed view `classdb_get_class` summarises as bare names, plus the canonical docs URL; optional `member` filter), and **`docs_search`** (keyword search over the class reference — class names and, unless a `class_name`/`kind` scope narrows it, their members — each hit carrying its canonical online-docs URL; member scan bounded by `limit`).
- Same quality bar: frozen `outputSchema` entries in `host/src/schemas.ts` for all six; read-only, so none are undoable or gated; invalid-regex / not-found / empty-query surface as clear errors; contract-check parity; `EXPECTED_TOOL_COUNT` 217 → 223; `docs/TOOL_CATALOG.md` gains a Group K family section (prose + 6 detail blocks) + 6 index rows. Both `operations.gd` copies byte-identical (new `classdb.reference` / `docs.search` bridge handlers).
- Unit-tested the four host-side tools against a throwaway project fixture in `host/test/knowledge.test.ts` (res:// paths, cache-dir skipping, regex + word-boundary semantics, exact vs substring). Added a live-engine `AUTH_K` probe family to the authoring-plane integration probe (host-side search over the example project + ClassDB `class_reference` / `docs_search` against a real editor).
- No version bump — feature PRs leave the version stamps equal (a later release cut re-stamps them together).

## [0.14.0] — 2026-07-09

### Added — Group I: input, project config & testing (12 tools, 205 → 217)
- Adds input-map, project-configuration, and test-discovery editor tools (bridge namespaces `inputmap.*` / `project.*` / `editorsettings.*` / `test.*`), carrying the count to **217**.
  - **Input (4):** **`inputmap_add_action`** / **`inputmap_add_event`** / **`inputmap_erase_action`** — gated `ProjectSettings` `input/<name>` writers (optional `save`) — plus read-only **`inputmap_list`**. Events are built from a `{ type: key | mouse_button | joy_button | joy_motion, … }` descriptor (`keycode` / `physical_keycode` accept a key name via `OS.find_keycode_from_string` or an int).
  - **Project / config (6):** **`project_add_autoload`** / **`project_remove_autoload`** (`autoload/<name>`; a `*` prefix marks an enabled singleton), **`project_set_main_scene`** (validated `.tscn`/`.scn`), **`project_add_export_preset`** (appends to `export_presets.cfg` via `ConfigFile`), read-only **`project_list_settings`** (keys+values by dotted prefix), and **`editorsettings_get_set`** (read; gated write when `value` is given).
  - **Testing (2):** read-only **`test_detect`** (GUT / GdUnit4 / none) and **`test_list`** (`test_*.gd` / `*_test.gd`).
- Same quality bar: frozen `outputSchema` entries in `host/src/schemas.ts`; a confirm-gate on every writer (the `project_set_setting` model — `ProjectSettings` / editor-config mutations are **not** on the scene `EditorUndoRedoManager` history, so they are gated, not undoable); clear `bad_params`/`not_found` errors; contract-check parity; `EXPECTED_TOOL_COUNT` 205 → 217; `docs/TOOL_CATALOG.md` gains a Group I family section (prose + 12 detail blocks) + 12 index rows. Both `operations.gd` copies byte-identical.
- Added a live-engine `AUTH_GROUPI` probe family (13 assertions) to the authoring-plane integration probe; the 8 gated writers added to its `GATED` set. Authoring probe 125 → 138, live-validated against a real Godot 4.7-stable editor.
- `test_run` / `test_result` deferred on purpose (async / non-deterministic under a headless CI editor; needs a framework-bearing fixture + a maintainer semantics decision), so Group I ships 12 of the plan's ~14 tools. (#54)

### Added — Group H: 3D & navigation (10 tools, 195 → 205)
- Adds 3D and navigation editor tools (bridge namespaces `meshinstance.*` / `mesh.*` / `primitive_mesh.*` / `light.*` / `camera.*` / `csg.*` / `navregion.*` / `navagent.*` / `environment.*`), carrying the count to **205**.
  - **Seven edited-scene 3D mutators** (undoable via `EditorUndoRedoManager`, ungated — the `node_*` model): **`meshinstance_create`** (`MeshInstance3D`; optional `mesh_path` loads + assigns a `Mesh`), **`mesh_set_surface_material`** (`material_override` at surface -1, or a per-surface override slot), **`light_create`** (Directional / Omni / Spot), **`camera_create`** (`Camera3D`, optional current), **`csg_create`** (Box / Sphere / Cylinder / Torus / Polygon / Mesh / Combiner), **`navregion_create`** (`NavigationRegion3D`, seeding a fresh `NavigationMesh`), **`navagent_configure`** (`NavigationAgent3D` + radius / height / max_speed / path + target-distance / avoidance).
  - **Three confirm-gated resource file-writers** (the `resource_*` / `theme_create` model): **`primitive_mesh_create`** (Box/Sphere/Cylinder/Plane/Capsule/Prism/Torus/Quad mesh `.tres`), **`environment_create`** (`Environment` + background mode + optional ambient), **`environment_set_sky`** (attach a Procedural / Physical / Panorama `Sky`, switch background to SKY).
- Same quality bar: frozen `outputSchema` entries; undo for every scene mutator / confirm-gate for every file-writer; `MeshInstance3D` / `Material` / light-kind / CSG-shape / `Environment` type-guards with clear `bad_type`/`bad_params` errors; contract-check parity; `EXPECTED_TOOL_COUNT` 195 → 205; `docs/TOOL_CATALOG.md` gains a Group H family section (prose + 10 detail blocks) + 10 index rows. Both `operations.gd` copies byte-identical.
- Added a live-engine `AUTH_3D` probe family (13 assertions incl. a `meshinstance` undo/redo round-trip); the 3 writers added to its `GATED` set. Authoring probe 112 → 125, live-validated against a real Godot 4.7-stable editor.
- `navmesh_bake` deferred on purpose (async / non-deterministic headless bake; needs a maintainer semantics decision), so Group H ships 10 of the plan's ~11 tools. (#53)

### Added — Group G: UI / Control / theming (11 tools, 184 → 195)
- Adds UI/Control and theming editor tools (bridge namespaces `control.*` / `container.*` / `theme.*`) — the editor-authoring milestone — carrying the count to **195**.
  - **Six edited-scene Control mutators** (undoable via `EditorUndoRedoManager`, ungated — the `node_*` model): **`control_create`** (instance a `Control` subclass; refuses non-`Control`; seeds `text` when present), **`container_add_child`** (add a `Control` child under a `Container`; refuses a non-`Container` parent), **`control_set_anchors`**, **`control_set_layout_preset`** (name or 0..15 int via `set_anchors_and_offsets_preset`, capturing all 8 anchor/offset props for undo), **`control_set_size_flags`**, **`control_set_theme`**.
  - **Five `Theme` `.tres` file-writers** (confirm-gated like `resource_*` / `shader_create`): **`theme_create`**, **`theme_set_color`**, **`theme_set_font`**, **`theme_set_stylebox`**, **`theme_set_constant`**.
- Same quality bar: frozen `outputSchema` entries; undo for every scene mutator / confirm-gate for every file-writer; Control-subclass / `Container` / `Theme` / `Font` / `StyleBox` type-guards with clear `bad_type` errors; contract-check parity; `EXPECTED_TOOL_COUNT` 184 → 195; `docs/TOOL_CATALOG.md` gains a Group G family section (prose + 11 detail blocks) + 11 index rows. Both `operations.gd` copies byte-identical.
- Added a live-engine `AUTH_UI` probe family (13 assertions incl. a control undo/redo round-trip); the 5 theme writers added to its `GATED` set. Authoring probe 99 → 112, live-validated against a real Godot 4.7-stable editor. (#51)

### Added — `editor_undo` / `editor_redo` (2 tools, 182 → 184)
- Adds a programmatic Ctrl-Z / Ctrl-Shift-Z to the editor plane — the capability the `authoring-plane` probe's undo-stack assertion was deferred on (see the entry below). Two A/Editor tools, ungated (the `node_*` model):
  - **`editor_undo`** — step the editor's undo history one action back; **`editor_redo`** — re-apply the most recently undone action. Both default to the **edited scene's** history and take `scope: "scene" | "global"` to target the editor-wide `GLOBAL_HISTORY` instead. Each reports `{ performed, direction, action, has_undo, has_redo, history_id, scope }`; `performed` is `false` (not an error) when the end of the history is reached.
- Mechanism: the `node_*` mutators already commit through `EditorPlugin.get_undo_redo()` (an `EditorUndoRedoManager`); the new `edit.undo` / `edit.redo` bridge actions resolve the edited scene's history with `get_object_history_id(edited_root)` — the same routing those commits use — fetch the concrete `UndoRedo` with `get_history_undo_redo(id)`, and step it (`undo()` / `redo()`). That history-id choice is version-sensitive and was **validated live on Godot 4.7**: `history_id` comes back `1` (the scene history, not `GLOBAL_HISTORY`) and mutate → undo → revert → redo round-trips a real scene mutation.
- Extends **`host/test-integration/authoring-plane.integration.mjs`** with an `AUTH_UNDO` family that rounds-trips each undo archetype on a throwaway node — node creators (`add_do_reference`), scalar property setters (`add_do_property`), and resource assignments — mutate → undo → **revert** → redo → **restore**, plus a 3-deep LIFO stack test and a redo no-op guard. Each cycle touches only the action(s) it just pushed (the top of the scene history), so the forward families are undisturbed. Live-validated **41/41** on a real Godot 4.7 editor (was 32/32); the probe's `AUTH_UNDO_DEFERRED` marker is retired for `AUTH_UNDO_ASSERTED`.
- Handlers in both `addons/claude_bridge/operations.gd` copies (dispatch + `_edit_undo` / `_edit_redo` / `_edit_history_step` / `_history_id_for_scope`), parse-checked against local Godot 4.7; host registrations in `host/src/tools/editor.ts`; output schemas in `host/src/schemas.ts`; `registration.test.ts` `EXPECTED_TOOL_COUNT` 182 → 184; `docs/TOOL_CATALOG.md` (detail + index). No version bump — feature PRs leave the version stamps equal (a later release cut re-stamps them together).

### Changed — `authoring-plane` live probe expanded and promoted to a required gate (no tool change)
- The `authoring-plane` live probe was extended to cover the Groups A–D mutators (41 → 99 assertions) (#49), then promoted from experimental to a **required** CI gate — dropping `continue-on-error` (#50). The job was renamed `A-F` → `A-G` to track the live 112/112 probe as Group G landed (#52).

### Added — `authoring-plane` live CI probe for Groups E+F (no tool change)
- Delivers the first installment of the long-tracked **`authoring-plane`** live-verification job (referenced as a follow-up since the Group A batches). Two files, no tool/schema/addon change — the surface stays **182/173**:
  - **`host/test-integration/authoring-plane.integration.mjs`** — spawns the MCP host over stdio, connects to a live editor's addon bridge (`:9080`), opens `res://main.tscn`, and drives all **29 Group E+F mutators** (physics/collision + VFX/audio). Each mutation is asserted **independently** by reading the edited scene back through *separate* read tools — `node_get_children` (creators), `node_get_property` (scalar props, and resource props via `Codec.encode`'s `{__type__:"Resource",class}` tag), `project_get_setting` (`physics_set_gravity`), `resource_load` (the `.gdshader` / `.tres` file writers) — rather than trusting the mutator's own post-commit echo. Grep markers `AUTH_PHYS_*` / `AUTH_VFX_PARTICLES_*` / `AUTH_VFX_SHADER_*` / `AUTH_AUDIO_*`; a trailing `AUTH_SUMMARY pass=N/N` line and non-zero exit on any failure. The probe **mints its own fixtures** — `PlaceholderTexture2D` + `AudioStreamWAV` via `resource_create`, two `.gdshader` via `shader_create` — so no binary fixtures are committed (`.tres` native resources sidestep the import pipeline).
  - **`authoring-plane` job in `.github/workflows/integration.yml`** — mirrors `editor-plane` (Ubuntu + Xvfb + software OpenGL, Godot 4.7-stable): boots the editor, waits for `:9080`, runs the probe. Single newest-stable arm (E+F are version-stable engine features, unlike the LSP/DAP planes that matrix 4.3/4.7 for capability divergence). `continue-on-error: true` while GUI-boot timing is proven on real runners; promote to a required gate once green across a few runs (the `runtime-plane` / `csharp-plane` pattern).
- Live-validated **32/32** against a real Godot 4.7 editor and **green on the CI runner** on merge. **Undo-stack assertion is deferred**: no bridge action triggers an editor undo over `:9080` (and `contract_check`'s orphan scan forbids a caller-less bridge method), so the probe asserts **forward mutation only** (`AUTH_UNDO_DEFERRED` marker). An `editor_undo` capability that would let the probe assert mutate → undo → revert is the tracked follow-up. (#47)

## [0.13.0] — 2026-07-09

### Added — Group F (batch 3): Audio (6 tools, 176 → 182)
- Completes **Group F (VFX & audio)** with the **audio** subgroup, carrying the tool count to **182**. Six tools split across the two established models:
  - **`audio_player_create`** — add an `AudioStreamPlayer` / `AudioStreamPlayer2D` / `AudioStreamPlayer3D` node under a parent in the edited scene (`dim` selects `none` default / `2d` / `3d`), optionally seeding `stream_path` (a `res://` `AudioStream`), `autoplay`, `volume_db`, `bus`. Undoable via `EditorUndoRedoManager` and **ungated** (the `node_*` model); the node rides `add_do_reference`, the stream is a persisted disk resource (no inline reference).
  - **`audio_set_stream`** — load an `AudioStream` from a `res://` path and assign it as `stream` on an `AudioStreamPlayer/2D/3D` (undoable, ungated; feature-detects the player type, degrading to a clear `bad_type` otherwise — the `particles_set_texture` pattern).
  - **`audio_bus_add`** — add a bus to the global `AudioServer` layout (optional `name`, `at_position`, `send`). Project-wide (not scene-undoable), so **gated** by confirmation like `physics_set_gravity`.
  - **`audio_bus_add_effect`** — instantiate an `AudioEffect` subclass by class name (validated via `ClassDB.can_instantiate` + `is_parent_class("AudioEffect")`) and add it to a named bus. **Gated** (project-wide).
  - **`audio_bus_set_volume`** — set a named bus's `volume_db` on the `AudioServer`. **Gated** (project-wide).
  - **`audio_set_bus_layout`** — persist the current `AudioServer` bus layout (buses, effects, volumes) to a `.tres` on disk (default `res://default_bus_layout.tres`) via `generate_bus_layout` + `ResourceSaver.save`. **Gated** (writes a file).
- Same quality bar: the `AudioServer` bus API (`add_bus` / `set_bus_name` / `get_bus_index` / `set_bus_send` / `set_bus_volume_db` / `add_bus_effect` / `get_bus_effect_count` / `generate_bus_layout` / `set_bus_layout`), the `AudioEffect` `ClassDB` instantiation, and the player `stream` / `autoplay` / `volume_db` / `bus` props were probed live on Godot 4.7 (set + read-back on typed locals — no `get_property_list` / RefCounted `.free()`), and an `AudioStreamPlayer` carrying an external `AudioStream` (`autoplay` / `volume_db` / `bus` set) survives a `.tscn` save + fresh reload. Handlers in both `addons/claude_bridge/operations.gd` copies (dispatch + `_audio_player_create` / `_audio_set_stream` / `_audio_bus_add` / `_audio_bus_add_effect` / `_audio_bus_set_volume` / `_audio_set_bus_layout`, plus the `_is_audio_player` helper), statically parse-checked against local Godot 4.7; host registrations in `host/src/tools/editor.ts` (the four `AudioServer` tools reuse the `gate` confirm pattern); output schemas in `host/src/schemas.ts`; `registration.test.ts` `EXPECTED_TOOL_COUNT` 176 → 182; `docs/TOOL_CATALOG.md` (Group F header + detail + index). No version bump — the E+F release cut re-stamps all five version stamps together.

### Added — Group F (batch 2): Shaders (5 tools, 171 → 176)
- Continues **Group F (VFX & audio)** with the **shaders** subgroup. Five tools split across the two established models:
  - **`shader_create`** — create a `Shader` with optional initial GDShader `code` and save it as a `.gdshader` resource at a `res://` path. Writes a file, so **gated** by confirmation (the `resource_*` / `tileset_*` model), not the in-scene model.
  - **`shader_set_code`** — replace the source of an existing `.gdshader` and re-save. **Gated** (writes a file); feature-checks that the target loads as a `Shader`.
  - **`shadermaterial_create`** — create a `ShaderMaterial` and assign it to a node's material slot in the edited scene, undoable via `EditorUndoRedoManager` and **ungated**. Feature-detects the slot: `CanvasItem.material` (2D / Control) vs `GeometryInstance3D.material_override` (3D); a node with neither degrades to a clear `unsupported`. Optionally binds a `Shader` loaded from a `res://` path (rides `add_do_property` + `add_do_reference`).
  - **`shadermaterial_set_shader`** — load a `Shader` from a `res://` path and assign it to an existing `ShaderMaterial` on the node's slot (undoable). No `add_do_reference` — the shader is a persisted disk resource (the `particles_set_texture` pattern).
  - **`shadermaterial_set_param`** — set a shader uniform through the `shader_parameter/<name>` property path (undoable via `add_do_property` / `add_undo_property`); the value uses the tagged-Variant convention (`Codec.decode` in, `Codec.encode` out).
- Quality bar held: `Shader` / `ShaderMaterial` / `set_shader_parameter` and the `shader_parameter/<name>` property-path form were probed live on Godot 4.7 (set + read-back on typed locals — no `get_property_list` / RefCounted `.free()`), and a `Sprite2D` carrying a `ShaderMaterial` (external `.gdshader` + a `shader_parameter` override) survives a `.tscn` save + fresh reload. Handlers in both `addons/claude_bridge/operations.gd` copies (dispatch + `_shader_create` / `_shader_set_code` / `_shadermaterial_create` / `_shadermaterial_set_shader` / `_shadermaterial_set_param`, plus the `_material_prop` helper), statically parse-checked against local Godot 4.7; host registrations in `host/src/tools/editor.ts` (the two `shader_*` writers reuse the `gate` confirm pattern); output schemas in `host/src/schemas.ts`; `registration.test.ts` `EXPECTED_TOOL_COUNT` 171 → 176; `docs/TOOL_CATALOG.md` (Group F header + detail + index). No version bump — the E+F release cut re-stamps all five version stamps together.

### Added — Group F (batch 1): GPU particles (6 tools, 165 → 171)
- Starts **Group F (VFX & audio)** from the editor-authoring roadmap with the **GPU particles** subgroup. Six A/Editor
  tools, all mutating the edited scene, undoable via `EditorUndoRedoManager`, and **ungated** (the `node_*` model):
  - **`particles_create`** — add a `GPUParticles2D`/`GPUParticles3D` node (`dim` 2d default / 3d), optionally seeding `amount` (> 0), `lifetime` (> 0), `emitting`.
  - **`particles_set_process_material`** — create a `ParticleProcessMaterial` and assign it as `process_material` (GPU particles need one to emit): `gravity`/`direction` (Vector3), `spread`, `initial_velocity_min`/`_max`, `scale_min`/`_max`, `color`.
  - **`particles_set_amount`** — set `amount` (> 0).
  - **`particles_set_lifetime`** — set `lifetime` in seconds (> 0).
  - **`particles_set_emitting`** — toggle `emitting`.
  - **`particles_set_texture`** — load a `Texture2D` from a `res://` path onto a `GPUParticles2D`'s `texture`. Feature-detects: `GPUParticles3D` has no `texture` (it draws meshes) and degrades to a clear `unsupported`.
- Same quality bar as the earlier groups: node authoring uses the `node_add` do/undo-reference pattern; the new
  `ParticleProcessMaterial` rides along via `add_do_reference`; property mutators use `add_do_property` /
  `add_undo_property`. The `GPUParticles2D/3D` property surface (`amount`/`lifetime`/`emitting`/`process_material`, and
  the **2D-only** `texture`) and the `ParticleProcessMaterial` knobs were probed live on Godot 4.7 before design.
  Handlers in both `addons/claude_bridge/operations.gd` copies (dispatch + `_particles_create` /
  `_particles_set_process_material` / `_particles_set_amount` / `_particles_set_lifetime` / `_particles_set_emitting` /
  `_particles_set_texture`, plus `_is_particles` / `_to_color` helpers), statically parse-checked against local Godot
  4.7; host registrations in `host/src/tools/editor.ts`; output schemas in `host/src/schemas.ts`;
  `registration.test.ts` `EXPECTED_TOOL_COUNT` 165 → 171; `docs/TOOL_CATALOG.md` (new Group F section + index). No
  version bump — the E+F release cut re-stamps all five version stamps together.

### Added — Group E (batch 2): Areas, joints, collision polygons, rigidbody & material tuning (8 tools, 157 → 165)
- Completes **Group E (Physics & collision)** from the editor-authoring roadmap — batch 2 carries the tool count past
  godot-mcp-pro's 162-tool ceiling to **165**. Eight A/Editor tools: seven mutate the edited scene, are undoable via
  `EditorUndoRedoManager`, and **ungated** (the `node_*` model); one writes ProjectSettings and is **gated** like
  `project_set_setting`:
  - **`area_set_monitoring`** — set `monitoring` / `monitorable` on an `Area2D/3D`.
  - **`area_set_gravity`** — set an `Area2D/3D`'s local gravity override: `space_override`, magnitude, direction, point.
  - **`joint_create`** — add a joint node via `type` × `dim` (2D: `PinJoint2D`/`GrooveJoint2D`/`DampedSpringJoint2D`; 3D: `PinJoint3D`/`HingeJoint3D`/`SliderJoint3D`/`ConeTwistJoint3D`/`Generic6DOFJoint3D`), optionally wiring `node_a`/`node_b`.
  - **`joint_set_bodies`** — set `node_a` / `node_b` on an existing `Joint2D/3D`.
  - **`collisionpolygon_add`** — add a `CollisionPolygon2D/3D` from a 2D outline (3D extruded by `depth`; 2D `build_mode`).
  - **`rigidbody_set_properties`** — tune a `RigidBody2D/3D`: `mass` (> 0), `gravity_scale`, `linear_damp`, `angular_damp`.
  - **`body_set_physics_material`** — create a `PhysicsMaterial` and assign it as `physics_material_override` on a StaticBody/RigidBody (2D/3D): `friction`, `bounce`, `rough`, `absorbent`.
  - **`physics_set_gravity`** — write project `physics/{2d,3d}/default_gravity` (+ `default_gravity_vector`); `save` persists to `project.godot`. Gated.
- Same quality bar as the earlier groups: in-scene node authoring uses the `node_add` do/undo-reference pattern; property
  mutators use `add_do_property` / `add_undo_property`; the new `PhysicsMaterial` rides along via `add_do_reference`.
  The eight joint classes (2D+3D), Area `monitoring`/`monitorable` + gravity props, RigidBody props, `CollisionPolygon2D/3D`
  (`polygon` is a `PackedVector2Array` for both dims), `PhysicsMaterial` + `physics_material_override`, and the four
  `physics/{2d,3d}/default_gravity(_vector)` ProjectSettings keys were probed live on Godot 4.7 before design; the real
  `operations.gd` helpers were unit-exercised, and a `Root → StaticBody2D(PhysicsMaterial) + PinJoint2D(node_a/node_b) +
  CollisionPolygon2D` scene was packed to a `.tscn`, saved, and reloaded — the joint NodePaths, the inline material
  (friction/bounce), and the polygon all survive the round-trip. Handlers in both `addons/claude_bridge/operations.gd`
  copies (dispatch + `_area_set_monitoring` / `_area_set_gravity` / `_joint_create` / `_joint_set_bodies` /
  `_collisionpolygon_add` / `_rigidbody_set_properties` / `_body_set_physics_material` / `_physics_set_gravity`),
  statically parse-checked against local Godot 4.7; host registrations in `host/src/tools/editor.ts`
  (`physics_set_gravity` gated); output schemas in `host/src/schemas.ts`; `registration.test.ts` `EXPECTED_TOOL_COUNT`
  157 → 165; `docs/TOOL_CATALOG.md` (Group E section + index). `contract_check` 165; host tests 173. No version bump —
  the E+F release cut re-stamps all five version stamps together.

### Added — Group E (batch 1): Physics bodies & collision shapes (4 tools, 153 → 157)
- Starts **Group E (Physics & collision)** from the editor-authoring roadmap — the group that crosses
  godot-mcp-pro's 162-tool ceiling (at ~166 once the group lands). Four A/Editor tools that author physics
  nodes in the edited scene, all in-scene, undoable via `EditorUndoRedoManager`, and **ungated** (the
  `node_*` / `tilemap_*` model, not the disk-writing gated `tileset_*` model):
  - **`body_create`** — add a `StaticBody` / `RigidBody` / `CharacterBody` / `Area` node (2D or 3D via `dim`) under a parent.
  - **`collisionshape_add`** — add a `CollisionShape2D` / `CollisionShape3D` carrying a shape resource: `rect` (Rectangle/Box), `circle` (Circle/Sphere), `capsule` (Capsule 2D/3D), or `polygon` (ConvexPolygon 2D/3D).
  - **`body_set_collision_layer`** / **`body_set_collision_mask`** — set the `collision_layer` / `collision_mask` bitmask on any body or area (`CollisionObject2D/3D`).
- Same quality bar as Groups A–D: bodies/shapes go through the `node_add` do/undo reference pattern, layer/mask
  through `add_do_property` / `add_undo_property`. The `StaticBody/RigidBody/CharacterBody/Area` (2D+3D),
  `CollisionShape2D/3D`, and `RectangleShape2D / CircleShape2D / CapsuleShape2D / ConvexPolygonShape2D` +
  `BoxShape3D / SphereShape3D / CapsuleShape3D / ConvexPolygonShape3D` APIs were probed live on Godot 4.7
  before design, and a `Node2D → StaticBody2D → CollisionShape2D(RectangleShape2D)` scene was packed to a
  `.tscn`, saved, and reloaded — the body's `collision_layer` and the shape (type + `size`) survive the
  round-trip; the shape-building helpers were unit-exercised against a live `operations.gd` instance. Handlers
  in both `addons/claude_bridge/operations.gd` copies (dispatch + `_body_create` / `_collisionshape_add` /
  `_body_set_collision_layer` / `_body_set_collision_mask`), statically parse-checked against local Godot 4.7;
  host registrations in `host/src/tools/editor.ts`; output schemas in `host/src/schemas.ts`;
  `registration.test.ts` `EXPECTED_TOOL_COUNT` 153 → 157; `docs/TOOL_CATALOG.md` (Group E section + index).
  `contract_check` 157; host tests 173. No version bump — Group E completes across batches, then the E+F release cut.

## [0.12.0] — 2026-07-08

### Added — Group D (batch 2): TileMapLayer + cell painting (5 tools, 148 → 153)
- Completes **Group D (TileMap/TileSet)** from the editor-authoring roadmap. Five D/Editor tools that author a
  `TileMapLayer` node in the edited scene and paint its cells — the in-scene counterpart to batch 1's disk-backed
  `tileset_*` writers:
  - **`tilemaplayer_create`** — add a `TileMapLayer` node under a parent, optionally binding a TileSet `.tres` (e.g. from `tileset_create`) as its `tile_set`.
  - **`tilemap_set_cell`** — paint (or erase, with `source_id` -1) a single cell by `coords`, `source_id`, `atlas_coords`, `alternative`.
  - **`tilemap_set_cells_rect`** — fill a rectangular region `[x, y, w, h]` with one tile in a single undoable action (capped at 65536 cells).
  - **`tilemap_get_cell`** — read a cell; an empty cell reports `source_id` -1 / `atlas_coords` [-1, -1] / `alternative` 0 (`empty: true`).
  - **`tilemap_clear`** — remove every painted cell; undo restores the prior cells.
- Same quality bar as the rest of Groups A–C: every mutator goes through `EditorUndoRedoManager` (undoable) and is
  **ungated** — an in-scene mutation like `node_*` / `anim_*`, not the disk-writing gated model of `tileset_*`.
  `set_cell`/`set_cells_rect`/`clear` capture the prior per-cell state (source/atlas/alternative) for exact undo.
  The `TileMapLayer` API (`set_cell` / `get_cell_source_id` / `get_cell_atlas_coords` / `get_cell_alternative_tile`
  / `clear` / `get_used_cells`) was probed live on Godot 4.7 before design, and the create → set_cell → get_cell →
  clear chain (plus a `.tscn` save/reload round-trip of the painted cells) was verified end-to-end. Handlers in both
  `addons/claude_bridge/operations.gd` copies (dispatch + `_tilemaplayer_create` / `_tilemap_*`), statically
  parse-checked against local Godot 4.7; host registrations in `host/src/tools/editor.ts`; output schemas in
  `host/src/schemas.ts`; `registration.test.ts` `EXPECTED_TOOL_COUNT` 148 → 153; `docs/TOOL_CATALOG.md`
  (detail + index). `contract_check` 153; host tests 173. `TileMapLayer` supersedes the deprecated `TileMap` node in
  Godot 4.x. Group D is now complete; the Group C+D release cut follows.

### Added — Group D (batch 1): TileSet authoring — TileSet / atlas source / tile / collision (4 tools, 144 → 148)
- First family of **Group D (TileMap/TileSet)** from the editor-authoring roadmap (unblocked by Group B —
  `TileSet` is a Resource). Four D/Editor `tileset_*` tools over the editor bridge, schema-enforced, that author
  a disk-backed `.tres` `TileSet` (load → mutate → re-save; no scene needs to be open):
  - **`tileset_create`** — instantiate a `TileSet` and save it as a new `.tres`; optional base `tile_size` (default 16×16 px).
  - **`tileset_add_source`** — add a `TileSetAtlasSource` backed by a `Texture2D`; `texture_region_size` defaults to the tile size, `source_id` -1 auto-assigns; optional atlas `margins` / `separation`.
  - **`tileset_add_tile`** — create a tile at `atlas_coords` (in cells) in an atlas source; optional multi-cell `size` (default 1×1).
  - **`tileset_set_tile_collision`** — add a collision polygon (≥3 tile-local points) to a tile on a numbered physics layer (created on demand); optional `one_way`.
- All four are **file-writing → elicitation-gated** (the disk-writing `resource_*` / `filesystem_*` precedent,
  not the in-scene undoable `node_*` / `anim_*` model). The `TileSet` / `TileSetAtlasSource` / `TileData` API
  surface was probed live on Godot 4.7 before design, and the create → add_source → add_tile → set_collision
  chain was verified end-to-end through a `.tres` save/reload round-trip. Handlers in both
  `addons/claude_bridge/operations.gd` copies (dispatch + `_tileset_*`), statically parse-checked against local
  Godot 4.7; host registrations in `host/src/tools/editor.ts`; output schemas in `host/src/schemas.ts`;
  `registration.test.ts` `EXPECTED_TOOL_COUNT` 144 → 148; `docs/TOOL_CATALOG.md` (detail + index).
  `contract_check` 148; host tests 173. Group D batch 2 (`tilemaplayer_create` + `tilemap_*`) is next, then the
  Group C+D release cut.

### Added — Group C (batch 2): animation state machines — AnimationTree + StateMachine (4 tools, 140 → 144)
- Completes **Group C (Animation)** from the editor-authoring roadmap. Four C/Editor `anim_*` tools that author an
  `AnimationTree` node and its `tree_root` graph, schema-enforced and undoable:
  - **`anim_tree_create`** — add an `AnimationTree` node with a fresh `tree_root` (`AnimationNodeBlendTree` or `AnimationNodeStateMachine`); created inactive, optionally wired to an `AnimationPlayer` via `anim_player`.
  - **`anim_tree_add_node`** — add any `AnimationNode` subclass to the tree_root graph (blend tree or state machine); binds a clip for `AnimationNodeAnimation`.
  - **`anim_statemachine_add_state`** — add a state (default `AnimationNodeAnimation`) to a state machine — the `tree_root`, or a nested state-machine node.
  - **`anim_statemachine_add_transition`** — connect two states with an `AnimationNodeStateMachineTransition` (xfade time, switch mode, advance mode/condition, priority).
- Same quality bar as batch 1: every mutation goes through `EditorUndoRedoManager` (undoable; nothing written to
  disk), ungated (in-scene mutation, like `node_*`). The `AnimationTree` / `AnimationNode*` API surface was probed
  live on Godot 4.7 before design. Handlers in both `addons/claude_bridge/operations.gd` copies (dispatch +
  `_anim_tree_*` / `_anim_statemachine_*`), statically parse-checked against local Godot 4.7; host registrations in
  `host/src/tools/editor.ts`; output schemas in `host/src/schemas.ts`; `registration.test.ts`
  `EXPECTED_TOOL_COUNT` 140 → 144; `docs/TOOL_CATALOG.md` (detail + index). `contract_check` 144; host tests 173.
  Group C complete; a release cut follows after Group D.

### Added — Group C (batch 1): animation authoring — AnimationPlayer + Animation (10 tools, 130 → 140)
- First family of **Group C (Animation)** from the editor-authoring roadmap (unblocked by Group B — animations
  are Resources). Ten C/Editor `anim_*` tools over the editor bridge, schema-enforced, authoring an in-scene
  `AnimationPlayer` (animations live in its `AnimationLibrary` resources, addressed as `animation` within a
  `library`, default `""`):
  - **`anim_player_create`** — add an `AnimationPlayer` node (undoable); seeds an empty default library so `anim_create` works immediately.
  - **`anim_create`** / **`anim_delete`** — create / remove a named `Animation` in a library (undoable; delete is elicitation-gated).
  - **`anim_add_track`** — add a track (value / position_3d / rotation_3d / scale_3d / blend_shape / method / bezier / audio / animation) and set its target path; returns the new track index.
  - **`anim_insert_key`** / **`anim_remove_key`** — insert / remove keyframes (Variant values through the JSON codec).
  - **`anim_set_length`** / **`anim_set_loop`** — set an animation's length and loop mode (none / linear / pingpong).
  - **`anim_get_track_keys`** / **`anim_list`** — read a track's keyframes / list a player's animations across libraries. Read-only.
- Every mutation goes through `EditorUndoRedoManager` (undoable; nothing written to disk) — the `node_*`
  precedent, not the disk-writing `resource_*` / `filesystem_*` gating. Only `anim_delete` is elicitation-gated
  (it discards an animation, like `node_delete`). Handlers in both `addons/claude_bridge/operations.gd` copies
  (dispatch + `_anim_*`), statically parse-checked against local Godot 4.7; host registrations in
  `host/src/tools/editor.ts`; output schemas in `host/src/schemas.ts`; `registration.test.ts`
  `EXPECTED_TOOL_COUNT` 130 → 140; `docs/TOOL_CATALOG.md` (detail + index). `contract_check` 140; host tests
  173. First of Group C; the `AnimationTree` / state-machine family follows, then a release cut after Group D.

### Fixed
- **Editor bridge loads on Godot 4.3 again.** `_scene_list_open` and `_scene_close` (added in #33) called
  `EditorInterface.get_unsaved_scenes()` and `EditorInterface.close_scene()` — both Godot 4.4+ APIs. Because a
  literal call is resolved at *parse* time, their presence made the entire `operations.gd` addon fail to compile
  on Godot 4.3, taking the whole editor plane down (not just those two tools). Both call sites are now
  feature-detected via `EditorInterface.has_method(...)` and invoked dynamically via `EditorInterface.call(...)`
  — the same idiom `runtime_bridge.gd` already uses for the 4.5+ logger APIs. On Godot 4.3: `scene_list_open`
  returns `unsaved: []` plus a new `unsaved_supported: false` flag; `scene_close` returns an `unsupported`
  error. Godot 4.4+ behavior is unchanged and no tools were added or removed (still 130). Un-reds the
  experimental `editor-plane` Godot 4.3 job.

## [0.11.0] — 2026-07-08

Lands **Group B of the editor-authoring roadmap** — the Resources & FileSystem layer that unblocks Groups
C–F (animation, tilesets, shaders, and audio are all Resources). Two families since 0.10.0: `resource_*`
(#35) and `filesystem_*` (#36). Tool count **118 → 130** (new `resource_*` family of 8, new `filesystem_*`
family of 4); host tests **173**; `scripts/contract_check.py` green at **130**. Every file-writing op is
elicitation-gated — matching the `scene_pack`/`scene_save_as` precedent for disk mutations that fall
outside `EditorUndoRedoManager` — while reads stay ungated; the import tools feature-detect the `.import`
sidecar. Every version stamp (`host/package.json` + lockfile, `index.ts` serverInfo, both `plugin.cfg`,
both `operations.gd` `ADDON_VERSION`) is now **0.11.0** — a minor bump (new tool surface, no breaking
changes). The live `authoring-plane` CI probe for the Group A/B mutators remains a tracked follow-up.

### Added — Group B (batch 2): filesystem (4 tools, 126 → 130)
- Completes **Group B (Resources & FileSystem)** with the `filesystem_*` family. Four A/Editor tools,
  schema-enforced, in lockstep with `scripts/contract_check.py` (130), `registration.test.ts`
  (`EXPECTED_TOOL_COUNT` 126 → 130), and `docs/TOOL_CATALOG.md`:
  - **`filesystem_list`** — list a project directory's subdirectories and files (hidden entries like `.godot` skipped). Read-only.
  - **`filesystem_scan`** — trigger an editor rescan so newly added or externally-changed files are picked up.
  - **`filesystem_move`** — move or rename a file/directory (carrying its `.import` sidecar) and rescan; **destructive** (moves on disk; does not remap references in other resources), elicitation-gated.
  - **`filesystem_create_dir`** — create a directory recursively and rescan; no-op if it already exists.
- Handlers in both `addons/claude_bridge/operations.gd` copies (dispatch + `_filesystem_*`), statically parse-checked against local Godot 4.7; host registrations in `host/src/tools/editor.ts`; output schemas in `host/src/schemas.ts`. Built on `DirAccess`, `FileAccess`, and `EditorInterface.get_resource_filesystem()`. Lands Group B; a minor release cut follows.

### Added — Group B (batch 1): resources (8 tools, 118 → 126)
- First family of **Group B (Resources & FileSystem)** from the editor-authoring roadmap — the layer that
  unblocks Groups C–F (animation/tileset/shader/audio are all Resources). Eight A/Editor tools,
  schema-enforced, in lockstep with `scripts/contract_check.py` (126), `registration.test.ts`
  (`EXPECTED_TOOL_COUNT` 118 → 126), and `docs/TOOL_CATALOG.md`:
  - **`resource_create`** — instantiate a Resource subclass (with optional initial properties) and save it as a new file; **destructive** (writes a file), elicitation-gated.
  - **`resource_load`** — load a resource and return its class, `resource_name`, and inspector-visible property list. Read-only.
  - **`resource_save`** — load and (re-)save a resource, optionally to a new path and with `ResourceSaver` flags; **destructive** (writes a file), elicitation-gated.
  - **`resource_duplicate`** — duplicate a resource (optionally deep, cloning subresources) to a new path; **destructive** (writes a file), elicitation-gated.
  - **`resource_get_property`** / **`resource_set_property`** — read or write a single resource property by name (tagged-Variant values). Set is **destructive** (writes a file), elicitation-gated.
  - **`resource_get_import_settings`** / **`resource_set_import_settings`** — read an asset's `.import` metadata (importer + params), or update those params and reimport. Set is **destructive** (rewrites metadata + reimports), elicitation-gated; both feature-detect the `.import` sidecar.
- Handlers added to both `addons/claude_bridge/operations.gd` copies (dispatch + `_resource_*`), statically parse-checked against local Godot 4.7; host registrations in `host/src/tools/editor.ts`; output schemas in `host/src/schemas.ts`. Built on `ResourceLoader`/`ResourceSaver`, `ClassDB`, and `ConfigFile` for import metadata. File-writing ops are elicitation-gated rather than `EditorUndoRedoManager`-undoable (they mutate disk, like `scene_pack`/`scene_save_as`).

## [0.10.0] — 2026-07-08

Lands **Group A of the editor-authoring roadmap** — the full scene-graph authoring foundation, the biggest
single authoring jump in the project. Four batches of A/Editor tools since 0.9.0: node-graph depth
(#31), node-depth authoring (#32), scene depth (#33), and signals (#34), plus the `csharp-plane` release-pinning hardening (#30). Tool count **93 → 118** (`node_*` 6 → 13, `scene_*`
4 → 10, new `signal_*` family of 6); host tests **173**; `scripts/contract_check.py` green at **118**.
Every mutator is undoable via `EditorUndoRedoManager` and every destructive op elicitation-gated, holding
the same undo-and-gating discipline across the new surface. Every version stamp (`host/package.json` + lockfile,
`index.ts` serverInfo, both `plugin.cfg`, both `operations.gd` `ADDON_VERSION`) is now **0.10.0** — a
minor bump (new tool surface, no breaking changes). The live `authoring-plane` CI probe for the Group A
mutators remains a tracked follow-up.

### Added — Group A (batch 4): signals (6 tools, 112 → 118)
- New `signal_*` family from the editor-authoring roadmap — completing Group A's authoring surface. Six
  A/Editor tools, schema-enforced and (where they mutate) undoable via `EditorUndoRedoManager`, in
  lockstep with `scripts/contract_check.py` (118), `registration.test.ts` (`EXPECTED_TOOL_COUNT`
  112 → 118), and `docs/TOOL_CATALOG.md`:
  - **`signal_list`** / **`signal_list_connections`** — enumerate a node's signals (names + argument names), or its outgoing connections (signal, target path, method, flags). Read-only.
  - **`signal_connect`** / **`signal_disconnect`** — wire a source signal to a target method, or unwire it (undoable). Connections default to `CONNECT_PERSIST` (flags=2) so they save into the scene; disconnect restores the original flags on undo.
  - **`signal_add_user_signal`** — declare a new user signal with optional typed arguments (undoable via `remove_user_signal`); errors if it already exists.
  - **`signal_emit`** — emit a signal at edit-time, firing connected callables now; **destructive** (edit-time side effects), elicitation-gated.
- Handlers added to both `addons/claude_bridge/operations.gd` copies (dispatch + `_signal_*`); host registrations in `host/src/tools/editor.ts`; output schemas in `host/src/schemas.ts`. Built on Godot 4.7 `Object` signal APIs (`get_signal_list`, `get_signal_connection_list`, `connect`/`disconnect`, `add_user_signal`/`remove_user_signal`, `emit_signal`). This lands the last of Group A; a minor release cut follows.

### Added — Group A (batch 3): scene depth (6 tools, 106 → 112)
- Extends the `scene_*` family from the editor-authoring roadmap. Six A/Editor tools, schema-enforced,
  in lockstep with `scripts/contract_check.py` (112), `registration.test.ts` (`EXPECTED_TOOL_COUNT`
  106 → 112), and `docs/TOOL_CATALOG.md`:
  - **`scene_list_open`** — list open scene paths, the current one, and which have unsaved changes (read-only).
  - **`scene_reload`** — reload a scene from disk; **destructive** (discards unsaved changes), elicitation-gated.
  - **`scene_close`** — close the current scene tab; **destructive** (discards unsaved changes), elicitation-gated (only the current scene closes; an optional `path` asserts which).
  - **`scene_pack`** — save a node branch as a new `PackedScene` file (editor "Save Branch as Scene"); **destructive** (writes a file), elicitation-gated. Packs a detached duplicate, so the edited scene is never mutated.
  - **`scene_get_dependencies`** — list a scene file's external resource dependencies (read-only).
  - **`scene_save_as`** — save the current scene to a new res:// path (Save As); **destructive** (writes a file), elicitation-gated.
- Handlers added to both `addons/claude_bridge/operations.gd` copies (dispatch + `_scene_*`); host registrations in `host/src/tools/editor.ts`; output schemas in `host/src/schemas.ts`. `scene_close`/`scene_reload` use Godot 4.7 `EditorInterface.close_scene()` / `reload_scene_from_path()`. No release cut.

### Added — Group A (batch 2): node-depth authoring (7 tools, 99 → 106)
- Completes the `node_*` depth surface from the editor-authoring roadmap. Seven A/Editor tools, all
  schema-enforced and — where they mutate — undoable via `EditorUndoRedoManager`, in lockstep with
  `scripts/contract_check.py` (106), `registration.test.ts` (`EXPECTED_TOOL_COUNT` 99 → 106), and
  `docs/TOOL_CATALOG.md`:
  - **`node_instantiate_scene`** — instance an external `PackedScene` as an editable child of a parent (undoable; instanced with `GEN_EDIT_STATE_INSTANCE`).
  - **`node_move_child`** — reorder a node among its siblings by index (undoable; negative indices count from the end).
  - **`node_change_type`** — replace a node with a different class via `Node.replace_by`, carrying over compatible storage properties, children, and groups (undoable; refuses the scene root).
  - **`node_set_owner`** — set a node's owner ancestor (undoable); ownership decides which scene a node saves into.
  - **`node_call_method`** — invoke a method on an edited-scene node; **destructive** (arbitrary invocation, not undoable), elicitation-gated.
  - **`node_get_path`** / **`node_list_properties`** — read a node's path/index/parent metadata, or its inspector-visible property list (name, Variant type, class_name, usage). Read-only.
- Handlers added to both `addons/claude_bridge/operations.gd` copies (dispatch + `_node_*`); host registrations in `host/src/tools/editor.ts`; output schemas in `host/src/schemas.ts`. No release cut; the live `authoring-plane` CI probe for the Group A mutators remains a tracked follow-up.

### Added — Group A (batch 1): node-graph authoring depth (6 tools, 93 → 99)
- First installment of the editor-authoring roadmap (Group A). Six A/Editor authoring tools, all
  schema-enforced and — where they mutate — undoable via `EditorUndoRedoManager`, in lockstep with
  `scripts/contract_check.py` (99), `registration.test.ts` (`EXPECTED_TOOL_COUNT` 93 → 99), and
  `docs/TOOL_CATALOG.md`:
  - **`node_duplicate`** — duplicate a node and its subtree under the same parent (undoable; child owners re-set so the copy persists on save).
  - **`node_get_children`** / **`node_find`** — list a node's direct children, or search descendants by class (`is_class`) and/or a case-insensitive name substring.
  - **`node_list_groups`** / **`node_add_to_group`** / **`node_remove_from_group`** — read and edit a node's group membership (add/remove undoable, persistent; no-op when already/not a member).
- Handlers added to both `addons/claude_bridge/operations.gd` copies (dispatch + `_node_*`); host registrations in `host/src/tools/editor.ts`; output schemas in `host/src/schemas.ts`. No release cut; a live `authoring-plane` CI probe for the new mutators is tracked as a follow-up.

### Changed — `csharp-plane` pins OmniSharp / netcoredbg to known-good releases (CI hardening, no tool change)
- The required `csharp-plane` gate installed OmniSharp and netcoredbg from `releases/latest/download/…`.
  As a **required** gate that left the job hostage to upstream: an asset rename — or a bad `latest` —
  would block **every** merge. Both are now pinned via job-level env vars to the tags green on the gate
  as of the 0.9.0 cut — **OmniSharp `v1.39.15`** and **netcoredbg `3.2.0-1092`** — which is exactly what
  `releases/latest` resolved to, so behavior is unchanged today while merges are insulated from upstream
  churn. Bump the pins deliberately after a green run. The binaries still resolve via `find`, so a rename
  even at a pinned tag still fails loudly (empty-var) rather than silently. CI-only; no tool/host change,
  `scripts/contract_check.py` unaffected at 93.

## [0.9.0] — 2026-07-07

Folds the two C#/.NET-plane surfaces cut since 0.8.0 into a release: the **C# LSP mutators** (`cs_rename`
/ `cs_code_action`, #27) and the **C# debugging extras** (`cs_dbg_watch` / `cs_dbg_set_exception_breakpoints`
/ `cs_dbg_restart`, #29). Tool count **88 → 93**; host tests **160 → 173**; `scripts/contract_check.py`
green at **93**. This cycle also **promoted the `csharp-plane` integration job to a required gate** (#28),
so a live C#/.NET regression now blocks a merge. Every version stamp (`host/package.json` + lockfile,
`index.ts` serverInfo, both `plugin.cfg`, both `operations.gd` `ADDON_VERSION`) is now **0.9.0** — a minor
bump per `docs/D4_CSHARP_PLAN.md` (new tool surface, no breaking changes).

### Added — D4 C# debugging extras (`cs_dbg_watch`, `cs_dbg_set_exception_breakpoints`, `cs_dbg_restart`)
- The `cs_dbg_*` plane gains the three GDScript `dbg_*` extras that **netcoredbg actually backs**,
  mirroring the read/inspect surface it already had. Tool count **90 → 93**.
- **`cs_dbg_watch`** — manage a persistent set of C# watch expressions and re-evaluate them in the
  current stopped frame (DAP `watch` context, side-effect-free, so **not** gated). Each expression's
  `evaluate` is bounded by `GODOT_CSDAP_EVALUATE_TIMEOUT_MS`, so a stalling watch fails fast on its own
  entry instead of hanging the stop — the same discipline as `cs_dbg_evaluate` and the GDScript plane.
- **`cs_dbg_set_exception_breakpoints`** — enable (replace) exception breakpoint filters so execution
  halts on a thrown .NET exception (DAP `setExceptionBreakpoints`). netcoredbg advertises `all` and
  `user-unhandled`; the result echoes the active `filters` and the `available_filters`. Not gated;
  feature-detected — on an adapter advertising no `exceptionBreakpointFilters` it returns a clear
  "unsupported" message without sending anything.
- **`cs_dbg_restart`** — restart the session, using the DAP `restart` request when advertised and
  otherwise `terminate` + a fresh handshake. netcoredbg advertises no `supportsRestartRequest`, so the
  relaunch path runs; `method` reports which ran. Reuses the last launch/attach params (`stop_on_entry`
  / `program` / `args` override). C# sessions have no scene, so — unlike `dbg_restart` — there is no
  `scene` field.
- **Deliberately not ported:** `dbg_goto` and `dbg_data_breakpoints`. netcoredbg advertises neither
  `supportsGotoTargetsRequest` nor `supportsDataBreakpoints`, so `cs_dbg_goto` / `cs_dbg_data_breakpoints`
  would only ever return "unsupported" — dead surface, so they are left out. Confirmed from the live
  `C#_DAP_REACHED` capability dump in the `csharp-plane` CI probe.
- **Client additions.** `CsDapClient` gains the watch-set methods (`addWatches` / `removeWatches` /
  `clearWatches` / `evaluateWatches`, reusing the exported `WatchResult`) and a `restart()` (terminate +
  relaunch fallback), mirroring the GDScript `DapClient`; exception breakpoints need no client method
  (the tool drives `request` + capabilities directly).
- **Contract kept in lockstep.** `schemas.ts` (frozen `outputSchema` for the three tools),
  `host/test/registration.test.ts` (`EXPECTED_TOOL_COUNT` 90 → 93) and `docs/TOOL_CATALOG.md` (three
  detail entries + three index rows + updated plane header) all updated in the same change;
  `scripts/contract_check.py` green at **93↔93**. Host tests **166 → 173** (`host/test/csdap.test.ts`:
  watch add/error/remove/clear, exception-breakpoints enable + unsupported-feature-detect, restart
  relaunch-fallback / native-restart / no-session).

### Added — D4 C# LSP mutators (`cs_rename`, `cs_code_action`)
- The last deferred C#-plane surface from the D4 C2 plan: the two OmniSharp LSP **mutators**, mirroring
  the GDScript `gd_rename` / `gd_code_action`. Tool count **88 → 90**.
- **`cs_rename`** — rename a C# symbol project-wide via OmniSharp `textDocument/rename`. Returns the
  planned edit by default (dry run); `apply: true` writes the edits to disk and is **elicitation-gated**
  (with a `confirm: true` override and a safe block on clients that can't prompt), exactly like
  `gd_rename`. Handles both WorkspaceEdit encodings — the legacy `changes` map **and** OmniSharp's
  `documentChanges` (versioned `TextDocumentEdit[]`) — via a shared `normalizeWorkspaceEdit` helper.
- **`cs_code_action`** — list the code actions (quick fixes / refactors) OmniSharp offers for a range,
  read-only (returns `title` / `kind` / `has_edit` / `command` without applying). Unlike Godot's
  GDScript server (which advertises `codeActionProvider: false`), OmniSharp implements code actions, so
  this returns real results; still feature-detected with a `-32601` belt-and-suspenders.
- **Shared edit-application helpers.** `offsetOf` / `applyTextEdits` moved from `tools/lsp.ts` to
  `tools/lsp-common.ts` (its stated home for protocol-generic LSP helpers), joined by the new
  `normalizeWorkspaceEdit` (a `changes` + `documentChanges` → `uri → edits` normalizer) that `cs_rename`
  uses. `gd_rename` / `gd_formatting` now import them; no behavior change.
- **Contract kept in lockstep.** `schemas.ts` (frozen `outputSchema` for both tools),
  `host/test/registration.test.ts` (`EXPECTED_TOOL_COUNT` 88 → 90) and `docs/TOOL_CATALOG.md` (two
  detail entries + two index rows + gate-list update) all updated in the same change;
  `scripts/contract_check.py` green at **90↔90**. Host tests **160 → 166** (`host/test/cslsp.test.ts`:
  `cs_rename` dry-run / apply / `documentChanges` / declined-gate-blocks-write, `cs_code_action`
  list + unsupported feature-detect).

## [0.8.0] — 2026-07-07

Releases the D4 C3 **C# debugging plane** (`cs_dbg_*` via netcoredbg), completing the C#/.NET half of
Plane D — C1 fixture/CI + C2 semantic (`cs_*` via OmniSharp) + C3 debugging. C3 adds new tool surface
(78 → 88 tools), so this is a minor bump per `docs/D4_CSHARP_PLAN.md`. Every version stamp
(`host/package.json` + lockfile, `index.ts` serverInfo, both `plugin.cfg`, both `operations.gd`
`ADDON_VERSION`) is now **0.8.0**. No functional code change since the C3 merge; contract check green
(88 tools), 160 host tests.

### Added — D4 C3: the C# debugging plane (`cs_dbg_*` via netcoredbg)
- The C#/.NET debugging plane — the debugger analogue of the C2 semantic plane, and the mirror of the
  GDScript `dbg_*` DAP plane. **Ten read/inspect `cs_dbg_*` tools** driven by **netcoredbg** (Samsung,
  MIT — DAP-compatible, redistributable; **not** Microsoft `vsdbg`, whose licence forbids third-party
  hosts): `cs_dbg_launch` / `cs_dbg_attach`, `cs_dbg_set_breakpoints`, `cs_dbg_continue` /
  `cs_dbg_step`, `cs_dbg_stack_trace`, `cs_dbg_scopes`, `cs_dbg_variables`, and the gated
  `cs_dbg_evaluate` / `cs_dbg_set_variable`. The richer GDScript extras (watch / restart / goto /
  exception & data breakpoints) are deferred to a later cut, exactly as the C2 LSP mutators were.
- **`host/src/csdap.ts`** — `CsDapClient`, a **transport-agnostic sibling** of `DapClient` (injected
  `JsonRpcChannel`, `coreclr` adapterID). netcoredbg is a **spawned stdio** debug adapter (like
  OmniSharp, unlike Godot's TCP DAP), so it reuses the C2 `StdioChannel` / framing; its protocol logic
  is unit-tested over the *same* loopback-TCP mock the `dbg_*` tests use, while running over stdio in
  production. Matches the one-client-per-protocol precedent (dap.ts / lsp.ts / cslsp.ts) and reuses
  `DapError` / `DapState`.
- **Lazy spawn.** netcoredbg is launched on the **first `cs_dbg_*` call**, so a host without it
  installed starts and runs every other plane unaffected. New config, all env-overridable:
  `GODOT_CSDAP_CMD` (default `netcoredbg`), `GODOT_CSDAP_ARGS` (default `--interpreter=vscode`),
  `GODOT_CSHARP_BIN` (the program `cs_dbg_launch` launches by default — the Mono/.NET Godot binary),
  and the `GODOT_CSDAP_*_TIMEOUT_MS` bounds.
- **Same disciplines as the GDScript plane.** `cs_dbg_evaluate` / `cs_dbg_set_variable` are
  elicitation-gated (with a `confirm: true` override and a safe block on clients that can't prompt);
  both carry the F1 short bounded deadline so a non-answering adapter fails fast with a clear message
  instead of hanging the full DAP timeout, and `cs_dbg_set_variable` feature-detects
  `supportsSetVariable: false` (clear "unsupported", no prompt). `cs_dbg_set_breakpoints`
  feature-detects `supportsConditionalBreakpoints` — dropping the `conditions` modifier with a
  `warning` on an adapter that lacks it. Adapter absent → the lazy stdio spawn fails with an
  actionable hint, never a hang.
- **Contract kept in lockstep.** Tool count **78 → 88**; `schemas.ts` (frozen `outputSchema` per
  tool), `host/test/registration.test.ts` (`EXPECTED_TOOL_COUNT` 78→88), and `docs/TOOL_CATALOG.md`
  (new "Plane D — C# Debugging (netcoredbg DAP)" section + 10 index rows) all updated in the same
  change; `scripts/contract_check.py` green at 88↔88. Host tests **139 → 160** (`host/test/csdap.test.ts`:
  the ten tools + client protocol behaviors over a TCP mock — breakpoint/stack/scopes/variables/evaluate,
  the gated + fail-fast mutators, condition feature-detect — **plus** an end-to-end pass through a real
  spawned `StdioChannel` and a spawn-failure path).
- **CI.** The experimental `csharp-plane` job (still `continue-on-error`, non-required) installs
  **netcoredbg** and runs a live `cs_dbg_*` probe (`host/test-integration/csharp-dap.integration.mjs`,
  markers **`C#_DAP_*`**): an `initialize` handshake against real netcoredbg is the gate, then a
  best-effort, **log-only** launch-to-breakpoint flow over the `example-csharp` fixture. The
  netcoredbg + Godot native-host attach story under headless CI is the least-certain piece of D4
  (see `docs/D4_CSHARP_PLAN.md`), so only the gate is fatal — proven end-to-end by the mock unit suite.
- **Released in 0.8.0** — per the D4 plan, a version is cut when a chunk lands new surface; this cut
  folds the C3 tools into a minor. Versions unified at **0.8.0**; npm still 0.4.8 (publish pending).

## [0.7.0] — 2026-07-07

Releases the D4 C#/.NET work and unifies the version stamps, which had drifted (host at 0.6.0, addon
at 0.6.1). **C2 — the C# semantic plane (`cs_*` via OmniSharp)** adds new tool surface (70 → 78
tools), so this is a minor bump per the D4 plan; it also promotes the D4 C1 fixture/CI scaffold and
the Godot 4.3/4.4 runtime-bridge fix + runtime-plane CI probe below. Every version stamp
(`host/package.json` + lockfile, `index.ts` serverInfo, both `plugin.cfg`, both `operations.gd`
`ADDON_VERSION`) is now **0.7.0**.

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
  same capability with no native toolchain. See `BACKLOG.md`.
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
