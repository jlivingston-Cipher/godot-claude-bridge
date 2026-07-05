# Changelog

All notable changes to the Godot–Claude Bridge are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

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

[0.4.3]: #043--2026-07-05
[0.4.2]: #042--2026-07-05
[0.4.1]: #041--2026-07-04
