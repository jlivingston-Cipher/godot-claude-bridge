# Godot–Breakpoint MCP — MCP Tool-Schema Catalog

Complete tool contract for the bridge — **59 tools + 5 MCP resources, all implemented (Phases 0–4)**. Each tool lists its **plane**, **status** (`✅ implemented`), a **destructive** flag (destructive tools are elicitation-gated and accept a `confirm` argument — see "Destructive-action gating" below), and its **input** and **output** JSON Schemas (draft 2020-12).

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
Headless export via an export preset. Runs to completion; can be slow. Exposed as an MCP task (D2): task-aware clients poll/await/cancel it via `tasks/get` / `tasks/result` / `tasks/cancel`; plain clients still get a synchronous result.
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
Headless (re)import of project assets. Exposed as an MCP task (D2): poll/await/cancel via `tasks/get` / `tasks/result` / `tasks/cancel`; plain clients still get a synchronous result.
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
Run a GDScript headless (`godot --headless -s <script>`). Use for GdUnit4/GUT test runners or batch tools. Exposed as an MCP task (D2): a long test run can be polled/awaited/cancelled via `tasks/get` / `tasks/result` / `tasks/cancel`; plain clients still get a synchronous result.
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
- **Input**
```json
{ "type": "object", "properties": {} }
```
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
- **Input**
```json
{ "type": "object", "properties": {} }
```
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

### `editor_undo` ✅  (steps the undo history)
- **Input**
```json
{ "type": "object", "additionalProperties": false,
  "properties": { "scope": { "type": "string", "enum": ["scene", "global"], "default": "scene" } } }
```
- **Output**
```json
{ "type": "object", "required": ["performed", "direction", "has_undo", "has_redo", "history_id", "scope"],
  "properties": {
    "performed": { "type": "boolean" },
    "direction": { "type": "string" },
    "action": { "type": "string" },
    "has_undo": { "type": "boolean" },
    "has_redo": { "type": "boolean" },
    "history_id": { "type": "integer" },
    "scope": { "type": "string" }
  } }
```
- Programmatic Ctrl-Z. Steps the editor's undo history one action back via `EditorUndoRedoManager.get_history_undo_redo(get_object_history_id(edited_root)).undo()` — the same history the `node_*` mutators commit into. `scope: "global"` targets `GLOBAL_HISTORY` instead of the edited scene. Ungated (the `node_*` model). `performed` is `false` when the history is already at its oldest state; `action` is the name of the undone action (empty when nothing was undone).

### `editor_redo` ✅  (steps the undo history)
- **Input**
```json
{ "type": "object", "additionalProperties": false,
  "properties": { "scope": { "type": "string", "enum": ["scene", "global"], "default": "scene" } } }
```
- **Output**
```json
{ "type": "object", "required": ["performed", "direction", "has_undo", "has_redo", "history_id", "scope"],
  "properties": {
    "performed": { "type": "boolean" },
    "direction": { "type": "string" },
    "action": { "type": "string" },
    "has_undo": { "type": "boolean" },
    "has_redo": { "type": "boolean" },
    "history_id": { "type": "integer" },
    "scope": { "type": "string" }
  } }
```
- Programmatic Ctrl-Shift-Z. Re-applies the most recently undone action on the same history. `performed` is `false` when there is nothing to redo.

### `project_get_info` ✅
- **Input**
```json
{ "type": "object", "properties": {} }
```
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
- **Output**
```json
{ "type": "object", "required": ["opened"], "properties": { "opened": { "type": "string" } } }
```

### `scene_save` ✅
- **Input**
```json
{ "type": "object", "properties": {} }
```
- **Output**
```json
{ "type": "object", "required": ["saved"], "properties": { "saved": { "type": "string" } } }
```

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
- **Output**
```json
{ "type": "object", "required": ["created", "root_type"], "properties": { "created": { "type": "string" }, "root_type": { "type": "string" } } }
```

### `scene_list_open` ✅
- **Input**
```json
{ "type": "object", "properties": {} }
```
- **Output**
```json
{ "type": "object", "required": ["scenes", "current", "unsaved", "unsaved_supported"], "properties": { "scenes": { "type": "array", "items": { "type": "string" } }, "current": { "type": ["string", "null"] }, "unsaved": { "type": "array", "items": { "type": "string" } }, "unsaved_supported": { "type": "boolean" } } }
```
- **Note** `unsaved` enumeration uses `EditorInterface.get_unsaved_scenes()` (Godot 4.4+). On Godot 4.3 that API is absent, so `unsaved` comes back empty and `unsaved_supported` is `false`; `scenes` and `current` are unaffected.

### `scene_reload` ✅ · destructive (discards unsaved changes)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "properties": { "path": { "type": "string", "description": "omitted = current scene" } } }
```
- **Output**
```json
{ "type": "object", "required": ["reloaded"], "properties": { "reloaded": { "type": "string" } } }
```

### `scene_close` ✅ · destructive (discards unsaved changes)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "properties": { "path": { "type": "string", "description": "optional assertion of the current scene path" } } }
```
- **Output**
```json
{ "type": "object", "required": ["closed"], "properties": { "closed": { "type": "string" } } }
```
- **Note** Requires Godot 4.4+ (`EditorInterface.close_scene()`); on Godot 4.3 the tool returns an `unsupported` error instead of closing.

### `scene_pack` ✅ · destructive (writes a new file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "to_path"], "properties": { "path": { "type": "string" }, "to_path": { "type": "string", "pattern": "^res://" } } }
```
- **Output**
```json
{ "type": "object", "required": ["packed", "branch"], "properties": { "packed": { "type": "string" }, "branch": { "type": "string" } } }
```

### `scene_get_dependencies` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "properties": { "path": { "type": "string", "description": "omitted = current scene" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "dependencies"], "properties": { "path": { "type": "string" }, "dependencies": { "type": "array", "items": { "type": "string" } } } }
```

### `scene_save_as` ✅ · destructive (writes a new file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string", "pattern": "^res://" } } }
```
- **Output**
```json
{ "type": "object", "required": ["saved_as"], "properties": { "saved_as": { "type": "string" } } }
```

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
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" } } }
```

### `node_delete` ✅ · destructive  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["deleted"], "properties": { "deleted": { "type": "string" } } }
```

### `node_rename` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "new_name"],
  "properties": { "path": { "type": "string" }, "new_name": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name"], "properties": { "path": { "type": "string" }, "name": { "type": "string" } } }
```

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
- **Output**
```json
{ "type": "object", "required": ["path"], "properties": { "path": { "type": "string" } } }
```

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
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "property"], "properties": { "path": { "type": "string" }, "property": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "property", "value"],
  "properties": { "path": { "type": "string" }, "property": { "type": "string" }, "value": { "$ref": "#/$defs/Variant" } } }
```

### `node_duplicate` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" }, "name": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" } } }
```

### `node_get_children` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "children"], "properties": { "path": { "type": "string" }, "children": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "type": { "type": "string" }, "path": { "type": "string" } } } } } }
```

### `node_find` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "properties": { "root_path": { "type": "string" }, "type": { "type": "string" }, "name_contains": { "type": "string" }, "limit": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["matches", "count"], "properties": { "matches": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "type": { "type": "string" }, "path": { "type": "string" } } } }, "count": { "type": "integer" } } }
```

### `node_list_groups` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "groups"], "properties": { "path": { "type": "string" }, "groups": { "type": "array", "items": { "type": "string" } } } }
```

### `node_add_to_group` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "group"], "properties": { "path": { "type": "string" }, "group": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "group", "added"], "properties": { "path": { "type": "string" }, "group": { "type": "string" }, "added": { "type": "boolean" } } }
```

### `node_remove_from_group` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "group"], "properties": { "path": { "type": "string" }, "group": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "group", "removed"], "properties": { "path": { "type": "string" }, "group": { "type": "string" }, "removed": { "type": "boolean" } } }
```

### `node_instantiate_scene` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path", "scene_path"], "properties": { "parent_path": { "type": "string", "description": "'.' for root" }, "scene_path": { "type": "string", "pattern": "^res://" }, "name": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "scene"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "scene": { "type": "string" } } }
```

### `node_move_child` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "to_index"], "properties": { "path": { "type": "string" }, "to_index": { "type": "integer", "description": "0-based; negative counts from the end" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "index"], "properties": { "path": { "type": "string" }, "index": { "type": "integer" } } }
```

### `node_change_type` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "type"], "properties": { "path": { "type": "string" }, "type": { "type": "string", "description": "new engine class" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "old_type"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "old_type": { "type": "string" } } }
```

### `node_set_owner` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" }, "owner_path": { "type": "string", "description": "'.' or omitted = scene root" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "owner"], "properties": { "path": { "type": "string" }, "owner": { "type": ["string", "null"] } } }
```

### `node_call_method` ✅ · destructive (arbitrary invocation, edit-time)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "method"], "properties": { "path": { "type": "string" }, "method": { "type": "string" }, "args": { "type": "array", "items": { "$ref": "#/$defs/Variant" } } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "method", "result"], "properties": { "path": { "type": "string" }, "method": { "type": "string" }, "result": { "$ref": "#/$defs/Variant" } } }
```

### `node_get_path` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "index", "child_count"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "index": { "type": "integer" }, "parent": { "type": ["string", "null"] }, "child_count": { "type": "integer" } } }
```

### `node_list_properties` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "properties"], "properties": { "path": { "type": "string" }, "properties": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "type": { "type": "integer" }, "class_name": { "type": "string" }, "usage": { "type": "integer" } } } } } }
```

### `signal_list` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "signals"], "properties": { "path": { "type": "string" }, "signals": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "args": { "type": "array", "items": { "type": "string" } } } } } } }
```

### `signal_list_connections` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" }, "signal": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "connections"], "properties": { "path": { "type": "string" }, "connections": { "type": "array", "items": { "type": "object", "properties": { "signal": { "type": "string" }, "target": { "type": ["string", "null"] }, "method": { "type": "string" }, "flags": { "type": "integer" } } } } } }
```

### `signal_connect` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "signal", "target_path", "method"], "properties": { "path": { "type": "string" }, "signal": { "type": "string" }, "target_path": { "type": "string" }, "method": { "type": "string" }, "flags": { "type": "integer", "default": 2 } } }
```
- **Output**
```json
{ "type": "object", "required": ["signal", "source", "target", "method", "flags", "connected"], "properties": { "signal": { "type": "string" }, "source": { "type": "string" }, "target": { "type": "string" }, "method": { "type": "string" }, "flags": { "type": "integer" }, "connected": { "type": "boolean" } } }
```

### `signal_disconnect` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "signal", "target_path", "method"], "properties": { "path": { "type": "string" }, "signal": { "type": "string" }, "target_path": { "type": "string" }, "method": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["signal", "source", "target", "method", "disconnected"], "properties": { "signal": { "type": "string" }, "source": { "type": "string" }, "target": { "type": "string" }, "method": { "type": "string" }, "disconnected": { "type": "boolean" } } }
```

### `signal_add_user_signal` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "signal"], "properties": { "path": { "type": "string" }, "signal": { "type": "string" }, "args": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "type": { "type": "integer" } } } } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "signal", "added"], "properties": { "path": { "type": "string" }, "signal": { "type": "string" }, "added": { "type": "boolean" } } }
```

### `signal_emit` ✅ · destructive (edit-time side effects)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "signal"], "properties": { "path": { "type": "string" }, "signal": { "type": "string" }, "args": { "type": "array", "items": { "$ref": "#/$defs/Variant" } } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "signal", "emitted"], "properties": { "path": { "type": "string" }, "signal": { "type": "string" }, "emitted": { "type": "boolean" } } }
```

### `selection_get` ✅
- **Input**
```json
{ "type": "object", "properties": {} }
```
- **Output**
```json
{ "type": "object", "required": ["selection"], "properties": { "selection": { "type": "array", "items": { "type": "string" } } } }
```

### `selection_set` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["paths"], "properties": { "paths": { "type": "array", "items": { "type": "string" } } } }
```
- **Output**
```json
{ "type": "object", "required": ["selection"], "properties": { "selection": { "type": "array", "items": { "type": "string" } } } }
```

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
- **Input**
```json
{ "type": "object", "additionalProperties": false, "properties": { "viewport": { "enum": ["2d", "3d"], "default": "3d" } } }
```
- **Output** — MCP `content: [{ type: "image", data, mimeType }, { type: "text" }]`. Bridge payload:
```json
{ "type": "object", "required": ["base64", "mime", "width", "height", "viewport"],
  "properties": {
    "base64": { "type": "string" }, "mime": { "const": "image/png" },
    "width": { "type": "integer" }, "height": { "type": "integer" },
    "viewport": { "enum": ["2d", "3d"] }
  } }
```

### `resource_create` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["class_name", "to_path"], "properties": { "class_name": { "type": "string" }, "to_path": { "type": "string", "pattern": "^res://" }, "properties": { "type": "object" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["created", "type"], "properties": { "created": { "type": "string" }, "type": { "type": "string" } } }
```

### `resource_load` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "type", "resource_name", "properties"], "properties": { "path": { "type": "string" }, "type": { "type": "string" }, "resource_name": { "type": "string" }, "properties": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "type": { "type": "integer" }, "class_name": { "type": "string" }, "usage": { "type": "integer" } } } } } }
```

### `resource_save` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["from_path"], "properties": { "from_path": { "type": "string" }, "to_path": { "type": "string", "pattern": "^res://" }, "flags": { "type": "integer" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["saved", "from"], "properties": { "saved": { "type": "string" }, "from": { "type": "string" } } }
```

### `resource_duplicate` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "to_path"], "properties": { "path": { "type": "string" }, "to_path": { "type": "string", "pattern": "^res://" }, "deep": { "type": "boolean" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["duplicated", "from", "deep"], "properties": { "duplicated": { "type": "string" }, "from": { "type": "string" }, "deep": { "type": "boolean" } } }
```

### `resource_get_property` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "property"], "properties": { "path": { "type": "string" }, "property": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "property", "value"], "properties": { "path": { "type": "string" }, "property": { "type": "string" }, "value": {} } }
```

### `resource_set_property` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "property", "value"], "properties": { "path": { "type": "string" }, "property": { "type": "string" }, "value": {}, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "property", "value"], "properties": { "path": { "type": "string" }, "property": { "type": "string" }, "value": {} } }
```

### `resource_get_import_settings` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "imported", "importer", "settings"], "properties": { "path": { "type": "string" }, "imported": { "type": "boolean" }, "importer": { "type": "string" }, "settings": { "type": "object" } } }
```

### `resource_set_import_settings` ✅ · destructive (rewrites metadata + reimports)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "settings"], "properties": { "path": { "type": "string" }, "settings": { "type": "object" }, "reimport": { "type": "boolean" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "reimported", "settings"], "properties": { "path": { "type": "string" }, "reimported": { "type": "boolean" }, "settings": { "type": "array", "items": { "type": "string" } } } }
```

### `filesystem_list` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "properties": { "path": { "type": "string", "description": "default res://" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "dirs", "files"], "properties": { "path": { "type": "string" }, "dirs": { "type": "array", "items": { "type": "string" } }, "files": { "type": "array", "items": { "type": "string" } } } }
```

### `filesystem_scan` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "properties": {} }
```
- **Output**
```json
{ "type": "object", "required": ["scanning"], "properties": { "scanning": { "type": "boolean" } } }
```

### `filesystem_move` ✅ · destructive (moves on disk; no reference remap)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["from_path", "to_path"], "properties": { "from_path": { "type": "string", "pattern": "^res://" }, "to_path": { "type": "string", "pattern": "^res://" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["moved", "from", "moved_import"], "properties": { "moved": { "type": "string" }, "from": { "type": "string" }, "moved_import": { "type": "boolean" } } }
```

### `filesystem_create_dir` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string", "pattern": "^res://" } } }
```
- **Output**
```json
{ "type": "object", "required": ["created", "existed"], "properties": { "created": { "type": "string" }, "existed": { "type": "boolean" } } }
```

## Group C — Animation (Plane A / Editor)

Authoring over an in-scene `AnimationPlayer`; animations live in its `AnimationLibrary` resources. Every mutation goes through `EditorUndoRedoManager` (undoable, nothing written to disk). Names are addressed as `animation` within a `library` (default `""`).

Batch 2 (`anim_tree_*`, `anim_statemachine_*`) authors an `AnimationTree` node and its `tree_root` graph — an `AnimationNodeBlendTree` or `AnimationNodeStateMachine` — adding graph nodes, state-machine states, and transitions. Same model: undoable via `EditorUndoRedoManager`, ungated, nothing written to disk.

### `anim_player_create` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path"], "properties": { "parent_path": { "type": "string" }, "name": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" } } }
```

### `anim_create` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["player_path", "name"], "properties": { "player_path": { "type": "string" }, "name": { "type": "string" }, "library": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["player", "library", "name"], "properties": { "player": { "type": "string" }, "library": { "type": "string" }, "name": { "type": "string" } } }
```

### `anim_delete` ✅ · destructive (removes an animation; gated)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["player_path", "name"], "properties": { "player_path": { "type": "string" }, "name": { "type": "string" }, "library": { "type": "string" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["player", "library", "deleted"], "properties": { "player": { "type": "string" }, "library": { "type": "string" }, "deleted": { "type": "string" } } }
```

### `anim_add_track` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["player_path", "name", "path"], "properties": { "player_path": { "type": "string" }, "name": { "type": "string" }, "path": { "type": "string", "description": "node path or Node:property" }, "type": { "type": "string", "enum": ["value", "position_3d", "rotation_3d", "scale_3d", "blend_shape", "method", "bezier", "audio", "animation"] }, "library": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["track", "type", "path"], "properties": { "track": { "type": "integer" }, "type": { "type": "string" }, "path": { "type": "string" } } }
```

### `anim_insert_key` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["player_path", "name", "track", "time", "value"], "properties": { "player_path": { "type": "string" }, "name": { "type": "string" }, "track": { "type": "integer" }, "time": { "type": "number" }, "value": { "description": "Variant matching the track type" }, "transition": { "type": "number" }, "library": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["track", "time", "key_count"], "properties": { "track": { "type": "integer" }, "time": { "type": "number" }, "key_count": { "type": "integer" } } }
```

### `anim_remove_key` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["player_path", "name", "track", "key"], "properties": { "player_path": { "type": "string" }, "name": { "type": "string" }, "track": { "type": "integer" }, "key": { "type": "integer" }, "library": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["track", "removed_key", "time"], "properties": { "track": { "type": "integer" }, "removed_key": { "type": "integer" }, "time": { "type": "number" } } }
```

### `anim_set_length` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["player_path", "name", "length"], "properties": { "player_path": { "type": "string" }, "name": { "type": "string" }, "length": { "type": "number" }, "library": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["length", "previous"], "properties": { "length": { "type": "number" }, "previous": { "type": "number" } } }
```

### `anim_set_loop` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["player_path", "name", "mode"], "properties": { "player_path": { "type": "string" }, "name": { "type": "string" }, "mode": { "type": "string", "enum": ["none", "linear", "pingpong"] }, "library": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["mode", "previous"], "properties": { "mode": { "type": "string" }, "previous": { "type": "string" } } }
```

### `anim_get_track_keys` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["player_path", "name", "track"], "properties": { "player_path": { "type": "string" }, "name": { "type": "string" }, "track": { "type": "integer" }, "library": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["track", "type", "path", "keys"], "properties": { "track": { "type": "integer" }, "type": { "type": "string" }, "path": { "type": "string" }, "keys": { "type": "array", "items": { "type": "object", "properties": { "index": { "type": "integer" }, "time": { "type": "number" }, "value": {}, "transition": { "type": "number" } } } } } }
```

### `anim_list` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["player_path"], "properties": { "player_path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["player", "animations"], "properties": { "player": { "type": "string" }, "animations": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "library": { "type": "string" }, "animation": { "type": "string" }, "length": { "type": "number" }, "loop_mode": { "type": "string" }, "track_count": { "type": "integer" } } } } } }
```

### `anim_tree_create` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path"], "properties": { "parent_path": { "type": "string" }, "name": { "type": "string" }, "root_type": { "type": "string", "enum": ["blend_tree", "state_machine"] }, "anim_player_path": { "type": "string" }, "active": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "root_type", "anim_player", "active"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "root_type": { "type": "string" }, "anim_player": { "type": "string" }, "active": { "type": "boolean" } } }
```

### `anim_tree_add_node` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["tree_path", "node_name", "node_type"], "properties": { "tree_path": { "type": "string" }, "node_name": { "type": "string" }, "node_type": { "type": "string" }, "animation": { "type": "string" }, "position": { "type": "array", "items": { "type": "number" } } } }
```
- **Output**
```json
{ "type": "object", "required": ["tree", "node_name", "node_type", "position"], "properties": { "tree": { "type": "string" }, "node_name": { "type": "string" }, "node_type": { "type": "string" }, "position": { "type": "array", "items": { "type": "number" } } } }
```

### `anim_statemachine_add_state` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["tree_path", "state_name"], "properties": { "tree_path": { "type": "string" }, "state_name": { "type": "string" }, "animation": { "type": "string" }, "node_type": { "type": "string" }, "state_machine": { "type": "string" }, "position": { "type": "array", "items": { "type": "number" } } } }
```
- **Output**
```json
{ "type": "object", "required": ["tree", "state_machine", "state_name", "node_type", "animation", "position"], "properties": { "tree": { "type": "string" }, "state_machine": { "type": "string" }, "state_name": { "type": "string" }, "node_type": { "type": "string" }, "animation": { "type": "string" }, "position": { "type": "array", "items": { "type": "number" } } } }
```

### `anim_statemachine_add_transition` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["tree_path", "from_state", "to_state"], "properties": { "tree_path": { "type": "string" }, "from_state": { "type": "string" }, "to_state": { "type": "string" }, "state_machine": { "type": "string" }, "xfade_time": { "type": "number" }, "switch_mode": { "type": "string", "enum": ["immediate", "sync", "at_end"] }, "advance_mode": { "type": "string", "enum": ["disabled", "enabled", "auto"] }, "advance_condition": { "type": "string" }, "priority": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["tree", "state_machine", "from_state", "to_state", "xfade_time", "switch_mode", "advance_mode", "transition_count"], "properties": { "tree": { "type": "string" }, "state_machine": { "type": "string" }, "from_state": { "type": "string" }, "to_state": { "type": "string" }, "xfade_time": { "type": "number" }, "switch_mode": { "type": "string" }, "advance_mode": { "type": "string" }, "transition_count": { "type": "integer" } } }
```

## Group D — TileMap/TileSet (Plane A / Editor)

Disk-backed TileSet authoring: each tool loads a `.tres` `TileSet`, mutates it, and re-saves — so all four are file-writing and **gated** by confirmation, and none need a scene open. Sources are `TileSetAtlasSource` (a texture carved into a grid); tiles are addressed by `atlas_coords` in cells; per-tile collision polygons live on `TileData` under numbered physics layers (created on demand). `tilemaplayer_create` and the `tilemap_*` cell painters (Group D batch 2) consume the TileSet produced here.

Batch 2 (`tilemaplayer_create`, `tilemap_*`) is the other half: it authors a `TileMapLayer` **node in the edited scene** and paints its cells. Unlike the disk-backed writers above, these mutate the open scene and are **undoable** via `EditorUndoRedoManager` and **ungated** (the in-scene `node_*` model). `tilemaplayer_create` optionally binds a TileSet `.tres` as the layer's `tile_set`; cells are addressed by integer `coords` and painted with a `source_id` + `atlas_coords` (+ `alternative`). `set_cell` with `source_id` -1 erases; `set_cells_rect` fills a region in one undoable action (capped at 65536 cells); an empty cell reads back as `source_id` -1 / `atlas_coords` [-1, -1] / `alternative` 0. `TileMapLayer` supersedes the deprecated `TileMap` node in Godot 4.x.

### `tileset_create` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["to_path"], "properties": { "to_path": { "type": "string", "pattern": "^res://" }, "tile_size": { "type": "array", "items": { "type": "integer" } }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["created", "tile_size"], "properties": { "created": { "type": "string" }, "tile_size": { "type": "array", "items": { "type": "integer" } } } }
```

### `tileset_add_source` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["tileset_path", "texture_path"], "properties": { "tileset_path": { "type": "string" }, "texture_path": { "type": "string" }, "texture_region_size": { "type": "array", "items": { "type": "integer" } }, "source_id": { "type": "integer" }, "margins": { "type": "array", "items": { "type": "integer" } }, "separation": { "type": "array", "items": { "type": "integer" } }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["tileset", "source_id", "texture", "texture_region_size", "source_count"], "properties": { "tileset": { "type": "string" }, "source_id": { "type": "integer" }, "texture": { "type": "string" }, "texture_region_size": { "type": "array", "items": { "type": "integer" } }, "source_count": { "type": "integer" } } }
```

### `tileset_add_tile` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["tileset_path", "source_id", "atlas_coords"], "properties": { "tileset_path": { "type": "string" }, "source_id": { "type": "integer" }, "atlas_coords": { "type": "array", "items": { "type": "integer" } }, "size": { "type": "array", "items": { "type": "integer" } }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["tileset", "source_id", "atlas_coords", "size", "tiles_count"], "properties": { "tileset": { "type": "string" }, "source_id": { "type": "integer" }, "atlas_coords": { "type": "array", "items": { "type": "integer" } }, "size": { "type": "array", "items": { "type": "integer" } }, "tiles_count": { "type": "integer" } } }
```

### `tileset_set_tile_collision` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["tileset_path", "source_id", "atlas_coords", "polygon"], "properties": { "tileset_path": { "type": "string" }, "source_id": { "type": "integer" }, "atlas_coords": { "type": "array", "items": { "type": "integer" } }, "polygon": { "type": "array", "items": { "type": "array", "items": { "type": "number" } } }, "physics_layer": { "type": "integer" }, "one_way": { "type": "boolean" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["tileset", "source_id", "atlas_coords", "physics_layer", "polygon_index", "points", "one_way"], "properties": { "tileset": { "type": "string" }, "source_id": { "type": "integer" }, "atlas_coords": { "type": "array", "items": { "type": "integer" } }, "physics_layer": { "type": "integer" }, "polygon_index": { "type": "integer" }, "points": { "type": "integer" }, "one_way": { "type": "boolean" } } }
```

### `tilemaplayer_create` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path"], "properties": { "parent_path": { "type": "string" }, "name": { "type": "string" }, "tileset_path": { "type": "string", "pattern": "^res://" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "tile_set"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "tile_set": { "type": "string" } } }
```

### `tilemap_set_cell` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "coords"], "properties": { "path": { "type": "string" }, "coords": { "type": "array", "items": { "type": "integer" } }, "source_id": { "type": "integer" }, "atlas_coords": { "type": "array", "items": { "type": "integer" } }, "alternative": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "coords", "source_id", "atlas_coords", "alternative", "erased"], "properties": { "path": { "type": "string" }, "coords": { "type": "array", "items": { "type": "integer" } }, "source_id": { "type": "integer" }, "atlas_coords": { "type": "array", "items": { "type": "integer" } }, "alternative": { "type": "integer" }, "erased": { "type": "boolean" } } }
```

### `tilemap_set_cells_rect` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "rect"], "properties": { "path": { "type": "string" }, "rect": { "type": "array", "items": { "type": "integer" }, "minItems": 4, "description": "[x, y, width, height] in cells" }, "source_id": { "type": "integer" }, "atlas_coords": { "type": "array", "items": { "type": "integer" } }, "alternative": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "rect", "cells", "source_id", "atlas_coords", "alternative", "erased"], "properties": { "path": { "type": "string" }, "rect": { "type": "array", "items": { "type": "integer" } }, "cells": { "type": "integer" }, "source_id": { "type": "integer" }, "atlas_coords": { "type": "array", "items": { "type": "integer" } }, "alternative": { "type": "integer" }, "erased": { "type": "boolean" } } }
```

### `tilemap_get_cell` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "coords"], "properties": { "path": { "type": "string" }, "coords": { "type": "array", "items": { "type": "integer" } } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "coords", "source_id", "atlas_coords", "alternative", "empty"], "properties": { "path": { "type": "string" }, "coords": { "type": "array", "items": { "type": "integer" } }, "source_id": { "type": "integer" }, "atlas_coords": { "type": "array", "items": { "type": "integer" } }, "alternative": { "type": "integer" }, "empty": { "type": "boolean" } } }
```

### `tilemap_clear` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "cleared_cells"], "properties": { "path": { "type": "string" }, "cleared_cells": { "type": "integer" } } }
```

## Group E — Physics & collision (Plane A / Editor)

In-scene physics authoring. Every tool mutates the **edited scene** and is **undoable** via `EditorUndoRedoManager` and **ungated** — the `node_*` / `tilemap_*` model, not the disk-writing gated `tileset_*` model. `body_create` adds a `StaticBody`/`RigidBody`/`CharacterBody`/`Area` node; `collisionshape_add` adds a `CollisionShape2D`/`CollisionShape3D` carrying a shape resource (`rect`→Rectangle/Box, `circle`→Circle/Sphere, `capsule`→Capsule 2D/3D, `polygon`→ConvexPolygon 2D/3D); `body_set_collision_layer` / `body_set_collision_mask` set the bitmasks on any body or area (`CollisionObject2D/3D`). `dim` selects 2D (default) or 3D. The API surface (bodies + `CollisionShape2D/3D` + the six shape resources) was probed live on Godot 4.7, and a `StaticBody2D → CollisionShape2D(RectangleShape2D)` scene was packed to a `.tscn`, saved, and reloaded — body `collision_layer` and the shape (type + `size`) survive the round-trip. This is the group that crosses godot-mcp-pro's 162-tool ceiling. Batch 1 added bodies, collision shapes, and layer/mask; **batch 2 completes the group** (now **165**): `area_set_monitoring` / `area_set_gravity` (Area monitoring + gravity zones), `joint_create` / `joint_set_bodies` (2D `PinJoint2D`/`GrooveJoint2D`/`DampedSpringJoint2D`, 3D `PinJoint3D`/`HingeJoint3D`/`SliderJoint3D`/`ConeTwistJoint3D`/`Generic6DOFJoint3D`), `collisionpolygon_add` (`CollisionPolygon2D/3D`), `rigidbody_set_properties`, `body_set_physics_material` (a `PhysicsMaterial` override), and the gated `physics_set_gravity` (project `default_gravity`). All node/property mutators are undoable and ungated; `physics_set_gravity` writes ProjectSettings and is gated like `project_set_setting`. Every joint/area/rigidbody/polygon/material API was probed live on Godot 4.7 before design.

### `body_create` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path", "type"], "properties": { "parent_path": { "type": "string" }, "type": { "type": "string", "enum": ["static", "rigid", "character", "area"] }, "dim": { "type": "string", "enum": ["2d", "3d"] }, "name": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "body", "dim"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "body": { "type": "string" }, "dim": { "type": "string" } } }
```

### `collisionshape_add` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path", "shape"], "properties": { "parent_path": { "type": "string" }, "shape": { "type": "string", "enum": ["rect", "circle", "capsule", "polygon"] }, "dim": { "type": "string", "enum": ["2d", "3d"] }, "name": { "type": "string" }, "size": { "type": "array", "items": { "type": "number" } }, "radius": { "type": "number" }, "height": { "type": "number" }, "points": { "type": "array", "items": { "type": "array", "items": { "type": "number" } } } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "shape", "shape_class", "dim"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "shape": { "type": "string" }, "shape_class": { "type": "string" }, "dim": { "type": "string" } } }
```

### `body_set_collision_layer` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "layer"], "properties": { "path": { "type": "string" }, "layer": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "collision_layer"], "properties": { "path": { "type": "string" }, "collision_layer": { "type": "integer" } } }
```

### `body_set_collision_mask` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "mask"], "properties": { "path": { "type": "string" }, "mask": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "collision_mask"], "properties": { "path": { "type": "string" }, "collision_mask": { "type": "integer" } } }
```

### `area_set_monitoring` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" }, "monitoring": { "type": "boolean" }, "monitorable": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "monitoring", "monitorable"], "properties": { "path": { "type": "string" }, "monitoring": { "type": "boolean" }, "monitorable": { "type": "boolean" } } }
```

### `area_set_gravity` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" }, "space_override": { "type": "string", "enum": ["disabled", "combine", "combine_replace", "replace", "replace_combine"] }, "gravity": { "type": "number" }, "direction": { "type": "array", "items": { "type": "number" } }, "point": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "space_override", "gravity", "direction", "gravity_point", "dim"], "properties": { "path": { "type": "string" }, "space_override": { "type": "string" }, "gravity": { "type": "number" }, "direction": { "type": "array", "items": { "type": "number" } }, "gravity_point": { "type": "boolean" }, "dim": { "type": "string" } } }
```

### `joint_create` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path", "type"], "properties": { "parent_path": { "type": "string" }, "type": { "type": "string", "enum": ["pin", "groove", "spring", "hinge", "slider", "cone_twist", "generic6dof"] }, "dim": { "type": "string", "enum": ["2d", "3d"] }, "name": { "type": "string" }, "node_a": { "type": "string" }, "node_b": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "joint", "dim", "node_a", "node_b"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "joint": { "type": "string" }, "dim": { "type": "string" }, "node_a": { "type": "string" }, "node_b": { "type": "string" } } }
```

### `joint_set_bodies` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" }, "node_a": { "type": "string" }, "node_b": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "node_a", "node_b"], "properties": { "path": { "type": "string" }, "node_a": { "type": "string" }, "node_b": { "type": "string" } } }
```

### `collisionpolygon_add` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path", "points"], "properties": { "parent_path": { "type": "string" }, "points": { "type": "array", "items": { "type": "array", "items": { "type": "number" } } }, "dim": { "type": "string", "enum": ["2d", "3d"] }, "name": { "type": "string" }, "build_mode": { "type": "string", "enum": ["solids", "segments"] }, "depth": { "type": "number" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "dim", "points"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "dim": { "type": "string" }, "points": { "type": "integer" } } }
```

### `rigidbody_set_properties` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" }, "mass": { "type": "number" }, "gravity_scale": { "type": "number" }, "linear_damp": { "type": "number" }, "angular_damp": { "type": "number" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "mass", "gravity_scale", "linear_damp", "angular_damp"], "properties": { "path": { "type": "string" }, "mass": { "type": "number" }, "gravity_scale": { "type": "number" }, "linear_damp": { "type": "number" }, "angular_damp": { "type": "number" } } }
```

### `body_set_physics_material` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" }, "friction": { "type": "number" }, "bounce": { "type": "number" }, "rough": { "type": "boolean" }, "absorbent": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "friction", "bounce", "rough", "absorbent"], "properties": { "path": { "type": "string" }, "friction": { "type": "number" }, "bounce": { "type": "number" }, "rough": { "type": "boolean" }, "absorbent": { "type": "boolean" } } }
```

### `physics_set_gravity` ✅  (gated)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "properties": { "dim": { "type": "string", "enum": ["2d", "3d"] }, "magnitude": { "type": "number" }, "direction": { "type": "array", "items": { "type": "number" } }, "save": { "type": "boolean" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["dim", "magnitude", "direction", "saved"], "properties": { "dim": { "type": "string" }, "magnitude": { "type": "number" }, "direction": { "type": "array", "items": { "type": "number" } }, "saved": { "type": "boolean" } } }
```

## Group F — VFX & audio (Plane A / Editor)

In-scene VFX authoring. Every tool mutates the **edited scene** and is **undoable** via `EditorUndoRedoManager` and **ungated** — the `node_*` model. Batch 1 covers **GPU particles**: `particles_create` adds a `GPUParticles2D`/`GPUParticles3D` (`dim` selects 2D default or 3D), optionally seeding `amount`/`lifetime`/`emitting`; `particles_set_process_material` creates a `ParticleProcessMaterial` and assigns it as `process_material` (GPU particles need one to emit), exposing `gravity`/`direction` (Vector3), `spread`, `initial_velocity_min`/`_max`, `scale_min`/`_max`, and `color`; `particles_set_amount` / `particles_set_lifetime` / `particles_set_emitting` tune the headline knobs individually; `particles_set_texture` loads a `Texture2D` from a `res://` path onto a `GPUParticles2D` — GPUParticles3D draws meshes and has no texture, so it degrades to a clear `unsupported`. The particle + `ParticleProcessMaterial` API surface (properties present per dim, the 2D-only `texture`) was probed live on Godot 4.7 before design. **Batch 2 adds shaders** (now **176**): `shader_create` and `shader_set_code` author a `Shader` (`.gdshader`) resource on disk — initial or replacement GDShader source — and, because they write files, are **gated** by confirmation like the `resource_*` / `tileset_*` writers (not the in-scene model); `shadermaterial_create` creates a `ShaderMaterial` and assigns it to a node's material slot — `CanvasItem.material` (2D / Control) or `GeometryInstance3D.material_override` (3D), degrading to a clear `unsupported` for a node with neither — optionally binding a `Shader` loaded from a `res://` path; `shadermaterial_set_shader` swaps the shader on an existing `ShaderMaterial`; `shadermaterial_set_param` sets a uniform through the `shader_parameter/<name>` property path (values use the tagged-Variant convention). The three `shadermaterial_*` tools mutate the edited scene and are **undoable** and **ungated**. `Shader` / `ShaderMaterial` / `set_shader_parameter` and the `shader_parameter/<name>` property-path form were probed live on Godot 4.7, and a `Sprite2D` carrying a `ShaderMaterial` (external `.gdshader` + a `shader_parameter` override) survives a `.tscn` save + fresh reload. **Batch 3 completes Group F with audio** (now **182**): `audio_player_create` adds an `AudioStreamPlayer` / `AudioStreamPlayer2D` / `AudioStreamPlayer3D` (`dim` selects `none` default / `2d` / `3d`), optionally seeding `stream_path` (a `res://` `AudioStream`), `autoplay`, `volume_db`, `bus`; `audio_set_stream` loads an `AudioStream` from a `res://` path onto a player — both mutate the edited scene and are **undoable** / **ungated** (the `node_*` model). The remaining four drive the **global `AudioServer`** (project-wide, not scene-undoable) and are **gated** like `physics_set_gravity`: `audio_bus_add` adds a bus (optional name / position / send), `audio_bus_add_effect` instantiates an `AudioEffect` subclass by name onto a named bus, `audio_bus_set_volume` sets a bus's `volume_db`, and `audio_set_bus_layout` persists the current layout to a `.tres` on disk (`generate_bus_layout` + `ResourceSaver.save`; a file-writer). The `AudioServer` bus API and the player `stream` / `autoplay` / `volume_db` / `bus` props were probed live on Godot 4.7, and an `AudioStreamPlayer` carrying an external stream survives a `.tscn` save + fresh reload.

### `particles_create` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path"], "properties": { "parent_path": { "type": "string" }, "dim": { "type": "string", "enum": ["2d", "3d"] }, "name": { "type": "string" }, "amount": { "type": "number" }, "lifetime": { "type": "number" }, "emitting": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "dim", "amount", "lifetime", "emitting"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "dim": { "type": "string" }, "amount": { "type": "number" }, "lifetime": { "type": "number" }, "emitting": { "type": "boolean" } } }
```

### `particles_set_process_material` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" }, "gravity": { "type": "array", "items": { "type": "number" } }, "direction": { "type": "array", "items": { "type": "number" } }, "spread": { "type": "number" }, "initial_velocity_min": { "type": "number" }, "initial_velocity_max": { "type": "number" }, "scale_min": { "type": "number" }, "scale_max": { "type": "number" }, "color": { "type": "array", "items": { "type": "number" } } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "gravity", "direction", "spread", "initial_velocity_min", "initial_velocity_max", "scale_min", "scale_max", "color"], "properties": { "path": { "type": "string" }, "gravity": { "type": "array", "items": { "type": "number" } }, "direction": { "type": "array", "items": { "type": "number" } }, "spread": { "type": "number" }, "initial_velocity_min": { "type": "number" }, "initial_velocity_max": { "type": "number" }, "scale_min": { "type": "number" }, "scale_max": { "type": "number" }, "color": { "type": "array", "items": { "type": "number" } } } }
```

### `particles_set_amount` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "amount"], "properties": { "path": { "type": "string" }, "amount": { "type": "number" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "amount"], "properties": { "path": { "type": "string" }, "amount": { "type": "number" } } }
```

### `particles_set_lifetime` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "lifetime"], "properties": { "path": { "type": "string" }, "lifetime": { "type": "number" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "lifetime"], "properties": { "path": { "type": "string" }, "lifetime": { "type": "number" } } }
```

### `particles_set_emitting` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "emitting"], "properties": { "path": { "type": "string" }, "emitting": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "emitting"], "properties": { "path": { "type": "string" }, "emitting": { "type": "boolean" } } }
```

### `particles_set_texture` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "texture_path"], "properties": { "path": { "type": "string" }, "texture_path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "texture_path"], "properties": { "path": { "type": "string" }, "texture_path": { "type": "string" } } }
```

### `shader_create` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["to_path"], "properties": { "to_path": { "type": "string" }, "code": { "type": "string" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["created", "type", "code_length"], "properties": { "created": { "type": "string" }, "type": { "type": "string" }, "code_length": { "type": "number" } } }
```

### `shader_set_code` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "code"], "properties": { "path": { "type": "string" }, "code": { "type": "string" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "code_length"], "properties": { "path": { "type": "string" }, "code_length": { "type": "number" } } }
```

### `shadermaterial_create` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" }, "shader_path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "target_property", "type", "shader_path"], "properties": { "path": { "type": "string" }, "target_property": { "type": "string" }, "type": { "type": "string" }, "shader_path": { "type": "string" } } }
```

### `shadermaterial_set_shader` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "shader_path"], "properties": { "path": { "type": "string" }, "shader_path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "shader_path"], "properties": { "path": { "type": "string" }, "shader_path": { "type": "string" } } }
```

### `shadermaterial_set_param` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "param", "value"], "properties": { "path": { "type": "string" }, "param": { "type": "string" }, "value": {} } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "param", "value"], "properties": { "path": { "type": "string" }, "param": { "type": "string" }, "value": {} } }
```

### `audio_player_create` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path"], "properties": { "parent_path": { "type": "string" }, "dim": { "type": "string", "enum": ["none", "2d", "3d"] }, "name": { "type": "string" }, "stream_path": { "type": "string" }, "autoplay": { "type": "boolean" }, "volume_db": { "type": "number" }, "bus": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "dim", "autoplay", "volume_db", "bus", "stream_path"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "dim": { "type": "string" }, "autoplay": { "type": "boolean" }, "volume_db": { "type": "number" }, "bus": { "type": "string" }, "stream_path": { "type": "string" } } }
```

### `audio_set_stream` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "stream_path"], "properties": { "path": { "type": "string" }, "stream_path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "stream_path"], "properties": { "path": { "type": "string" }, "stream_path": { "type": "string" } } }
```

### `audio_bus_add` ✅ · destructive (project-wide audio state)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": [], "properties": { "name": { "type": "string" }, "at_position": { "type": "number" }, "send": { "type": "string" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["index", "name", "send", "count"], "properties": { "index": { "type": "number" }, "name": { "type": "string" }, "send": { "type": "string" }, "count": { "type": "number" } } }
```

### `audio_bus_add_effect` ✅ · destructive (project-wide audio state)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["bus", "effect"], "properties": { "bus": { "type": "string" }, "effect": { "type": "string" }, "at_position": { "type": "number" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["bus", "bus_index", "effect", "effect_count"], "properties": { "bus": { "type": "string" }, "bus_index": { "type": "number" }, "effect": { "type": "string" }, "effect_count": { "type": "number" } } }
```

### `audio_bus_set_volume` ✅ · destructive (project-wide audio state)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["bus", "volume_db"], "properties": { "bus": { "type": "string" }, "volume_db": { "type": "number" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["bus", "bus_index", "volume_db"], "properties": { "bus": { "type": "string" }, "bus_index": { "type": "number" }, "volume_db": { "type": "number" } } }
```

### `audio_set_bus_layout` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": [], "properties": { "to_path": { "type": "string" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["saved", "bus_count"], "properties": { "saved": { "type": "string" }, "bus_count": { "type": "number" } } }
```

## Group G — UI / Control / theming (Plane A / Editor)

The user-interface authoring surface (now **195**). `control_create` and `container_add_child` add a **Control**-derived node (Button / Label / Panel / any `Container` / TextureRect / …) to the **edited scene** — both refuse a non-Control class, and `container_add_child` additionally refuses a non-`Container` parent so the child lands in a real layout container; `control_create` also seeds `text` on controls that expose it. `control_set_anchors` sets any of the four anchors (`left`/`top`/`right`/`bottom`, 0..1) directly; `control_set_layout_preset` applies a `LayoutPreset` (by name — `full_rect`, `center`, `top_left`, `hcenter_wide`, … — or the 0..15 integer) via `set_anchors_and_offsets_preset`, capturing all eight anchor/offset properties for a clean undo; `control_set_size_flags` sets the container `size_flags_horizontal` / `size_flags_vertical` bitmasks and/or `size_flags_stretch_ratio`; `control_set_theme` assigns (or clears) a `Theme` on a Control's `theme` property. All six mutate the edited scene and are **undoable** via `EditorUndoRedoManager` and **ungated** — the `node_*` model. The five `theme_*` tools author a **`Theme` resource on disk**: `theme_create` writes a new empty Theme, and `theme_set_color` / `theme_set_font` / `theme_set_stylebox` / `theme_set_constant` load a Theme, set one typed item (a `Color`, a `Font`/`StyleBox` loaded from a `res://` path, or an integer constant) for a given theme type, and re-save — so, like the `resource_*` / `shader_create` writers, they are **gated** by confirmation (not scene-undoable). The Control anchor / preset / size-flag / `theme` API and `Theme.set_color` / `set_font` / `set_stylebox` / `set_constant` were probed live on Godot 4.7 before design, and a `Button` carrying anchors + a `Theme` override survives a `.tscn` save + fresh reload.

### `control_create` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path", "type"], "properties": { "parent_path": { "type": "string" }, "type": { "type": "string" }, "name": { "type": "string" }, "text": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" } } }
```

### `container_add_child` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["container_path", "type"], "properties": { "container_path": { "type": "string" }, "type": { "type": "string" }, "name": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "container"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "container": { "type": "string" } } }
```

### `control_set_anchors` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" }, "left": { "type": "number" }, "top": { "type": "number" }, "right": { "type": "number" }, "bottom": { "type": "number" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "anchors"], "properties": { "path": { "type": "string" }, "anchors": { "type": "object", "required": ["left", "top", "right", "bottom"], "properties": { "left": { "type": "number" }, "top": { "type": "number" }, "right": { "type": "number" }, "bottom": { "type": "number" } } } } }
```

### `control_set_layout_preset` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "preset"], "properties": { "path": { "type": "string" }, "preset": { "type": ["string", "integer"] }, "resize_mode": { "type": "integer" }, "margin": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "preset", "preset_name"], "properties": { "path": { "type": "string" }, "preset": { "type": "number" }, "preset_name": { "type": "string" } } }
```

### `control_set_size_flags` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" }, "horizontal": { "type": "integer" }, "vertical": { "type": "integer" }, "stretch_ratio": { "type": "number" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "horizontal", "vertical", "stretch_ratio"], "properties": { "path": { "type": "string" }, "horizontal": { "type": "number" }, "vertical": { "type": "number" }, "stretch_ratio": { "type": "number" } } }
```

### `control_set_theme` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "theme_path"], "properties": { "path": { "type": "string" }, "theme_path": { "type": "string", "description": "Theme res:// path, or \"\" to clear" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "theme_path"], "properties": { "path": { "type": "string" }, "theme_path": { "type": "string" } } }
```

### `theme_create` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["to_path"], "properties": { "to_path": { "type": "string" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["created", "type"], "properties": { "created": { "type": "string" }, "type": { "type": "string" } } }
```

### `theme_set_color` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "name", "theme_type", "color"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "theme_type": { "type": "string" }, "color": { "type": "array", "items": { "type": "number" } }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "theme_type", "color"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "theme_type": { "type": "string" }, "color": { "type": "array", "items": { "type": "number" } } } }
```

### `theme_set_font` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "name", "theme_type", "font_path"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "theme_type": { "type": "string" }, "font_path": { "type": "string" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "theme_type", "font_path"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "theme_type": { "type": "string" }, "font_path": { "type": "string" } } }
```

### `theme_set_stylebox` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "name", "theme_type", "stylebox_path"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "theme_type": { "type": "string" }, "stylebox_path": { "type": "string" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "theme_type", "stylebox_path"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "theme_type": { "type": "string" }, "stylebox_path": { "type": "string" } } }
```

### `theme_set_constant` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "name", "theme_type", "value"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "theme_type": { "type": "string" }, "value": { "type": "integer" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "theme_type", "value"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "theme_type": { "type": "string" }, "value": { "type": "number" } } }
```

## Group H — 3D & navigation (Plane A / Editor)

The 3D authoring surface (now **205**). `meshinstance_create` adds a **MeshInstance3D** — optionally assigning a Mesh loaded from a `res://` path (e.g. a `primitive_mesh_create` output); `mesh_set_surface_material` assigns a `Material` (res:// path) to a MeshInstance3D, either the whole-instance `material_override` (default surface `-1`) or a specific surface's override slot, refusing a non-MeshInstance3D node or a non-`Material` resource; `light_create` adds a `DirectionalLight3D` / `OmniLight3D` / `SpotLight3D` (`kind` = dir/omni/spot); `camera_create` adds a `Camera3D` (optionally made `current`); `csg_create` adds a CSG primitive (`CSGBox3D` / `CSGSphere3D` / `CSGCylinder3D` / `CSGTorus3D` / `CSGPolygon3D` / `CSGMesh3D` / `CSGCombiner3D`); `navregion_create` adds a `NavigationRegion3D`, seeding a fresh empty `NavigationMesh` by default; `navagent_configure` adds a `NavigationAgent3D` and sets its steering/avoidance properties (radius, height, max_speed, path/target desired distances, avoidance_enabled). All seven mutate the edited scene and are **undoable** via `EditorUndoRedoManager` and **ungated** — the `node_*` model. Two families author a **resource on disk**: `primitive_mesh_create` writes a `PrimitiveMesh` (box/sphere/cylinder/plane/capsule/prism/torus/quad), and `environment_create` / `environment_set_sky` write and update an `Environment` (background mode + ambient light; attach a `Sky` with a Procedural / Physical / Panorama material and switch the background to SKY) — so, like the `resource_*` / `theme_*` writers, they are **gated** by confirmation. `navmesh_bake` is intentionally **deferred** — a real geometry bake is async and non-deterministic under a headless CI editor and awaits a maintainer semantics decision (like `scene_set_root`). The `MeshInstance3D` / `Light3D` / `Camera3D` / CSG / `NavigationRegion3D` / `NavigationAgent3D` and the `PrimitiveMesh` / `Environment` / `Sky` APIs were probed live on Godot 4.7 before design, and a `MeshInstance3D` carrying a primitive mesh + a `material_override` survives a `.tscn` save + fresh reload.

### `meshinstance_create` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path"], "properties": { "parent_path": { "type": "string" }, "name": { "type": "string" }, "mesh_path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "mesh_path"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "mesh_path": { "type": "string" } } }
```

### `mesh_set_surface_material` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "material_path"], "properties": { "path": { "type": "string" }, "material_path": { "type": "string" }, "surface": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "material_path", "surface"], "properties": { "path": { "type": "string" }, "material_path": { "type": "string" }, "surface": { "type": "number" } } }
```

### `primitive_mesh_create` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["to_path"], "properties": { "to_path": { "type": "string" }, "shape": { "type": "string" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["created", "type", "shape"], "properties": { "created": { "type": "string" }, "type": { "type": "string" }, "shape": { "type": "string" } } }
```

### `light_create` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path"], "properties": { "parent_path": { "type": "string" }, "kind": { "type": "string", "enum": ["dir", "directional", "omni", "spot"] }, "name": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "kind"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "kind": { "type": "string" } } }
```

### `camera_create` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path"], "properties": { "parent_path": { "type": "string" }, "name": { "type": "string" }, "current": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "current"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "current": { "type": "boolean" } } }
```

### `csg_create` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path"], "properties": { "parent_path": { "type": "string" }, "shape": { "type": "string" }, "name": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "shape"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "shape": { "type": "string" } } }
```

### `navregion_create` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path"], "properties": { "parent_path": { "type": "string" }, "name": { "type": "string" }, "with_navmesh": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "has_navmesh"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "has_navmesh": { "type": "boolean" } } }
```

### `navagent_configure` ✅  (undoable)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path"], "properties": { "parent_path": { "type": "string" }, "name": { "type": "string" }, "radius": { "type": "number" }, "height": { "type": "number" }, "max_speed": { "type": "number" }, "path_desired_distance": { "type": "number" }, "target_desired_distance": { "type": "number" }, "avoidance_enabled": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "config"], "properties": { "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" }, "config": { "type": "object", "required": ["radius", "height", "max_speed", "path_desired_distance", "target_desired_distance", "avoidance_enabled"], "properties": { "radius": { "type": "number" }, "height": { "type": "number" }, "max_speed": { "type": "number" }, "path_desired_distance": { "type": "number" }, "target_desired_distance": { "type": "number" }, "avoidance_enabled": { "type": "boolean" } } } } }
```

### `environment_create` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["to_path"], "properties": { "to_path": { "type": "string" }, "background": { "type": "string" }, "ambient_color": { "type": "array", "items": { "type": "number" } }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["created", "type", "background_mode"], "properties": { "created": { "type": "string" }, "type": { "type": "string" }, "background_mode": { "type": "string" } } }
```

### `environment_set_sky` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" }, "sky_material": { "type": "string", "enum": ["procedural", "physical", "panorama"] }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "background_mode", "sky_material"], "properties": { "path": { "type": "string" }, "background_mode": { "type": "string" }, "sky_material": { "type": "string" } } }
```

## Group I — Input, project config & testing (Plane A / Editor)

The project-authoring surface (now **217**). Four `inputmap_*` tools author the project's input actions in `ProjectSettings` (`input/<name>`): `inputmap_add_action` defines an action (deadzone + empty event list), `inputmap_add_event` appends an `InputEventKey` / `InputEventMouseButton` / `InputEventJoypadButton` / `InputEventJoypadMotion` built from a descriptor (`keycode`/`physical_keycode` accept a name like `"A"` via `OS.find_keycode_from_string` or an int), `inputmap_erase_action` removes one, and `inputmap_list` reads them all back (deadzone + each event's class and `as_text()`). Six project/editor-config tools follow: `project_add_autoload` / `project_remove_autoload` write `autoload/<name>` (a leading `*` marks an enabled global singleton) after checking the target `res://` path exists; `project_set_main_scene` writes `application/run/main_scene` (validated to be an existing `.tscn`/`.scn`); `project_list_settings` reads `ProjectSettings` keys+values filtered by a dotted prefix; `project_add_export_preset` appends a preset to `res://export_presets.cfg` via `ConfigFile`; and `editorsettings_get_set` reads an `EditorSettings` value, or writes it when a `value` is supplied. Two testing tools round out the family: `test_detect` reports an installed GUT / GdUnit4 framework (or `none`), and `test_list` enumerates `test_*.gd` / `*_test.gd` scripts under a directory. Every mutator that touches `ProjectSettings` or the editor config is **confirmation-gated** (the `project_set_setting` model, not the scene `EditorUndoRedoManager` history) and takes an optional `save` flag to persist to `project.godot`; the read-only `inputmap_list` / `project_list_settings` / `test_detect` / `test_list` are ungated. `test_run` and `test_result` are intentionally **deferred** — actually executing a framework's suite is async and non-deterministic under a headless CI editor and awaits a framework-bearing fixture project + a maintainer semantics decision (the same posture as `navmesh_bake` / `scene_set_root`). The `ProjectSettings` input/autoload/main-scene round-trips, `ConfigFile` export-preset write, and `EditorSettings` get/set were probed live on Godot 4.7.

### `inputmap_add_action` ✅ · destructive
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["name"], "properties": { "name": { "type": "string" }, "deadzone": { "type": "number" }, "save": { "type": "boolean" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["action", "deadzone", "saved"], "properties": { "action": { "type": "string" }, "deadzone": { "type": "number" }, "saved": { "type": "boolean" } } }
```

### `inputmap_add_event` ✅ · destructive
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["name", "event"], "properties": { "name": { "type": "string" }, "event": { "type": "object", "required": ["type"], "properties": { "type": { "type": "string", "enum": ["key", "mouse_button", "joy_button", "joy_motion"] }, "keycode": { "type": ["string", "number"] }, "physical_keycode": { "type": ["string", "number"] }, "button_index": { "type": "number" }, "axis": { "type": "number" }, "axis_value": { "type": "number" } } }, "save": { "type": "boolean" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["action", "event_count", "event_class", "saved"], "properties": { "action": { "type": "string" }, "event_count": { "type": "number" }, "event_class": { "type": "string" }, "saved": { "type": "boolean" } } }
```

### `inputmap_list` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "properties": {} }
```
- **Output**
```json
{ "type": "object", "required": ["count", "actions"], "properties": { "count": { "type": "number" }, "actions": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "deadzone": { "type": "number" }, "events": { "type": "array", "items": { "type": "object", "properties": { "class": { "type": "string" }, "text": { "type": "string" } } } } } } } } }
```

### `inputmap_erase_action` ✅ · destructive
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["name"], "properties": { "name": { "type": "string" }, "save": { "type": "boolean" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["erased", "action", "saved"], "properties": { "erased": { "type": "boolean" }, "action": { "type": "string" }, "saved": { "type": "boolean" } } }
```

### `project_add_autoload` ✅ · destructive
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["name", "path"], "properties": { "name": { "type": "string" }, "path": { "type": "string" }, "enabled": { "type": "boolean" }, "save": { "type": "boolean" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["autoload", "path", "enabled", "saved"], "properties": { "autoload": { "type": "string" }, "path": { "type": "string" }, "enabled": { "type": "boolean" }, "saved": { "type": "boolean" } } }
```

### `project_remove_autoload` ✅ · destructive
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["name"], "properties": { "name": { "type": "string" }, "save": { "type": "boolean" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["removed", "autoload", "saved"], "properties": { "removed": { "type": "boolean" }, "autoload": { "type": "string" }, "saved": { "type": "boolean" } } }
```

### `project_add_export_preset` ✅ · destructive (writes a file)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["name", "platform"], "properties": { "name": { "type": "string" }, "platform": { "type": "string" }, "runnable": { "type": "boolean" }, "export_path": { "type": "string" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["preset", "platform", "index", "path"], "properties": { "preset": { "type": "string" }, "platform": { "type": "string" }, "index": { "type": "number" }, "path": { "type": "string" } } }
```

### `project_set_main_scene` ✅ · destructive
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": { "path": { "type": "string" }, "save": { "type": "boolean" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["main_scene", "saved"], "properties": { "main_scene": { "type": "string" }, "saved": { "type": "boolean" } } }
```

### `project_list_settings` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "properties": { "prefix": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["prefix", "count", "settings"], "properties": { "prefix": { "type": "string" }, "count": { "type": "number" }, "settings": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "value": {} } } } } }
```

### `editorsettings_get_set` ✅ · destructive (on set)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["name"], "properties": { "name": { "type": "string" }, "value": {}, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["name", "value", "mode"], "properties": { "name": { "type": "string" }, "value": {}, "mode": { "type": "string" } } }
```

### `test_detect` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "properties": {} }
```
- **Output**
```json
{ "type": "object", "required": ["framework", "path", "version"], "properties": { "framework": { "type": "string" }, "path": { "type": "string" }, "version": { "type": "string" } } }
```

### `test_list` ✅
- **Input**
```json
{ "type": "object", "additionalProperties": false, "properties": { "dir": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["dir", "count", "tests"], "properties": { "dir": { "type": "string" }, "count": { "type": "number" }, "tests": { "type": "array", "items": { "type": "string" } } } }
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
- **Output**
```json
{ "type": "object", "properties": { "contents": { "type": "string" }, "range": { "type": "object" } } }
```

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
- **Input**
```json
{ "type": "object", "required": ["path"], "properties": { "path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["symbols"], "properties": { "symbols": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "kind": { "type": "string" }, "line": { "type": "integer" } } } } } }
```

### `gd_workspace_symbols` ⚠️ · unsupported by Godot ≤ 4.7 (handled gracefully)
> **Engine limitation (found in live validation):** Godot 4.7's GDScript language server replies `-32601 Method not found` to `workspace/symbol` (confirmed in CI on both 4.3-stable and 4.7-stable: 4.3 advertises `workspaceSymbolProvider: true` yet still replies `-32601` to every query, and 4.7 honestly advertises it `false` and likewise replies `-32601` — exactly why the tool keeps a belt-and-suspenders `-32601` catch). The gap is in the engine, not the host — the input/output contract below is correct and the tool is retained for forward compatibility (it will start returning results on a Godot build that implements the method). **As of v0.4.5** the host feature-detects this: it checks the server's advertised `workspaceSymbolProvider` capability (and still catches a `-32601` from builds that advertise it but don't honour it), returning an explicit `isError` "unsupported by the connected Godot build — use gd_document_symbols instead" message rather than leaking a raw JSON-RPC error. On the success path (a future capable build) the `symbols` output shape below is unchanged.
- **Input**
```json
{ "type": "object", "required": ["query"], "properties": { "query": { "type": "string" } } }
```
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

### `gd_signature_help` ✅
Call-signature hints (the parameter popup shown inside a call) at a position. Godot's GDScript language server advertises `signatureHelpProvider`; **confirmed returning signatures live in CI on 4.3-stable.**
- **Input** same `{ path, line, character }` as `gd_completion`.
- **Output**
```json
{ "type": "object", "required": ["signatures", "active_signature", "active_parameter"], "properties": { "signatures": { "type": "array", "items": { "type": "object", "properties": { "label": { "type": "string" }, "documentation": { "type": "string" }, "parameters": { "type": "array", "items": { "type": "object", "properties": { "label": { "type": "string" }, "documentation": { "type": "string" } } } } } } }, "active_signature": { "type": "integer" }, "active_parameter": { "type": "integer" } } }
```

### `gd_code_action` ⚠️ · engine-dependent (handled)
List the code actions (quick fixes / refactors) the language server offers for a range — the lightbulb menu. Read-only: returns the available actions without applying any (`has_edit` flags those carrying a `WorkspaceEdit`; `command` names any attached command; both a CodeAction and a bare Command are normalized). **Engine-gated:** Godot's GDScript LSP advertises `codeActionProvider: false` on current builds (confirmed in CI on 4.3-stable) and replies `-32601`, so on those builds the tool feature-detects and returns a clear "unsupported" message (same contract as `gd_workspace_symbols`); it will return results unchanged on a build that implements code actions.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "start_line", "start_character"], "properties": { "path": { "type": "string" }, "start_line": { "type": "integer", "minimum": 0 }, "start_character": { "type": "integer", "minimum": 0 }, "end_line": { "type": "integer", "minimum": 0, "description": "default = start_line" }, "end_character": { "type": "integer", "minimum": 0, "description": "default = start_character" }, "only": { "type": "array", "items": { "type": "string" }, "description": "Restrict to these CodeActionKind prefixes, e.g. 'quickfix', 'refactor'" } } }
```
- **Output**
```json
{ "type": "object", "required": ["actions"], "properties": { "actions": { "type": "array", "items": { "type": "object", "properties": { "title": { "type": "string" }, "kind": { "type": "string" }, "has_edit": { "type": "boolean" }, "command": { "type": ["string", "null"] } } } } } }
```

### `gd_document_highlight` ✅ on Godot 4.7 · ⚠️ advertised `false` on Godot 4.3 (handled)
Highlight every occurrence of the symbol at a position **within the same file**, tagged read / write / text (the shading an editor shows for a variable's uses when the caret is on it). Read-only. **Live-verified in CI: Godot 4.7 advertises `documentHighlightProvider: true` and the tool returns results (3 highlights); on Godot 4.3-stable it advertises `documentHighlightProvider: false`,** so on 4.3 the tool returns "unsupported" there; it feature-detects the capability and keeps a `-32601` belt-and-suspenders, returning a clear "unsupported" message on a build that advertises but doesn't honour it (the D7 lesson).
- **Input** same `{ path, line, character }` as `gd_completion`.
- **Output**
```json
{ "type": "object", "required": ["highlights"], "properties": { "highlights": { "type": "array", "items": {
  "type": "object", "properties": {
    "line": { "type": "integer" }, "character": { "type": "integer" },
    "end_line": { "type": "integer" }, "end_character": { "type": "integer" },
    "kind": { "enum": ["text", "read", "write"] } } } } } }
```

### `gd_type_definition` ⚠️ · advertised `false` on Godot 4.3-stable (handled)
Resolve the location of the **type** of the symbol at a position (jump to the class of a typed variable), as opposed to the symbol's own definition. Godot 4.3-stable advertises `typeDefinitionProvider: false` (confirmed live in CI), so the tool returns "unsupported" there; feature-detected with a `-32601` fallback for a future build that implements it.
- **Input** same `{ path, line, character }` as `gd_completion`.
- **Output** same `locations` array shape as `gd_definition`.

### `gd_implementation` ⚠️ · advertised `false` on Godot 4.3-stable (handled)
Resolve the implementation location(s) of the symbol at a position (e.g. the concrete override of a method). Godot 4.3-stable advertises `implementationProvider: false` (confirmed live in CI), so the tool returns "unsupported" there; feature-detected with a `-32601` fallback for a future build that implements it.
- **Input** same `{ path, line, character }`.
- **Output** same `locations` array shape as `gd_definition`.

### `gd_declaration` ✅ · confirmed live on Godot 4.3-stable
Resolve the declaration location(s) of the symbol at a position (coincides with the definition for most symbols; differs for forward-declared / re-exported names). Advertises `declarationProvider`; feature-detected with a `-32601` fallback. **Confirmed returning a location live in CI on 4.3-stable.**
- **Input** same `{ path, line, character }`.
- **Output** same `locations` array shape as `gd_definition`.

### `gd_folding_ranges` ⚠️ · advertised `false` on Godot 4.3-stable (handled)
List the foldable regions of a script (functions, blocks, comment/region markers) — the ranges an editor's fold gutter offers. Read-only. Godot 4.3-stable advertises `foldingRangeProvider: false` (confirmed live in CI), so the tool returns "unsupported" there; feature-detected with a `-32601` fallback for a future build that implements it.
- **Input**
```json
{ "type": "object", "required": ["path"], "properties": { "path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["ranges"], "properties": { "ranges": { "type": "array", "items": {
  "type": "object", "properties": {
    "start_line": { "type": "integer" }, "end_line": { "type": "integer" }, "kind": { "type": "string" } } } } } }
```

### `gd_document_link` ✅ · confirmed live on Godot 4.3-stable
List the links embedded in a script (res:// paths or URLs the language server recognizes) with their source ranges and targets. Read-only. Advertises `documentLinkProvider`; feature-detected with a `-32601` fallback. **Confirmed implemented live in CI on 4.3-stable (empty list for a link-free file).**
- **Input**
```json
{ "type": "object", "required": ["path"], "properties": { "path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["links"], "properties": { "links": { "type": "array", "items": {
  "type": "object", "properties": {
    "line": { "type": "integer" }, "character": { "type": "integer" },
    "end_line": { "type": "integer" }, "end_character": { "type": "integer" },
    "target": { "type": "string" } } } } } }
```

### `gd_formatting` ⚠️ · advertised `false` on Godot 4.3-stable (handled)
Compute how the language server would reformat a whole script and return the formatted **text** — **without writing anything to disk** (read-only preview; apply it yourself with a file write). Godot 4.3-stable advertises `documentFormattingProvider: false` (confirmed live in CI; `documentRangeFormattingProvider` likewise), so the tool returns "unsupported" there; feature-detected with a `-32601` fallback for a future build that implements it.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path"], "properties": {
  "path": { "type": "string" },
  "tab_size": { "type": "integer", "minimum": 1, "default": 4 },
  "insert_spaces": { "type": "boolean", "default": false, "description": "Indent with spaces instead of tabs (Godot uses tabs)" } } }
```
- **Output**
```json
{ "type": "object", "required": ["edit_count", "formatted"], "properties": { "edit_count": { "type": "integer" }, "formatted": { "type": "string" } } }
```

### `gd_document_color` ⚠️ · advertised `false` on Godot 4.3-stable (handled)
List the color literals the language server recognizes in a script — the `Color(...)` values an editor draws an inline swatch for — with each one's source range, its RGBA components (floats 0..1) and a convenience `#RRGGBBAA` hex (Godot's `Color.to_html()` ordering). Read-only. Godot 4.3-stable lists `colorProvider` among its `initialize` capability keys but with the value **`false`** (confirmed live in CI: `D7_CAPS2 … color=false`, tool returns "unsupported"), so it joins `document-highlight`/`type-definition`/`implementation`/`folding-ranges`/`formatting` in the advertised-but-not-honoured group; the tool feature-detects and returns a clear "unsupported" message there, and keeps a `-32601` belt-and-suspenders for a future build that implements it (the D7 lesson: advertised ≠ implemented).
- **Input**
```json
{ "type": "object", "required": ["path"], "properties": { "path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["colors"], "properties": { "colors": { "type": "array", "items": {
  "type": "object", "properties": {
    "line": { "type": "integer" }, "character": { "type": "integer" },
    "end_line": { "type": "integer" }, "end_character": { "type": "integer" },
    "red": { "type": "number" }, "green": { "type": "number" }, "blue": { "type": "number" }, "alpha": { "type": "number" },
    "hex": { "type": "string" } } } } } }
```

---

# Plane D — C# Semantic (OmniSharp LSP)  (✅ implemented — D4 C2; the C#/.NET mirror of the GDScript LSP plane. OmniSharp is spawned by the host over **stdio** (lazily, on the first `cs_*` call) and driven against a C# Godot project — e.g. the `example-csharp/` fixture — set via `GODOT_CSHARP_PROJECT`. The read-only `cs_*` tools mirror the read-only `gd_*` surface; the two mutators — `cs_rename` (elicitation-gated on `apply=true`) and the read-only `cs_code_action` listing — mirror the GDScript `gd_rename` / `gd_code_action`. Feature-detected the same way: a method the server never advertised, or a `-32601` from one that lied about it, degrades to a clear "unsupported" message rather than a hang.)

### `cs_completion` ✅
- **Input** `{ path, line, character }` (path resolves against the C# project root; 0-based line/character).
- **Output**
```json
{ "type": "object", "required": ["items"], "properties": { "items": { "type": "array", "items": {
  "type": "object", "properties": {
    "label": { "type": "string" }, "kind": { "type": "string" },
    "detail": { "type": "string" }, "insertText": { "type": "string" } } } } } }
```

### `cs_hover` ✅
- **Input** same `{ path, line, character }`.
- **Output**
```json
{ "type": "object", "required": ["contents"], "properties": { "contents": { "type": "string" } } }
```

### `cs_definition` ✅
- **Input** same `{ path, line, character }`.
- **Output** same `locations` array shape as `gd_definition` — `{ "locations": [{ "uri", "line", "character" }] }`.

### `cs_references` ✅
- **Input** `{ path, line, character, include_declaration?: boolean }`.
- **Output** same `locations` array shape as `cs_definition`.

### `cs_rename` ✅ · destructive (edits multiple files)
Rename a C# symbol project-wide via OmniSharp `textDocument/rename`. Returns the planned edit by default (dry run); `apply=true` writes the edits to disk and is **elicitation-gated** (with a `confirm: true` override and a safe block on clients that can't prompt), exactly like `gd_rename`. OmniSharp returns the WorkspaceEdit as `documentChanges` (versioned `TextDocumentEdit[]`); the host normalizes that and the legacy `changes` map identically before applying.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "line", "character", "new_name"],
  "properties": {
    "path": { "type": "string" }, "line": { "type": "integer" },
    "character": { "type": "integer" }, "new_name": { "type": "string" },
    "apply": { "type": "boolean", "default": false, "description": "Write edits to disk (default false = dry run returning the planned edit)" },
    "confirm": { "type": "boolean", "description": "Auto-approve writing edits (skip the elicitation prompt); only relevant with apply=true" } } }
```
- **Output** same shape as `gd_rename`: `{ "changed_files": [string], "edit_count": integer, "applied": boolean, "written": [string] }` (`written` = absolute paths actually written, empty on a dry run).

### `cs_document_symbols` ✅
- **Input**
```json
{ "type": "object", "required": ["path"], "properties": { "path": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["symbols"], "properties": { "symbols": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "kind": { "type": "string" }, "line": { "type": "integer" } } } } } }
```

### `cs_workspace_symbols` ✅
Unlike Godot's GDScript server, OmniSharp implements LSP `workspace/symbol`, so this returns real project-wide results; it stays feature-detected (advertised `workspaceSymbolProvider` capability plus a `-32601` belt-and-suspenders) so a server lacking it degrades to an explicit "unsupported" message rather than a raw JSON-RPC error.
- **Input**
```json
{ "type": "object", "required": ["query"], "properties": { "query": { "type": "string" } } }
```
- **Output** same `symbols` shape as `cs_document_symbols`, each with an added `uri`.

### `cs_signature_help` ✅
- **Input** same `{ path, line, character }`.
- **Output**
```json
{ "type": "object", "required": ["signatures", "active_signature", "active_parameter"],
  "properties": {
    "signatures": { "type": "array", "items": { "type": "object", "properties": {
      "label": { "type": "string" }, "documentation": { "type": "string" },
      "parameters": { "type": "array", "items": { "type": "object", "properties": {
        "label": { "type": "string" }, "documentation": { "type": "string" } } } } } } },
    "active_signature": { "type": "integer" }, "active_parameter": { "type": "integer" } } }
```

### `cs_diagnostics` ✅
- **Input**
```json
{ "type": "object", "required": ["path"], "properties": { "path": { "type": "string" }, "wait_ms": { "type": "integer", "description": "Max time to wait for the first publish (default 2000; OmniSharp's first analysis can be slow)" } } }
```
- **Output**
```json
{ "type": "object", "required": ["uri", "diagnostics"],
  "properties": {
    "uri": { "type": "string" },
    "diagnostics": { "type": "array", "items": { "type": "object", "properties": {
      "severity": { "type": "string" }, "message": { "type": "string" },
      "line": { "type": "integer" }, "character": { "type": "integer" } } } } } }
```

### `cs_code_action` ✅ · OmniSharp implements it
List the code actions (quick fixes / refactors) OmniSharp offers for a range — the lightbulb menu. Read-only: returns the available actions without applying any (`has_edit` flags those carrying a `WorkspaceEdit`; `command` names any attached command; both a CodeAction and a bare Command are normalized). Unlike Godot's GDScript server (which advertises `codeActionProvider: false`), OmniSharp implements code actions, so this returns real results; still feature-detected with a `-32601` belt-and-suspenders. `end_line`/`end_character` default to the start position (a caret, not a selection).
- **Input** same shape as `gd_code_action`: `{ path, start_line, start_character, end_line?, end_character?, only?: string[] }`.
- **Output** same `actions` shape as `gd_code_action`: `{ "actions": [{ "title", "kind", "has_edit", "command": string|null }] }`.

---

# Plane D — Debugging (DAP)  (✅ implemented — Phase 2; raw TCP + DAP `Content-Length` framing to Godot's debug adapter, default `127.0.0.1:6006`)

### `dbg_launch` ✅
- **Input**
```json
{ "type": "object", "properties": { "scene": { "type": "string", "description": "'main' (default), 'current', or a res:// scene path" }, "stop_on_entry": { "type": "boolean", "default": false } } }
```
- **Output**
```json
{ "type": "object", "required": ["session_id", "state", "scene"], "properties": { "session_id": { "type": "string" }, "state": { "type": "string" }, "scene": { "type": "string" } } }
```

### `dbg_attach` ✅
- **Input**
```json
{ "type": "object", "properties": { "address": { "type": "string", "default": "127.0.0.1" }, "port": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["session_id", "state"], "properties": { "session_id": { "type": "string" }, "state": { "type": "string" } } }
```

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
- **Output**
```json
{ "type": "object", "required": ["path", "buffered", "breakpoints"], "properties": { "path": { "type": "string" }, "buffered": { "type": "boolean" }, "breakpoints": { "type": "array", "items": { "type": "object", "properties": { "line": { "type": "integer" }, "verified": { "type": "boolean" } } } }, "unsupported_modifiers": { "type": "array", "items": { "type": "string" } }, "warning": { "type": "string" } } }
```
- **Feature-detect:** `conditions` / `hit_conditions` / `log_messages` are sent only when the connected adapter advertises `supportsConditionalBreakpoints` / `supportsHitConditionalBreakpoints` / `supportsLogPoints`. Godot 4.3 advertises all three **false** and ignores them (a conditional breakpoint would halt unconditionally — verified live in the `dap-plane` modifier probe), so there they are dropped and the result carries `unsupported_modifiers` + a `warning`. Detection needs a live session (set modifiers after `dbg_launch`).

### `dbg_continue` / `dbg_step` ✅
- **Input (`dbg_step`)** `{ "type": "object", "required": ["kind"], "properties": { "kind": { "enum": ["in", "over", "out"] } } }`
- **Input (`dbg_continue`)** `{ "type": "object", "properties": {} }`
- **Output**
```json
{ "type": "object", "required": ["state"], "properties": { "state": { "enum": ["running", "stopped", "terminated"] }, "stopped_reason": { "type": ["string", "null"] } } }
```

### `dbg_stack_trace` ✅
- **Input**
```json
{ "type": "object", "properties": { "levels": { "type": "integer", "minimum": 1, "default": 20, "description": "Max frames" } } }
```
- **Output**
```json
{ "type": "object", "required": ["frames"], "properties": { "frames": { "type": "array", "items": { "type": "object", "properties": { "id": { "type": "integer" }, "name": { "type": "string" }, "source": { "type": "string" }, "line": { "type": "integer" } } } } } }
```

### `dbg_scopes` ✅
- **Input**
```json
{ "type": "object", "required": ["frame_id"], "properties": { "frame_id": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["scopes"], "properties": { "scopes": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "variables_ref": { "type": "integer" } } } } } }
```

### `dbg_variables` ✅
- **Input**
```json
{ "type": "object", "required": ["variables_ref"], "properties": { "variables_ref": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["variables"], "properties": { "variables": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "value": { "type": "string" }, "type": { "type": "string" }, "variables_ref": { "type": "integer" } } } } } }
```

### `dbg_evaluate` ✅ · destructive (arbitrary code execution — gate hard)
Evaluate an expression in the current stopped frame (DAP `evaluate`, repl context). **Live-verified in CI:** Godot 4.3 does bare-name lookup only (a compound expression like `counter + 1` returns empty), while **Godot 4.7 performs full expression evaluation** (`counter + 1` → `101`). The request is bounded by `GODOT_DAP_EVALUATE_TIMEOUT_MS` (~8 s) so a non-answering adapter fails fast rather than hanging the full DAP timeout.
- **Input**
```json
{ "type": "object", "required": ["expression"], "properties": { "expression": { "type": "string" }, "frame_id": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["result"], "properties": { "result": { "type": "string" }, "type": { "type": "string" }, "variables_ref": { "type": "integer" } } }
```

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
- **Output**
```json
{ "type": "object", "required": ["watches"], "properties": { "watches": { "type": "array", "items": { "type": "object", "required": ["expression", "value", "type", "error"], "properties": { "expression": { "type": "string" }, "value": { "type": "string" }, "type": { "type": "string" }, "error": { "type": ["string", "null"] } } } } } }
```

### `dbg_set_exception_breakpoints` ✅
Enable (replace) the debugger's exception breakpoint filters so execution halts when a matching error is thrown (DAP `setExceptionBreakpoints`). Pass filter IDs to enable; call with no filters (or `[]`) to clear. The result echoes the active `filters` and reports `available_filters` — the exception filters the connected adapter advertises. Requires a running session; **not** gated (it only configures the debugger). Feature-detected: on an adapter that advertises no `exceptionBreakpointFilters` (e.g. Godot 4.3, which also does not answer the request — it would otherwise time out) it returns a clear "unsupported" message **without sending anything**.
- **Input**
```json
{ "type": "object", "properties": { "filters": { "type": "array", "items": { "type": "string" }, "description": "Exception filter IDs to enable (default none = clear); choose from available_filters" } } }
```
- **Output**
```json
{ "type": "object", "required": ["filters", "available_filters", "breakpoints"], "properties": { "filters": { "type": "array", "items": { "type": "string" } }, "available_filters": { "type": "array", "items": { "type": "object", "properties": { "filter": { "type": "string" }, "label": { "type": "string" } } } }, "breakpoints": { "type": "array", "items": { "type": "object", "properties": { "verified": { "type": "boolean" } } } } } }
```

### `dbg_set_variable` ✅ · destructive (mutates live program state — gate hard)
Change a variable's value in a stopped frame (DAP `setVariable`). `variables_ref` is the container's `variablesReference` (from `dbg_scopes`, or a complex `dbg_variables` entry), `name` is the variable within it, `value` is a GDScript literal/expression. Feature-detected: on an adapter that advertises `supportsSetVariable: false` it returns a clear "unsupported" message **without prompting**.
- **Input**
```json
{ "type": "object", "required": ["variables_ref", "name", "value"], "properties": { "variables_ref": { "type": "integer" }, "name": { "type": "string" }, "value": { "type": "string" }, "confirm": { "type": "boolean", "description": "Auto-approve this mutation (skip the elicitation prompt)" } } }
```
- **Output**
```json
{ "type": "object", "required": ["name", "value", "variables_ref"], "properties": { "name": { "type": "string" }, "value": { "type": "string" }, "type": { "type": "string" }, "variables_ref": { "type": "integer" } } }
```

### `dbg_restart` ✅
Restart the current debug session. Uses the DAP `restart` request when the adapter advertises `supportsRestartRequest`; otherwise falls back to `terminate` + a fresh launch/attach handshake, so it works on every adapter. Reuses the last `dbg_launch`/`dbg_attach` params; `scene` / `stop_on_entry` override them for a launched session. `method` reports which path ran (`restart` = native DAP restart, `relaunch` = terminate + fresh handshake).
- **Input**
```json
{ "type": "object", "properties": { "scene": { "type": "string", "description": "Override scene for a launched session: 'main', 'current', or res://scene.tscn" }, "stop_on_entry": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["session_id", "method", "state"], "properties": { "session_id": { "type": "string" }, "method": { "enum": ["restart", "relaunch"] }, "state": { "type": "string" }, "scene": { "type": ["string", "null"] } } }
```

### `dbg_goto` ✅ · destructive (moves execution — gate hard)
Move the program counter within the current stopped frame — 'set next statement' (DAP `gotoTargets` + `goto`). Call with `path` + `line` to list the valid goto targets on that line; when the line has exactly one target (or you pass `target_id`) it jumps there. Feature-detected: on an adapter that does not advertise `supportsGotoTargetsRequest` it returns a clear "unsupported" message **without prompting**. Only meaningful while stopped at a breakpoint.
- **Input**
```json
{ "type": "object", "required": ["path", "line"], "properties": { "path": { "type": "string" }, "line": { "type": "integer", "minimum": 1 }, "target_id": { "type": "integer", "description": "A specific target id from a prior listing; omit to auto-pick when the line has a single target" }, "confirm": { "type": "boolean", "description": "Auto-approve the jump (skip the elicitation prompt)" } } }
```
- **Output**
```json
{ "type": "object", "required": ["targets", "jumped", "target_id"], "properties": { "targets": { "type": "array", "items": { "type": "object", "properties": { "id": { "type": "integer" }, "label": { "type": "string" }, "line": { "type": "integer" } } } }, "jumped": { "type": "boolean" }, "target_id": { "type": ["integer", "null"] } } }
```

### `dbg_data_breakpoints` ✅
Set (replace) data breakpoints — 'watchpoints' that halt when a variable's value changes (DAP `dataBreakpointInfo` + `setDataBreakpoints`). Each `watch` entry `{ name, variables_ref?, access_type? }` is resolved to a dataId, then every resolvable id is armed in one `setDataBreakpoints` call. Call with no `watch` (or `[]`) to clear all data breakpoints. The result reports the armed `breakpoints` (with `data_id` + `verified`) and any `unresolved` variables the adapter cannot watch. Requires a running session; **not** gated. Feature-detected on `supportsDataBreakpoints`.
- **Input**
```json
{ "type": "object", "properties": { "watch": { "type": "array", "items": { "type": "object", "required": ["name"], "properties": { "name": { "type": "string" }, "variables_ref": { "type": "integer" }, "access_type": { "enum": ["read", "write", "readWrite"] } } }, "description": "Variables to watch; omit or [] to clear all data breakpoints" } } }
```
- **Output**
```json
{ "type": "object", "required": ["breakpoints", "unresolved"], "properties": { "breakpoints": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "data_id": { "type": "string" }, "verified": { "type": "boolean" } } } }, "unresolved": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "reason": { "type": "string" } } } } } }
```

---

# Plane D — C# Debugging (netcoredbg DAP)  (✅ implemented — D4 C3; the C#/.NET mirror of the GDScript debugging plane. **netcoredbg** (Samsung, MIT) is spawned by the host over **stdio** (lazily, on the first `cs_dbg_*` call) and driven against a C# Godot game — launching it (`cs_dbg_launch`) or attaching to a running .NET process (`cs_dbg_attach`) — instead of Godot's built-in TCP debug adapter. Configured via `GODOT_CSDAP_CMD` (default `netcoredbg`), `GODOT_CSDAP_ARGS` (default `--interpreter=vscode`), `GODOT_CSHARP_BIN` (the program `cs_dbg_launch` launches by default) and `GODOT_CSHARP_PROJECT`. On top of read/inspect + a gated `cs_dbg_set_variable`, it carries the GDScript extras netcoredbg actually backs: `cs_dbg_watch`, `cs_dbg_set_exception_breakpoints` (netcoredbg advertises the `all` / `user-unhandled` filters) and `cs_dbg_restart` (terminate + relaunch, since netcoredbg advertises no `supportsRestartRequest`). `dbg_goto` / `dbg_data_breakpoints` are intentionally **not** mirrored here — netcoredbg advertises neither `supportsGotoTargetsRequest` nor `supportsDataBreakpoints`, so those tools would be dead surface. Adapter absent → the lazy stdio spawn fails with an actionable hint, never a hang.)

### `cs_dbg_launch` ✅ · runs code
Launch a C# Godot game under netcoredbg. `program` defaults to the configured Mono/.NET Godot binary and `args` to `['--path', <C# project>]`; override either to debug a different .NET program. Buffered breakpoints are applied during the handshake.
- **Input**
```json
{ "type": "object", "properties": { "program": { "type": "string" }, "args": { "type": "array", "items": { "type": "string" } }, "stop_on_entry": { "type": "boolean", "default": false }, "just_my_code": { "type": "boolean", "default": true } } }
```
- **Output**
```json
{ "type": "object", "required": ["session_id", "state"], "properties": { "session_id": { "type": "string" }, "state": { "type": "string" } } }
```

### `cs_dbg_attach` ✅
Attach netcoredbg to an already-running .NET process (e.g. a C# Godot game launched separately) by its OS process id.
- **Input**
```json
{ "type": "object", "required": ["process_id"], "properties": { "process_id": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["session_id", "state"], "properties": { "session_id": { "type": "string" }, "state": { "type": "string" } } }
```

### `cs_dbg_set_breakpoints` ✅
Set (replace) the breakpoints for a C# source file. Applied immediately if a session is running, else buffered until launch/attach. Feature-detected: the per-line `conditions` modifier is only sent when the connected adapter advertises `supportsConditionalBreakpoints` (netcoredbg does); on an adapter that advertises it unsupported the modifier is dropped and the result carries `unsupported_modifiers` + a `warning`.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "lines"], "properties": { "path": { "type": "string" }, "lines": { "type": "array", "items": { "type": "integer", "minimum": 1 } }, "conditions": { "type": "array", "items": { "type": ["string", "null"] } } } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "buffered", "breakpoints"], "properties": { "path": { "type": "string" }, "buffered": { "type": "boolean" }, "breakpoints": { "type": "array", "items": { "type": "object", "properties": { "line": { "type": "integer" }, "verified": { "type": "boolean" } } } }, "unsupported_modifiers": { "type": "array", "items": { "type": "string" } }, "warning": { "type": "string" } } }
```

### `cs_dbg_continue` / `cs_dbg_step` ✅
Resume execution and wait for the program to settle again (next breakpoint or termination). `cs_dbg_step` takes a `kind`; `cs_dbg_continue` takes no input.
- **Input (`cs_dbg_step`)** `{ "type": "object", "required": ["kind"], "properties": { "kind": { "enum": ["in", "over", "out"] } } }`
- **Input (`cs_dbg_continue`)** `{ "type": "object", "properties": {} }`
- **Output**
```json
{ "type": "object", "required": ["state"], "properties": { "state": { "enum": ["running", "stopped", "terminated"] }, "stopped_reason": { "type": ["string", "null"] } } }
```

### `cs_dbg_stack_trace` ✅
- **Input**
```json
{ "type": "object", "properties": { "levels": { "type": "integer", "minimum": 1, "default": 20 } } }
```
- **Output**
```json
{ "type": "object", "required": ["frames"], "properties": { "frames": { "type": "array", "items": { "type": "object", "properties": { "id": { "type": "integer" }, "name": { "type": "string" }, "source": { "type": "string" }, "line": { "type": "integer" } } } } } }
```

### `cs_dbg_scopes` ✅
- **Input**
```json
{ "type": "object", "required": ["frame_id"], "properties": { "frame_id": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["scopes"], "properties": { "scopes": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "variables_ref": { "type": "integer" } } } } } }
```

### `cs_dbg_variables` ✅
- **Input**
```json
{ "type": "object", "required": ["variables_ref"], "properties": { "variables_ref": { "type": "integer" } } }
```
- **Output**
```json
{ "type": "object", "required": ["variables"], "properties": { "variables": { "type": "array", "items": { "type": "object", "properties": { "name": { "type": "string" }, "value": { "type": "string" }, "type": { "type": "string" }, "variables_ref": { "type": "integer" } } } } } }
```

### `cs_dbg_evaluate` ✅ · destructive (arbitrary code execution — gate hard)
Evaluate a C# expression in the current stopped frame (DAP `evaluate`, repl context). Bounded by `GODOT_CSDAP_EVALUATE_TIMEOUT_MS` (~8 s) so a non-answering adapter fails fast rather than hanging the full DAP timeout.
- **Input**
```json
{ "type": "object", "required": ["expression"], "properties": { "expression": { "type": "string" }, "frame_id": { "type": "integer" }, "confirm": { "type": "boolean", "description": "Auto-approve this arbitrary-code evaluation (skip the elicitation prompt)" } } }
```
- **Output**
```json
{ "type": "object", "required": ["result"], "properties": { "result": { "type": "string" }, "type": { "type": "string" }, "variables_ref": { "type": "integer" } } }
```

### `cs_dbg_set_variable` ✅ · destructive (mutates live program state — gate hard)
Change a variable's value in a stopped C# frame (DAP `setVariable`). `variables_ref` is the container's `variablesReference` (from `cs_dbg_scopes`, or a complex `cs_dbg_variables` entry), `name` is the variable within it, `value` is a C# literal/expression. Feature-detected: on an adapter that advertises `supportsSetVariable: false` it returns a clear "unsupported" message **without prompting**; otherwise a bounded deadline (`GODOT_CSDAP_SETVAR_TIMEOUT_MS`) turns a non-answering adapter into a clear message rather than a hang.
- **Input**
```json
{ "type": "object", "required": ["variables_ref", "name", "value"], "properties": { "variables_ref": { "type": "integer" }, "name": { "type": "string" }, "value": { "type": "string" }, "confirm": { "type": "boolean" } } }
```
- **Output**
```json
{ "type": "object", "required": ["name", "value", "variables_ref"], "properties": { "name": { "type": "string" }, "value": { "type": "string" }, "type": { "type": "string" }, "variables_ref": { "type": "integer" } } }
```

### `cs_dbg_watch` ✅
Manage a persistent set of C# watch expressions and re-evaluate them in the current stopped frame. Evaluated in DAP `watch` context (side-effect-free), so it is **not** gated. Results are only meaningful while stopped at a breakpoint. Each watch's `evaluate` is bounded by `GODOT_CSDAP_EVALUATE_TIMEOUT_MS` so a stalling expression fails fast on that entry.
- **Input**
```json
{ "type": "object",
  "properties": {
    "add": { "type": "array", "items": { "type": "string" }, "description": "Expressions to add to the watch set" },
    "remove": { "type": "array", "items": { "type": "string" }, "description": "Expressions to remove" },
    "clear": { "type": "boolean", "description": "Clear all watches before applying add" },
    "frame_id": { "type": "integer", "description": "Frame id from cs_dbg_stack_trace; omit for the top frame" } } }
```
- **Output**
```json
{ "type": "object", "required": ["watches"], "properties": { "watches": { "type": "array", "items": { "type": "object", "required": ["expression", "value", "type", "error"], "properties": { "expression": { "type": "string" }, "value": { "type": "string" }, "type": { "type": "string" }, "error": { "type": ["string", "null"] } } } } } }
```

### `cs_dbg_set_exception_breakpoints` ✅
Enable (replace) the debugger's exception breakpoint filters so execution halts when a matching .NET exception is thrown (DAP `setExceptionBreakpoints`). Pass filter IDs to enable; call with no filters (or `[]`) to clear. The result echoes the active `filters` and reports `available_filters` — the exception filters the connected adapter advertises (**netcoredbg exposes `all` and `user-unhandled`**). Requires a running session; **not** gated (it only configures the debugger). Feature-detected: on an adapter that advertises no `exceptionBreakpointFilters` it returns a clear "unsupported" message **without sending anything**.
- **Input**
```json
{ "type": "object", "properties": { "filters": { "type": "array", "items": { "type": "string" }, "description": "Exception filter IDs to enable (default none = clear); choose from available_filters" } } }
```
- **Output**
```json
{ "type": "object", "required": ["filters", "available_filters", "breakpoints"], "properties": { "filters": { "type": "array", "items": { "type": "string" } }, "available_filters": { "type": "array", "items": { "type": "object", "properties": { "filter": { "type": "string" }, "label": { "type": "string" } } } }, "breakpoints": { "type": "array", "items": { "type": "object", "properties": { "verified": { "type": "boolean" } } } } } }
```

### `cs_dbg_restart` ✅
Restart the current C# debug session. Uses the DAP `restart` request when the adapter advertises `supportsRestartRequest`; otherwise falls back to `terminate` + a fresh launch/attach handshake, so it works on every adapter (**netcoredbg advertises none, so the relaunch path runs**). Reuses the last `cs_dbg_launch`/`cs_dbg_attach` params; `stop_on_entry` / `program` / `args` override them for a launched session. `method` reports which path ran (`restart` = native DAP restart, `relaunch` = terminate + fresh handshake). C# sessions have no scene, so there is no `scene` field.
- **Input**
```json
{ "type": "object", "properties": { "stop_on_entry": { "type": "boolean" }, "program": { "type": "string" }, "args": { "type": "array", "items": { "type": "string" } } } }
```
- **Output**
```json
{ "type": "object", "required": ["session_id", "method", "state"], "properties": { "session_id": { "type": "string" }, "method": { "enum": ["restart", "relaunch"] }, "state": { "type": "string" } } }
```

---

# Plane C — Runtime Bridge  (✅ implemented — Phase 3; in-game autoload `BreakpointRuntimeBridge` over loopback TCP :9081, same JSON protocol as the editor bridge)

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

### `runtime_get_log` ✅  (also a subscribable `godot://runtime/log` resource)
- **Input** `{ "type": "object", "properties": { "since_seq": { "type": "integer", "default": 0 }, "levels": { "type": "array", "items": { "enum": ["info", "warning", "error"] } } } }`
- **Output** `{ "type": "object", "required": ["entries", "latest_seq"], "properties": { "entries": { "type": "array", "items": { "type": "object", "properties": { "seq": { "type": "integer" }, "level": { "type": "string" }, "message": { "type": "string" } } } }, "latest_seq": { "type": "integer" }, "capture": { "type": "boolean" } } }`
- **D6 zero-config capture (Godot 4.5+):** on 4.5 and newer the runtime bridge auto-registers a scriptable `Logger` (`OS.add_logger`) that funnels every `print()` / `push_warning` / `push_error` and engine message into this ring buffer — so the host reads the game's console with **no managed parent process**. Levels are `info` / `warning` / `error`. `capture` reports whether that hook is active; on Godot < 4.5 it is `false` and only explicit `BreakpointRuntimeBridge.push_log(...)` entries appear (unchanged behavior). Changes to the buffer push `godot://runtime/log` to subscribers (coalesced, one per frame).

---

---

## Group K — Knowledge & search

Read-only "where / what / how" tools. Four are **host-side** (Plane B — they read the project files directly, no editor or language server needed, so they answer even when nothing is running) and two are **ClassDB-backed** (Plane A — over the editor bridge). None mutate, so none are undoable or gated. `find_symbol` is the project-wide declaration index Godot's language server does not provide (`gd_workspace_symbols` returns *unsupported*); `find_usages` is the build-independent complement to the position-based `gd_references`. Markers `AUTH_K_*` in the authoring-plane probe.

### `project_search` ✅  (Plane B / host)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["query"],
  "properties": {
    "query": { "type": "string" },
    "regex": { "type": "boolean", "default": false },
    "ignore_case": { "type": "boolean", "default": false },
    "extensions": { "type": "array", "items": { "type": "string" } },
    "path": { "type": "string" },
    "max_results": { "type": "integer", "minimum": 1, "default": 200 }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["query", "regex", "matches", "count", "truncated"],
  "properties": {
    "query": { "type": "string" },
    "regex": { "type": "boolean" },
    "matches": { "type": "array", "items": { "type": "object", "required": ["file", "line", "column", "text"],
      "properties": { "file": { "type": "string" }, "line": { "type": "integer" }, "column": { "type": "integer" }, "text": { "type": "string" } } } },
    "count": { "type": "integer" },
    "truncated": { "type": "boolean" }
  } }
```

### `find_symbol` ✅  (Plane B / host)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["name"],
  "properties": {
    "name": { "type": "string" },
    "exact": { "type": "boolean", "default": false },
    "kinds": { "type": "array", "items": { "enum": ["class_name", "class", "func", "signal", "enum", "const", "var"] } },
    "max_results": { "type": "integer", "minimum": 1, "default": 200 }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["name", "matches", "count", "truncated"],
  "properties": {
    "name": { "type": "string" },
    "matches": { "type": "array", "items": { "type": "object", "required": ["file", "line", "kind", "symbol", "text"],
      "properties": { "file": { "type": "string" }, "line": { "type": "integer" }, "kind": { "type": "string" }, "symbol": { "type": "string" }, "text": { "type": "string" } } } },
    "count": { "type": "integer" },
    "truncated": { "type": "boolean" }
  } }
```

### `find_usages` ✅  (Plane B / host)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["name"],
  "properties": {
    "name": { "type": "string" },
    "extensions": { "type": "array", "items": { "type": "string" } },
    "ignore_case": { "type": "boolean", "default": false },
    "max_results": { "type": "integer", "minimum": 1, "default": 200 }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["name", "usages", "count", "truncated"],
  "properties": {
    "name": { "type": "string" },
    "usages": { "type": "array", "items": { "type": "object", "required": ["file", "line", "column", "text"],
      "properties": { "file": { "type": "string" }, "line": { "type": "integer" }, "column": { "type": "integer" }, "text": { "type": "string" } } } },
    "count": { "type": "integer" },
    "truncated": { "type": "boolean" }
  } }
```

### `example_snippet` ✅  (Plane B / host)
- **Input**
```json
{ "type": "object", "additionalProperties": false,
  "properties": {
    "query": { "type": "string" },
    "limit": { "type": "integer", "minimum": 1, "default": 5 }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["query", "count", "snippets", "available"],
  "properties": {
    "query": { "type": ["string", "null"] },
    "count": { "type": "integer" },
    "snippets": { "type": "array", "items": { "type": "object", "required": ["id", "title", "tags", "code", "explanation", "docs_url"],
      "properties": { "id": { "type": "string" }, "title": { "type": "string" }, "tags": { "type": "array", "items": { "type": "string" } },
        "code": { "type": "string" }, "explanation": { "type": "string" }, "docs_url": { "type": "string" } } } },
    "available": { "type": "array", "items": { "type": "string" } }
  } }
```

### `class_reference` ✅  (Plane A / Editor)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["class_name"],
  "properties": {
    "class_name": { "type": "string" },
    "include_inherited": { "type": "boolean", "default": false },
    "member": { "type": "string" }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["class", "parent", "can_instantiate", "docs_url", "methods", "signals", "properties"],
  "properties": {
    "class": { "type": "string" },
    "parent": { "type": "string" },
    "can_instantiate": { "type": "boolean" },
    "docs_url": { "type": "string" },
    "methods": { "type": "array", "items": { "type": "object", "required": ["name", "return_type", "args"],
      "properties": { "name": { "type": "string" }, "return_type": { "type": "string" },
        "args": { "type": "array", "items": { "type": "object", "required": ["name", "type"],
          "properties": { "name": { "type": "string" }, "type": { "type": "string" } } } } } } },
    "signals": { "type": "array", "items": { "type": "object", "required": ["name", "args"],
      "properties": { "name": { "type": "string" },
        "args": { "type": "array", "items": { "type": "object", "required": ["name", "type"],
          "properties": { "name": { "type": "string" }, "type": { "type": "string" } } } } } } },
    "properties": { "type": "array", "items": { "type": "object", "required": ["name", "type", "class_name"],
      "properties": { "name": { "type": "string" }, "type": { "type": "string" }, "class_name": { "type": "string" } } } }
  } }
```

### `docs_search` ✅  (Plane A / Editor)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["query"],
  "properties": {
    "query": { "type": "string" },
    "kind": { "enum": ["any", "class", "method", "property", "signal"], "default": "any" },
    "class_name": { "type": "string" },
    "limit": { "type": "integer", "minimum": 1, "default": 40 },
    "deep": { "type": "boolean", "default": true }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["query", "count", "truncated", "results"],
  "properties": {
    "query": { "type": "string" },
    "count": { "type": "integer" },
    "truncated": { "type": "boolean" },
    "results": { "type": "array", "items": { "type": "object", "required": ["class", "member", "kind", "docs_url"],
      "properties": { "class": { "type": "string" }, "member": { "type": "string" }, "kind": { "type": "string" }, "docs_url": { "type": "string" } } } }
  } }
```

---

## Group J — AI asset generation

MCP-native asset generation: the server never bundles or calls a model. Each generator writes an asset to a `res://` path, imports it through the editor bridge, and returns a schema'd result — but the pixels / samples are **delegated**. `asset_gen_configure` picks the session backend (the feature flag): **`none`** (default) makes the five typed generators **degrade** to a clear "no generation backend configured" result carrying a `request` spec the connected multimodal client can fulfil (no file written; not an error); **`placeholder`** writes deterministic, in-engine procedural stand-ins as native Godot resources (`.tres`) that load synchronously — a hashed-colour `ImageTexture` (sprite / texture / icon), an `AudioStreamWAV` blip, a `BoxMesh` / primitive; **`command`** delegates to a configured local command (an argv template with `{kind} {prompt} {output} {width} {height} {format}` tokens substituted per-argument, no shell — the command writes the file, in any format, and the host imports it through the editor). `asset_gen_placeholder` always mints a deterministic stand-in regardless of the backend, and any typed generator accepts `placeholder: true` to force one. The file-writing paths are **destructive** (elicitation-gated); the degrade path writes nothing. The five typed generators share one result envelope (below), which validates all three outcomes — `placeholder` / `generated` / `no_backend`. Markers `AUTH_ASSETGEN_*` in the authoring-plane probe.

The shared generator result envelope (`asset_gen_placeholder` and the five typed generators):
```json
{ "type": "object", "required": ["status", "kind", "backend", "path", "prompt", "message"],
  "properties": {
    "status": { "enum": ["placeholder", "generated", "no_backend"] },
    "kind": { "type": "string" },
    "backend": { "type": "string" },
    "path": { "type": ["string", "null"] },
    "prompt": { "type": ["string", "null"] },
    "imported_type": { "type": ["string", "null"] },
    "width": { "type": "integer" },
    "height": { "type": "integer" },
    "bytes": { "type": "integer" },
    "format": { "type": "string" },
    "provider": { "type": ["string", "null"] },
    "request": { "type": "object" },
    "message": { "type": "string" }
  } }
```

### `asset_gen_configure` ✅  (Plane B / host)
- **Input**
```json
{ "type": "object", "additionalProperties": false,
  "properties": {
    "backend": { "enum": ["none", "placeholder", "command"] },
    "command": { "type": "string" },
    "provider": { "type": "string" }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["backend", "provider", "command", "configured", "supported_kinds", "note"],
  "properties": {
    "backend": { "type": "string" },
    "provider": { "type": ["string", "null"] },
    "command": { "type": ["string", "null"] },
    "configured": { "type": "boolean" },
    "supported_kinds": { "type": "array", "items": { "type": "string" } },
    "note": { "type": "string" }
  } }
```

### `asset_gen_placeholder` ✅  (Plane A / Editor)  · writes file (gated)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["kind", "to_path"],
  "properties": {
    "kind": { "enum": ["sprite", "texture", "icon", "audio_sfx", "model"] },
    "to_path": { "type": "string" },
    "prompt": { "type": "string" },
    "width": { "type": "integer", "minimum": 1 },
    "height": { "type": "integer", "minimum": 1 },
    "duration_ms": { "type": "integer", "minimum": 1 },
    "shape": { "enum": ["box", "sphere", "cylinder", "prism"] },
    "confirm": { "type": "boolean" }
  } }
```
- **Output** — the shared generator result envelope above (`status: "placeholder"`).

### `asset_gen_sprite` ✅  (Plane A / Editor)  · writes file (gated)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["prompt", "to_path"],
  "properties": {
    "prompt": { "type": "string" },
    "to_path": { "type": "string" },
    "width": { "type": "integer", "minimum": 1 },
    "height": { "type": "integer", "minimum": 1 },
    "placeholder": { "type": "boolean" },
    "confirm": { "type": "boolean" }
  } }
```
- **Output** — the shared generator result envelope above.

### `asset_gen_texture` ✅  (Plane A / Editor)  · writes file (gated)
- **Input** — same as `asset_gen_sprite`.
- **Output** — the shared generator result envelope above.

### `asset_gen_icon` ✅  (Plane A / Editor)  · writes file (gated)
- **Input** — same as `asset_gen_sprite`.
- **Output** — the shared generator result envelope above.

### `asset_gen_audio_sfx` ✅  (Plane A / Editor)  · writes file (gated)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["prompt", "to_path"],
  "properties": {
    "prompt": { "type": "string" },
    "to_path": { "type": "string" },
    "duration_ms": { "type": "integer", "minimum": 1 },
    "placeholder": { "type": "boolean" },
    "confirm": { "type": "boolean" }
  } }
```
- **Output** — the shared generator result envelope above.

### `asset_gen_model` ✅  (Plane A / Editor)  · writes file (gated)
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["prompt", "to_path"],
  "properties": {
    "prompt": { "type": "string" },
    "to_path": { "type": "string" },
    "shape": { "enum": ["box", "sphere", "cylinder", "prism"] },
    "placeholder": { "type": "boolean" },
    "confirm": { "type": "boolean" }
  } }
```
- **Output** — the shared generator result envelope above.

---

## Group M — Netcode & backend scaffolding (Plane A / Editor + host)

The "game backend" question, resolved as **authoring, not hosting**. Godot 4's built-in high-level multiplayer is a first-class engine feature, and multiplayer is a top game-dev request — but running a relay / leaderboard-DB / save-store is a SaaS, not editor control. So this family **hosts nothing and scaffolds everything**: it only adds nodes, scripts, and config to the project. Three tools author multiplayer nodes over the editor bridge (undoable via `EditorUndoRedoManager`, like every `node_*`); four generate GDScript. The generated code is built host-side (so the templates are unit-tested) and written by the editor's `FileAccess` through the `mp.write_script` bridge method, which triggers a filesystem rescan. Every code-writing tool is **destructive** (elicitation-gated — the `resource_create` model). `mp_setup_webrtc_peer` is **feature-detected**: if the WebRTC module/extension is absent from the build, it degrades to a clear `unsupported` result and writes nothing (never a dead call). Markers `AUTH_MP_*` in the authoring-plane probe.

### `mp_add_spawner` ✅  (Plane A / Editor)  · undoable
Add a `MultiplayerSpawner` (server-spawned nodes replicate to clients). `spawn_path` is the node whose children auto-replicate; `spawnable_scenes` are `res://` scenes it may instantiate.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path"],
  "properties": {
    "parent_path": { "type": "string" },
    "name": { "type": "string" },
    "spawn_path": { "type": "string" },
    "spawnable_scenes": { "type": "array", "items": { "type": "string" } }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "spawn_path", "spawnable_scenes"],
  "properties": {
    "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" },
    "spawn_path": { "type": "string" },
    "spawnable_scenes": { "type": "array", "items": { "type": "string" } }
  } }
```

### `mp_add_synchronizer` ✅  (Plane A / Editor)  · undoable
Add a `MultiplayerSynchronizer` and, when `properties` are given, build a `SceneReplicationConfig` replicating them. `root_path` is the node the property NodePaths are relative to (default `..`); property paths look like `.:position`.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["parent_path"],
  "properties": {
    "parent_path": { "type": "string" },
    "name": { "type": "string" },
    "root_path": { "type": "string" },
    "properties": { "type": "array", "items": { "type": "string" } },
    "replication_mode": { "enum": ["always", "on_change", "never"] }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "name", "type", "root_path", "properties"],
  "properties": {
    "path": { "type": "string" }, "name": { "type": "string" }, "type": { "type": "string" },
    "root_path": { "type": "string" },
    "properties": { "type": "array", "items": { "type": "string" } }
  } }
```

### `mp_set_authority` ✅  (Plane A / Editor)  · undoable
Set a node's multiplayer authority (`set_multiplayer_authority`) to a peer id (1 = server). The authority peer is the one allowed to push `authority`-mode RPCs / synchronizer state for that node.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "peer_id"],
  "properties": {
    "path": { "type": "string" },
    "peer_id": { "type": "integer" },
    "recursive": { "type": "boolean" }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["path", "peer_id", "previous", "recursive"],
  "properties": {
    "path": { "type": "string" }, "peer_id": { "type": "integer" },
    "previous": { "type": "integer" }, "recursive": { "type": "boolean" }
  } }
```

The four codegen tools share one result envelope (validates the `written` and — WebRTC only — `unsupported` outcomes; tool-specific extras like `bytes` / `created` / `function` / `annotation` / `stub_created` are additional):
```json
{ "type": "object", "required": ["status", "kind", "path", "message"],
  "properties": {
    "status": { "enum": ["written", "unsupported"] },
    "kind": { "type": "string" },
    "path": { "type": ["string", "null"] },
    "message": { "type": "string" }
  } }
```

### `mp_setup_enet_peer` ✅  (Plane A / Editor + host)  · writes file (gated)
Generate an `ENetMultiplayerPeer` host/join helper script (`host_game` / `join_game` / `close`) and assign `multiplayer.multiplayer_peer`. Godot's default, always-available transport.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["to_path"],
  "properties": {
    "to_path": { "type": "string" },
    "port": { "type": "integer", "minimum": 1 },
    "max_clients": { "type": "integer", "minimum": 1 },
    "class_name": { "type": "string" },
    "overwrite": { "type": "boolean" },
    "confirm": { "type": "boolean" }
  } }
```
- **Output** — the shared codegen envelope above (`status: "written"`).

### `mp_setup_webrtc_peer` ✅  (Plane A / Editor + host)  · writes file (gated) · feature-detected
Generate a `WebRTCMultiplayerPeer` mesh helper. If the WebRTC module/extension is absent, degrades to `status: "unsupported"` and writes nothing.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["to_path"],
  "properties": {
    "to_path": { "type": "string" },
    "class_name": { "type": "string" },
    "overwrite": { "type": "boolean" },
    "confirm": { "type": "boolean" }
  } }
```
- **Output** — the shared codegen envelope above (`status: "written"` or `"unsupported"`).

### `mp_wire_rpc` ✅  (Plane A / Editor + host)  · writes file (gated)
Insert (or replace) an `@rpc(...)` annotation above a function in an existing `res://` script; appends a stub when the function is absent. Operates on the on-disk file (save unsaved editor changes first).
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["path", "function"],
  "properties": {
    "path": { "type": "string" },
    "function": { "type": "string" },
    "mode": { "enum": ["authority", "any_peer"] },
    "transfer_mode": { "enum": ["unreliable", "unreliable_ordered", "reliable"] },
    "call_local": { "type": "boolean" },
    "channel": { "type": "integer", "minimum": 0 },
    "confirm": { "type": "boolean" }
  } }
```
- **Output** — the shared codegen envelope above, plus `function`, `annotation`, `stub_created`.

### `mp_scaffold_lobby` ✅  (Plane A / Editor + host)  · writes file (gated)
Generate a lobby controller GDScript: ENet host/join plus `peer_connected` / `peer_disconnected` tracking with `player_joined` / `player_left` / `server_started` / `join_succeeded` / `join_failed` signals.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["to_path"],
  "properties": {
    "to_path": { "type": "string" },
    "port": { "type": "integer", "minimum": 1 },
    "max_players": { "type": "integer", "minimum": 1 },
    "class_name": { "type": "string" },
    "overwrite": { "type": "boolean" },
    "confirm": { "type": "boolean" }
  } }
```
- **Output** — the shared codegen envelope above (`status: "written"`).

The **second half** of Group M is backend-SDK integration scaffolding (`backend_detect` + the four `*_scaffold` codegen tools). Same "host nothing, scaffold everything" stance: we never run a leaderboard DB, save-store or auth service — we generate the integration against the game's *installed* SDK (SilentWolf / Nakama / PlayFab / Photon). Every codegen tool is **feature-detected twice, and never a dead call**: if the SDK provides no such API (Photon is realtime transport, so it has no leaderboard/cloud-save/auth), it degrades to `status: "unsupported_feature"`; if the SDK is not installed in the project, it degrades to `status: "sdk_missing"` ("install <SDK> first"). Detection (via `backend_detect` → the `backend.detect` bridge method) keys off an enabled autoload, an addon directory under `res://addons`, or a global `class_name`. Only a capable + installed SDK reaches the (gated) writer; the generated GDScript is built host-side and written through the shared `mp.write_script` bridge method. Markers `AUTH_BACKEND_*` in the authoring-plane probe.

### `backend_detect` ✅  (Plane A / Editor)  · read-only
Report which known backend SDKs (SilentWolf / Nakama / PlayFab / Photon) are installed in the project and how each was found (an enabled autoload, an addon directory, or a global `class_name`). Read-only — nothing is written.
- **Input**
```json
{ "type": "object", "additionalProperties": false,
  "properties": {
    "sdk": { "enum": ["silentwolf", "nakama", "playfab", "photon"] }
  } }
```
- **Output**
```json
{ "type": "object", "required": ["detected", "backends", "message"], "properties": { "detected": { "type": "array", "items": { "type": "string" } }, "backends": { "type": "array", "items": { "type": "object", "required": ["sdk", "installed"], "properties": { "sdk": { "type": "string" }, "installed": { "type": "boolean" }, "method": { "type": ["string", "null"] }, "autoload": { "type": ["string", "null"] }, "addon_dir": { "type": ["string", "null"] }, "class_name": { "type": ["string", "null"] } } } }, "message": { "type": "string" } } }
```

### `backend_configure` ✅  (Plane A / Editor + host)  · writes file (gated) · feature-detected
Generate a config/bootstrap GDScript for a backend SDK — constants (API key / game id / host / title id / app id) plus a `configure()` you register as an autoload. If the SDK is not installed, degrades to `status: "sdk_missing"` and writes nothing.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["sdk"],
  "properties": {
    "sdk": { "enum": ["silentwolf", "nakama", "playfab", "photon"] },
    "to_path": { "type": "string" },
    "api_key": { "type": "string" },
    "game_id": { "type": "string" },
    "title_id": { "type": "string" },
    "app_id": { "type": "string" },
    "host": { "type": "string" },
    "port": { "type": "integer", "minimum": 1 },
    "server_key": { "type": "string" },
    "region": { "type": "string" },
    "overwrite": { "type": "boolean" },
    "confirm": { "type": "boolean" }
  } }
```
- **Output** — the shared backend scaffold envelope: `status` (`"written"` / `"sdk_missing"` / `"unsupported_feature"`), `sdk`, `kind`, `path` (nullable), `message`.

### `leaderboard_scaffold` ✅  (Plane A / Editor + host)  · writes file (gated) · feature-detected
Generate submit/fetch leaderboard helpers against the installed SDK. Degrades to `unsupported_feature` (Photon has no leaderboard API) or `sdk_missing` (not installed); neither writes.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["sdk"],
  "properties": {
    "sdk": { "enum": ["silentwolf", "nakama", "playfab", "photon"] },
    "to_path": { "type": "string" },
    "leaderboard_name": { "type": "string" },
    "overwrite": { "type": "boolean" },
    "confirm": { "type": "boolean" }
  } }
```
- **Output** — the shared backend scaffold envelope above.

### `cloudsave_scaffold` ✅  (Plane A / Editor + host)  · writes file (gated) · feature-detected
Generate save/load cloud-save helpers against the installed SDK. Degrades to `unsupported_feature` (Photon has no cloud-save API) or `sdk_missing` (not installed); neither writes.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["sdk"],
  "properties": {
    "sdk": { "enum": ["silentwolf", "nakama", "playfab", "photon"] },
    "to_path": { "type": "string" },
    "overwrite": { "type": "boolean" },
    "confirm": { "type": "boolean" }
  } }
```
- **Output** — the shared backend scaffold envelope above.

### `auth_scaffold` ✅  (Plane A / Editor + host)  · writes file (gated) · feature-detected
Generate login/register/logout helpers against the installed SDK. Degrades to `unsupported_feature` (Photon has no auth API) or `sdk_missing` (not installed); neither writes.
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["sdk"],
  "properties": {
    "sdk": { "enum": ["silentwolf", "nakama", "playfab", "photon"] },
    "to_path": { "type": "string" },
    "overwrite": { "type": "boolean" },
    "confirm": { "type": "boolean" }
  } }
```
- **Output** — the shared backend scaffold envelope above.

---

## Destructive-action gating (elicitation) — Phase 4

Every tool flagged **destructive** accepts an optional `confirm: boolean`. When it is omitted, the host issues an MCP **elicitation** (a client-side confirmation prompt) before executing: on *accept* it proceeds; on *decline/cancel* it returns a non-error "cancelled" result. If the client does not support elicitation, the tool blocks and instructs the caller to re-invoke with `confirm: true` — so a destructive op is never executed silently. Gated tools: `node_delete`, `project_set_setting`, `scene_new`, `gd_rename` (when `apply=true`), `cs_rename` (when `apply=true`), `dbg_evaluate`, `dbg_set_variable`, `dbg_goto`, `runtime_set_property`, `runtime_call_method`, `runtime_emit_signal`, `runtime_inject_input`.

The long-running tools (`godot_export`, `godot_import`, `godot_run_headless_script`) run under the formal MCP **task-execution model** (D2), registered with `taskSupport: 'optional'`. A task-aware client calls the tool with a `task` augmentation to get a task handle back immediately, then drives it with `tasks/get` (poll status), `tasks/result` (await the final result), and `tasks/cancel` (stop the run — which aborts the underlying headless Godot process). A plain client that omits the `task` augmentation is unaffected: the host auto-creates a task, polls it to completion, and returns the result synchronously, exactly as before.

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
- **Input**
```json
{ "type": "object", "additionalProperties": false, "required": ["id"], "properties": { "id": { "type": "string" } } }
```
- **Output**
```json
{ "type": "object", "required": ["id", "stopped"], "properties": { "id": { "type": "string" }, "stopped": { "type": "boolean" } } }
```

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

## Resource subscriptions (D3)

The server advertises the `resources.subscribe` capability. A client may `resources/subscribe` (and
`resources/unsubscribe`) any of the URIs above; the host then pushes `notifications/resources/updated`
for a URI when its underlying source changes, so a subscriber re-reads only when needed instead of
polling. Change signals come from two sources. The **editor addon**: changing the node selection
updates `godot://editor-state`, and switching the edited scene updates both `godot://editor-state`
and `godot://scene-tree`. The **in-game runtime autoload**: when the running game's live SceneTree
gains, loses, or renames a node, it updates `godot://runtime/tree` (coalesced to at most one push per
frame regardless of how many nodes changed that frame). Non-subscribers are unaffected — the
pull-on-demand reads above behave exactly as before. The push travels over the same bridge socket as
an unsolicited `{"event":"resource.changed","uri":…}` line (no request `id`, so it never collides
with a request/response); only URIs a client has actually subscribed to are forwarded to that client.

The host also **coalesces** rapid updates per URI with a leading-edge + trailing-flush throttle: the
first change pushes immediately, then further changes inside a short window (default 50 ms, override
via `BREAKPOINT_RESOURCE_COALESCE_MS`; `0` disables it) collapse into at most one trailing push. Multiple
`updated` notifications are spec-harmless — the client just re-reads — so this only trims volume.

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
| `editor_undo` | A / Editor | ✅ | – |
| `editor_redo` | A / Editor | ✅ | – |
| `project_get_info` | A / Editor | ✅ | – |
| `project_get_setting` | A / Editor | ✅ | – |
| `project_set_setting` | A / Editor | ✅ | ✔ |
| `scene_get_tree` | A / Editor | ✅ | – |
| `scene_open` | A / Editor | ✅ | – |
| `scene_save` | A / Editor | ✅ | writes file |
| `scene_new` | A / Editor | ✅ | writes file |
| `scene_list_open` | A / Editor | ✅ | – |
| `scene_reload` | A / Editor | ✅ | ✔ |
| `scene_close` | A / Editor | ✅ | ✔ |
| `scene_pack` | A / Editor | ✅ | ✔ writes file |
| `scene_get_dependencies` | A / Editor | ✅ | – |
| `scene_save_as` | A / Editor | ✅ | ✔ writes file |
| `node_add` | A / Editor | ✅ | undoable |
| `node_delete` | A / Editor | ✅ | ✔ undoable |
| `node_rename` | A / Editor | ✅ | undoable |
| `node_reparent` | A / Editor | ✅ | undoable |
| `node_set_property` | A / Editor | ✅ | undoable |
| `node_get_property` | A / Editor | ✅ | – |
| `node_duplicate` | A / Editor | ✅ | undoable |
| `node_get_children` | A / Editor | ✅ | – |
| `node_find` | A / Editor | ✅ | – |
| `node_list_groups` | A / Editor | ✅ | – |
| `node_add_to_group` | A / Editor | ✅ | undoable |
| `node_remove_from_group` | A / Editor | ✅ | undoable |
| `node_instantiate_scene` | A / Editor | ✅ | undoable |
| `node_move_child` | A / Editor | ✅ | undoable |
| `node_change_type` | A / Editor | ✅ | undoable |
| `node_set_owner` | A / Editor | ✅ | undoable |
| `node_call_method` | A / Editor | ✅ | ✔ |
| `node_get_path` | A / Editor | ✅ | – |
| `node_list_properties` | A / Editor | ✅ | – |
| `signal_list` | A / Editor | ✅ | – |
| `signal_list_connections` | A / Editor | ✅ | – |
| `signal_connect` | A / Editor | ✅ | undoable |
| `signal_disconnect` | A / Editor | ✅ | undoable |
| `signal_add_user_signal` | A / Editor | ✅ | undoable |
| `signal_emit` | A / Editor | ✅ | ✔ |
| `selection_get` | A / Editor | ✅ | – |
| `selection_set` | A / Editor | ✅ | – |
| `classdb_get_class` | A / Editor | ✅ | – |
| `screenshot_editor` | A / Editor | ✅ | – |
| `resource_create` | A / Editor | ✅ | ✔ writes file |
| `resource_load` | A / Editor | ✅ | – |
| `resource_save` | A / Editor | ✅ | ✔ writes file |
| `resource_duplicate` | A / Editor | ✅ | ✔ writes file |
| `resource_get_property` | A / Editor | ✅ | – |
| `resource_set_property` | A / Editor | ✅ | ✔ writes file |
| `resource_get_import_settings` | A / Editor | ✅ | – |
| `resource_set_import_settings` | A / Editor | ✅ | ✔ reimports |
| `filesystem_list` | A / Editor | ✅ | – |
| `filesystem_scan` | A / Editor | ✅ | – |
| `filesystem_move` | A / Editor | ✅ | ✔ moves file |
| `filesystem_create_dir` | A / Editor | ✅ | writes dir |
| `anim_player_create` | C / Editor | ✅ | – |
| `anim_create` | C / Editor | ✅ | – |
| `anim_delete` | C / Editor | ✅ | ✔ gated |
| `anim_add_track` | C / Editor | ✅ | – |
| `anim_insert_key` | C / Editor | ✅ | – |
| `anim_remove_key` | C / Editor | ✅ | – |
| `anim_set_length` | C / Editor | ✅ | – |
| `anim_set_loop` | C / Editor | ✅ | – |
| `anim_get_track_keys` | C / Editor | ✅ | – |
| `anim_list` | C / Editor | ✅ | – |
| `anim_tree_create` | C / Editor | ✅ | – |
| `anim_tree_add_node` | C / Editor | ✅ | – |
| `anim_statemachine_add_state` | C / Editor | ✅ | – |
| `anim_statemachine_add_transition` | C / Editor | ✅ | – |
| `tileset_create` | D / Editor | ✅ | ✔ writes file |
| `tileset_add_source` | D / Editor | ✅ | ✔ writes file |
| `tileset_add_tile` | D / Editor | ✅ | ✔ writes file |
| `tileset_set_tile_collision` | D / Editor | ✅ | ✔ writes file |
| `tilemaplayer_create` | D / Editor | ✅ | undoable |
| `tilemap_set_cell` | D / Editor | ✅ | undoable |
| `tilemap_set_cells_rect` | D / Editor | ✅ | undoable |
| `tilemap_get_cell` | D / Editor | ✅ | – |
| `tilemap_clear` | D / Editor | ✅ | undoable |
| `body_create` | E / Editor | ✅ | undoable |
| `collisionshape_add` | E / Editor | ✅ | undoable |
| `body_set_collision_layer` | E / Editor | ✅ | undoable |
| `body_set_collision_mask` | E / Editor | ✅ | undoable |
| `area_set_monitoring` | E / Editor | ✅ | undoable |
| `area_set_gravity` | E / Editor | ✅ | undoable |
| `joint_create` | E / Editor | ✅ | undoable |
| `joint_set_bodies` | E / Editor | ✅ | undoable |
| `collisionpolygon_add` | E / Editor | ✅ | undoable |
| `rigidbody_set_properties` | E / Editor | ✅ | undoable |
| `body_set_physics_material` | E / Editor | ✅ | undoable |
| `physics_set_gravity` | E / Editor | ✅ | ✔ writes setting |
| `particles_create` | F / Editor | ✅ | undoable |
| `particles_set_process_material` | F / Editor | ✅ | undoable |
| `particles_set_amount` | F / Editor | ✅ | undoable |
| `particles_set_lifetime` | F / Editor | ✅ | undoable |
| `particles_set_emitting` | F / Editor | ✅ | undoable |
| `particles_set_texture` | F / Editor | ✅ | undoable |
| `shader_create` | F / Editor | ✅ | ✔ writes file |
| `shader_set_code` | F / Editor | ✅ | ✔ writes file |
| `shadermaterial_create` | F / Editor | ✅ | undoable |
| `shadermaterial_set_shader` | F / Editor | ✅ | undoable |
| `shadermaterial_set_param` | F / Editor | ✅ | undoable |
| `audio_player_create` | F / Editor | ✅ | undoable |
| `audio_set_stream` | F / Editor | ✅ | undoable |
| `audio_bus_add` | F / Editor | ✅ | ✔ project-wide |
| `audio_bus_add_effect` | F / Editor | ✅ | ✔ project-wide |
| `audio_bus_set_volume` | F / Editor | ✅ | ✔ project-wide |
| `audio_set_bus_layout` | F / Editor | ✅ | ✔ writes file |
| `control_create` | G / Editor | ✅ | undoable |
| `container_add_child` | G / Editor | ✅ | undoable |
| `control_set_anchors` | G / Editor | ✅ | undoable |
| `control_set_layout_preset` | G / Editor | ✅ | undoable |
| `control_set_size_flags` | G / Editor | ✅ | undoable |
| `control_set_theme` | G / Editor | ✅ | undoable |
| `theme_create` | G / Editor | ✅ | ✔ writes file |
| `theme_set_color` | G / Editor | ✅ | ✔ writes file |
| `theme_set_font` | G / Editor | ✅ | ✔ writes file |
| `theme_set_stylebox` | G / Editor | ✅ | ✔ writes file |
| `theme_set_constant` | G / Editor | ✅ | ✔ writes file |
| `meshinstance_create` | H / Editor | ✅ | undoable |
| `mesh_set_surface_material` | H / Editor | ✅ | undoable |
| `primitive_mesh_create` | H / Editor | ✅ | ✔ writes file |
| `light_create` | H / Editor | ✅ | undoable |
| `camera_create` | H / Editor | ✅ | undoable |
| `csg_create` | H / Editor | ✅ | undoable |
| `navregion_create` | H / Editor | ✅ | undoable |
| `navagent_configure` | H / Editor | ✅ | undoable |
| `environment_create` | H / Editor | ✅ | ✔ writes file |
| `environment_set_sky` | H / Editor | ✅ | ✔ writes file |
| `inputmap_add_action` | I / Editor | ✅ | ✔ writes setting |
| `inputmap_add_event` | I / Editor | ✅ | ✔ writes setting |
| `inputmap_list` | I / Editor | ✅ | – |
| `inputmap_erase_action` | I / Editor | ✅ | ✔ writes setting |
| `project_add_autoload` | I / Editor | ✅ | ✔ writes setting |
| `project_remove_autoload` | I / Editor | ✅ | ✔ writes setting |
| `project_add_export_preset` | I / Editor | ✅ | ✔ writes file |
| `project_set_main_scene` | I / Editor | ✅ | ✔ writes setting |
| `project_list_settings` | I / Editor | ✅ | – |
| `editorsettings_get_set` | I / Editor | ✅ | ✔ on set |
| `test_detect` | I / Editor | ✅ | – |
| `test_list` | I / Editor | ✅ | – |
| `gd_completion` | D / LSP | ✅ | – |
| `gd_hover` | D / LSP | ✅ | – |
| `gd_definition` | D / LSP | ✅ | – |
| `gd_references` | D / LSP | ✅ | – |
| `gd_rename` | D / LSP | ✅ | ✔ |
| `gd_document_symbols` | D / LSP | ✅ | – |
| `gd_workspace_symbols` | D / LSP | ⚠️ engine-missing (handled) | – |
| `gd_diagnostics` | D / LSP | ✅ | – |
| `gd_signature_help` | D / LSP | ✅ | – |
| `gd_code_action` | D / LSP | ⚠️ engine-dependent (handled) | – |
| `gd_document_highlight` | D / LSP | ⚠️ 4.3 advertises false (handled) | – |
| `gd_type_definition` | D / LSP | ⚠️ 4.3 advertises false (handled) | – |
| `gd_implementation` | D / LSP | ⚠️ 4.3 advertises false (handled) | – |
| `gd_declaration` | D / LSP | ✅ confirmed live (4.3) | – |
| `gd_folding_ranges` | D / LSP | ⚠️ 4.3 advertises false (handled) | – |
| `gd_document_link` | D / LSP | ✅ confirmed live (4.3) | – |
| `gd_formatting` | D / LSP | ⚠️ 4.3 advertises false (handled) | – |
| `gd_document_color` | D / LSP | ⚠️ 4.3 advertises false (handled) | – |
| `cs_completion` | D / C# LSP | ✅ | – |
| `cs_hover` | D / C# LSP | ✅ | – |
| `cs_definition` | D / C# LSP | ✅ | – |
| `cs_references` | D / C# LSP | ✅ | – |
| `cs_rename` | D / C# LSP | ✅ | ✔ |
| `cs_document_symbols` | D / C# LSP | ✅ | – |
| `cs_workspace_symbols` | D / C# LSP | ✅ (OmniSharp implements it) | – |
| `cs_signature_help` | D / C# LSP | ✅ | – |
| `cs_diagnostics` | D / C# LSP | ✅ | – |
| `cs_code_action` | D / C# LSP | ✅ (OmniSharp implements it) | – |
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
| `dbg_set_exception_breakpoints` | D / DAP | ✅ | – |
| `dbg_set_variable` | D / DAP | ✅ | ✔ mutates state |
| `dbg_restart` | D / DAP | ✅ | – |
| `dbg_goto` | D / DAP | ✅ | ✔ moves execution |
| `dbg_data_breakpoints` | D / DAP | ✅ | – |
| `cs_dbg_launch` | D / C# DAP | ✅ | runs code |
| `cs_dbg_attach` | D / C# DAP | ✅ | – |
| `cs_dbg_set_breakpoints` | D / C# DAP | ✅ | – |
| `cs_dbg_continue` | D / C# DAP | ✅ | – |
| `cs_dbg_step` | D / C# DAP | ✅ | – |
| `cs_dbg_stack_trace` | D / C# DAP | ✅ | – |
| `cs_dbg_scopes` | D / C# DAP | ✅ | – |
| `cs_dbg_variables` | D / C# DAP | ✅ | – |
| `cs_dbg_evaluate` | D / C# DAP | ✅ | ✔ arbitrary code |
| `cs_dbg_set_variable` | D / C# DAP | ✅ | ✔ mutates state |
| `cs_dbg_watch` | D / C# DAP | ✅ | – |
| `cs_dbg_set_exception_breakpoints` | D / C# DAP | ✅ | – |
| `cs_dbg_restart` | D / C# DAP | ✅ | – |
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

| `project_search` | K / Host | ✅ | – |
| `find_symbol` | K / Host | ✅ | – |
| `find_usages` | K / Host | ✅ | – |
| `example_snippet` | K / Host | ✅ | – |
| `class_reference` | K / Editor | ✅ | – |
| `docs_search` | K / Editor | ✅ | – |

| `asset_gen_configure` | J / Host | ✅ | – |
| `asset_gen_placeholder` | J / Editor | ✅ | ✔ writes file |
| `asset_gen_sprite` | J / Editor | ✅ | ✔ writes file |
| `asset_gen_texture` | J / Editor | ✅ | ✔ writes file |
| `asset_gen_icon` | J / Editor | ✅ | ✔ writes file |
| `asset_gen_audio_sfx` | J / Editor | ✅ | ✔ writes file |
| `asset_gen_model` | J / Editor | ✅ | ✔ writes file |

| `mp_add_spawner` | M / Editor | ✅ | undoable |
| `mp_add_synchronizer` | M / Editor | ✅ | undoable |
| `mp_set_authority` | M / Editor | ✅ | undoable |
| `mp_setup_enet_peer` | M / Editor | ✅ | ✔ writes file |
| `mp_setup_webrtc_peer` | M / Editor | ✅ | ✔ writes file |
| `mp_wire_rpc` | M / Editor | ✅ | ✔ writes file |
| `mp_scaffold_lobby` | M / Editor | ✅ | ✔ writes file |
| `backend_detect` | M / Editor | ✅ | – |
| `backend_configure` | M / Editor | ✅ | ✔ writes file |
| `leaderboard_scaffold` | M / Editor | ✅ | ✔ writes file |
| `cloudsave_scaffold` | M / Editor | ✅ | ✔ writes file |
| `auth_scaffold` | M / Editor | ✅ | ✔ writes file |

**70 tools + 5 MCP resources implemented across Phases 0–4: 6 CLI, 3 managed-process, 19 editor, 18 LSP, 15 DAP, 9 runtime. Destructive tools are elicitation-gated; long jobs stream progress. All four planes live.**
