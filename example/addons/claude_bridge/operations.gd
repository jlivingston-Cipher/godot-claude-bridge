@tool
extends RefCounted
## Request handlers for the Claude Bridge.
##
## Every handler returns a plain Dictionary that becomes the JSON-RPC `result`.
## Errors are raised via `_err(code, message)`. All edit-time mutations are
## wrapped in the EditorUndoRedoManager so a human can Ctrl-Z anything Claude did.

const Codec := preload("res://addons/claude_bridge/variant_json.gd")
const ADDON_VERSION := "0.6.1"

var _plugin: EditorPlugin


func setup(plugin: EditorPlugin) -> void:
	_plugin = plugin


## Dispatch a method name + params to a handler. Returns {ok, result|error}.
func dispatch(method: String, params: Dictionary) -> Dictionary:
	match method:
		"ping":
			return _ok(_ping())
		"editor.get_state":
			return _ok(_editor_get_state())
		"project.get_info":
			return _ok(_project_get_info())
		"project.get_setting":
			return _project_get_setting(params)
		"project.set_setting":
			return _project_set_setting(params)
		"scene.get_tree":
			return _scene_get_tree(params)
		"scene.open":
			return _scene_open(params)
		"scene.save":
			return _scene_save()
		"scene.new":
			return _scene_new(params)
		"node.add":
			return _node_add(params)
		"node.delete":
			return _node_delete(params)
		"node.rename":
			return _node_rename(params)
		"node.reparent":
			return _node_reparent(params)
		"node.set_property":
			return _node_set_property(params)
		"node.get_property":
			return _node_get_property(params)
		"selection.get":
			return _ok(_selection_get())
		"selection.set":
			return _selection_set(params)
		"classdb.get_class":
			return _classdb_get_class(params)
		"screenshot.editor_viewport":
			return _screenshot(params)
		_:
			return _err("unknown_method", "No such method: %s" % method)


# ---------------------------------------------------------------- helpers ----

func _ok(result: Variant) -> Dictionary:
	return {"ok": true, "result": result}


func _err(code: String, message: String) -> Dictionary:
	return {"ok": false, "error": {"code": code, "message": message}}


func _edited_root() -> Node:
	return EditorInterface.get_edited_scene_root()


## Resolve a node path relative to the edited scene root.
## "" or "." → the root itself; otherwise a path like "Player/Sprite2D".
func _resolve(root: Node, path: String) -> Node:
	if root == null:
		return null
	if path == "" or path == "." or path == "/root":
		return root
	if root.has_node(path):
		return root.get_node(path)
	return null


func _path_of(root: Node, node: Node) -> String:
	if node == root:
		return "."
	return String(root.get_path_to(node))


# ------------------------------------------------------------- handlers ------

func _ping() -> Dictionary:
	return {
		"pong": true,
		"addon_version": ADDON_VERSION,
		"godot": Engine.get_version_info().get("string", ""),
	}


func _editor_get_state() -> Dictionary:
	var root := _edited_root()
	var selection: Array = []
	if root:
		for n in EditorInterface.get_selection().get_selected_nodes():
			selection.append(_path_of(root, n))
	return {
		"has_open_scene": root != null,
		"edited_scene_root": (_path_of(root, root) if root else null),
		"edited_scene_path": (root.scene_file_path if root else null),
		"root_type": (root.get_class() if root else null),
		"selection": selection,
		"godot": Engine.get_version_info().get("string", ""),
	}


func _project_get_info() -> Dictionary:
	return {
		"name": ProjectSettings.get_setting("application/config/name", ""),
		"main_scene": ProjectSettings.get_setting("application/run/main_scene", ""),
		"project_root": ProjectSettings.globalize_path("res://"),
		"godot": Engine.get_version_info().get("string", ""),
		"features": Array(ProjectSettings.get_setting("application/config/features", [])),
	}


func _project_get_setting(params: Dictionary) -> Dictionary:
	var key := String(params.get("name", ""))
	if key == "" or not ProjectSettings.has_setting(key):
		return _err("not_found", "Project setting not found: %s" % key)
	return _ok({"name": key, "value": Codec.encode(ProjectSettings.get_setting(key))})


func _project_set_setting(params: Dictionary) -> Dictionary:
	var key := String(params.get("name", ""))
	if key == "":
		return _err("bad_params", "Missing 'name'")
	ProjectSettings.set_setting(key, Codec.decode(params.get("value")))
	if bool(params.get("save", false)):
		var e := ProjectSettings.save()
		if e != OK:
			return _err("save_failed", "ProjectSettings.save() returned %d" % e)
	return _ok({"name": key, "saved": bool(params.get("save", false))})


func _serialize_node(node: Node, root: Node, depth: int, max_depth: int) -> Dictionary:
	var script_path: Variant = null
	var scr := node.get_script()
	if scr and scr is Resource:
		script_path = (scr as Resource).resource_path
	var d := {
		"name": String(node.name),
		"type": node.get_class(),
		"path": _path_of(root, node),
		"script": script_path,
		"child_count": node.get_child_count(),
	}
	if depth < max_depth and node.get_child_count() > 0:
		var kids: Array = []
		for c in node.get_children():
			kids.append(_serialize_node(c, root, depth + 1, max_depth))
		d["children"] = kids
	return d


func _scene_get_tree(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is currently open in the editor")
	var max_depth := int(params.get("max_depth", 64))
	return _ok(_serialize_node(root, root, 0, max_depth))


func _scene_open(params: Dictionary) -> Dictionary:
	var path := String(params.get("path", ""))
	if path == "" or not ResourceLoader.exists(path):
		return _err("not_found", "Scene not found: %s" % path)
	EditorInterface.open_scene_from_path(path)
	return _ok({"opened": path})


func _scene_save() -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var e := EditorInterface.save_scene()
	if e != OK:
		return _err("save_failed", "save_scene() returned %d (has the scene ever been saved to a path?)" % e)
	return _ok({"saved": root.scene_file_path})


func _scene_new(params: Dictionary) -> Dictionary:
	var root_type := String(params.get("root_type", "Node"))
	var path := String(params.get("path", ""))
	if path == "":
		return _err("bad_params", "'path' is required (e.g. res://scenes/new.tscn)")
	if not ClassDB.can_instantiate(root_type):
		return _err("bad_type", "Cannot instantiate class: %s" % root_type)
	var root: Node = ClassDB.instantiate(root_type)
	root.name = String(params.get("name", root_type))
	var packed := PackedScene.new()
	var e := packed.pack(root)
	if e != OK:
		return _err("pack_failed", "PackedScene.pack() returned %d" % e)
	e = ResourceSaver.save(packed, path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	EditorInterface.open_scene_from_path(path)
	return _ok({"created": path, "root_type": root_type})


func _node_add(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var type := String(params.get("type", "Node"))
	if not ClassDB.can_instantiate(type):
		return _err("bad_type", "Cannot instantiate class: %s" % type)
	var node: Node = ClassDB.instantiate(type)
	node.name = String(params.get("name", type))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": type})


func _node_delete(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if node == root:
		return _err("refused", "Refusing to delete the scene root")
	var parent := node.get_parent()
	var index := node.get_index()
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: delete %s" % node.name)
	ur.add_do_method(parent, "remove_child", node)
	ur.add_undo_method(parent, "add_child", node)
	ur.add_undo_method(parent, "move_child", node, index)
	ur.add_undo_method(node, "set_owner", root)
	ur.add_undo_reference(node)
	ur.commit_action()
	return _ok({"deleted": String(params.get("path", ""))})


func _node_rename(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var new_name := String(params.get("new_name", ""))
	if new_name == "":
		return _err("bad_params", "Missing 'new_name'")
	var old_name := String(node.name)
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: rename %s -> %s" % [old_name, new_name])
	ur.add_do_property(node, "name", new_name)
	ur.add_undo_property(node, "name", old_name)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name)})


func _node_reparent(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if node == root:
		return _err("refused", "Cannot reparent the scene root")
	var new_parent := _resolve(root, String(params.get("new_parent_path", "")))
	if new_parent == null:
		return _err("bad_path", "New parent not found: %s" % params.get("new_parent_path", ""))
	var keep := bool(params.get("keep_global_transform", true))
	var old_parent := node.get_parent()
	var old_index := node.get_index()
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: reparent %s" % node.name)
	ur.add_do_method(node, "reparent", new_parent, keep)
	ur.add_do_method(node, "set_owner", root)
	ur.add_undo_method(node, "reparent", old_parent, keep)
	ur.add_undo_method(old_parent, "move_child", node, old_index)
	ur.add_undo_method(node, "set_owner", root)
	ur.commit_action()
	return _ok({"path": _path_of(root, node)})


func _node_set_property(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var prop := String(params.get("property", ""))
	if prop == "":
		return _err("bad_params", "Missing 'property'")
	var old_value: Variant = node.get(prop)
	var new_value: Variant = Codec.decode(params.get("value"))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s.%s" % [node.name, prop])
	ur.add_do_property(node, prop, new_value)
	ur.add_undo_property(node, prop, old_value)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "property": prop, "value": Codec.encode(node.get(prop))})


func _node_get_property(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var prop := String(params.get("property", ""))
	if prop == "":
		return _err("bad_params", "Missing 'property'")
	return _ok({"path": _path_of(root, node), "property": prop, "value": Codec.encode(node.get(prop))})


func _selection_get() -> Dictionary:
	var root := _edited_root()
	var paths: Array = []
	if root:
		for n in EditorInterface.get_selection().get_selected_nodes():
			paths.append(_path_of(root, n))
	return {"selection": paths}


func _selection_set(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var sel := EditorInterface.get_selection()
	sel.clear()
	var applied: Array = []
	for p in params.get("paths", []):
		var node := _resolve(root, String(p))
		if node:
			sel.add_node(node)
			applied.append(String(p))
	return _ok({"selection": applied})


func _classdb_get_class(params: Dictionary) -> Dictionary:
	var cls := String(params.get("class_name", ""))
	if cls == "" or not ClassDB.class_exists(cls):
		return _err("not_found", "Class not found: %s" % cls)
	var inherited := bool(params.get("include_inherited", false))
	var no_inherit := not inherited
	var methods: Array = []
	for m in ClassDB.class_get_method_list(cls, no_inherit):
		methods.append(String(m.get("name", "")))
	var props: Array = []
	for p in ClassDB.class_get_property_list(cls, no_inherit):
		props.append(String(p.get("name", "")))
	var signals: Array = []
	for s in ClassDB.class_get_signal_list(cls, no_inherit):
		signals.append(String(s.get("name", "")))
	return _ok({
		"class": cls,
		"parent": ClassDB.get_parent_class(cls),
		"can_instantiate": ClassDB.can_instantiate(cls),
		"methods": methods,
		"properties": props,
		"signals": signals,
	})


func _screenshot(params: Dictionary) -> Dictionary:
	var which := String(params.get("viewport", "3d"))
	var vp: SubViewport = null
	if which == "2d":
		vp = EditorInterface.get_editor_viewport_2d()
	else:
		vp = EditorInterface.get_editor_viewport_3d(0)
	if vp == null:
		return _err("no_viewport", "Editor viewport '%s' is not available" % which)
	var tex := vp.get_texture()
	if tex == null:
		return _err("no_texture", "Viewport has no texture yet (open the matching editor tab)")
	var img := tex.get_image()
	if img == null:
		return _err("no_image", "Could not read viewport image")
	var buf := img.save_png_to_buffer()
	return _ok({
		"mime": "image/png",
		"base64": Marshalls.raw_to_base64(buf),
		"width": img.get_width(),
		"height": img.get_height(),
		"viewport": which,
	})
