@tool
extends RefCounted
## Request handlers for the Claude Bridge.
##
## Every handler returns a plain Dictionary that becomes the JSON-RPC `result`.
## Errors are raised via `_err(code, message)`. All edit-time mutations are
## wrapped in the EditorUndoRedoManager so a human can Ctrl-Z anything Claude did.

const Codec := preload("res://addons/claude_bridge/variant_json.gd")
const ADDON_VERSION := "0.10.0"

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
		"scene.list_open":
			return _ok(_scene_list_open())
		"scene.reload":
			return _scene_reload(params)
		"scene.close":
			return _scene_close(params)
		"scene.pack":
			return _scene_pack(params)
		"scene.get_dependencies":
			return _scene_get_dependencies(params)
		"scene.save_as":
			return _scene_save_as(params)
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
		"node.duplicate":
			return _node_duplicate(params)
		"node.get_children":
			return _node_get_children(params)
		"node.find":
			return _node_find(params)
		"node.list_groups":
			return _node_list_groups(params)
		"node.add_to_group":
			return _node_add_to_group(params)
		"node.remove_from_group":
			return _node_remove_from_group(params)
		"node.instantiate_scene":
			return _node_instantiate_scene(params)
		"node.move_child":
			return _node_move_child(params)
		"node.change_type":
			return _node_change_type(params)
		"node.set_owner":
			return _node_set_owner(params)
		"node.call_method":
			return _node_call_method(params)
		"node.get_path":
			return _node_get_path(params)
		"node.list_properties":
			return _node_list_properties(params)
		"signal.list":
			return _signal_list(params)
		"signal.list_connections":
			return _signal_list_connections(params)
		"signal.connect":
			return _signal_connect(params)
		"signal.disconnect":
			return _signal_disconnect(params)
		"signal.add_user_signal":
			return _signal_add_user_signal(params)
		"signal.emit":
			return _signal_emit(params)
		"resource.create":
			return _resource_create(params)
		"resource.load":
			return _resource_load(params)
		"resource.save":
			return _resource_save(params)
		"resource.duplicate":
			return _resource_duplicate(params)
		"resource.get_property":
			return _resource_get_property(params)
		"resource.set_property":
			return _resource_set_property(params)
		"resource.get_import_settings":
			return _resource_get_import_settings(params)
		"resource.set_import_settings":
			return _resource_set_import_settings(params)
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


# ------------------------------------------------- Group A: node depth -------

func _descendants(node: Node) -> Array:
	var out: Array = []
	for c in node.get_children():
		out.append(c)
		out.append_array(_descendants(c))
	return out


func _node_duplicate(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if node == root:
		return _err("refused", "Cannot duplicate the scene root")
	var parent := node.get_parent()
	var dup: Node = node.duplicate()
	if params.has("name"):
		dup.name = String(params.get("name"))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: duplicate %s" % node.name)
	ur.add_do_method(parent, "add_child", dup)
	ur.add_do_method(dup, "set_owner", root)
	for d in _descendants(dup):
		ur.add_do_method(d, "set_owner", root)
	ur.add_do_reference(dup)
	ur.add_undo_method(parent, "remove_child", dup)
	ur.commit_action()
	return _ok({"path": _path_of(root, dup), "name": String(dup.name), "type": dup.get_class()})


func _node_get_children(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var children: Array = []
	for c in node.get_children():
		children.append({"name": String(c.name), "type": c.get_class(), "path": _path_of(root, c)})
	return _ok({"path": _path_of(root, node), "children": children})


func _node_find(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var start := _resolve(root, String(params.get("root_path", ".")))
	if start == null:
		return _err("bad_path", "Search root not found: %s" % params.get("root_path", "."))
	var want_type := String(params.get("type", ""))
	var name_has := String(params.get("name_contains", ""))
	var limit := int(params.get("limit", 200))
	var matches: Array = []
	for n in _descendants(start):
		if want_type != "" and not n.is_class(want_type):
			continue
		if name_has != "" and String(n.name).findn(name_has) == -1:
			continue
		matches.append({"name": String(n.name), "type": n.get_class(), "path": _path_of(root, n)})
		if matches.size() >= limit:
			break
	return _ok({"matches": matches, "count": matches.size()})


func _node_list_groups(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var groups: Array = []
	for g in node.get_groups():
		groups.append(String(g))
	return _ok({"path": _path_of(root, node), "groups": groups})


func _node_add_to_group(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var group := String(params.get("group", ""))
	if group == "":
		return _err("bad_params", "Missing 'group'")
	if node.is_in_group(group):
		return _ok({"path": _path_of(root, node), "group": group, "added": false})
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s to group %s" % [node.name, group])
	ur.add_do_method(node, "add_to_group", group, true)
	ur.add_undo_method(node, "remove_from_group", group)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "group": group, "added": true})


func _node_remove_from_group(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var group := String(params.get("group", ""))
	if group == "":
		return _err("bad_params", "Missing 'group'")
	if not node.is_in_group(group):
		return _ok({"path": _path_of(root, node), "group": group, "removed": false})
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: remove %s from group %s" % [node.name, group])
	ur.add_do_method(node, "remove_from_group", group)
	ur.add_undo_method(node, "add_to_group", group, true)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "group": group, "removed": true})


# ------------------------------------- Group A: node depth (batch 2) ---------

func _node_instantiate_scene(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var scene_path := String(params.get("scene_path", ""))
	if scene_path == "" or not ResourceLoader.exists(scene_path):
		return _err("not_found", "Scene not found: %s" % scene_path)
	var res := ResourceLoader.load(scene_path)
	if res == null or not (res is PackedScene):
		return _err("bad_type", "Not a PackedScene: %s" % scene_path)
	var inst: Node = (res as PackedScene).instantiate(PackedScene.GEN_EDIT_STATE_INSTANCE)
	if inst == null:
		return _err("instantiate_failed", "Could not instantiate %s" % scene_path)
	if params.has("name"):
		inst.name = String(params.get("name"))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: instance scene %s" % scene_path)
	ur.add_do_method(parent, "add_child", inst)
	ur.add_do_method(inst, "set_owner", root)
	ur.add_do_reference(inst)
	ur.add_undo_method(parent, "remove_child", inst)
	ur.commit_action()
	return _ok({"path": _path_of(root, inst), "name": String(inst.name), "type": inst.get_class(), "scene": scene_path})


func _node_move_child(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if node == root:
		return _err("refused", "Cannot move the scene root")
	var parent := node.get_parent()
	var count := parent.get_child_count()
	var to_index := int(params.get("to_index", node.get_index()))
	if to_index < 0:
		to_index = count + to_index
	if to_index < 0 or to_index >= count:
		return _err("bad_index", "to_index out of range 0..%d" % (count - 1))
	var old_index := node.get_index()
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: move %s to %d" % [node.name, to_index])
	ur.add_do_method(parent, "move_child", node, to_index)
	ur.add_undo_method(parent, "move_child", node, old_index)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "index": node.get_index()})


func _node_change_type(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if node == root:
		return _err("refused", "Cannot change the type of the scene root")
	var type := String(params.get("type", ""))
	if not ClassDB.can_instantiate(type):
		return _err("bad_type", "Cannot instantiate class: %s" % type)
	var old_type := node.get_class()
	var replacement: Node = ClassDB.instantiate(type)
	replacement.name = node.name
	var new_props := {}
	for np in replacement.get_property_list():
		new_props[String(np.get("name", ""))] = true
	for op in node.get_property_list():
		var pname := String(op.get("name", ""))
		if pname == "" or pname == "name" or pname == "owner" or pname == "script":
			continue
		if (int(op.get("usage", 0)) & PROPERTY_USAGE_STORAGE) == 0:
			continue
		if not new_props.has(pname):
			continue
		replacement.set(pname, node.get(pname))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: change type %s -> %s" % [node.name, type])
	ur.add_do_method(node, "replace_by", replacement, true)
	ur.add_do_method(replacement, "set_owner", root)
	ur.add_do_reference(replacement)
	ur.add_undo_method(replacement, "replace_by", node, true)
	ur.add_undo_method(node, "set_owner", root)
	ur.add_undo_reference(node)
	ur.commit_action()
	return _ok({"path": _path_of(root, replacement), "name": String(replacement.name), "type": replacement.get_class(), "old_type": old_type})


func _node_set_owner(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if node == root:
		return _err("refused", "The scene root cannot have an owner")
	var owner_node: Node = root
	if params.has("owner_path") and String(params.get("owner_path", "")) != "":
		owner_node = _resolve(root, String(params.get("owner_path")))
		if owner_node == null:
			return _err("bad_path", "Owner not found: %s" % params.get("owner_path", ""))
	var old_owner := node.owner
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set owner of %s" % node.name)
	ur.add_do_method(node, "set_owner", owner_node)
	ur.add_undo_method(node, "set_owner", old_owner)
	ur.commit_action()
	var owner_out: Variant = (_path_of(root, node.owner) if node.owner else null)
	return _ok({"path": _path_of(root, node), "owner": owner_out})


func _node_call_method(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var method := String(params.get("method", ""))
	if method == "":
		return _err("bad_params", "Missing 'method'")
	if not node.has_method(method):
		return _err("no_method", "%s has no method %s" % [node.get_class(), method])
	var call_args: Array = []
	for a in params.get("args", []):
		call_args.append(Codec.decode(a))
	var result: Variant = node.callv(method, call_args)
	return _ok({"path": _path_of(root, node), "method": method, "result": Codec.encode(result)})


func _node_get_path(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var parent := node.get_parent()
	var parent_out: Variant = null
	if node != root and parent != null:
		parent_out = _path_of(root, parent)
	return _ok({
		"path": _path_of(root, node),
		"name": String(node.name),
		"type": node.get_class(),
		"index": node.get_index(),
		"parent": parent_out,
		"child_count": node.get_child_count(),
	})


func _node_list_properties(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var props: Array = []
	for p in node.get_property_list():
		var usage := int(p.get("usage", 0))
		if (usage & PROPERTY_USAGE_EDITOR) == 0:
			continue
		var ptype := int(p.get("type", 0))
		if ptype == TYPE_NIL:
			continue
		props.append({
			"name": String(p.get("name", "")),
			"type": ptype,
			"class_name": String(p.get("class_name", "")),
			"usage": usage,
		})
	return _ok({"path": _path_of(root, node), "properties": props})


# ---------------------------------------------- Group A: scene depth ---------

func _scene_list_open() -> Dictionary:
	var scenes: Array = []
	for p in EditorInterface.get_open_scenes():
		scenes.append(String(p))
	var unsaved: Array = []
	for p in EditorInterface.get_unsaved_scenes():
		unsaved.append(String(p))
	var root := _edited_root()
	var current: Variant = null
	if root and root.scene_file_path != "":
		current = root.scene_file_path
	return {"scenes": scenes, "current": current, "unsaved": unsaved}


func _scene_reload(params: Dictionary) -> Dictionary:
	var target := String(params.get("path", ""))
	if target == "":
		var root := _edited_root()
		if root == null:
			return _err("no_scene", "No scene is open")
		target = root.scene_file_path
	if target == "":
		return _err("bad_params", "Current scene has no saved path yet")
	if not ResourceLoader.exists(target):
		return _err("not_found", "Scene not found: %s" % target)
	EditorInterface.reload_scene_from_path(target)
	return _ok({"reloaded": target})


func _scene_close(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var current := root.scene_file_path
	var target := String(params.get("path", ""))
	if target != "" and target != current:
		return _err("not_current", "Only the current scene (%s) can be closed; open %s first" % [current, target])
	EditorInterface.close_scene()
	return _ok({"closed": current})


func _scene_get_dependencies(params: Dictionary) -> Dictionary:
	var target := String(params.get("path", ""))
	if target == "":
		var root := _edited_root()
		if root == null:
			return _err("no_scene", "No scene is open")
		target = root.scene_file_path
	if target == "":
		return _err("bad_params", "Current scene has no saved path yet")
	if not ResourceLoader.exists(target):
		return _err("not_found", "Scene not found: %s" % target)
	var deps: Array = []
	for d in ResourceLoader.get_dependencies(target):
		deps.append(String(d))
	return _ok({"path": target, "dependencies": deps})


func _scene_pack(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var branch := _resolve(root, String(params.get("path", "")))
	if branch == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var to_path := String(params.get("to_path", ""))
	if to_path == "" or not to_path.begins_with("res://"):
		return _err("bad_params", "'to_path' must be a res:// path")
	var dup: Node = branch.duplicate()
	if dup == null:
		return _err("duplicate_failed", "Could not duplicate branch")
	for d in _descendants(dup):
		d.owner = dup
	var packed := PackedScene.new()
	var e := packed.pack(dup)
	if e != OK:
		dup.free()
		return _err("pack_failed", "PackedScene.pack() returned %d" % e)
	e = ResourceSaver.save(packed, to_path)
	dup.free()
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"packed": to_path, "branch": _path_of(root, branch)})


func _scene_save_as(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var to_path := String(params.get("path", ""))
	if to_path == "" or not to_path.begins_with("res://"):
		return _err("bad_params", "'path' must be a res:// path")
	EditorInterface.save_scene_as(to_path)
	return _ok({"saved_as": to_path})


# ---------------------------------------------------- Group A: signals -------

func _signal_list(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var sigs: Array = []
	for s in node.get_signal_list():
		var arg_names: Array = []
		for a in s.get("args", []):
			arg_names.append(String(a.get("name", "")))
		sigs.append({"name": String(s.get("name", "")), "args": arg_names})
	return _ok({"path": _path_of(root, node), "signals": sigs})


func _signal_list_connections(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var only := String(params.get("signal", ""))
	var conns: Array = []
	for s in node.get_signal_list():
		var sname := String(s.get("name", ""))
		if only != "" and sname != only:
			continue
		for c in node.get_signal_connection_list(sname):
			var cb: Callable = c.get("callable")
			var target: Object = cb.get_object()
			var tpath: Variant = null
			if target is Node:
				var tnode := target as Node
				if tnode == root or root.is_ancestor_of(tnode):
					tpath = _path_of(root, tnode)
				else:
					tpath = String(tnode.name)
			conns.append({
				"signal": sname,
				"target": tpath,
				"method": String(cb.get_method()),
				"flags": int(c.get("flags", 0)),
			})
	return _ok({"path": _path_of(root, node), "connections": conns})


func _signal_connect(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var sig := String(params.get("signal", ""))
	if sig == "" or not node.has_signal(sig):
		return _err("no_signal", "%s has no signal %s" % [node.get_class(), sig])
	var target := _resolve(root, String(params.get("target_path", "")))
	if target == null:
		return _err("bad_path", "Target not found: %s" % params.get("target_path", ""))
	var method := String(params.get("method", ""))
	if method == "":
		return _err("bad_params", "Missing 'method'")
	if not target.has_method(method):
		return _err("no_method", "%s has no method %s" % [target.get_class(), method])
	var flags := int(params.get("flags", 2))
	var cb := Callable(target, method)
	if node.is_connected(sig, cb):
		return _ok({"signal": sig, "source": _path_of(root, node), "target": _path_of(root, target), "method": method, "flags": flags, "connected": false})
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: connect %s.%s -> %s.%s" % [node.name, sig, target.name, method])
	ur.add_do_method(node, "connect", sig, cb, flags)
	ur.add_undo_method(node, "disconnect", sig, cb)
	ur.commit_action()
	return _ok({"signal": sig, "source": _path_of(root, node), "target": _path_of(root, target), "method": method, "flags": flags, "connected": true})


func _signal_disconnect(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var sig := String(params.get("signal", ""))
	if sig == "" or not node.has_signal(sig):
		return _err("no_signal", "%s has no signal %s" % [node.get_class(), sig])
	var target := _resolve(root, String(params.get("target_path", "")))
	if target == null:
		return _err("bad_path", "Target not found: %s" % params.get("target_path", ""))
	var method := String(params.get("method", ""))
	var cb := Callable(target, method)
	if not node.is_connected(sig, cb):
		return _ok({"signal": sig, "source": _path_of(root, node), "target": _path_of(root, target), "method": method, "disconnected": false})
	var flags := 2
	for c in node.get_signal_connection_list(sig):
		var ecb: Callable = c.get("callable")
		if ecb == cb:
			flags = int(c.get("flags", 2))
			break
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: disconnect %s.%s -> %s.%s" % [node.name, sig, target.name, method])
	ur.add_do_method(node, "disconnect", sig, cb)
	ur.add_undo_method(node, "connect", sig, cb, flags)
	ur.commit_action()
	return _ok({"signal": sig, "source": _path_of(root, node), "target": _path_of(root, target), "method": method, "disconnected": true})


func _signal_add_user_signal(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var sig := String(params.get("signal", ""))
	if sig == "":
		return _err("bad_params", "Missing 'signal'")
	if node.has_signal(sig) or node.has_user_signal(sig):
		return _err("exists", "Signal already exists: %s" % sig)
	var arguments: Array = []
	for a in params.get("args", []):
		if typeof(a) == TYPE_DICTIONARY:
			arguments.append({"name": String(a.get("name", "arg")), "type": int(a.get("type", TYPE_NIL))})
		else:
			arguments.append({"name": String(a), "type": TYPE_NIL})
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add user signal %s.%s" % [node.name, sig])
	ur.add_do_method(node, "add_user_signal", sig, arguments)
	ur.add_undo_method(node, "remove_user_signal", sig)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "signal": sig, "added": true})


func _signal_emit(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var sig := String(params.get("signal", ""))
	if sig == "" or (not node.has_signal(sig) and not node.has_user_signal(sig)):
		return _err("no_signal", "%s has no signal %s" % [node.get_class(), sig])
	var call_args: Array = [sig]
	for a in params.get("args", []):
		call_args.append(Codec.decode(a))
	node.callv("emit_signal", call_args)
	return _ok({"path": _path_of(root, node), "signal": sig, "emitted": true})


# ------------------------------------------------- Group B: resources --------

func _resource_class_ok(cls: String) -> bool:
	return ClassDB.class_exists(cls) and ClassDB.is_parent_class(cls, "Resource") and ClassDB.can_instantiate(cls)


func _resource_props(res: Resource) -> Array:
	var props: Array = []
	for p in res.get_property_list():
		var usage := int(p.get("usage", 0))
		if (usage & PROPERTY_USAGE_EDITOR) == 0:
			continue
		var ptype := int(p.get("type", 0))
		if ptype == TYPE_NIL:
			continue
		props.append({
			"name": String(p.get("name", "")),
			"type": ptype,
			"class_name": String(p.get("class_name", "")),
			"usage": usage,
		})
	return props


func _resource_create(params: Dictionary) -> Dictionary:
	var cls := String(params.get("class_name", ""))
	if cls == "":
		return _err("bad_params", "Missing 'class_name'")
	if not _resource_class_ok(cls):
		return _err("bad_class", "Not an instantiable Resource class: %s" % cls)
	var to_path := String(params.get("to_path", ""))
	if not to_path.begins_with("res://"):
		return _err("bad_params", "'to_path' must be a res:// path")
	var res: Resource = ClassDB.instantiate(cls)
	if res == null:
		return _err("create_failed", "Could not instantiate %s" % cls)
	for key in params.get("properties", {}):
		res.set(String(key), Codec.decode(params["properties"][key]))
	var e := ResourceSaver.save(res, to_path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"created": to_path, "type": cls})


func _resource_load(params: Dictionary) -> Dictionary:
	var path := String(params.get("path", ""))
	if not ResourceLoader.exists(path):
		return _err("not_found", "Resource not found: %s" % path)
	var res := ResourceLoader.load(path)
	if res == null:
		return _err("load_failed", "Could not load resource: %s" % path)
	return _ok({
		"path": path,
		"type": res.get_class(),
		"resource_name": String(res.resource_name),
		"properties": _resource_props(res),
	})


func _resource_save(params: Dictionary) -> Dictionary:
	var from_path := String(params.get("from_path", ""))
	if not ResourceLoader.exists(from_path):
		return _err("not_found", "Resource not found: %s" % from_path)
	var to_path := String(params.get("to_path", from_path))
	if to_path == "":
		to_path = from_path
	if not to_path.begins_with("res://"):
		return _err("bad_params", "'to_path' must be a res:// path")
	var res := ResourceLoader.load(from_path)
	if res == null:
		return _err("load_failed", "Could not load resource: %s" % from_path)
	var flags := int(params.get("flags", 0))
	var e := ResourceSaver.save(res, to_path, flags)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"saved": to_path, "from": from_path})


func _resource_duplicate(params: Dictionary) -> Dictionary:
	var from_path := String(params.get("path", ""))
	if not ResourceLoader.exists(from_path):
		return _err("not_found", "Resource not found: %s" % from_path)
	var to_path := String(params.get("to_path", ""))
	if not to_path.begins_with("res://"):
		return _err("bad_params", "'to_path' must be a res:// path")
	var res := ResourceLoader.load(from_path)
	if res == null:
		return _err("load_failed", "Could not load resource: %s" % from_path)
	var deep := bool(params.get("deep", false))
	var dup := res.duplicate(deep)
	if dup == null:
		return _err("duplicate_failed", "Could not duplicate resource")
	var e := ResourceSaver.save(dup, to_path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"duplicated": to_path, "from": from_path, "deep": deep})


func _resource_get_property(params: Dictionary) -> Dictionary:
	var path := String(params.get("path", ""))
	if not ResourceLoader.exists(path):
		return _err("not_found", "Resource not found: %s" % path)
	var res := ResourceLoader.load(path)
	if res == null:
		return _err("load_failed", "Could not load resource: %s" % path)
	var prop := String(params.get("property", ""))
	if prop == "":
		return _err("bad_params", "Missing 'property'")
	return _ok({"path": path, "property": prop, "value": Codec.encode(res.get(prop))})


func _resource_set_property(params: Dictionary) -> Dictionary:
	var path := String(params.get("path", ""))
	if not ResourceLoader.exists(path):
		return _err("not_found", "Resource not found: %s" % path)
	var res := ResourceLoader.load(path)
	if res == null:
		return _err("load_failed", "Could not load resource: %s" % path)
	var prop := String(params.get("property", ""))
	if prop == "":
		return _err("bad_params", "Missing 'property'")
	res.set(prop, Codec.decode(params.get("value")))
	var e := ResourceSaver.save(res, path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"path": path, "property": prop, "value": Codec.encode(res.get(prop))})


func _resource_get_import_settings(params: Dictionary) -> Dictionary:
	var path := String(params.get("path", ""))
	if path == "":
		return _err("bad_params", "Missing 'path'")
	var import_path := path + ".import"
	if not FileAccess.file_exists(import_path):
		return _ok({"path": path, "imported": false, "importer": "", "settings": {}})
	var cfg := ConfigFile.new()
	var e := cfg.load(import_path)
	if e != OK:
		return _err("load_failed", "Could not read import metadata: %s (%d)" % [import_path, e])
	var importer := ""
	if cfg.has_section_key("remap", "importer"):
		importer = String(cfg.get_value("remap", "importer"))
	var settings: Dictionary = {}
	if cfg.has_section("params"):
		for key in cfg.get_section_keys("params"):
			settings[key] = Codec.encode(cfg.get_value("params", key))
	return _ok({"path": path, "imported": true, "importer": importer, "settings": settings})


func _resource_set_import_settings(params: Dictionary) -> Dictionary:
	var path := String(params.get("path", ""))
	if path == "":
		return _err("bad_params", "Missing 'path'")
	var import_path := path + ".import"
	if not FileAccess.file_exists(import_path):
		return _err("not_imported", "No .import metadata for %s (not an imported asset)" % path)
	var cfg := ConfigFile.new()
	var e := cfg.load(import_path)
	if e != OK:
		return _err("load_failed", "Could not read import metadata: %s (%d)" % [import_path, e])
	var applied: Array = []
	for key in params.get("settings", {}):
		cfg.set_value("params", String(key), Codec.decode(params["settings"][key]))
		applied.append(String(key))
	e = cfg.save(import_path)
	if e != OK:
		return _err("save_failed", "Could not write import metadata (%d)" % e)
	var reimport := bool(params.get("reimport", true))
	if reimport:
		var efs := EditorInterface.get_resource_filesystem()
		efs.reimport_files(PackedStringArray([path]))
	return _ok({"path": path, "reimported": reimport, "settings": applied})
