# Changelog

All notable changes to the Godot–Claude Bridge are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
  a required check while live-adapter timing is new. No tool/schema/version change —
  surface stays **70 tools / 104 tests**; `contract_check.py` parity unchanged (70 ↔ 70).

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
