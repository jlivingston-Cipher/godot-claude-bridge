# Go / No-Go Checklist — Godot–Claude Bridge

A tight acceptance gate for the first live run. Each gate has **one action**, **one pass criterion**, and **what to check first if it fails**. Stop at the first NO-GO, fix it, then re-run that gate. Full step detail lives in `RUNBOOK.md`; this is the pass/fail scorecard.

**Environment:** a developer machine with Godot 4.4+ (real display/GPU), Node 18+, npm with registry access. Not a headless CI box — screenshots and the editor GUI need a display.

Mark each: **GO** / **NO-GO**.

---

## Preconditions

| # | Action | Pass criterion | ▢ |
|---|---|---|---|
| P1 | Ports 9080 / 9081 / 6005 / 6006 free | none in use (`lsof -i` shows nothing) | ▢ |
| P2 | `godot --version` | prints `4.4.x` (or later) | ▢ |
| P3 | `node --version` | ≥ 18 | ▢ |

---

## Gate 0 — Build against the *real* SDK  *(the check neither authoring env could do)*

| # | Action | Pass criterion | ▢ |
|---|---|---|---|
| 0.1 | `cd host && npm install` | completes; no unmet-peer / missing-package errors | ▢ |
| 0.2 | `npm run build` | `dist/index.js` produced, **0 type errors** | ▢ |
| 0.3 | Check resolved SDK version (`npm ls @modelcontextprotocol/sdk`) | a **1.x** that still has `registerTool(name, {inputSchema}, handler)` **and** `server.server.elicitInput` (≈1.13+) | ▢ |

**NO-GO first checks:** if 0.2 fails on the `registerTool` / `registerResource` / import shape, the installed SDK is v2 — apply the three-line migration in `README.md` → "SDK version note". If 0.3 lands below ~1.13, elicitation degrades to `confirm: true` (safe, but no prompt); pin a floor in `package.json` and commit a lockfile.

> **Do not proceed past Gate 0 until it's GO.** Everything below assumes a real `dist/` and a registered MCP host (`claude mcp add godot -- node "$(pwd)/host/dist/index.js"`, with `GODOT_BIN` + `GODOT_PROJECT=…/example`).

---

## Gate 1 — Plane B · Headless CLI  *(editor NOT required)*

| # | Action | Pass criterion | ▢ |
|---|---|---|---|
| 1.1 | `godot_version` | version string returned | ▢ |
| 1.2 | `godot_run_headless_script` on a trivial script | `exit_code: 0`, stdout captured | ▢ |

**NO-GO first checks:** `GODOT_BIN` path wrong, or `GODOT_PROJECT` not pointing at the folder containing `project.godot`.

---

## Gate 2 — Plane A · Editor bridge  *(editor open, plugin enabled)*

Enable **Project → Project Settings → Plugins → Claude Bridge**; confirm `[claude_bridge] listening on 127.0.0.1:9080` in Output.

| # | Action | Pass criterion | ▢ |
|---|---|---|---|
| 2.1 | `editor_ping` | `{ pong: true, godot: "4.x" }` | ▢ |
| 2.2 | `scene_get_tree` | tree shows `Main` → `Sprite2D` | ▢ |
| 2.3 | `node_add` AudioStreamPlayer3D under `.` | node appears in the editor tree | ▢ |
| 2.4 | `node_set_property` `Sprite2D.position` → then **Ctrl-Z** | value updates, then Ctrl-Z reverts it | ▢ |
| 2.5 | `node_delete` (decline the prompt, then accept) | decline = no change; accept = removed | ▢ |
| 2.6 | `screenshot_editor` (2D tab active) | image returned | ▢ |

**NO-GO first checks:** ping fails → plugin not enabled or port 9080 taken (set `CLAUDE_BRIDGE_PORT` for **both** Godot and the host). Screenshot blank → the matching 2D/3D tab isn't the active, rendered tab.

---

## Gate 3 — Plane D · Semantic (LSP)

| # | Action | Pass criterion | ▢ |
|---|---|---|---|
| 3.1 | `gd_hover` on `counter` in `player.gd` | shows `int` | ▢ |
| 3.2 | `gd_definition` on a `take_damage` usage | resolves to its declaration line | ▢ |
| 3.3 | `gd_diagnostics` on clean `player.gd` | empty list (no error) | ▢ |
| 3.4 | Introduce a typo, save, re-run `gd_diagnostics` | the error is reported | ▢ |

**NO-GO first checks:** all `gd_*` empty/erroring → language server off or wrong port (Editor Settings → Network → Language Server, 6005; set `GODOT_LSP_PORT`). **If only `gd_diagnostics` (3.3/3.4) comes back empty while hover/definition work** → the URI-key fix in 0.4.1 should cover this, but confirm the server's `publishDiagnostics` URI reduces to the same relative path as the opened doc; if hover/definition are *also* empty, try feeding `res://`-form URIs to the LSP.

---

## Gate 4 — Plane D · Debugging (DAP)

| # | Action | Pass criterion | ▢ |
|---|---|---|---|
| 4.1 | `dbg_set_breakpoints` on the `counter -= amount` line | breakpoint buffered/verified | ▢ |
| 4.2 | `dbg_launch` | session running; game starts | ▢ |
| 4.3 | Trigger `take_damage` (via `runtime_call_method`) | execution stops at the breakpoint | ▢ |
| 4.4 | `dbg_stack_trace` → `dbg_scopes` → `dbg_variables` | see `amount` / `counter` locals | ▢ |
| 4.5 | `dbg_step` (over) | returns **the new** state + `stopped_reason` (0.4.1: now awaits the stop) | ▢ |
| 4.6 | `dbg_evaluate` `counter` (accept prompt) → `dbg_continue` | value returned; execution resumes | ▢ |

**NO-GO first checks:** launch fails → Debug Adapter off / wrong port (6006; `GODOT_DAP_PORT`), or the editor isn't open (the adapter drives the editor to run the game). If `dbg_launch` errors on its arguments, reconcile the `{project, scene, stopOnEntry}` payload with your Godot version's launch schema. `stepOut` may be unsupported on older builds.

---

## Gate 5 — Plane C · Runtime bridge  *(game running)*

| # | Action | Pass criterion | ▢ |
|---|---|---|---|
| 5.1 | `godot_run_managed` | returns an `id`; game window opens | ▢ |
| 5.2 | `godot_output {id}` | includes `[example] player ready` | ▢ |
| 5.3 | `runtime_get_property` `counter` on `.` | `100` | ▢ |
| 5.4 | `runtime_call_method` `take_damage` `[10]` (accept) | returns `90` | ▢ |
| 5.5 | `runtime_get_monitors` `["time/fps"]` | numeric value | ▢ |
| 5.6 | `runtime_screenshot` | game frame image | ▢ |
| 5.7 | `runtime_get_log` | includes the `push_log` entries | ▢ |

**NO-GO first checks:** runtime tools unreachable → autoload didn't register (re-enable the plugin; confirm `[claude_runtime] listening` in the game's Output) or port 9081 taken (`CLAUDE_RUNTIME_PORT`). **Note:** `runtime_get_log` only surfaces `ClaudeRuntimeBridge.push_log(...)` entries — plain `print()` shows up via `godot_output` (5.2), not here. Empty `runtime_get_log` is only a failure if the example's `push_log` calls ran.

---

## Gate 6 — Resources & safety

| # | Action | Pass criterion | ▢ |
|---|---|---|---|
| 6.1 | Read `godot://scene-tree` | edited-scene JSON | ▢ |
| 6.2 | Read `godot://class/AudioStreamPlayer3D` | ClassDB JSON | ▢ |
| 6.3 | Destructive tool with prompt **declined** | returns "cancelled", no change | ▢ |
| 6.4 | Same tool with `confirm: true` | proceeds without a prompt | ▢ |

---

## Sign-off

| Plane | Result |
|---|---|
| Gate 0 — Real SDK build | ▢ GO ▢ NO-GO |
| Gate 1 — CLI (B) | ▢ GO ▢ NO-GO |
| Gate 2 — Editor (A) | ▢ GO ▢ NO-GO |
| Gate 3 — LSP (D) | ▢ GO ▢ NO-GO |
| Gate 4 — DAP (D) | ▢ GO ▢ NO-GO |
| Gate 5 — Runtime (C) | ▢ GO ▢ NO-GO |
| Gate 6 — Resources & safety | ▢ GO ▢ NO-GO |

**Overall: ▢ GO (all four planes exercised live) ▢ NO-GO**

All GO → the "full four-plane" claim is proven end-to-end, not just typechecked. Tag `v0.4.1` as the first live-validated build and move to the P2 hardening in `NEXT_STEPS_ASSESSMENT.md` (enforced output schemas, CI, doc-drift cleanup).
