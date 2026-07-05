# Godot–Claude Bridge — MCP Tool-Schema Catalog

Complete tool contract for the bridge — **54 tools + 5 MCP resources, all implemented (Phases 0–4)**. Each tool lists its **plane**, **status** (`✅ implemented`), a **destructive** flag (destructive tools are elicitation-gated and accept a `confirm` argument — see "Destructive-action gating" below), and its **input** and **output** JSON Schemas (draft 2020-12).

> Design note: as of **v0.4.3 (track B1)** these output schemas are **enforced at runtime**. `host/src/schemas.ts` freezes the `structuredContent` shape of every data tool and `applyOutputSchemas()` injects it as that tool's `outputSchema`, which the MCP SDK validates on every success result (`isError` results are exempt). The shapes were frozen from the v0.4.2 live-validation run, so the documented contract below **is** the enforced contract. `z.object` is non-strict, so a tool may still return *extra* fields without failing validation (the schema pins the required envelope, not an exhaustive field list).

---

## Conventions

**Tool result envelope.** Every tool returns MCP `content` (a human-readable `text` item, plus an `image` item for screenshots) and, for data tools, a `structuredContent` object matching the output schema below. On failure a tool returns `{ "isError": true, "content": [{ "type": "text", "text": "..." }] }` rather than throwing.

**Node paths.** All editor/runtime node paths are **relative to the scene root**; `"."` (or `""`) denotes the root itself. Example: `"Player/Camera3D"`.

**Tagged Variants (`$defs.Variant`).** JSON cannot express Godot's rich value types, so any property value that isn't a plain scalar/array/object is encoded as a tagged object. This applies to `node_set_property` / `node_get_property` values and `project_*_setting` values.

```json
{
  "$defs": {
    "Variant": {
      "description": "A plain JSON scalar/array/object, OR a tagged Godot value.",
      "oneOf": [
        { "type": ["null", "boolean", "number", "string", "array", "object"] },
        { "type": "object", "required": ["__type__"], "properties": {
          "__type__": { "enum": ["NodePath","Vector2","Vector2i","Vector3","Vector3i","Vector4","Color","Rect2","Quaternion","Resource","Object"] }
        }}
      ],
      "examples": [
        42, "hello", true,
        { "__type__": "Vector3", "x": 1.0, "y": 0.0, "z": 2.5 },
        { "__type__": "Color", "r": 1, "g": 0.5, "b": 0, "a": 1 },
        { "__type__": "NodePath", "path": "Player/Sprite2D" },
        { "__type__": "Resource", "class": "Texture2D", "path": "res://icon.svg" }
      ]
    }
  }
}
```

**Standard error object** (transport-level result from the in-editor bridge, surfaced in the tool's error text):

```json
{ "type": "object", "required": ["code", "message"],
  "properties": { "code": { "type": "string" }, "message": { "type": "string" } } }
```

---

# Plane B — Headless CLI  (✅ implemented; works without the editor running)

### `godot_version` ✅
Return the version string of the configured Godot binary.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "properties": {} }
```
- **Output**
```json
{ "type": "object", "required": ["version"],
  "properties": {
    "version": { "type": "string" },
    "raw": { "type": "object" }
  } }
```

### `godot_launch_editor` ✅
Open the Godot editor for the project (detached). Prerequisite for every `editor_*` tool.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "properties": {} }
```
- **Output**
```json
{ "type": "object", "required": ["launched", "pid", "project"],
  "properties": {
    "launched": { "type": "boolean" },
    "pid": { "type": ["integer", "null"] },
    "project": { "type": "string" }
  } }
```

### `godot_run_project` ✅
Run the project (detached), optionally from a specific scene.
- **Input**
```json
{ "type": "object", "additionalProperties": false,
  "properties": { "scene": { "type": "string", "description": "res:// scene to run" } } }
```
- **Output**
```json
{ "type": "object", "required": ["running", "pid"],
  "properties": {
    "running": { "type": "boolean" },
    "pid": { "type": ["integer", "null"] },
    "scene": { "type": ["string", "null"] }
  } }
```

### `godot_export` ✅  · destructive (writes build artifacts)
Headless export via an export preset. Runs to completion; can be slow.
- **Input**
```json
{ "type": "object", "additionalProperties": false,
  "required": ["preset", "output_path"],
  "properties": {
    "preset": { "type": "string" },
    "output_path": { "type": "string" },
    "debug": { "type": "boolean", "default": false },
    "timeout_ms": { "type": "integer", "minimum": 1, "default": 600000 }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["preset", "output_path", "exit_code"],
  "properties": {
    "preset": { "type": "string" },
    "output_path": { "type": "string" },
    "exit_code": { "type": ["integer", "null"] },
    "timed_out": { "type": "boolean" },
    "stdout": { "type": "string" },
    "stderr": { "type": "string" }
  } }
```

### `godot_import` ✅
Headless (re)import of project assets.
- **Input**
```json
{ "type": "object", "additionalProperties": false,
  "properties": { "timeout_ms": { "type": "integer", "minimum": 1, "default": 600000 } } }
```
- **Output**
```json
{ "type": "object", "required": ["exit_code"],
  "properties": {
    "exit_code": { "type": ["integer", "null"] },
    "timed_out": { "type": "boolean" },
    "stdout": { "type": "string" },
    "stderr": { "type": "string" }
  } }
```

### `godot_run_headless_script` ✅
Run a GDScript headless (`godot --headless -s <script>`). Use for GdUnit4/GUT test runners or batch tools.
- **Input**
```json
{ "type": "object", "additionalProperties": false,
  "required": ["script_path"],
  "properties": {
    "script_path": { "type": "string" },
    "args": { "type": "array", "items": { "type": "string" } },
    "timeout_ms": { "type": "integer", "minimum": 1, "default": 600000 }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["script_path", "exit_code"],
  "properties": {
    "script_path": { "type": "string" },
    "exit_code": { "type": ["integer", "null"] },
    "timed_out": { "type": "boolean" },
    "stdout": { "type": "string" },
    "stderr": { "type": "string" }
  } }
```

---

# Plane A — Editor Bridge  (✅ implemented; requires the editor open with the plugin enabled)

### `editor_ping` ✅
- **Input** `{ "type": "object", "properties": {} }`
- **Output**
```json
{ "type": "object", "required": ["pong", "addon_version", "godot"],
  "properties": {
    "pong": { "type": "boolean" },
    "addon_version": { "type": "string" },
    "godot": { "type": "string" }
  } }
```

### `editor_get_state` ✅
- **Input** `{ "type": "object", "properties": {} }`
- **Output**
```json
{ "type": "object", "required": ["has_open_scene"],
  "properties": {
    "has_open_scene": { "type": "boolean" },
    "edited_scene_root": { "type": ["string", "null"] },
    "edited_scene_path": { "type": ["string", "null"] },
    "root_type": { "type": ["string", "null"] },
    "selection": { "type": "array", "items": { "type": "string" } },
    "godot": { "type": "string" }
  } }
```

### `project_get_info` ✅
- **Input** `{ "type": "object", "properties": {} }`
- **Output**
```json
{ "type": "object", "required": ["name", "project_root"],
  "properties": {
    "name": { "type": "string" },
    "main_scene": { "type": "string" },
    "project_root": { "type": "string" },
    "godot": { "type": "string" },
    "features": { "type": "array", "items": { "type": "string" } }
  } }
```

### `project_get_setting` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["name"],
  "properties": { "name": { "type": "string", "description": "dotted ProjectSettings key" } } }
```
- **Output**
```json
{ "type": "object", "required": ["name", "value"],
  "properties": { "name": { "type": "string" }, "value": { "$ref": "#/$defs/Variant" } } }
```

### `project_set_setting` ✅ · destructive
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["name", "value"],
  "properties": {
    "name": { "type": "string" },
    "value": { "$ref": "#/$defs/Variant" },
    "save": { "type": "boolean", "default": false }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["name", "saved"],
  "properties": { "name": { "type": "string" }, "saved": { "type": "boolean" } } }
```

### `scene_get_tree` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false,
  "properties": { "max_depth": { "type": "integer", "minimum": 1, "default": 64 } } }
```
- **Output** (recursive node)
```json
{ "$ref": "#/$defs/SceneNode",
  "$defs": { "SceneNode": {
    "type": "object", "required": ["name", "type", "path", "child_count"],
    "properties": {
      "name": { "type": "string" },
      "type": { "type": "string" },
      "path": { "type": "string" },
      "script": { "type": ["string", "null"] },
      "child_count": { "type": "integer" },
      "children": { "type": "array", "items": { "$ref": "#/$defs/SceneNode" } }
    } } } }
```

### `scene_open` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"],
  "properties": { "path": { "type": "string", "pattern": "^res://" } } }
```
- **Output** `{ "type": "object", "required": ["opened"], "properties": { "opened": { "type": "string" } } }`

### `scene_save` ✅
- **Input** `{ "type": "object", "properties": {} }`
- **Output** `{ "type": "object", "required": ["saved"], "properties": { "saved": { "type": "string" } } }`

### `scene_new` ✅ · destructive (writes a new file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["root_type", "path"],
  "properties": {
    "root_type": { "type": "string", "default": "Node" },
    "path": { "type": "string", "pattern": "^res://" },
    "name": { "type": "string" }
  } }
```
- **Output** `{ "type": "object", "required": ["created", "root_type"], "properties": { "created": { "type": "string" }, "root_type": { "type": "string" } } }`

### `node_add` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path", "type"],
  "properties": {
    "parent_path": { "type": "string", "description": "'.' for root" },
    "type": { "type": "string", "description": "engine class, e.g. AudioStreamPlayer3D" },
    "name": { "type": "string" }
  } }
```
- **Output** `{ "type": "object", "required": ["path", "name", "type"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" } } }`

### `node_delete` ✅ · destructive  (undoable)
- **Input** `{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" } } }`
- **Output** `{ "type": "object", "required": ["deleted"], "properties": { "deleted": { "type": "string" } } }`

### `node_rename` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "new_name"],
  "properties": { "path": { "type": "string" }, "new_name": { "type": "string" } } }
```
- **Output** `{ "type": "object", "required": ["path", "name"], "properties": { "path": { "type": "string" }, "name": { "type": "string" } } }`

### `node_reparent` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "new_parent_path"],
  "properties": {
    "path": { "type": "string" },
    "new_parent_path": { "type": "string" },
    "keep_global_transform": { "type": "boolean", "default": true }
  } }
```
- **Output** `{ "type": "object", "required": ["path"], "properties": { "path": { "type": "string" } } }`

### `node_set_property` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "property", "value"],
  "properties": {
    "path": { "type": "string" },
    "property": { "type": "string" },
    "value": { "$ref": "#/$defs/Variant" }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "property", "value"],
  "properties": { "path": { "type": "string" }, "property": { "type": "string" }, "value": { "$ref": "#/$defs/Variant" } } }
```

### `node_get_property` ✅
- **Input** `{ "type": "object", "additionalProperties": false, "required": ["path", "property"], "properties": { "path": { "type": "string" }, "property": { "type": "string" } } }`
- **Output** identical shape to `node_set_property` output.

### `selection_get` ✅
- **Input** `{ "type": "object", "properties": {} }`
- **Output** `{ "type": "object", "required": ["selection"], "properties": { "selection": { "type": "array", "items": { "type": "string" } } } }`

### `selection_set` ✅
- **Input** `{ "type": "object", "additionalProperties": false, "required": ["paths"], "properties": { "paths": { "type": "array", "items": { "type": "string" } } } }`
- **Output** `{ "type": "object", "required": ["selection"], "properties": { "selection": { "type": "array", "items": { "type": "string" } } } }`

### `classdb_get_class` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["class_name"],
  "properties": {
    "class_name": { "type": "string" },
    "include_inherited": { "type": "boolean", "default": false }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["class", "parent", "methods", "properties", "signals"],
  "properties": {
    "class": { "type": "string" },
    "parent": { "type": "string" },
    "can_instantiate": { "type": "boolean" },
    "methods": { "type": "array", "items": { "type": "string" } },
    "properties": { "type": "array", "items": { "type": "string" } },
    "signals": { "type": "array", "items": { "type": "string" } }
  } }
```

### `screenshot_editor` ✅  (returns MCP image content)
- **Input** `{ "type": "object", "additionalProperties": false, "properties": { "viewport": { "enum": ["2d", "3d"], "default": "3d" } } }`
- **Output** — MCP `content: [{ type: "image", data, mimeType }, { type: "text" }]`. Bridge payload:
```json
{ "type": "object", "required": ["base64", "mime", "width", "height", "viewport"],
  "properties": {
    "base64": { "type": "string" }, "mime": { "const": "image/png" },
    "width": { "type": "integer" }, "height": { "type": "integer" },
    "viewport": { "enum": ["2d", "3d"] }
  } }
```

---

# Plane D — Semantic (LSP)  (✅ implemented — Phase 2; raw TCP + LSP `Content-Length` framing to Godot's GDScript language server, default `127.0.0.1:6005`)

### `gd_completion` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "line", "character"],
  "properties": {
    "path": { "type": "string", "pattern": "^res://" },
    "line": { "type": "integer", "minimum": 0 },
    "character": { "type": "integer", "minimum": 0 }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["items"],
  "properties": { "items": { "type": "array", "items": {
    "type": "object", "properties": {
      "label": { "type": "string" }, "kind": { "type": "string" },
      "detail": { "type": "string" }, "insertText": { "type": "string" }
    } } } } }
```

### `gd_hover` ✅
- **Input** same `{ path, line, character }` as `gd_completion`.
- **Output** `{ "type": "object", "properties": { "contents": { "type": "string" }, "range": { "type": "object" } } }`

### `gd_definition` ✅
- **Input** same `{ path, line, character }`.
- **Output**
```json
{ "type": "object", "required": ["locations"],
  "properties": { "locations": { "type": "array", "items": {
    "type": "object", "properties": {
      "uri": { "type": "string" }, "line": { "type": "integer" }, "character": { "type": "integer" } } } } } }
```

### `gd_references` ✅
- **Input** `{ path, line, character, include_declaration?: boolean }`.
- **Output** same `locations` array shape as `gd_definition`.

### `gd_rename` ✅ · destructive (edits multiple files)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "line", "character", "new_name"],
  "properties": {
    "path": { "type": "string" }, "line": { "type": "integer" },
    "character": { "type": "integer" }, "new_name": { "type": "string" },
    "apply": { "type": "boolean", "default": false, "description": "Write edits to disk (default false = dry run returning the planned edit)" },
    "confirm": { "type": "boolean", "description": "Auto-approve writing edits (skip the elicitation prompt); only relevant with apply=true" } } }
```
- **Output**
```json
{ "type": "object", "required": ["changed_files", "edit_count", "applied", "written"],
  "properties": {
    "changed_files": { "type": "array", "items": { "type": "string" } },
    "edit_count": { "type": "integer" },
    "applied": { "type": "boolean" },
    "written": { "type": "array", "items": { "type": "string" }, "description": "Absolute paths actually written (empty on a dry run)" } } }
```

### `gd_document_symbols` ✅
- **Input** `{ "type": "object", "required": ["path"], "properties": { "path": { "type": "string" } } }`
- **Output** `{ "type": "object", "required": ["symbols"], "properties": { "symbols": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "kind": { "type": "string" }, "line": { "type": "integer" } } } } } }`

### `gd_workspace_symbols` ⚠️ · unsupported by Godot ≤ 4.7 (handled gracefully)
> **Engine limitation (found in live validation):** Godot 4.7's GDScript language server replies `-32601 Method not found` to `workspace/symbol`. The gap is in the engine, not the host — the input/output contract below is correct and the tool is retained for forward compatibility (it will start returning results on a Godot build that implements the method). **As of v0.4.5** the host feature-detects this: it checks the server's advertised `workspaceSymbolProvider` capability (and still catches a `-32601` from builds that advertise it but don't honour it), returning an explicit `isError` "unsupported by the connected Godot build — use gd_document_symbols instead" message rather than leaking a raw JSON-RPC error. On the success path (a future capable build) the `symbols` output shape below is unchanged.
- **Input** `{ "type": "object", "required": ["query"], "properties": { "query": { "type": "string" } } }`
- **Output** same `symbols` shape as `gd_document_symbols`, each with an added `uri`.

### `gd_diagnostics` ✅  (also exposed as a subscribable `diagnostics://` resource)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"],
  "properties": {
    "path": { "type": "string", "description": "Script path (res://..., absolute, or project-relative)" },
    "wait_ms": { "type": "integer", "minimum": 1, "default": 1500, "description": "Max time to wait for the server's first diagnostics publish" } } }
```
- **Output** (`uri` is top-level — the `file://` URI the server published under — not per-diagnostic)
```json
{ "type": "object", "required": ["uri", "diagnostics"],
  "properties": {
    "uri": { "type": "string" },
    "diagnostics": { "type": "array", "items": {
      "type": "object", "properties": {
        "severity": { "enum": ["error","warning","info","hint"] },
        "message": { "type": "string" }, "line": { "type": "integer" }, "character": { "type": "integer" } } } } } }
```

---

# Plane D — Debugging (DAP)  (✅ implemented — Phase 2; raw TCP + DAP `Content-Length` framing to Godot's debug adapter, default `127.0.0.1:6006`)

### `dbg_launch` ✅
- **Input** `{ "type": "object", "properties": { "scene": { "type": "string", "description": "'main' (default), 'current', or a res:// scene path" }, "stop_on_entry": { "type": "boolean", "default": false } } }`
- **Output** `{ "type": "object", "required": ["session_id", "state", "scene"], "properties": { "session_id": { "type": "string" }, "state": { "type": "string" }, "scene": { "type": "string" } } }`

### `dbg_attach` ✅
- **Input** `{ "type": "object", "properties": { "address": { "type": "string", "default": "127.0.0.1" }, "port": { "type": "integer" } } }`
- **Output** `{ "type": "object", "required": ["session_id", "state"], "properties": { "session_id": { "type": "string" }, "state": { "type": "string" } } }`

### `dbg_set_breakpoints` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "lines"],
  "properties": {
    "path": { "type": "string" },
    "lines": { "type": "array", "items": { "type": "integer", "minimum": 1 } },
    "conditions": { "type": "array", "items": { "type": ["string", "null"] } },
    "hit_conditions": { "type": "array", "items": { "type": ["string", "null"] }, "description": "Per-line hit expressions aligned to lines, e.g. '>3' or '%5'" },
    "log_messages": { "type": "array", "items": { "type": ["string", "null"] }, "description": "Per-line log messages aligned to lines; makes that breakpoint a logpoint (logs, never halts)" } } }
```
- **Output** `{ "type": "object", "required": ["path", "buffered", "breakpoints"], "properties": { "path": { "type": "string" }, "buffered": { "type": "boolean" }, "breakpoints": { "type": "array", "items": { "type": "object", "properties": { "line": { "type": "integer" }, "verified": { "type": "boolean" } } } } } }`

### `dbg_continue` / `dbg_step` ✅
- **Input (`dbg_step`)** `{ "type": "object", "required": ["kind"], "properties": { "kind": { "enum": ["in", "over", "out"] } } }`
- **Input (`dbg_continue`)** `{ "type": "object", "properties": {} }`
- **Output** `{ "type": "object", "required": ["state"], "properties": { "state": { "enum": ["running", "stopped", "terminated"] }, "stopped_reason": { "type": ["string", "null"] } } }`

### `dbg_stack_trace` ✅
- **Input** `{ "type": "object", "properties": { "levels": { "type": "integer", "minimum": 1, "default": 20, "description": "Max frames" } } }`
- **Output** `{ "type": "object", "required": ["frames"], "properties": { "frames": { "type": "array", "items": { "type": "object", "properties": { "id": { "type": "integer" }, "name": { "type": "string" }, "source": { "type": "string" }, "line": { "type": "integer" } } } } } }`

### `dbg_scopes` ✅
- **Input** `{ "type": "object", "required": ["frame_id"], "properties": { "frame_id": { "type": "integer" } } }`
- **Output** `{ "type": "object", "required": ["scopes"], "properties": { "scopes": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "variables_ref": { "type": "integer" } } } } } }`

### `dbg_variables` ✅
- **Input** `{ "type": "object", "required": ["variables_ref"], "properties": { "variables_ref": { "type": "integer" } } }`
- **Output** `{ "type": "object", "required": ["variables"], "properties": { "variables": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "value": { "type": "string" }, "type": { "type": "string" }, "variables_ref": { "type": "integer" } } } } } }`

### `dbg_evaluate` ✅ · destructive (arbitrary code execution — gate hard)
- **Input** `{ "type": "object", "required": ["expression"], "properties": { "expression": { "type": "string" }, "frame_id": { "type": "integer" } } }`
- **Output** `{ "type": "object", "required": ["result"], "properties": { "result": { "type": "string" }, "type": { "type": "string" }, "variables_ref": { "type": "integer" } } }`

### `dbg_watch` ✅
Manage a persistent set of watch expressions and re-evaluate them in the current stopped frame. Evaluated in DAP `watch` context (side-effect-free), so it is **not** gated. Results are only meaningful while stopped at a breakpoint.
- **Input**
```json
{ "type": "object",
  "properties": {
    "add": { "type": "array", "items": { "type": "string" }, "description": "Expressions to add to the watch set" },
    "remove": { "type": "array", "items": { "type": "string" }, "description": "Expressions to remove" },
    "clear": { "type": "boolean", "description": "Clear all watches before applying add" },
    "frame_id": { "type": "integer", "description": "Frame id from dbg_stack_trace; omit for the top frame" } } }
```
- **Output** `{ "type": "object", "required": ["watches"], "properties": { "watches": { "type": "array", "items": { "type": "object", "required": ["expression", "value", "type", "error"], "properties": { "expression": { "type": "string" }, "value": { "type": "string" }, "type": { "type": "string" }, "error": { "type": ["string", "null"] } } } } } }`

---

# Plane C — Runtime Bridge  (✅ implemented — Phase 3; in-game autoload `ClaudeRuntimeBridge` over loopback TCP :9081, same JSON protocol as the editor bridge)

### `runtime_get_tree` ✅
- **Input** `{ "type": "object", "properties": { "max_depth": { "type": "integer", "default": 64 } } }`
- **Output** same recursive `SceneNode` shape as `scene_get_tree`, plus live `visible`/`process_mode` fields.

### `runtime_get_property` / `runtime_set_property` ✅ · (`set` is destructive)
- **Input** identical to `node_get_property` / `node_set_property` (paths resolved against the live `SceneTree`).
- **Output** identical `{ path, property, value }` shape.

### `runtime_call_method` ✅ · destructive (arbitrary invocation)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "method"],
  "properties": {
    "path": { "type": "string" }, "method": { "type": "string" },
    "args": { "type": "array", "items": { "$ref": "#/$defs/Variant" } } } }
```
- **Output** `{ "type": "object", "required": ["return"], "properties": { "return": { "$ref": "#/$defs/Variant" } } }`

### `runtime_emit_signal` ✅ · destructive
- **Input** `{ "type": "object", "required": ["path", "signal"], "properties": { "path": { "type": "string" }, "signal": { "type": "string" }, "args": { "type": "array", "items": { "$ref": "#/$defs/Variant" } } } }`
- **Output** `{ "type": "object", "properties": { "emitted": { "type": "boolean" } } }`

### `runtime_inject_input` ✅ · destructive
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["event"],
  "properties": { "event": { "type": "object", "description": "InputEvent descriptor", "required": ["kind"],
    "properties": {
      "kind": { "enum": ["action", "key", "mouse_button", "mouse_motion"] },
      "action": { "type": "string", "description": "action name (kind=action)" },
      "strength": { "type": "number", "description": "action strength 0..1 (kind=action)" },
      "keycode": { "type": "integer", "description": "key code (kind=key)" },
      "button": { "type": "integer", "description": "mouse button index (kind=mouse_button)" },
      "pressed": { "type": "boolean" },
      "position": { "$ref": "#/$defs/Variant" },
      "relative": { "$ref": "#/$defs/Variant", "description": "relative motion (kind=mouse_motion)" } } } } }
```
- **Output** `{ "type": "object", "required": ["injected", "kind"], "properties": { "injected": { "type": "boolean" }, "kind": { "type": "string" } } }`

### `runtime_get_monitors` ✅
- **Input** `{ "type": "object", "properties": { "keys": { "type": "array", "items": { "type": "string" }, "description": "e.g. time/fps, render/total_draw_calls_in_frame, audio/*" } } }`
- **Output** `{ "type": "object", "required": ["monitors"], "properties": { "monitors": { "type": "object", "additionalProperties": { "type": "number" } } } }`

### `runtime_screenshot` ✅  (returns MCP image content)
- **Input** `{ "type": "object", "properties": {} }`
- **Output** same PNG bridge payload as `screenshot_editor`.

### `runtime_get_log` ✅  (also a subscribable `log://` resource)
- **Input** `{ "type": "object", "properties": { "since_seq": { "type": "integer", "default": 0 }, "levels": { "type": "array", "items": { "enum": ["print", "warning", "error"] } } } }`
- **Output** `{ "type": "object", "required": ["entries", "latest_seq"], "properties": { "entries": { "type": "array", "items": { "type": "object", "properties": { "seq": { "type": "integer" }, "level": { "type": "string" }, "message": { "type": "string" } } } }, "latest_seq": { "type": "integer" } } }`

---

---

## Destructive-action gating (elicitation) — Phase 4

Every tool flagged **destructive** accepts an optional `confirm: boolean`. When it is omitted, the host issues an MCP **elicitation** (a client-side confirmation prompt) before executing: on *accept* it proceeds; on *decline/cancel* it returns a non-error "cancelled" result. If the client does not support elicitation, the tool blocks and instructs the caller to re-invoke with `confirm: true` — so a destructive op is never executed silently. Gated tools: `node_delete`, `project_set_setting`, `scene_new`, `gd_rename` (when `apply=true`), `dbg_evaluate`, `runtime_set_property`, `runtime_call_method`, `runtime_emit_signal`, `runtime_inject_input`.

The long-running tools (`godot_export`, `godot_import`, `godot_run_headless_script`) emit `notifications/progress` while running whenever the caller supplies a `progressToken`.

---

# Plane B — Managed Process & Console Capture  (✅ implemented — Phase 4; host-side piped stdio for transparent `print()`/error capture)

### `godot_run_managed` ✅
Run the project as a managed child process with captured stdout/stderr (unlike `godot_run_project`, whose output is not captured).
- **Input**
```json
{ "type": "object", "additionalProperties": false,
  "properties": { "scene": { "type": "string", "description": "optional res:// scene" } } }
```
- **Output**
```json
{ "type": "object", "required": ["id", "running"],
  "properties": {
    "id": { "type": "string" }, "pid": { "type": ["integer", "null"] },
    "running": { "type": "boolean" }, "scene": { "type": ["string", "null"] } } }
```

### `godot_output` ✅
Read captured console output for a managed process.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["id"],
  "properties": {
    "id": { "type": "string" },
    "since_seq": { "type": "integer", "default": 0 },
    "stream": { "enum": ["stdout", "stderr", "both"], "default": "both" } } }
```
- **Output**
```json
{ "type": "object", "required": ["id", "lines"],
  "properties": {
    "id": { "type": "string" }, "exited": { "type": "boolean" },
    "exit_code": { "type": ["integer", "null"] }, "latest_seq": { "type": "integer" },
    "lines": { "type": "array", "items": { "type": "object", "properties": {
      "seq": { "type": "integer" }, "stream": { "enum": ["stdout", "stderr"] }, "text": { "type": "string" } } } } } }
```

### `godot_stop` ✅
Terminate a managed process.
- **Input** `{ "type": "object", "additionalProperties": false, "required": ["id"], "properties": { "id": { "type": "string" } } }`
- **Output** `{ "type": "object", "required": ["id", "stopped"], "properties": { "id": { "type": "string" }, "stopped": { "type": "boolean" } } }`

---

# MCP Resources  (✅ implemented — Phase 4)

Read-mostly context Claude can pull on demand (clients may subscribe). Each degrades to `{ "available": false, "note": "..." }` when the editor/game isn't reachable.

| URI | mimeType | Source |
|---|---|---|
| `godot://scene-tree` | application/json | editor bridge — edited scene tree |
| `godot://editor-state` | application/json | editor bridge — edited scene + selection |
| `godot://runtime/tree` | application/json | runtime bridge — live SceneTree |
| `godot://runtime/log` | application/json | runtime bridge — log ring buffer |
| `godot://class/{name}` | application/json | editor bridge — ClassDB docs (URI template) |

## Tool Index

| Tool | Plane | Status | Destructive |
|---|---|---|---|
| `godot_version` | B / CLI | ✅ | – |
| `godot_launch_editor` | B / CLI | ✅ | – |
| `godot_run_project` | B / CLI | ✅ | – |
| `godot_export` | B / CLI | ✅ | writes artifacts |
| `godot_import` | B / CLI | ✅ | – |
| `godot_run_headless_script` | B / CLI | ✅ | runs code |
| `editor_ping` | A / Editor | ✅ | – |
| `editor_get_state` | A / Editor | ✅ | – |
| `project_get_info` | A / Editor | ✅ | – |
| `project_get_setting` | A / Editor | ✅ | – |
| `project_set_setting` | A / Editor | ✅ | ✔ |
| `scene_get_tree` | A / Editor | ✅ | – |
| `scene_open` | A / Editor | ✅ | – |
| `scene_save` | A / Editor | ✅ | writes file |
| `scene_new` | A / Editor | ✅ | writes file |
| `node_add` | A / Editor | ✅ | undoable |
| `node_delete` | A / Editor | ✅ | ✔ undoable |
| `node_rename` | A / Editor | ✅ | undoable |
| `node_reparent` | A / Editor | ✅ | undoable |
| `node_set_property` | A / Editor | ✅ | undoable |
| `node_get_property` | A / Editor | ✅ | – |
| `selection_get` | A / Editor | ✅ | – |
| `selection_set` | A / Editor | ✅ | – |
| `classdb_get_class` | A / Editor | ✅ | – |
| `screenshot_editor` | A / Editor | ✅ | – |
| `gd_completion` | D / LSP | ✅ | – |
| `gd_hover` | D / LSP | ✅ | – |
| `gd_definition` | D / LSP | ✅ | – |
| `gd_references` | D / LSP | ✅ | – |
| `gd_rename` | D / LSP | ✅ | ✔ |
| `gd_document_symbols` | D / LSP | ✅ | – |
| `gd_workspace_symbols` | D / LSP | ⚠️ engine-missing (handled) | – |
| `gd_diagnostics` | D / LSP | ✅ | – |
| `dbg_launch` | D / DAP | ✅ | runs code |
| `dbg_attach` | D / DAP | ✅ | – |
| `dbg_set_breakpoints` | D / DAP | ✅ | – |
| `dbg_continue` | D / DAP | ✅ | – |
| `dbg_step` | D / DAP | ✅ | – |
| `dbg_stack_trace` | D / DAP | ✅ | – |
| `dbg_scopes` | D / DAP | ✅ | – |
| `dbg_variables` | D / DAP | ✅ | – |
| `dbg_evaluate` | D / DAP | ✅ | ✔ arbitrary code |
| `dbg_watch` | D / DAP | ✅ | – |
| `runtime_get_tree` | C / Runtime | ✅ | – |
| `runtime_get_property` | C / Runtime | ✅ | – |
| `runtime_set_property` | C / Runtime | ✅ | ✔ |
| `runtime_call_method` | C / Runtime | ✅ | ✔ arbitrary invocation |
| `runtime_emit_signal` | C / Runtime | ✅ | ✔ |
| `runtime_inject_input` | C / Runtime | ✅ | ✔ |
| `runtime_get_monitors` | C / Runtime | ✅ | – |
| `runtime_screenshot` | C / Runtime | ✅ | – |
| `runtime_get_log` | C / Runtime | ✅ | – |

| `godot_run_managed` | B / Process | ✅ | – |
| `godot_output` | B / Process | ✅ | – |
| `godot_stop` | B / Process | ✅ | – |

**54 tools + 5 MCP resources implemented across Phases 0–4: 6 CLI, 3 managed-process, 19 editor, 8 LSP, 9 DAP, 9 runtime. Destructive tools are elicitation-gated; long jobs stream progress. All four planes live.**
