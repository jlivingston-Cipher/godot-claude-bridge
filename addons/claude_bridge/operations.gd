@tool
extends RefCounted
## Request handlers for the Claude Bridge.
##
## Every handler returns a plain Dictionary that becomes the JSON-RPC `result`.
## Errors are raised via `_err(code, message)`. All edit-time mutations are
## wrapped in the EditorUndoRedoManager so a human can Ctrl-Z anything Claude did.

const Codec := preload("res://addons/claude_bridge/variant_json.gd")
const ADDON_VERSION := "0.13.0"

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
		"edit.undo":
			return _edit_undo(params)
		"edit.redo":
			return _edit_redo(params)
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
		"filesystem.list":
			return _filesystem_list(params)
		"filesystem.scan":
			return _filesystem_scan(params)
		"filesystem.move":
			return _filesystem_move(params)
		"filesystem.create_dir":
			return _filesystem_create_dir(params)
		"anim.player_create":
			return _anim_player_create(params)
		"anim.create":
			return _anim_create(params)
		"anim.delete":
			return _anim_delete(params)
		"anim.add_track":
			return _anim_add_track(params)
		"anim.insert_key":
			return _anim_insert_key(params)
		"anim.remove_key":
			return _anim_remove_key(params)
		"anim.set_length":
			return _anim_set_length(params)
		"anim.set_loop":
			return _anim_set_loop(params)
		"anim.get_track_keys":
			return _anim_get_track_keys(params)
		"anim.list":
			return _anim_list(params)
		"anim.tree_create":
			return _anim_tree_create(params)
		"anim.tree_add_node":
			return _anim_tree_add_node(params)
		"anim.statemachine_add_state":
			return _anim_statemachine_add_state(params)
		"anim.statemachine_add_transition":
			return _anim_statemachine_add_transition(params)
		"tileset.create":
			return _tileset_create(params)
		"tileset.add_source":
			return _tileset_add_source(params)
		"tileset.add_tile":
			return _tileset_add_tile(params)
		"tileset.set_tile_collision":
			return _tileset_set_tile_collision(params)
		"tilemaplayer.create":
			return _tilemaplayer_create(params)
		"tilemap.set_cell":
			return _tilemap_set_cell(params)
		"tilemap.set_cells_rect":
			return _tilemap_set_cells_rect(params)
		"tilemap.get_cell":
			return _tilemap_get_cell(params)
		"tilemap.clear":
			return _tilemap_clear(params)
		"body.create":
			return _body_create(params)
		"collisionshape.add":
			return _collisionshape_add(params)
		"body.set_collision_layer":
			return _body_set_collision_layer(params)
		"body.set_collision_mask":
			return _body_set_collision_mask(params)
		"area.set_monitoring":
			return _area_set_monitoring(params)
		"area.set_gravity":
			return _area_set_gravity(params)
		"joint.create":
			return _joint_create(params)
		"joint.set_bodies":
			return _joint_set_bodies(params)
		"collisionpolygon.add":
			return _collisionpolygon_add(params)
		"rigidbody.set_properties":
			return _rigidbody_set_properties(params)
		"body.set_physics_material":
			return _body_set_physics_material(params)
		"physics.set_gravity":
			return _physics_set_gravity(params)
		"particles.create":
			return _particles_create(params)
		"particles.set_process_material":
			return _particles_set_process_material(params)
		"particles.set_amount":
			return _particles_set_amount(params)
		"particles.set_lifetime":
			return _particles_set_lifetime(params)
		"particles.set_emitting":
			return _particles_set_emitting(params)
		"particles.set_texture":
			return _particles_set_texture(params)
		"shader.create":
			return _shader_create(params)
		"shader.set_code":
			return _shader_set_code(params)
		"shadermaterial.create":
			return _shadermaterial_create(params)
		"shadermaterial.set_shader":
			return _shadermaterial_set_shader(params)
		"shadermaterial.set_param":
			return _shadermaterial_set_param(params)
		"audio.player_create":
			return _audio_player_create(params)
		"audio.set_stream":
			return _audio_set_stream(params)
		"audio.bus_add":
			return _audio_bus_add(params)
		"audio.bus_add_effect":
			return _audio_bus_add_effect(params)
		"audio.bus_set_volume":
			return _audio_bus_set_volume(params)
		"audio.set_bus_layout":
			return _audio_set_bus_layout(params)
		"control.create":
			return _control_create(params)
		"container.add_child":
			return _container_add_child(params)
		"control.set_anchors":
			return _control_set_anchors(params)
		"control.set_layout_preset":
			return _control_set_layout_preset(params)
		"control.set_size_flags":
			return _control_set_size_flags(params)
		"control.set_theme":
			return _control_set_theme(params)
		"theme.create":
			return _theme_create(params)
		"theme.set_color":
			return _theme_set_color(params)
		"theme.set_font":
			return _theme_set_font(params)
		"theme.set_stylebox":
			return _theme_set_stylebox(params)
		"theme.set_constant":
			return _theme_set_constant(params)
		"meshinstance.create":
			return _meshinstance_create(params)
		"mesh.set_surface_material":
			return _mesh_set_surface_material(params)
		"primitive_mesh.create":
			return _primitive_mesh_create(params)
		"light.create":
			return _light_create(params)
		"camera.create":
			return _camera_create(params)
		"environment.create":
			return _environment_create(params)
		"environment.set_sky":
			return _environment_set_sky(params)
		"csg.create":
			return _csg_create(params)
		"navregion.create":
			return _navregion_create(params)
		"navagent.configure":
			return _navagent_configure(params)
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


func _edit_undo(params: Dictionary) -> Dictionary:
	return _edit_history_step(params, true)


func _edit_redo(params: Dictionary) -> Dictionary:
	return _edit_history_step(params, false)


## Drive the editor's undo/redo history. `is_undo` picks the direction.
## `scope` selects which history: "scene" (default) resolves the edited scene's
## history via EditorUndoRedoManager.get_object_history_id(root) — the same
## routing the node_* mutators commit into — while "global" targets the
## editor-wide GLOBAL_HISTORY. The concrete UndoRedo is fetched with
## get_history_undo_redo(id) and stepped directly; that is the only
## scripting-exposed route to a programmatic Ctrl-Z (validated on Godot 4.7).
func _edit_history_step(params: Dictionary, is_undo: bool) -> Dictionary:
	var ur := _plugin.get_undo_redo()
	var scope := String(params.get("scope", "scene"))
	var hid := _history_id_for_scope(ur, scope)
	if hid == EditorUndoRedoManager.INVALID_HISTORY:
		return _err("no_history", "No undo/redo history for scope '%s'" % scope)
	var hist := ur.get_history_undo_redo(hid)
	if hist == null:
		return _err("no_history", "No UndoRedo for history %d (scope '%s')" % [hid, scope])
	var performed := false
	var action_name := ""
	if is_undo:
		if hist.has_undo():
			action_name = hist.get_current_action_name()
			performed = hist.undo()
	else:
		if hist.has_redo():
			performed = hist.redo()
			action_name = hist.get_current_action_name()
	return _ok({
		"performed": performed,
		"direction": ("undo" if is_undo else "redo"),
		"action": (action_name if performed else ""),
		"has_undo": hist.has_undo(),
		"has_redo": hist.has_redo(),
		"history_id": hid,
		"scope": scope,
	})


## Resolve the target undo-history id for a scope string.
func _history_id_for_scope(ur: EditorUndoRedoManager, scope: String) -> int:
	if scope == "global":
		return EditorUndoRedoManager.GLOBAL_HISTORY
	var root := _edited_root()
	if root != null:
		return ur.get_object_history_id(root)
	return EditorUndoRedoManager.GLOBAL_HISTORY


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
	# EditorInterface.get_unsaved_scenes() is Godot 4.4+; a literal call is resolved at PARSE
	# time and fails to compile the whole addon on 4.3. Guard with has_method + a dynamic
	# call() defers the lookup to runtime. On <4.4 the unsaved set can't be enumerated, so we
	# report that via unsaved_supported instead of implying "nothing is unsaved".
	var unsaved_supported := EditorInterface.has_method("get_unsaved_scenes")
	if unsaved_supported:
		for p in EditorInterface.call("get_unsaved_scenes"):
			unsaved.append(String(p))
	var root := _edited_root()
	var current: Variant = null
	if root and root.scene_file_path != "":
		current = root.scene_file_path
	return {"scenes": scenes, "current": current, "unsaved": unsaved, "unsaved_supported": unsaved_supported}


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
	# EditorInterface.close_scene() is Godot 4.4+; a literal call is resolved at PARSE time and
	# fails to compile the whole addon on 4.3. Guard with has_method + a dynamic call() defers
	# the lookup to runtime, so the addon still loads (this tool just reports unsupported).
	if not EditorInterface.has_method("close_scene"):
		return _err("unsupported", "scene_close requires Godot 4.4+ (EditorInterface.close_scene is unavailable on this Godot version)")
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var current := root.scene_file_path
	var target := String(params.get("path", ""))
	if target != "" and target != current:
		return _err("not_current", "Only the current scene (%s) can be closed; open %s first" % [current, target])
	EditorInterface.call("close_scene")
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


# ----------------------------------------------- Group B: filesystem --------

func _filesystem_list(params: Dictionary) -> Dictionary:
	var path := String(params.get("path", "res://"))
	if path == "":
		path = "res://"
	var dir := DirAccess.open(path)
	if dir == null:
		return _err("not_found", "Directory not found: %s" % path)
	var dirs: Array = []
	for d in dir.get_directories():
		dirs.append(String(d))
	var files: Array = []
	for f in dir.get_files():
		files.append(String(f))
	return _ok({"path": path, "dirs": dirs, "files": files})


func _filesystem_scan(_params: Dictionary) -> Dictionary:
	EditorInterface.get_resource_filesystem().scan()
	return _ok({"scanning": true})


func _filesystem_move(params: Dictionary) -> Dictionary:
	var from_path := String(params.get("from_path", ""))
	var to_path := String(params.get("to_path", ""))
	if not from_path.begins_with("res://") or not to_path.begins_with("res://"):
		return _err("bad_params", "'from_path' and 'to_path' must be res:// paths")
	var is_file := FileAccess.file_exists(from_path)
	var is_dir := DirAccess.dir_exists_absolute(from_path)
	if not is_file and not is_dir:
		return _err("not_found", "Source not found: %s" % from_path)
	if FileAccess.file_exists(to_path) or DirAccess.dir_exists_absolute(to_path):
		return _err("exists", "Destination already exists: %s" % to_path)
	var dir := DirAccess.open("res://")
	if dir == null:
		return _err("fs_error", "Could not open res://")
	var e := dir.rename(from_path, to_path)
	if e != OK:
		return _err("move_failed", "rename() returned %d" % e)
	var moved_import := false
	if is_file and FileAccess.file_exists(from_path + ".import"):
		dir.rename(from_path + ".import", to_path + ".import")
		moved_import = true
	EditorInterface.get_resource_filesystem().scan()
	return _ok({"moved": to_path, "from": from_path, "moved_import": moved_import})


func _filesystem_create_dir(params: Dictionary) -> Dictionary:
	var path := String(params.get("path", ""))
	if not path.begins_with("res://"):
		return _err("bad_params", "'path' must be a res:// path")
	if DirAccess.dir_exists_absolute(path):
		return _ok({"created": path, "existed": true})
	var e := DirAccess.make_dir_recursive_absolute(path)
	if e != OK:
		return _err("mkdir_failed", "make_dir_recursive_absolute() returned %d" % e)
	EditorInterface.get_resource_filesystem().scan()
	return _ok({"created": path, "existed": false})


# ------------------------------------------------------ Group C: Animation ----
## Authoring over an in-scene AnimationPlayer. Animations live in the player's
## AnimationLibrary resources; every mutation goes through EditorUndoRedoManager
## (undoable, like the node_* tools), so nothing is written to disk here.

func _as_anim_player(root: Node, path: String) -> AnimationPlayer:
	var n := _resolve(root, path)
	if n is AnimationPlayer:
		return n
	return null


func _anim_of(player: AnimationPlayer, lib_name: String, anim_name: String) -> Animation:
	if not player.has_animation_library(lib_name):
		return null
	var lib := player.get_animation_library(lib_name)
	if lib == null or not lib.has_animation(anim_name):
		return null
	return lib.get_animation(anim_name)


func _anim_track_type(s: String) -> int:
	var m := {
		"value": Animation.TYPE_VALUE,
		"position_3d": Animation.TYPE_POSITION_3D,
		"rotation_3d": Animation.TYPE_ROTATION_3D,
		"scale_3d": Animation.TYPE_SCALE_3D,
		"blend_shape": Animation.TYPE_BLEND_SHAPE,
		"method": Animation.TYPE_METHOD,
		"bezier": Animation.TYPE_BEZIER,
		"audio": Animation.TYPE_AUDIO,
		"animation": Animation.TYPE_ANIMATION,
	}
	return int(m.get(s, -1))


func _anim_track_type_name(t: int) -> String:
	var names := ["value", "position_3d", "rotation_3d", "scale_3d", "blend_shape", "method", "bezier", "audio", "animation"]
	if t >= 0 and t < names.size():
		return String(names[t])
	return "unknown"


func _anim_loop_mode(s: String) -> int:
	var m := {"none": Animation.LOOP_NONE, "linear": Animation.LOOP_LINEAR, "pingpong": Animation.LOOP_PINGPONG}
	return int(m.get(s, -1))


func _anim_loop_name(mode: int) -> String:
	var names := ["none", "linear", "pingpong"]
	if mode >= 0 and mode < names.size():
		return String(names[mode])
	return "unknown"


func _anim_player_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var node := AnimationPlayer.new()
	node.name = String(params.get("name", "AnimationPlayer"))
	node.add_animation_library("", AnimationLibrary.new())
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add AnimationPlayer %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": "AnimationPlayer"})


func _anim_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var player := _as_anim_player(root, String(params.get("player_path", "")))
	if player == null:
		return _err("bad_path", "AnimationPlayer not found: %s" % params.get("player_path", ""))
	var lib_name := String(params.get("library", ""))
	var anim_name := String(params.get("name", ""))
	if anim_name == "":
		return _err("bad_params", "Missing 'name'")
	if player.has_animation_library(lib_name) and player.get_animation_library(lib_name).has_animation(anim_name):
		return _err("exists", "Animation already exists: %s" % anim_name)
	var anim := Animation.new()
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: create animation %s" % anim_name)
	var lib: AnimationLibrary
	if player.has_animation_library(lib_name):
		lib = player.get_animation_library(lib_name)
	else:
		lib = AnimationLibrary.new()
		ur.add_do_method(player, "add_animation_library", lib_name, lib)
		ur.add_do_reference(lib)
		ur.add_undo_method(player, "remove_animation_library", lib_name)
	ur.add_do_method(lib, "add_animation", anim_name, anim)
	ur.add_do_reference(anim)
	ur.add_undo_method(lib, "remove_animation", anim_name)
	ur.commit_action()
	return _ok({"player": _path_of(root, player), "library": lib_name, "name": anim_name})


func _anim_delete(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var player := _as_anim_player(root, String(params.get("player_path", "")))
	if player == null:
		return _err("bad_path", "AnimationPlayer not found: %s" % params.get("player_path", ""))
	var lib_name := String(params.get("library", ""))
	var anim_name := String(params.get("name", ""))
	var anim := _anim_of(player, lib_name, anim_name)
	if anim == null:
		return _err("not_found", "Animation not found: %s" % anim_name)
	var lib := player.get_animation_library(lib_name)
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: delete animation %s" % anim_name)
	ur.add_do_method(lib, "remove_animation", anim_name)
	ur.add_undo_method(lib, "add_animation", anim_name, anim)
	ur.add_undo_reference(anim)
	ur.commit_action()
	return _ok({"player": _path_of(root, player), "library": lib_name, "deleted": anim_name})


func _anim_add_track(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var player := _as_anim_player(root, String(params.get("player_path", "")))
	if player == null:
		return _err("bad_path", "AnimationPlayer not found: %s" % params.get("player_path", ""))
	var anim := _anim_of(player, String(params.get("library", "")), String(params.get("name", "")))
	if anim == null:
		return _err("not_found", "Animation not found: %s" % params.get("name", ""))
	var ttype := _anim_track_type(String(params.get("type", "value")))
	if ttype < 0:
		return _err("bad_params", "Unknown track type: %s" % params.get("type", ""))
	var track_path := String(params.get("path", ""))
	if track_path == "":
		return _err("bad_params", "Missing track 'path' (node or node:property the track drives)")
	var idx := anim.get_track_count()
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s track" % _anim_track_type_name(ttype))
	ur.add_do_method(anim, "add_track", ttype, -1)
	ur.add_do_method(anim, "track_set_path", idx, NodePath(track_path))
	ur.add_undo_method(anim, "remove_track", idx)
	ur.commit_action()
	return _ok({"track": idx, "type": _anim_track_type_name(ttype), "path": track_path})


func _anim_insert_key(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var player := _as_anim_player(root, String(params.get("player_path", "")))
	if player == null:
		return _err("bad_path", "AnimationPlayer not found: %s" % params.get("player_path", ""))
	var anim := _anim_of(player, String(params.get("library", "")), String(params.get("name", "")))
	if anim == null:
		return _err("not_found", "Animation not found: %s" % params.get("name", ""))
	var track := int(params.get("track", -1))
	if track < 0 or track >= anim.get_track_count():
		return _err("bad_track", "Track index out of range: %d" % track)
	if not params.has("value"):
		return _err("bad_params", "Missing 'value'")
	var time := float(params.get("time", 0.0))
	var value: Variant = Codec.decode(params.get("value"))
	var transition := float(params.get("transition", 1.0))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: insert key @ %s" % time)
	ur.add_do_method(anim, "track_insert_key", track, time, value, transition)
	ur.add_undo_method(anim, "track_remove_key_at_time", track, time)
	ur.commit_action()
	return _ok({"track": track, "time": time, "key_count": anim.track_get_key_count(track)})


func _anim_remove_key(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var player := _as_anim_player(root, String(params.get("player_path", "")))
	if player == null:
		return _err("bad_path", "AnimationPlayer not found: %s" % params.get("player_path", ""))
	var anim := _anim_of(player, String(params.get("library", "")), String(params.get("name", "")))
	if anim == null:
		return _err("not_found", "Animation not found: %s" % params.get("name", ""))
	var track := int(params.get("track", -1))
	if track < 0 or track >= anim.get_track_count():
		return _err("bad_track", "Track index out of range: %d" % track)
	var key := int(params.get("key", -1))
	if key < 0 or key >= anim.track_get_key_count(track):
		return _err("bad_key", "Key index out of range: %d" % key)
	var time := anim.track_get_key_time(track, key)
	var value: Variant = anim.track_get_key_value(track, key)
	var transition := anim.track_get_key_transition(track, key)
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: remove key %d" % key)
	ur.add_do_method(anim, "track_remove_key", track, key)
	ur.add_undo_method(anim, "track_insert_key", track, time, value, transition)
	ur.commit_action()
	return _ok({"track": track, "removed_key": key, "time": time})


func _anim_set_length(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var player := _as_anim_player(root, String(params.get("player_path", "")))
	if player == null:
		return _err("bad_path", "AnimationPlayer not found: %s" % params.get("player_path", ""))
	var anim := _anim_of(player, String(params.get("library", "")), String(params.get("name", "")))
	if anim == null:
		return _err("not_found", "Animation not found: %s" % params.get("name", ""))
	var length := float(params.get("length", -1.0))
	if length <= 0.0:
		return _err("bad_params", "'length' must be greater than 0")
	var old := anim.length
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set animation length")
	ur.add_do_property(anim, "length", length)
	ur.add_undo_property(anim, "length", old)
	ur.commit_action()
	return _ok({"length": length, "previous": old})


func _anim_set_loop(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var player := _as_anim_player(root, String(params.get("player_path", "")))
	if player == null:
		return _err("bad_path", "AnimationPlayer not found: %s" % params.get("player_path", ""))
	var anim := _anim_of(player, String(params.get("library", "")), String(params.get("name", "")))
	if anim == null:
		return _err("not_found", "Animation not found: %s" % params.get("name", ""))
	var mode := _anim_loop_mode(String(params.get("mode", "")))
	if mode < 0:
		return _err("bad_params", "'mode' must be one of: none, linear, pingpong")
	var old := anim.loop_mode
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set animation loop mode")
	ur.add_do_property(anim, "loop_mode", mode)
	ur.add_undo_property(anim, "loop_mode", old)
	ur.commit_action()
	return _ok({"mode": _anim_loop_name(mode), "previous": _anim_loop_name(old)})


func _anim_get_track_keys(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var player := _as_anim_player(root, String(params.get("player_path", "")))
	if player == null:
		return _err("bad_path", "AnimationPlayer not found: %s" % params.get("player_path", ""))
	var anim := _anim_of(player, String(params.get("library", "")), String(params.get("name", "")))
	if anim == null:
		return _err("not_found", "Animation not found: %s" % params.get("name", ""))
	var track := int(params.get("track", -1))
	if track < 0 or track >= anim.get_track_count():
		return _err("bad_track", "Track index out of range: %d" % track)
	var keys: Array = []
	for i in anim.track_get_key_count(track):
		keys.append({
			"index": i,
			"time": anim.track_get_key_time(track, i),
			"value": Codec.encode(anim.track_get_key_value(track, i)),
			"transition": anim.track_get_key_transition(track, i),
		})
	return _ok({"track": track, "type": _anim_track_type_name(anim.track_get_type(track)), "path": String(anim.track_get_path(track)), "keys": keys})


func _anim_list(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var player := _as_anim_player(root, String(params.get("player_path", "")))
	if player == null:
		return _err("bad_path", "AnimationPlayer not found: %s" % params.get("player_path", ""))
	var out: Array = []
	for lib_name in player.get_animation_library_list():
		var lib := player.get_animation_library(lib_name)
		if lib == null:
			continue
		for a in lib.get_animation_list():
			var anim := lib.get_animation(a)
			var full := String(a)
			if String(lib_name) != "":
				full = String(lib_name) + "/" + String(a)
			out.append({
				"name": full,
				"library": String(lib_name),
				"animation": String(a),
				"length": anim.length,
				"loop_mode": _anim_loop_name(anim.loop_mode),
				"track_count": anim.get_track_count(),
			})
	return _ok({"player": _path_of(root, player), "animations": out})


## AnimationTree authoring (Group C batch 2): create an AnimationTree node and edit
## its tree_root graph (AnimationNodeBlendTree) or state machine (AnimationNodeStateMachine).
## Undoable via EditorUndoRedoManager, ungated (in-scene, like node_* / batch-1 anim_*).

func _as_anim_tree(root: Node, path: String) -> AnimationTree:
	var n := _resolve(root, path)
	if n is AnimationTree:
		return n
	return null


func _anim_root_type_class(s: String) -> String:
	match s:
		"blend_tree":
			return "AnimationNodeBlendTree"
		"state_machine":
			return "AnimationNodeStateMachine"
		_:
			return ""


func _to_vec2(v) -> Vector2:
	if v is Array and v.size() >= 2:
		return Vector2(float(v[0]), float(v[1]))
	return Vector2.ZERO


func _sm_switch_mode(s: String) -> int:
	var m := {"immediate": 0, "sync": 1, "at_end": 2}
	return int(m.get(s, -1))


func _sm_switch_name(mode: int) -> String:
	var names := ["immediate", "sync", "at_end"]
	if mode >= 0 and mode < names.size():
		return String(names[mode])
	return "unknown"


func _sm_advance_mode(s: String) -> int:
	var m := {"disabled": 0, "enabled": 1, "auto": 2}
	return int(m.get(s, -1))


func _sm_advance_name(mode: int) -> String:
	var names := ["disabled", "enabled", "auto"]
	if mode >= 0 and mode < names.size():
		return String(names[mode])
	return "unknown"


## Resolve the target AnimationNodeStateMachine: tree_root itself when sm_name is
## empty, or a nested state-machine node inside the tree_root graph.
func _resolve_state_machine(tree: AnimationTree, sm_name: String):
	var rootnode = tree.get("tree_root")
	if rootnode == null:
		return null
	if sm_name == "":
		if rootnode is AnimationNodeStateMachine:
			return rootnode
		return null
	if not rootnode.has_method("has_node") or not rootnode.has_node(sm_name):
		return null
	var sub = rootnode.get_node(sm_name)
	if sub is AnimationNodeStateMachine:
		return sub
	return null


func _anim_tree_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var rt := String(params.get("root_type", "blend_tree"))
	var rt_class := _anim_root_type_class(rt)
	if rt_class == "":
		return _err("bad_params", "'root_type' must be one of: blend_tree, state_machine")
	var node := AnimationTree.new()
	node.name = String(params.get("name", "AnimationTree"))
	node.set("tree_root", ClassDB.instantiate(rt_class))
	var anim_player_path := String(params.get("anim_player_path", ""))
	if anim_player_path != "":
		node.set("anim_player", NodePath(anim_player_path))
	node.set("active", bool(params.get("active", false)))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add AnimationTree %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": "AnimationTree", "root_type": rt, "anim_player": anim_player_path, "active": bool(node.get("active"))})


func _anim_tree_add_node(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var tree := _as_anim_tree(root, String(params.get("tree_path", "")))
	if tree == null:
		return _err("bad_path", "AnimationTree not found: %s" % params.get("tree_path", ""))
	var rootnode = tree.get("tree_root")
	if rootnode == null or not rootnode.has_method("add_node"):
		return _err("bad_root", "tree_root does not accept nodes (need AnimationNodeBlendTree or AnimationNodeStateMachine)")
	var node_name := String(params.get("node_name", ""))
	if node_name == "":
		return _err("bad_params", "Missing 'node_name'")
	if rootnode.has_node(node_name):
		return _err("exists", "Node already exists in the graph: %s" % node_name)
	var node_type := String(params.get("node_type", ""))
	if node_type == "" or not ClassDB.can_instantiate(node_type) or not ClassDB.is_parent_class(node_type, "AnimationNode"):
		return _err("bad_type", "'node_type' must be an instantiable AnimationNode subclass: %s" % node_type)
	var sub = ClassDB.instantiate(node_type)
	if params.has("animation") and sub is AnimationNodeAnimation:
		sub.set("animation", StringName(String(params.get("animation"))))
	var pos := _to_vec2(params.get("position", null))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add anim node %s" % node_name)
	ur.add_do_method(rootnode, "add_node", node_name, sub, pos)
	ur.add_do_reference(sub)
	ur.add_undo_method(rootnode, "remove_node", node_name)
	ur.commit_action()
	return _ok({"tree": _path_of(root, tree), "node_name": node_name, "node_type": node_type, "position": [pos.x, pos.y]})


func _anim_statemachine_add_state(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var tree := _as_anim_tree(root, String(params.get("tree_path", "")))
	if tree == null:
		return _err("bad_path", "AnimationTree not found: %s" % params.get("tree_path", ""))
	var sm_name := String(params.get("state_machine", ""))
	var sm = _resolve_state_machine(tree, sm_name)
	if sm == null:
		return _err("bad_root", "No AnimationNodeStateMachine at %s" % ("tree_root" if sm_name == "" else sm_name))
	var state_name := String(params.get("state_name", ""))
	if state_name == "":
		return _err("bad_params", "Missing 'state_name'")
	if sm.has_node(state_name):
		return _err("exists", "State already exists: %s" % state_name)
	var node_type := String(params.get("node_type", "AnimationNodeAnimation"))
	if not ClassDB.can_instantiate(node_type) or not ClassDB.is_parent_class(node_type, "AnimationNode"):
		return _err("bad_type", "'node_type' must be an instantiable AnimationNode subclass: %s" % node_type)
	var state = ClassDB.instantiate(node_type)
	var anim_name := String(params.get("animation", ""))
	if anim_name != "" and state is AnimationNodeAnimation:
		state.set("animation", StringName(anim_name))
	var pos := _to_vec2(params.get("position", null))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add state %s" % state_name)
	ur.add_do_method(sm, "add_node", state_name, state, pos)
	ur.add_do_reference(state)
	ur.add_undo_method(sm, "remove_node", state_name)
	ur.commit_action()
	return _ok({"tree": _path_of(root, tree), "state_machine": sm_name, "state_name": state_name, "node_type": node_type, "animation": anim_name, "position": [pos.x, pos.y]})


func _anim_statemachine_add_transition(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var tree := _as_anim_tree(root, String(params.get("tree_path", "")))
	if tree == null:
		return _err("bad_path", "AnimationTree not found: %s" % params.get("tree_path", ""))
	var sm_name := String(params.get("state_machine", ""))
	var sm = _resolve_state_machine(tree, sm_name)
	if sm == null:
		return _err("bad_root", "No AnimationNodeStateMachine at %s" % ("tree_root" if sm_name == "" else sm_name))
	var from_state := String(params.get("from_state", ""))
	var to_state := String(params.get("to_state", ""))
	if from_state == "" or to_state == "":
		return _err("bad_params", "Missing 'from_state' or 'to_state'")
	if from_state != "Start" and from_state != "End" and not sm.has_node(from_state):
		return _err("not_found", "from_state not in state machine: %s" % from_state)
	if to_state != "Start" and to_state != "End" and not sm.has_node(to_state):
		return _err("not_found", "to_state not in state machine: %s" % to_state)
	if sm.has_transition(from_state, to_state):
		return _err("exists", "Transition already exists: %s -> %s" % [from_state, to_state])
	var switch_s := String(params.get("switch_mode", "immediate"))
	var switch_mode := _sm_switch_mode(switch_s)
	if switch_mode < 0:
		return _err("bad_params", "'switch_mode' must be one of: immediate, sync, at_end")
	var advance_s := String(params.get("advance_mode", "enabled"))
	var advance_mode := _sm_advance_mode(advance_s)
	if advance_mode < 0:
		return _err("bad_params", "'advance_mode' must be one of: disabled, enabled, auto")
	var tr := AnimationNodeStateMachineTransition.new()
	tr.set("xfade_time", float(params.get("xfade_time", 0.0)))
	tr.set("switch_mode", switch_mode)
	tr.set("advance_mode", advance_mode)
	if String(params.get("advance_condition", "")) != "":
		tr.set("advance_condition", StringName(String(params.get("advance_condition"))))
	if params.has("priority"):
		tr.set("priority", int(params.get("priority")))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add transition %s -> %s" % [from_state, to_state])
	ur.add_do_method(sm, "add_transition", from_state, to_state, tr)
	ur.add_do_reference(tr)
	ur.add_undo_method(sm, "remove_transition", from_state, to_state)
	ur.commit_action()
	return _ok({"tree": _path_of(root, tree), "state_machine": sm_name, "from_state": from_state, "to_state": to_state, "xfade_time": float(tr.get("xfade_time")), "switch_mode": _sm_switch_name(int(tr.get("switch_mode"))), "advance_mode": _sm_advance_name(int(tr.get("advance_mode"))), "transition_count": sm.get_transition_count()})
# --------------------------------------------------------- Group D: tileset --
# Disk-backed TileSet authoring: load a .tres TileSet, mutate it, re-save.
# All four are file-writing → gated on the host side.

func _to_vec2i(v) -> Vector2i:
	if v is Array and v.size() >= 2:
		return Vector2i(int(v[0]), int(v[1]))
	return Vector2i.ZERO


func _to_packed_vec2(v) -> PackedVector2Array:
	var out := PackedVector2Array()
	if v is Array:
		for p in v:
			if p is Array and p.size() >= 2:
				out.append(Vector2(float(p[0]), float(p[1])))
	return out


func _load_tileset(path: String):
	if not ResourceLoader.exists(path):
		return null
	var res := ResourceLoader.load(path)
	if res is TileSet:
		return res
	return null


func _tileset_create(params: Dictionary) -> Dictionary:
	var to_path := String(params.get("to_path", ""))
	if not to_path.begins_with("res://"):
		return _err("bad_params", "'to_path' must be a res:// path")
	var ts := TileSet.new()
	if params.has("tile_size"):
		ts.set("tile_size", _to_vec2i(params.get("tile_size")))
	var e := ResourceSaver.save(ts, to_path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	var tsz: Vector2i = ts.get("tile_size")
	return _ok({"created": to_path, "tile_size": [tsz.x, tsz.y]})


func _tileset_add_source(params: Dictionary) -> Dictionary:
	var tileset_path := String(params.get("tileset_path", ""))
	var ts = _load_tileset(tileset_path)
	if ts == null:
		return _err("not_found", "TileSet not found: %s" % tileset_path)
	var texture_path := String(params.get("texture_path", ""))
	if texture_path == "" or not ResourceLoader.exists(texture_path):
		return _err("not_found", "Texture not found: %s" % texture_path)
	var tex := ResourceLoader.load(texture_path)
	if not (tex is Texture2D):
		return _err("bad_texture", "Not a Texture2D: %s" % texture_path)
	var atlas := TileSetAtlasSource.new()
	atlas.set("texture", tex)
	var region: Vector2i = ts.get("tile_size")
	if params.has("texture_region_size"):
		region = _to_vec2i(params.get("texture_region_size"))
	atlas.set("texture_region_size", region)
	if params.has("margins"):
		atlas.set("margins", _to_vec2i(params.get("margins")))
	if params.has("separation"):
		atlas.set("separation", _to_vec2i(params.get("separation")))
	var assigned: int = ts.add_source(atlas, int(params.get("source_id", -1)))
	var e := ResourceSaver.save(ts, tileset_path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"tileset": tileset_path, "source_id": assigned, "texture": texture_path, "texture_region_size": [region.x, region.y], "source_count": ts.get_source_count()})


func _tileset_add_tile(params: Dictionary) -> Dictionary:
	var tileset_path := String(params.get("tileset_path", ""))
	var ts = _load_tileset(tileset_path)
	if ts == null:
		return _err("not_found", "TileSet not found: %s" % tileset_path)
	var sid := int(params.get("source_id", -1))
	if not ts.has_source(sid):
		return _err("not_found", "No source with id %d" % sid)
	var src = ts.get_source(sid)
	if not (src is TileSetAtlasSource):
		return _err("bad_source", "Source %d is not a TileSetAtlasSource" % sid)
	var coords := _to_vec2i(params.get("atlas_coords"))
	if src.has_tile(coords):
		return _err("exists", "Tile already exists at %s" % str(coords))
	var size := Vector2i(1, 1)
	if params.has("size"):
		size = _to_vec2i(params.get("size"))
	src.create_tile(coords, size)
	var e := ResourceSaver.save(ts, tileset_path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"tileset": tileset_path, "source_id": sid, "atlas_coords": [coords.x, coords.y], "size": [size.x, size.y], "tiles_count": src.get_tiles_count()})


func _tileset_set_tile_collision(params: Dictionary) -> Dictionary:
	var tileset_path := String(params.get("tileset_path", ""))
	var ts = _load_tileset(tileset_path)
	if ts == null:
		return _err("not_found", "TileSet not found: %s" % tileset_path)
	var sid := int(params.get("source_id", -1))
	if not ts.has_source(sid):
		return _err("not_found", "No source with id %d" % sid)
	var src = ts.get_source(sid)
	if not (src is TileSetAtlasSource):
		return _err("bad_source", "Source %d is not a TileSetAtlasSource" % sid)
	var coords := _to_vec2i(params.get("atlas_coords"))
	if not src.has_tile(coords):
		return _err("not_found", "No tile at %s in source %d" % [str(coords), sid])
	var layer := int(params.get("physics_layer", 0))
	if layer < 0:
		return _err("bad_params", "'physics_layer' must be >= 0")
	var poly := _to_packed_vec2(params.get("polygon"))
	if poly.size() < 3:
		return _err("bad_params", "'polygon' needs at least 3 [x, y] points")
	while ts.get_physics_layers_count() <= layer:
		ts.add_physics_layer(-1)
	var td: TileData = src.get_tile_data(coords, 0)
	if td == null:
		return _err("no_tile_data", "Could not get TileData for %s" % str(coords))
	td.add_collision_polygon(layer)
	var poly_index := td.get_collision_polygons_count(layer) - 1
	td.set_collision_polygon_points(layer, poly_index, poly)
	var one_way := bool(params.get("one_way", false))
	if params.has("one_way"):
		td.set_collision_polygon_one_way(layer, poly_index, one_way)
	var e := ResourceSaver.save(ts, tileset_path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"tileset": tileset_path, "source_id": sid, "atlas_coords": [coords.x, coords.y], "physics_layer": layer, "polygon_index": poly_index, "points": poly.size(), "one_way": one_way})


# ---------------------------------------------- Group D: tilemap (batch 2) --
# In-scene TileMapLayer authoring + cell painting. Unlike the disk-backed
# tileset_* family (which writes a .tres and is host-gated), these mutate a
# TileMapLayer node in the edited scene and are undoable via
# EditorUndoRedoManager — the ungated node_* model. Empty cells read back as
# source_id -1 / atlas_coords (-1, -1) / alternative 0, which is exactly what
# the undo path restores.

func _as_tilemap_layer(root: Node, path: String) -> TileMapLayer:
	var n := _resolve(root, path)
	if n is TileMapLayer:
		return n
	return null


func _tilemaplayer_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var layer := TileMapLayer.new()
	layer.name = String(params.get("name", "TileMapLayer"))
	var tileset_path := String(params.get("tileset_path", ""))
	if tileset_path != "":
		var ts = _load_tileset(tileset_path)
		if ts == null:
			return _err("not_found", "TileSet not found: %s" % tileset_path)
		layer.tile_set = ts
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add TileMapLayer %s" % layer.name)
	ur.add_do_method(parent, "add_child", layer)
	ur.add_do_method(layer, "set_owner", root)
	ur.add_do_reference(layer)
	ur.add_undo_method(parent, "remove_child", layer)
	ur.commit_action()
	return _ok({"path": _path_of(root, layer), "name": String(layer.name), "type": "TileMapLayer", "tile_set": tileset_path})


func _tilemap_set_cell(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var layer := _as_tilemap_layer(root, String(params.get("path", "")))
	if layer == null:
		return _err("bad_path", "TileMapLayer not found: %s" % params.get("path", ""))
	var coords := _to_vec2i(params.get("coords"))
	var source_id := int(params.get("source_id", -1))
	var atlas := Vector2i.ZERO
	if params.has("atlas_coords"):
		atlas = _to_vec2i(params.get("atlas_coords"))
	var alternative := int(params.get("alternative", 0))
	var old_src := layer.get_cell_source_id(coords)
	var old_atlas := layer.get_cell_atlas_coords(coords)
	var old_alt := layer.get_cell_alternative_tile(coords)
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set cell %s" % str(coords))
	ur.add_do_method(layer, "set_cell", coords, source_id, atlas, alternative)
	ur.add_undo_method(layer, "set_cell", coords, old_src, old_atlas, old_alt)
	ur.commit_action()
	return _ok({"path": _path_of(root, layer), "coords": [coords.x, coords.y], "source_id": source_id, "atlas_coords": [atlas.x, atlas.y], "alternative": alternative, "erased": source_id < 0})


func _tilemap_set_cells_rect(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var layer := _as_tilemap_layer(root, String(params.get("path", "")))
	if layer == null:
		return _err("bad_path", "TileMapLayer not found: %s" % params.get("path", ""))
	var r = params.get("rect")
	if not (r is Array) or r.size() < 4:
		return _err("bad_params", "'rect' must be [x, y, width, height]")
	var rx := int(r[0])
	var ry := int(r[1])
	var rw := int(r[2])
	var rh := int(r[3])
	if rw <= 0 or rh <= 0:
		return _err("bad_params", "'rect' width and height must be > 0")
	var area := rw * rh
	if area > 65536:
		return _err("too_large", "rect covers %d cells (max 65536); split into multiple calls" % area)
	var source_id := int(params.get("source_id", -1))
	var atlas := Vector2i.ZERO
	if params.has("atlas_coords"):
		atlas = _to_vec2i(params.get("atlas_coords"))
	var alternative := int(params.get("alternative", 0))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set cells rect %d,%d %dx%d" % [rx, ry, rw, rh])
	for dy in range(rh):
		for dx in range(rw):
			var c := Vector2i(rx + dx, ry + dy)
			var os := layer.get_cell_source_id(c)
			var oa := layer.get_cell_atlas_coords(c)
			var oal := layer.get_cell_alternative_tile(c)
			ur.add_do_method(layer, "set_cell", c, source_id, atlas, alternative)
			ur.add_undo_method(layer, "set_cell", c, os, oa, oal)
	ur.commit_action()
	return _ok({"path": _path_of(root, layer), "rect": [rx, ry, rw, rh], "cells": area, "source_id": source_id, "atlas_coords": [atlas.x, atlas.y], "alternative": alternative, "erased": source_id < 0})


func _tilemap_get_cell(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var layer := _as_tilemap_layer(root, String(params.get("path", "")))
	if layer == null:
		return _err("bad_path", "TileMapLayer not found: %s" % params.get("path", ""))
	var coords := _to_vec2i(params.get("coords"))
	var src := layer.get_cell_source_id(coords)
	var atlas := layer.get_cell_atlas_coords(coords)
	var alt := layer.get_cell_alternative_tile(coords)
	return _ok({"path": _path_of(root, layer), "coords": [coords.x, coords.y], "source_id": src, "atlas_coords": [atlas.x, atlas.y], "alternative": alt, "empty": src < 0})


func _tilemap_clear(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var layer := _as_tilemap_layer(root, String(params.get("path", "")))
	if layer == null:
		return _err("bad_path", "TileMapLayer not found: %s" % params.get("path", ""))
	var used := layer.get_used_cells()
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: clear TileMapLayer %s" % layer.name)
	ur.add_do_method(layer, "clear")
	for c in used:
		var os := layer.get_cell_source_id(c)
		var oa := layer.get_cell_atlas_coords(c)
		var oal := layer.get_cell_alternative_tile(c)
		ur.add_undo_method(layer, "set_cell", c, os, oa, oal)
	ur.commit_action()
	return _ok({"path": _path_of(root, layer), "cleared_cells": used.size()})


# ---------------------------------------------- Group E: physics (batch 1) --
# In-scene physics authoring: bodies (Static/Rigid/Character/Area, 2D+3D),
# their collision shapes (CollisionShape2D/3D carrying a Shape resource), and
# the collision_layer / collision_mask bitmasks. Every mutation goes through
# EditorUndoRedoManager and is ungated — the in-scene node_* model.

func _to_vec3(v) -> Vector3:
	if v is Array and v.size() >= 3:
		return Vector3(float(v[0]), float(v[1]), float(v[2]))
	return Vector3.ZERO


func _to_packed_vec3(v) -> PackedVector3Array:
	var out := PackedVector3Array()
	if v is Array:
		for p in v:
			if p is Array and p.size() >= 3:
				out.append(Vector3(float(p[0]), float(p[1]), float(p[2])))
	return out


func _body_class(kind: String, dim3: bool) -> String:
	if kind == "static":
		return "StaticBody3D" if dim3 else "StaticBody2D"
	if kind == "rigid":
		return "RigidBody3D" if dim3 else "RigidBody2D"
	if kind == "character":
		return "CharacterBody3D" if dim3 else "CharacterBody2D"
	if kind == "area":
		return "Area3D" if dim3 else "Area2D"
	return ""


func _body_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var kind := String(params.get("type", ""))
	var dim3 := String(params.get("dim", "2d")) == "3d"
	var cls := _body_class(kind, dim3)
	if cls == "":
		return _err("bad_params", "Unknown body type '%s' (want static|rigid|character|area)" % kind)
	if not ClassDB.can_instantiate(cls):
		return _err("bad_type", "Cannot instantiate class: %s" % cls)
	var node: Node = ClassDB.instantiate(cls)
	node.name = String(params.get("name", cls))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": cls, "body": kind, "dim": ("3d" if dim3 else "2d")})


func _make_collision_shape(kind: String, dim3: bool, params: Dictionary):
	if kind == "rect":
		if dim3:
			var b := BoxShape3D.new()
			b.size = _to_vec3(params.get("size", [1, 1, 1]))
			return b
		var r := RectangleShape2D.new()
		r.size = _to_vec2(params.get("size", [32, 32]))
		return r
	if kind == "circle":
		if dim3:
			var s := SphereShape3D.new()
			s.radius = float(params.get("radius", 0.5))
			return s
		var c := CircleShape2D.new()
		c.radius = float(params.get("radius", 16.0))
		return c
	if kind == "capsule":
		if dim3:
			var cap3 := CapsuleShape3D.new()
			cap3.radius = float(params.get("radius", 0.5))
			cap3.height = float(params.get("height", 2.0))
			return cap3
		var cap := CapsuleShape2D.new()
		cap.radius = float(params.get("radius", 16.0))
		cap.height = float(params.get("height", 48.0))
		return cap
	if kind == "polygon":
		if dim3:
			var cp3 := ConvexPolygonShape3D.new()
			cp3.points = _to_packed_vec3(params.get("points"))
			return cp3
		var cp := ConvexPolygonShape2D.new()
		cp.points = _to_packed_vec2(params.get("points"))
		return cp
	return null


func _collisionshape_add(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var kind := String(params.get("shape", ""))
	if not (kind in ["rect", "circle", "capsule", "polygon"]):
		return _err("bad_params", "Unknown shape '%s' (want rect|circle|capsule|polygon)" % kind)
	var dim3 := String(params.get("dim", "2d")) == "3d"
	if kind == "polygon":
		if dim3 and _to_packed_vec3(params.get("points")).size() < 4:
			return _err("bad_params", "'polygon' (3D) needs at least 4 points")
		if not dim3 and _to_packed_vec2(params.get("points")).size() < 3:
			return _err("bad_params", "'polygon' (2D) needs at least 3 points")
	var shape_res = _make_collision_shape(kind, dim3, params)
	if shape_res == null:
		return _err("bad_params", "Could not build shape for '%s'" % kind)
	var node: Node
	if dim3:
		var cs3 := CollisionShape3D.new()
		cs3.set("shape", shape_res)
		node = cs3
	else:
		var cs2 := CollisionShape2D.new()
		cs2.set("shape", shape_res)
		node = cs2
	node.name = String(params.get("name", node.get_class()))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": node.get_class(), "shape": kind, "shape_class": shape_res.get_class(), "dim": ("3d" if dim3 else "2d")})


func _body_set_collision_layer(params: Dictionary) -> Dictionary:
	return _body_set_collision_field(params, "collision_layer", "layer")


func _body_set_collision_mask(params: Dictionary) -> Dictionary:
	return _body_set_collision_field(params, "collision_mask", "mask")


func _body_set_collision_field(params: Dictionary, field: String, key: String) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not (node is CollisionObject2D or node is CollisionObject3D):
		return _err("bad_type", "%s is not a physics body/area (CollisionObject2D/3D)" % node.name)
	if not params.has(key):
		return _err("bad_params", "Missing '%s'" % key)
	var new_value := int(params.get(key, 0))
	if new_value < 0:
		return _err("bad_params", "'%s' must be a non-negative bitmask" % key)
	var old_value: int = node.get(field)
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s.%s" % [node.name, field])
	ur.add_do_property(node, field, new_value)
	ur.add_undo_property(node, field, old_value)
	ur.commit_action()
	var result := {"path": _path_of(root, node)}
	result[field] = new_value
	return _ok(result)


# ---------------------------------------------------------------- Group E batch 2 ----
# Physics & collision, part 2: areas (monitoring / gravity zones), joints, collision
# polygons, rigidbody tuning, per-body physics material — all in-scene node mutators,
# undoable via EditorUndoRedoManager and ungated (the node_* model). _physics_set_gravity
# writes ProjectSettings (no undo) and is gated host-side like project_set_setting.

func _area_set_monitoring(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not (node is Area2D or node is Area3D):
		return _err("bad_type", "%s is not an Area2D/3D" % node.name)
	if not (params.has("monitoring") or params.has("monitorable")):
		return _err("bad_params", "Provide 'monitoring' and/or 'monitorable'")
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s monitoring" % node.name)
	if params.has("monitoring"):
		ur.add_do_property(node, "monitoring", bool(params.get("monitoring")))
		ur.add_undo_property(node, "monitoring", node.get("monitoring"))
	if params.has("monitorable"):
		ur.add_do_property(node, "monitorable", bool(params.get("monitorable")))
		ur.add_undo_property(node, "monitorable", node.get("monitorable"))
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "monitoring": node.get("monitoring"), "monitorable": node.get("monitorable")})


func _area_space_override(s: String) -> int:
	var m := {"disabled": 0, "combine": 1, "combine_replace": 2, "replace": 3, "replace_combine": 4}
	return int(m.get(s, -1))


func _area_space_override_name(v: int) -> String:
	var names := ["disabled", "combine", "combine_replace", "replace", "replace_combine"]
	if v >= 0 and v < names.size():
		return names[v]
	return str(v)


func _area_set_gravity(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not (node is Area2D or node is Area3D):
		return _err("bad_type", "%s is not an Area2D/3D" % node.name)
	if not (params.has("space_override") or params.has("gravity") or params.has("direction") or params.has("point")):
		return _err("bad_params", "Provide at least one of space_override|gravity|direction|point")
	var so := -1
	if params.has("space_override"):
		so = _area_space_override(String(params.get("space_override")))
		if so < 0:
			return _err("bad_params", "Unknown space_override '%s'" % params.get("space_override"))
	var dim3 := node is Area3D
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s gravity" % node.name)
	if params.has("space_override"):
		ur.add_do_property(node, "gravity_space_override", so)
		ur.add_undo_property(node, "gravity_space_override", node.get("gravity_space_override"))
	if params.has("gravity"):
		ur.add_do_property(node, "gravity", float(params.get("gravity")))
		ur.add_undo_property(node, "gravity", node.get("gravity"))
	if params.has("direction"):
		var dir = _to_vec3(params.get("direction")) if dim3 else _to_vec2(params.get("direction"))
		ur.add_do_property(node, "gravity_direction", dir)
		ur.add_undo_property(node, "gravity_direction", node.get("gravity_direction"))
	if params.has("point"):
		ur.add_do_property(node, "gravity_point", bool(params.get("point")))
		ur.add_undo_property(node, "gravity_point", node.get("gravity_point"))
	ur.commit_action()
	var dv = node.get("gravity_direction")
	var dir_out: Array = ([dv.x, dv.y, dv.z] if dim3 else [dv.x, dv.y])
	return _ok({"path": _path_of(root, node), "space_override": _area_space_override_name(int(node.get("gravity_space_override"))), "gravity": float(node.get("gravity")), "direction": dir_out, "gravity_point": bool(node.get("gravity_point")), "dim": ("3d" if dim3 else "2d")})


func _joint_class(kind: String, dim3: bool) -> String:
	if dim3:
		if kind == "pin":
			return "PinJoint3D"
		if kind == "hinge":
			return "HingeJoint3D"
		if kind == "slider":
			return "SliderJoint3D"
		if kind == "cone_twist":
			return "ConeTwistJoint3D"
		if kind == "generic6dof":
			return "Generic6DOFJoint3D"
		return ""
	if kind == "pin":
		return "PinJoint2D"
	if kind == "groove":
		return "GrooveJoint2D"
	if kind == "spring":
		return "DampedSpringJoint2D"
	return ""


func _joint_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var kind := String(params.get("type", ""))
	var dim3 := String(params.get("dim", "2d")) == "3d"
	var cls := _joint_class(kind, dim3)
	if cls == "":
		return _err("bad_params", "Unknown joint type '%s' for %s (2D: pin|groove|spring; 3D: pin|hinge|slider|cone_twist|generic6dof)" % [kind, ("3d" if dim3 else "2d")])
	if not ClassDB.can_instantiate(cls):
		return _err("bad_type", "Cannot instantiate class: %s" % cls)
	var node: Node = ClassDB.instantiate(cls)
	node.name = String(params.get("name", cls))
	if params.has("node_a"):
		node.set("node_a", NodePath(String(params.get("node_a"))))
	if params.has("node_b"):
		node.set("node_b", NodePath(String(params.get("node_b"))))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": cls, "joint": kind, "dim": ("3d" if dim3 else "2d"), "node_a": String(node.get("node_a")), "node_b": String(node.get("node_b"))})


func _joint_set_bodies(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not (node is Joint2D or node is Joint3D):
		return _err("bad_type", "%s is not a Joint2D/3D" % node.name)
	if not (params.has("node_a") or params.has("node_b")):
		return _err("bad_params", "Provide 'node_a' and/or 'node_b'")
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s bodies" % node.name)
	if params.has("node_a"):
		ur.add_do_property(node, "node_a", NodePath(String(params.get("node_a"))))
		ur.add_undo_property(node, "node_a", node.get("node_a"))
	if params.has("node_b"):
		ur.add_do_property(node, "node_b", NodePath(String(params.get("node_b"))))
		ur.add_undo_property(node, "node_b", node.get("node_b"))
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "node_a": String(node.get("node_a")), "node_b": String(node.get("node_b"))})


func _collisionpolygon_add(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var dim3 := String(params.get("dim", "2d")) == "3d"
	var pts := _to_packed_vec2(params.get("points"))
	if pts.size() < 3:
		return _err("bad_params", "collisionpolygon needs at least 3 points")
	var node: Node
	if dim3:
		var c3 := CollisionPolygon3D.new()
		c3.set("polygon", pts)
		if params.has("depth"):
			c3.set("depth", float(params.get("depth")))
		node = c3
	else:
		var c2 := CollisionPolygon2D.new()
		c2.set("polygon", pts)
		if params.has("build_mode"):
			var bm := 1 if String(params.get("build_mode")) == "segments" else 0
			c2.set("build_mode", bm)
		node = c2
	node.name = String(params.get("name", node.get_class()))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": node.get_class(), "dim": ("3d" if dim3 else "2d"), "points": pts.size()})


func _rigidbody_set_properties(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not (node is RigidBody2D or node is RigidBody3D):
		return _err("bad_type", "%s is not a RigidBody2D/3D" % node.name)
	var provided: Array = []
	for f in ["mass", "gravity_scale", "linear_damp", "angular_damp"]:
		if params.has(f):
			provided.append(f)
	if provided.is_empty():
		return _err("bad_params", "Provide at least one of mass|gravity_scale|linear_damp|angular_damp")
	if params.has("mass") and float(params.get("mass")) <= 0.0:
		return _err("bad_params", "'mass' must be > 0")
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s physics props" % node.name)
	for f in provided:
		ur.add_do_property(node, f, float(params.get(f)))
		ur.add_undo_property(node, f, node.get(f))
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "mass": float(node.get("mass")), "gravity_scale": float(node.get("gravity_scale")), "linear_damp": float(node.get("linear_damp")), "angular_damp": float(node.get("angular_damp"))})


func _body_set_physics_material(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not (node is StaticBody2D or node is StaticBody3D or node is RigidBody2D or node is RigidBody3D):
		return _err("bad_type", "%s has no physics_material_override (need StaticBody/RigidBody 2D/3D)" % node.name)
	var mat := PhysicsMaterial.new()
	mat.friction = float(params.get("friction", 1.0))
	mat.bounce = float(params.get("bounce", 0.0))
	mat.rough = bool(params.get("rough", false))
	mat.absorbent = bool(params.get("absorbent", false))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s physics material" % node.name)
	ur.add_do_property(node, "physics_material_override", mat)
	ur.add_undo_property(node, "physics_material_override", node.get("physics_material_override"))
	ur.add_do_reference(mat)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "friction": mat.friction, "bounce": mat.bounce, "rough": mat.rough, "absorbent": mat.absorbent})


func _physics_set_gravity(params: Dictionary) -> Dictionary:
	var dim3 := String(params.get("dim", "2d")) == "3d"
	var prefix := "physics/3d/" if dim3 else "physics/2d/"
	if not (params.has("magnitude") or params.has("direction")):
		return _err("bad_params", "Provide 'magnitude' and/or 'direction'")
	if params.has("magnitude"):
		ProjectSettings.set_setting(prefix + "default_gravity", float(params.get("magnitude")))
	if params.has("direction"):
		var dir = _to_vec3(params.get("direction")) if dim3 else _to_vec2(params.get("direction"))
		ProjectSettings.set_setting(prefix + "default_gravity_vector", dir)
	var saved := false
	if bool(params.get("save", false)):
		var e := ProjectSettings.save()
		if e != OK:
			return _err("save_failed", "ProjectSettings.save() returned %d" % e)
		saved = true
	var dv = ProjectSettings.get_setting(prefix + "default_gravity_vector", null)
	var dir_out: Array = ([dv.x, dv.y, dv.z] if dim3 else [dv.x, dv.y])
	return _ok({"dim": ("3d" if dim3 else "2d"), "magnitude": float(ProjectSettings.get_setting(prefix + "default_gravity", 0.0)), "direction": dir_out, "saved": saved})


# ---------------------------------------------------------------- Group F batch 1 ----
# VFX: GPU particles (2D/3D). All in-scene node/resource mutators, undoable via
# EditorUndoRedoManager and ungated (the node_* model). particles_set_texture is
# GPUParticles2D-only (3D has no texture; it draws meshes) and feature-detects.

func _is_particles(node) -> bool:
	return node is GPUParticles2D or node is GPUParticles3D


func _to_color(v) -> Color:
	if v is Array and v.size() >= 3:
		var a: float = float(v[3]) if v.size() >= 4 else 1.0
		return Color(float(v[0]), float(v[1]), float(v[2]), a)
	return Color(1, 1, 1, 1)


func _particles_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var dim3 := String(params.get("dim", "2d")) == "3d"
	if params.has("amount") and int(params.get("amount")) <= 0:
		return _err("bad_params", "'amount' must be > 0")
	if params.has("lifetime") and float(params.get("lifetime")) <= 0.0:
		return _err("bad_params", "'lifetime' must be > 0")
	var node: Node
	if dim3:
		node = GPUParticles3D.new()
	else:
		node = GPUParticles2D.new()
	node.name = String(params.get("name", node.get_class()))
	if params.has("amount"):
		node.set("amount", int(params.get("amount")))
	if params.has("lifetime"):
		node.set("lifetime", float(params.get("lifetime")))
	if params.has("emitting"):
		node.set("emitting", bool(params.get("emitting")))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": node.get_class(), "dim": ("3d" if dim3 else "2d"), "amount": int(node.get("amount")), "lifetime": float(node.get("lifetime")), "emitting": bool(node.get("emitting"))})


func _particles_set_process_material(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not _is_particles(node):
		return _err("bad_type", "%s is not a GPUParticles2D/3D" % node.name)
	var mat := ParticleProcessMaterial.new()
	if params.has("gravity"):
		mat.gravity = _to_vec3(params.get("gravity"))
	if params.has("direction"):
		mat.direction = _to_vec3(params.get("direction"))
	if params.has("spread"):
		mat.spread = float(params.get("spread"))
	if params.has("initial_velocity_min"):
		mat.initial_velocity_min = float(params.get("initial_velocity_min"))
	if params.has("initial_velocity_max"):
		mat.initial_velocity_max = float(params.get("initial_velocity_max"))
	if params.has("scale_min"):
		mat.scale_min = float(params.get("scale_min"))
	if params.has("scale_max"):
		mat.scale_max = float(params.get("scale_max"))
	if params.has("color"):
		mat.color = _to_color(params.get("color"))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s process material" % node.name)
	ur.add_do_property(node, "process_material", mat)
	ur.add_undo_property(node, "process_material", node.get("process_material"))
	ur.add_do_reference(mat)
	ur.commit_action()
	var g = mat.gravity
	var d = mat.direction
	var c = mat.color
	return _ok({"path": _path_of(root, node), "gravity": [g.x, g.y, g.z], "direction": [d.x, d.y, d.z], "spread": mat.spread, "initial_velocity_min": mat.initial_velocity_min, "initial_velocity_max": mat.initial_velocity_max, "scale_min": mat.scale_min, "scale_max": mat.scale_max, "color": [c.r, c.g, c.b, c.a]})


func _particles_set_amount(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not _is_particles(node):
		return _err("bad_type", "%s is not a GPUParticles2D/3D" % node.name)
	if not params.has("amount"):
		return _err("bad_params", "Missing 'amount'")
	var v := int(params.get("amount"))
	if v <= 0:
		return _err("bad_params", "'amount' must be > 0")
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s amount" % node.name)
	ur.add_do_property(node, "amount", v)
	ur.add_undo_property(node, "amount", node.get("amount"))
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "amount": int(node.get("amount"))})


func _particles_set_lifetime(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not _is_particles(node):
		return _err("bad_type", "%s is not a GPUParticles2D/3D" % node.name)
	if not params.has("lifetime"):
		return _err("bad_params", "Missing 'lifetime'")
	var v := float(params.get("lifetime"))
	if v <= 0.0:
		return _err("bad_params", "'lifetime' must be > 0")
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s lifetime" % node.name)
	ur.add_do_property(node, "lifetime", v)
	ur.add_undo_property(node, "lifetime", node.get("lifetime"))
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "lifetime": float(node.get("lifetime"))})


func _particles_set_emitting(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not _is_particles(node):
		return _err("bad_type", "%s is not a GPUParticles2D/3D" % node.name)
	if not params.has("emitting"):
		return _err("bad_params", "Missing 'emitting'")
	var v := bool(params.get("emitting"))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s emitting" % node.name)
	ur.add_do_property(node, "emitting", v)
	ur.add_undo_property(node, "emitting", node.get("emitting"))
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "emitting": bool(node.get("emitting"))})


func _particles_set_texture(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not (node is GPUParticles2D):
		return _err("unsupported", "%s has no texture (GPUParticles3D draws meshes; texture is GPUParticles2D-only)" % node.name)
	var tex_path := String(params.get("texture_path", ""))
	if tex_path == "" or not ResourceLoader.exists(tex_path):
		return _err("not_found", "Texture not found: %s" % tex_path)
	var res = ResourceLoader.load(tex_path)
	if not (res is Texture2D):
		return _err("bad_type", "%s is not a Texture2D" % tex_path)
	var tex := res as Texture2D
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s texture" % node.name)
	ur.add_do_property(node, "texture", tex)
	ur.add_undo_property(node, "texture", node.get("texture"))
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "texture_path": tex_path})


# -------------------------------------------------------------- shaders ------
# VFX: shaders. shader_create / shader_set_code write .gdshader resources to disk
# (host-gated, file-writing). shadermaterial_* mutate the edited scene's node
# material (undoable, ungated, node_* model). ShaderMaterial targets
# CanvasItem.material (2D / Control) or GeometryInstance3D.material_override (3D);
# other nodes degrade to a clear unsupported. Shader / ShaderMaterial /
# set_shader_parameter + the shader_parameter/<name> property path probed live on
# Godot 4.7.

func _material_prop(node) -> String:
	if node is CanvasItem:
		return "material"
	if node is GeometryInstance3D:
		return "material_override"
	return ""


func _shader_create(params: Dictionary) -> Dictionary:
	var to_path := String(params.get("to_path", ""))
	if not to_path.begins_with("res://"):
		return _err("bad_params", "'to_path' must be a res:// path")
	var sh := Shader.new()
	if params.has("code"):
		sh.code = String(params.get("code"))
	var e := ResourceSaver.save(sh, to_path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"created": to_path, "type": "Shader", "code_length": sh.code.length()})


func _shader_set_code(params: Dictionary) -> Dictionary:
	var path := String(params.get("path", ""))
	if not ResourceLoader.exists(path):
		return _err("not_found", "Shader not found: %s" % path)
	if not params.has("code"):
		return _err("bad_params", "Missing 'code'")
	var res = ResourceLoader.load(path)
	if not (res is Shader):
		return _err("bad_type", "%s is not a Shader" % path)
	var sh := res as Shader
	sh.code = String(params.get("code"))
	var e := ResourceSaver.save(sh, path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"path": path, "code_length": sh.code.length()})


func _shadermaterial_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var prop := _material_prop(node)
	if prop == "":
		return _err("unsupported", "%s has no material slot (needs CanvasItem.material or GeometryInstance3D.material_override)" % node.name)
	var mat := ShaderMaterial.new()
	var shader_path := String(params.get("shader_path", ""))
	if shader_path != "":
		if not ResourceLoader.exists(shader_path):
			return _err("not_found", "Shader not found: %s" % shader_path)
		var sres = ResourceLoader.load(shader_path)
		if not (sres is Shader):
			return _err("bad_type", "%s is not a Shader" % shader_path)
		mat.shader = sres as Shader
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s shader material" % node.name)
	ur.add_do_property(node, prop, mat)
	ur.add_undo_property(node, prop, node.get(prop))
	ur.add_do_reference(mat)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "target_property": prop, "type": node.get_class(), "shader_path": shader_path})


func _shadermaterial_set_shader(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var prop := _material_prop(node)
	if prop == "":
		return _err("unsupported", "%s has no material slot" % node.name)
	var cur = node.get(prop)
	if not (cur is ShaderMaterial):
		return _err("bad_type", "%s has no ShaderMaterial (create one first)" % node.name)
	var shader_path := String(params.get("shader_path", ""))
	if not ResourceLoader.exists(shader_path):
		return _err("not_found", "Shader not found: %s" % shader_path)
	var sres = ResourceLoader.load(shader_path)
	if not (sres is Shader):
		return _err("bad_type", "%s is not a Shader" % shader_path)
	var mat := cur as ShaderMaterial
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s shader" % node.name)
	ur.add_do_property(mat, "shader", sres as Shader)
	ur.add_undo_property(mat, "shader", mat.shader)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "shader_path": shader_path})


func _shadermaterial_set_param(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var prop := _material_prop(node)
	if prop == "":
		return _err("unsupported", "%s has no material slot" % node.name)
	var cur = node.get(prop)
	if not (cur is ShaderMaterial):
		return _err("bad_type", "%s has no ShaderMaterial (create one first)" % node.name)
	var pname := String(params.get("param", ""))
	if pname == "":
		return _err("bad_params", "Missing 'param'")
	var mat := cur as ShaderMaterial
	var value: Variant = Codec.decode(params.get("value"))
	var key := "shader_parameter/" + pname
	var old_value = mat.get(key)
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s shader param %s" % [node.name, pname])
	ur.add_do_property(mat, key, value)
	ur.add_undo_property(mat, key, old_value)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "param": pname, "value": Codec.encode(mat.get(key))})

# ---------------------------------------------------------------- Group F batch 3 ----
# Audio. Two models. audio_player_create / audio_set_stream mutate the edited scene
# (AudioStreamPlayer / AudioStreamPlayer2D / AudioStreamPlayer3D), undoable via
# EditorUndoRedoManager and ungated (the node_* model). The four bus tools drive the
# global AudioServer (project-wide, not scene-undoable) and are gated host-side like
# physics_set_gravity; audio_set_bus_layout writes a .tres, a file-writer too.
# AudioServer bus API + player stream/autoplay/volume_db/bus props probed live on Godot 4.7.

func _is_audio_player(node) -> bool:
	return node is AudioStreamPlayer or node is AudioStreamPlayer2D or node is AudioStreamPlayer3D


func _audio_player_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var dim := String(params.get("dim", "none"))
	var node: Node
	if dim == "2d":
		node = AudioStreamPlayer2D.new()
	elif dim == "3d":
		node = AudioStreamPlayer3D.new()
	else:
		node = AudioStreamPlayer.new()
	node.name = String(params.get("name", node.get_class()))
	if params.has("autoplay"):
		node.set("autoplay", bool(params.get("autoplay")))
	if params.has("volume_db"):
		node.set("volume_db", float(params.get("volume_db")))
	if params.has("bus"):
		node.set("bus", String(params.get("bus")))
	var stream_path := String(params.get("stream_path", ""))
	if stream_path != "":
		if not ResourceLoader.exists(stream_path):
			return _err("not_found", "Stream not found: %s" % stream_path)
		var sres = ResourceLoader.load(stream_path)
		if not (sres is AudioStream):
			return _err("bad_type", "%s is not an AudioStream" % stream_path)
		node.set("stream", sres as AudioStream)
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": node.get_class(), "dim": dim, "autoplay": bool(node.get("autoplay")), "volume_db": float(node.get("volume_db")), "bus": String(node.get("bus")), "stream_path": stream_path})


func _audio_set_stream(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not _is_audio_player(node):
		return _err("bad_type", "%s is not an AudioStreamPlayer/2D/3D" % node.name)
	var stream_path := String(params.get("stream_path", ""))
	if stream_path == "" or not ResourceLoader.exists(stream_path):
		return _err("not_found", "Stream not found: %s" % stream_path)
	var res = ResourceLoader.load(stream_path)
	if not (res is AudioStream):
		return _err("bad_type", "%s is not an AudioStream" % stream_path)
	var stream := res as AudioStream
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s stream" % node.name)
	ur.add_do_property(node, "stream", stream)
	ur.add_undo_property(node, "stream", node.get("stream"))
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "stream_path": stream_path})


func _audio_bus_add(params: Dictionary) -> Dictionary:
	var at := int(params.get("at_position", -1))
	AudioServer.add_bus(at)
	var count := AudioServer.get_bus_count()
	var idx: int = (count - 1) if at < 0 or at >= count else at
	if params.has("name"):
		AudioServer.set_bus_name(idx, String(params.get("name")))
	if params.has("send"):
		AudioServer.set_bus_send(idx, String(params.get("send")))
	return _ok({"index": idx, "name": String(AudioServer.get_bus_name(idx)), "send": String(AudioServer.get_bus_send(idx)), "count": AudioServer.get_bus_count()})


func _audio_bus_add_effect(params: Dictionary) -> Dictionary:
	var bus := String(params.get("bus", ""))
	var idx: int = AudioServer.get_bus_index(bus)
	if idx < 0:
		return _err("not_found", "Bus not found: %s" % bus)
	var cls := String(params.get("effect", ""))
	if cls == "" or not ClassDB.can_instantiate(cls) or not ClassDB.is_parent_class(cls, "AudioEffect"):
		return _err("bad_params", "'effect' must be an instantiable AudioEffect class: %s" % cls)
	var fx = ClassDB.instantiate(cls)
	if not (fx is AudioEffect):
		return _err("bad_type", "%s is not an AudioEffect" % cls)
	var at := int(params.get("at_position", -1))
	AudioServer.add_bus_effect(idx, fx, at)
	return _ok({"bus": bus, "bus_index": idx, "effect": cls, "effect_count": AudioServer.get_bus_effect_count(idx)})


func _audio_bus_set_volume(params: Dictionary) -> Dictionary:
	var bus := String(params.get("bus", ""))
	var idx: int = AudioServer.get_bus_index(bus)
	if idx < 0:
		return _err("not_found", "Bus not found: %s" % bus)
	if not params.has("volume_db"):
		return _err("bad_params", "Missing 'volume_db'")
	AudioServer.set_bus_volume_db(idx, float(params.get("volume_db")))
	return _ok({"bus": bus, "bus_index": idx, "volume_db": AudioServer.get_bus_volume_db(idx)})


func _audio_set_bus_layout(params: Dictionary) -> Dictionary:
	var to_path := String(params.get("to_path", "res://default_bus_layout.tres"))
	if not to_path.begins_with("res://"):
		return _err("bad_params", "'to_path' must be a res:// path")
	var layout = AudioServer.generate_bus_layout()
	var e := ResourceSaver.save(layout, to_path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"saved": to_path, "bus_count": AudioServer.get_bus_count()})


# ---------------------------------------------------------------- Group G: UI / control / theming ----
# control_* + container_add_child mutate the edited scene (Control nodes), undoable via
# EditorUndoRedoManager and ungated (the node_* model). theme_* author a Theme resource (or its
# entries) on disk via ResourceSaver and are host-gated file-writers like resource_* / shader_create.
# Control anchors / set_anchors_and_offsets_preset / size flags / theme and Theme.set_color /
# set_font / set_stylebox / set_constant were probed live on Godot 4.7 before design.

func _control_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var type := String(params.get("type", "Control"))
	if not ClassDB.can_instantiate(type):
		return _err("bad_type", "Cannot instantiate class: %s" % type)
	if not ClassDB.is_parent_class(type, "Control"):
		return _err("bad_type", "%s is not a Control subclass" % type)
	var node: Node = ClassDB.instantiate(type)
	node.name = String(params.get("name", type))
	if params.has("text") and _has_property(node, "text"):
		node.set("text", String(params.get("text")))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": type})


func _container_add_child(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("container_path", "")))
	if parent == null:
		return _err("bad_path", "Container not found: %s" % params.get("container_path", ""))
	if not (parent is Container):
		return _err("bad_type", "%s is not a Container" % parent.name)
	var type := String(params.get("type", "Control"))
	if not ClassDB.can_instantiate(type):
		return _err("bad_type", "Cannot instantiate class: %s" % type)
	if not ClassDB.is_parent_class(type, "Control"):
		return _err("bad_type", "%s is not a Control subclass" % type)
	var node: Node = ClassDB.instantiate(type)
	node.name = String(params.get("name", type))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s to container" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": type, "container": _path_of(root, parent)})


func _control_set_anchors(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not (node is Control):
		return _err("bad_type", "%s is not a Control" % node.name)
	var ctrl := node as Control
	var sides := {"left": "anchor_left", "top": "anchor_top", "right": "anchor_right", "bottom": "anchor_bottom"}
	var changed := []
	for k in sides:
		if params.has(k):
			changed.append(k)
	if changed.is_empty():
		return _err("bad_params", "Provide at least one of left/top/right/bottom")
	var olds := {}
	for k in changed:
		olds[k] = ctrl.get(sides[k])
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s anchors" % ctrl.name)
	for k in changed:
		var prop: String = sides[k]
		ur.add_do_property(ctrl, prop, float(params.get(k)))
		ur.add_undo_property(ctrl, prop, olds[k])
	ur.commit_action()
	return _ok({
		"path": _path_of(root, ctrl),
		"anchors": {
			"left": ctrl.anchor_left,
			"top": ctrl.anchor_top,
			"right": ctrl.anchor_right,
			"bottom": ctrl.anchor_bottom,
		},
	})


func _control_set_layout_preset(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not (node is Control):
		return _err("bad_type", "%s is not a Control" % node.name)
	var ctrl := node as Control
	var preset := _layout_preset(params.get("preset"))
	if preset < 0:
		return _err("bad_params", "Unknown layout preset: %s" % params.get("preset"))
	var resize_mode := int(params.get("resize_mode", 0))
	var margin := int(params.get("margin", 0))
	var props := ["anchor_left", "anchor_top", "anchor_right", "anchor_bottom", "offset_left", "offset_top", "offset_right", "offset_bottom"]
	var olds := {}
	for p in props:
		olds[p] = ctrl.get(p)
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: layout preset on %s" % ctrl.name)
	ur.add_do_method(ctrl, "set_anchors_and_offsets_preset", preset, resize_mode, margin)
	for p in props:
		ur.add_undo_property(ctrl, p, olds[p])
	ur.commit_action()
	return _ok({"path": _path_of(root, ctrl), "preset": preset, "preset_name": _layout_preset_name(preset)})


func _control_set_size_flags(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not (node is Control):
		return _err("bad_type", "%s is not a Control" % node.name)
	var ctrl := node as Control
	if not (params.has("horizontal") or params.has("vertical") or params.has("stretch_ratio")):
		return _err("bad_params", "Provide at least one of horizontal/vertical/stretch_ratio")
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s size flags" % ctrl.name)
	if params.has("horizontal"):
		var h_old := ctrl.size_flags_horizontal
		ur.add_do_property(ctrl, "size_flags_horizontal", int(params.get("horizontal")))
		ur.add_undo_property(ctrl, "size_flags_horizontal", h_old)
	if params.has("vertical"):
		var v_old := ctrl.size_flags_vertical
		ur.add_do_property(ctrl, "size_flags_vertical", int(params.get("vertical")))
		ur.add_undo_property(ctrl, "size_flags_vertical", v_old)
	if params.has("stretch_ratio"):
		var r_old := ctrl.size_flags_stretch_ratio
		ur.add_do_property(ctrl, "size_flags_stretch_ratio", float(params.get("stretch_ratio")))
		ur.add_undo_property(ctrl, "size_flags_stretch_ratio", r_old)
	ur.commit_action()
	return _ok({"path": _path_of(root, ctrl), "horizontal": ctrl.size_flags_horizontal, "vertical": ctrl.size_flags_vertical, "stretch_ratio": ctrl.size_flags_stretch_ratio})


func _control_set_theme(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not (node is Control):
		return _err("bad_type", "%s is not a Control" % node.name)
	var ctrl := node as Control
	var theme_path := String(params.get("theme_path", ""))
	var theme_res: Theme = null
	if theme_path != "":
		if not ResourceLoader.exists(theme_path):
			return _err("not_found", "Theme not found: %s" % theme_path)
		var res = ResourceLoader.load(theme_path)
		if not (res is Theme):
			return _err("bad_type", "%s is not a Theme" % theme_path)
		theme_res = res as Theme
	var old_theme = ctrl.get("theme")
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s theme" % ctrl.name)
	ur.add_do_property(ctrl, "theme", theme_res)
	ur.add_undo_property(ctrl, "theme", old_theme)
	if theme_res != null:
		ur.add_do_reference(theme_res)
	ur.commit_action()
	return _ok({"path": _path_of(root, ctrl), "theme_path": theme_path})


func _theme_create(params: Dictionary) -> Dictionary:
	var to_path := String(params.get("to_path", ""))
	if not to_path.begins_with("res://"):
		return _err("bad_params", "'to_path' must be a res:// path")
	var theme := Theme.new()
	var e := ResourceSaver.save(theme, to_path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"created": to_path, "type": "Theme"})


func _theme_set_color(params: Dictionary) -> Dictionary:
	var path := String(params.get("path", ""))
	var theme = _theme_load(path)
	if theme == null:
		return _err("not_found", "Theme not found or not a Theme: %s" % path)
	var iname := String(params.get("name", ""))
	var ttype := String(params.get("theme_type", ""))
	if iname == "" or ttype == "":
		return _err("bad_params", "Missing 'name' or 'theme_type'")
	var col := _to_color(params.get("color"))
	theme.set_color(iname, ttype, col)
	var e := ResourceSaver.save(theme, path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"path": path, "name": iname, "theme_type": ttype, "color": [col.r, col.g, col.b, col.a]})


func _theme_set_font(params: Dictionary) -> Dictionary:
	var path := String(params.get("path", ""))
	var theme = _theme_load(path)
	if theme == null:
		return _err("not_found", "Theme not found or not a Theme: %s" % path)
	var iname := String(params.get("name", ""))
	var ttype := String(params.get("theme_type", ""))
	if iname == "" or ttype == "":
		return _err("bad_params", "Missing 'name' or 'theme_type'")
	var font_path := String(params.get("font_path", ""))
	if not ResourceLoader.exists(font_path):
		return _err("not_found", "Font not found: %s" % font_path)
	var fres = ResourceLoader.load(font_path)
	if not (fres is Font):
		return _err("bad_type", "%s is not a Font" % font_path)
	theme.set_font(iname, ttype, fres as Font)
	var e := ResourceSaver.save(theme, path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"path": path, "name": iname, "theme_type": ttype, "font_path": font_path})


func _theme_set_stylebox(params: Dictionary) -> Dictionary:
	var path := String(params.get("path", ""))
	var theme = _theme_load(path)
	if theme == null:
		return _err("not_found", "Theme not found or not a Theme: %s" % path)
	var iname := String(params.get("name", ""))
	var ttype := String(params.get("theme_type", ""))
	if iname == "" or ttype == "":
		return _err("bad_params", "Missing 'name' or 'theme_type'")
	var sb_path := String(params.get("stylebox_path", ""))
	if not ResourceLoader.exists(sb_path):
		return _err("not_found", "StyleBox not found: %s" % sb_path)
	var sres = ResourceLoader.load(sb_path)
	if not (sres is StyleBox):
		return _err("bad_type", "%s is not a StyleBox" % sb_path)
	theme.set_stylebox(iname, ttype, sres as StyleBox)
	var e := ResourceSaver.save(theme, path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"path": path, "name": iname, "theme_type": ttype, "stylebox_path": sb_path})


func _theme_set_constant(params: Dictionary) -> Dictionary:
	var path := String(params.get("path", ""))
	var theme = _theme_load(path)
	if theme == null:
		return _err("not_found", "Theme not found or not a Theme: %s" % path)
	var iname := String(params.get("name", ""))
	var ttype := String(params.get("theme_type", ""))
	if iname == "" or ttype == "":
		return _err("bad_params", "Missing 'name' or 'theme_type'")
	if not params.has("value"):
		return _err("bad_params", "Missing 'value'")
	var val := int(params.get("value"))
	theme.set_constant(iname, ttype, val)
	var e := ResourceSaver.save(theme, path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"path": path, "name": iname, "theme_type": ttype, "value": val})


func _theme_load(path: String):
	if not ResourceLoader.exists(path):
		return null
	var res = ResourceLoader.load(path)
	if res is Theme:
		return res
	return null


func _has_property(obj: Object, prop: String) -> bool:
	for p in obj.get_property_list():
		if String(p.get("name", "")) == prop:
			return true
	return false


func _layout_preset_names() -> Dictionary:
	return {
		"top_left": Control.PRESET_TOP_LEFT,
		"top_right": Control.PRESET_TOP_RIGHT,
		"bottom_left": Control.PRESET_BOTTOM_LEFT,
		"bottom_right": Control.PRESET_BOTTOM_RIGHT,
		"center_left": Control.PRESET_CENTER_LEFT,
		"center_top": Control.PRESET_CENTER_TOP,
		"center_right": Control.PRESET_CENTER_RIGHT,
		"center_bottom": Control.PRESET_CENTER_BOTTOM,
		"center": Control.PRESET_CENTER,
		"left_wide": Control.PRESET_LEFT_WIDE,
		"top_wide": Control.PRESET_TOP_WIDE,
		"right_wide": Control.PRESET_RIGHT_WIDE,
		"bottom_wide": Control.PRESET_BOTTOM_WIDE,
		"vcenter_wide": Control.PRESET_VCENTER_WIDE,
		"hcenter_wide": Control.PRESET_HCENTER_WIDE,
		"full_rect": Control.PRESET_FULL_RECT,
	}


func _layout_preset(v) -> int:
	if v is String:
		var names := _layout_preset_names()
		var key := String(v).to_lower()
		if names.has(key):
			return int(names[key])
		return -1
	if v is float or v is int:
		var iv := int(v)
		if iv >= 0 and iv <= 15:
			return iv
		return -1
	return -1


func _layout_preset_name(preset: int) -> String:
	var names := _layout_preset_names()
	for k in names:
		if int(names[k]) == preset:
			return k
	return str(preset)


# ---------------------------------------------------------------- Group H: 3D & navigation ----
# meshinstance / mesh / light / camera / csg / navregion / navagent tools mutate the edited scene
# (3D nodes), undoable via EditorUndoRedoManager and ungated (the node_* model). primitive_mesh /
# environment author a resource on disk via ResourceSaver and are host-gated file-writers like
# resource_* / theme_create. Mesh / Light3D / Camera3D / CSG / NavigationRegion3D /
# NavigationAgent3D and the PrimitiveMesh / Environment / Sky APIs were probed live on Godot 4.7.

func _meshinstance_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var mesh_path := String(params.get("mesh_path", ""))
	var mesh_res: Mesh = null
	if mesh_path != "":
		if not ResourceLoader.exists(mesh_path):
			return _err("not_found", "Mesh not found: %s" % mesh_path)
		var res = ResourceLoader.load(mesh_path)
		if not (res is Mesh):
			return _err("bad_type", "%s is not a Mesh" % mesh_path)
		mesh_res = res as Mesh
	var node := MeshInstance3D.new()
	node.name = String(params.get("name", "MeshInstance3D"))
	if mesh_res != null:
		node.mesh = mesh_res
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": "MeshInstance3D", "mesh_path": mesh_path})


func _mesh_set_surface_material(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var node := _resolve(root, String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	if not (node is MeshInstance3D):
		return _err("bad_type", "%s is not a MeshInstance3D" % node.name)
	var mi := node as MeshInstance3D
	var material_path := String(params.get("material_path", ""))
	if material_path == "":
		return _err("bad_params", "Missing 'material_path'")
	if not ResourceLoader.exists(material_path):
		return _err("not_found", "Material not found: %s" % material_path)
	var mres = ResourceLoader.load(material_path)
	if not (mres is Material):
		return _err("bad_type", "%s is not a Material" % material_path)
	var mat := mres as Material
	var surface := int(params.get("surface", -1))
	if surface >= 0:
		var count := mi.get_surface_override_material_count()
		if surface >= count:
			return _err("bad_params", "surface %d out of range (0..%d)" % [surface, count - 1])
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: set %s material" % mi.name)
	if surface < 0:
		var old_mat = mi.material_override
		ur.add_do_property(mi, "material_override", mat)
		ur.add_undo_property(mi, "material_override", old_mat)
	else:
		var old_sm = mi.get_surface_override_material(surface)
		ur.add_do_method(mi, "set_surface_override_material", surface, mat)
		ur.add_undo_method(mi, "set_surface_override_material", surface, old_sm)
	ur.add_do_reference(mat)
	ur.commit_action()
	return _ok({"path": _path_of(root, mi), "material_path": material_path, "surface": surface})


func _primitive_mesh_create(params: Dictionary) -> Dictionary:
	var to_path := String(params.get("to_path", ""))
	if not to_path.begins_with("res://"):
		return _err("bad_params", "'to_path' must be a res:// path")
	var shape := String(params.get("shape", "box")).to_lower()
	var classes := {"box": "BoxMesh", "sphere": "SphereMesh", "cylinder": "CylinderMesh", "plane": "PlaneMesh", "capsule": "CapsuleMesh", "prism": "PrismMesh", "torus": "TorusMesh", "quad": "QuadMesh"}
	if not classes.has(shape):
		return _err("bad_params", "Unknown primitive shape: %s (box/sphere/cylinder/plane/capsule/prism/torus/quad)" % shape)
	var cls := String(classes[shape])
	var mesh: Mesh = ClassDB.instantiate(cls)
	if mesh == null:
		return _err("create_failed", "Could not instantiate %s" % cls)
	var e := ResourceSaver.save(mesh, to_path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"created": to_path, "type": cls, "shape": shape})


func _light_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var kind := String(params.get("kind", "omni")).to_lower()
	var classes := {"dir": "DirectionalLight3D", "directional": "DirectionalLight3D", "omni": "OmniLight3D", "spot": "SpotLight3D"}
	if not classes.has(kind):
		return _err("bad_params", "Unknown light kind: %s (use dir/omni/spot)" % kind)
	var cls := String(classes[kind])
	var node: Node = ClassDB.instantiate(cls)
	node.name = String(params.get("name", cls))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": cls, "kind": kind})


func _camera_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var node := Camera3D.new()
	node.name = String(params.get("name", "Camera3D"))
	if bool(params.get("current", false)):
		node.current = true
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": "Camera3D", "current": node.current})


func _environment_create(params: Dictionary) -> Dictionary:
	var to_path := String(params.get("to_path", ""))
	if not to_path.begins_with("res://"):
		return _err("bad_params", "'to_path' must be a res:// path")
	var bg := String(params.get("background", "clear_color")).to_lower()
	var modes := {"clear_color": Environment.BG_CLEAR_COLOR, "color": Environment.BG_COLOR, "sky": Environment.BG_SKY, "canvas": Environment.BG_CANVAS}
	if not modes.has(bg):
		return _err("bad_params", "Unknown background: %s (clear_color/color/sky/canvas)" % bg)
	var env := Environment.new()
	env.background_mode = int(modes[bg])
	if params.has("ambient_color"):
		env.ambient_light_color = _to_color(params.get("ambient_color"))
	var e := ResourceSaver.save(env, to_path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"created": to_path, "type": "Environment", "background_mode": bg})


func _environment_set_sky(params: Dictionary) -> Dictionary:
	var path := String(params.get("path", ""))
	if not ResourceLoader.exists(path):
		return _err("not_found", "Environment not found: %s" % path)
	var res = ResourceLoader.load(path)
	if not (res is Environment):
		return _err("bad_type", "%s is not an Environment" % path)
	var env := res as Environment
	var mat_kind := String(params.get("sky_material", "procedural")).to_lower()
	var sky := Sky.new()
	match mat_kind:
		"procedural":
			sky.sky_material = ProceduralSkyMaterial.new()
		"physical":
			sky.sky_material = PhysicalSkyMaterial.new()
		"panorama":
			sky.sky_material = PanoramaSkyMaterial.new()
		_:
			return _err("bad_params", "Unknown sky_material: %s (procedural/physical/panorama)" % mat_kind)
	env.sky = sky
	env.background_mode = Environment.BG_SKY
	var e := ResourceSaver.save(env, path)
	if e != OK:
		return _err("save_failed", "ResourceSaver.save() returned %d" % e)
	return _ok({"path": path, "background_mode": "sky", "sky_material": mat_kind})


func _csg_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var shape := String(params.get("shape", "box")).to_lower()
	var classes := {"box": "CSGBox3D", "sphere": "CSGSphere3D", "cylinder": "CSGCylinder3D", "torus": "CSGTorus3D", "polygon": "CSGPolygon3D", "mesh": "CSGMesh3D", "combiner": "CSGCombiner3D"}
	if not classes.has(shape):
		return _err("bad_params", "Unknown CSG shape: %s (box/sphere/cylinder/torus/polygon/mesh/combiner)" % shape)
	var cls := String(classes[shape])
	if not ClassDB.can_instantiate(cls):
		return _err("bad_type", "Cannot instantiate class: %s" % cls)
	var node: Node = ClassDB.instantiate(cls)
	node.name = String(params.get("name", cls))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": cls, "shape": shape})


func _navregion_create(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var node := NavigationRegion3D.new()
	node.name = String(params.get("name", "NavigationRegion3D"))
	if bool(params.get("with_navmesh", true)):
		node.navigation_mesh = NavigationMesh.new()
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": "NavigationRegion3D", "has_navmesh": node.navigation_mesh != null})


func _navagent_configure(params: Dictionary) -> Dictionary:
	var root := _edited_root()
	if root == null:
		return _err("no_scene", "No scene is open")
	var parent := _resolve(root, String(params.get("parent_path", "")))
	if parent == null:
		return _err("bad_path", "Parent not found: %s" % params.get("parent_path", ""))
	var node := NavigationAgent3D.new()
	node.name = String(params.get("name", "NavigationAgent3D"))
	if params.has("radius"):
		node.radius = float(params.get("radius"))
	if params.has("height"):
		node.height = float(params.get("height"))
	if params.has("max_speed"):
		node.max_speed = float(params.get("max_speed"))
	if params.has("path_desired_distance"):
		node.path_desired_distance = float(params.get("path_desired_distance"))
	if params.has("target_desired_distance"):
		node.target_desired_distance = float(params.get("target_desired_distance"))
	if params.has("avoidance_enabled"):
		node.avoidance_enabled = bool(params.get("avoidance_enabled"))
	var ur := _plugin.get_undo_redo()
	ur.create_action("Claude: add %s" % node.name)
	ur.add_do_method(parent, "add_child", node)
	ur.add_do_method(node, "set_owner", root)
	ur.add_do_reference(node)
	ur.add_undo_method(parent, "remove_child", node)
	ur.commit_action()
	return _ok({"path": _path_of(root, node), "name": String(node.name), "type": "NavigationAgent3D", "config": {"radius": node.radius, "height": node.height, "max_speed": node.max_speed, "path_desired_distance": node.path_desired_distance, "target_desired_distance": node.target_desired_distance, "avoidance_enabled": node.avoidance_enabled}})
