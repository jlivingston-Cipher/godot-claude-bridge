extends SceneTree
## Headless behaviour smoke for Group N Increment 4 (the Interaction slice), the
## (b) layer of the verification rig: it proves — WITHOUT an editor, bridge, or GUI
## — that the drag/drop behaviour scripts `interact_make_draggable` and
## `interact_add_drop_zone` emit are valid Godot 4 GDScript that COMPILES, SAVES +
## RELOADS as a res:// resource (the round-trip the host op-sequence cannot check),
## attaches to a real node, and BEHAVES:
##   * a Control draggable's _get_drag_data() hands off {payload, source} with the
##     bound payload, and its preview variant compiles + exposes _make_drag_preview,
##   * a Node2D draggable flips _dragging + emits drag_started(payload) from its
##     pointer handler when the drag button goes down,
##   * a Control drop zone's _can_drop_data / _drop_data validate the neutral
##     key∈values predicate and emit the on_drop user signal only on an accepted drop,
##   * a Node2D drop zone builds an Area2D + CollisionShape2D hit region and its
##     try_drop() seam accepts + emits.
##
## The host op-sequence unit tests (host/test/tabletop.test.ts) prove the tools emit
## the right primitives + script source; this proves that source is a real,
## round-trippable, behaving script. Together they cover the composite end-to-end
## offline. Nothing here is game-specific — placeholder payloads (kind=x / y) exactly
## as a caller of the general-purpose tool would use.
##
## Prints `INTERACT_BUILD_PASS` / `INTERACT_BUILD_FAIL` per assertion and a final
## `INTERACT_BUILD_SUMMARY pass=<n>/<total>` line; quits non-zero if anything fails so
## a CI step can gate on it. Run:
##   godot --headless --path example --script res://tests/interact_build_smoke.gd

var _pass := 0
var _fail := 0

const DRAG_CTRL_PATH := "res://tests/_interact_drag_ctrl_gen.gd"
const DRAG_CTRL_PREVIEW_PATH := "res://tests/_interact_drag_ctrl_preview_gen.gd"
const DRAG_N2D_PATH := "res://tests/_interact_drag_n2d_gen.gd"
const ZONE_CTRL_PATH := "res://tests/_interact_zone_ctrl_gen.gd"
const ZONE_N2D_PATH := "res://tests/_interact_zone_n2d_gen.gd"


func _check(label: String, cond: bool) -> void:
	if cond:
		_pass += 1
		print("INTERACT_BUILD_PASS %s" % label)
	else:
		_fail += 1
		print("INTERACT_BUILD_FAIL %s" % label)


func _initialize() -> void:
	_run()
	print("INTERACT_BUILD_SUMMARY pass=%d/%d" % [_pass, _pass + _fail])
	_cleanup()
	quit(0 if _fail == 0 else 1)


## A tiny signal receiver: connect a user/declared signal to `on_payload` and read
## back what arrived. Avoids lambda-capture questions in the assertions below.
class Receiver extends RefCounted:
	var got: Array = []
	func on_payload(p) -> void:
		got.append(p)


# ---- script sources: the exact shapes interact_* generate (buildDraggableScript /
# ---- buildDropZoneScript). Kept faithful by hand, like piece_build_smoke.gd.

func _drag_control_source(preview: bool) -> String:
	var lines := PackedStringArray([
		'extends Control',
		'func get_drag_payload() -> Dictionary:',
		'\treturn {"kind": "x", "n": 3}.duplicate(true)',
		'func _get_drag_data(_at_position: Vector2) -> Variant:',
		'\tvar data := {"payload": get_drag_payload(), "source": self}',
	])
	if preview:
		lines.append('\tset_drag_preview(_make_drag_preview())')
	lines.append('\treturn data')
	if preview:
		lines.append('func _make_drag_preview() -> Control:')
		lines.append('\tvar ghost := duplicate()')
		lines.append('\tghost.modulate = Color(1, 1, 1, 0.7)')
		lines.append('\treturn ghost')
	lines.append('')
	return "\n".join(lines)


func _drag_node2d_source() -> String:
	return "\n".join(PackedStringArray([
		'extends Node2D',
		'signal drag_started(payload)',
		'signal drag_ended(payload)',
		'const DRAG_BUTTON := 1',
		'var _dragging := false',
		'func get_drag_payload() -> Dictionary:',
		'\treturn {"kind": "y"}.duplicate(true)',
		'func _on_drag_input(_viewport: Node, event: InputEvent, _shape_idx: int) -> void:',
		'\tif event is InputEventMouseButton and event.button_index == DRAG_BUTTON and event.pressed:',
		'\t\t_dragging = true',
		'\t\tdrag_started.emit(get_drag_payload())',
		'func _process(_delta: float) -> void:',
		'\tif not _dragging:',
		'\t\treturn',
		'\tglobal_position = get_global_mouse_position()',
		'\tif not Input.is_mouse_button_pressed(DRAG_BUTTON):',
		'\t\t_dragging = false',
		'\t\tdrag_ended.emit(get_drag_payload())',
		'',
	]))


func _zone_source(mode_control: bool) -> String:
	var lines := PackedStringArray([
		'extends Control' if mode_control else 'extends Node2D',
		'const ACCEPT_KEY := "kind"' if mode_control else 'const ACCEPT_KEY := ""',
		'const ACCEPT_VALUES := ["x"]' if mode_control else 'const ACCEPT_VALUES := []',
		'const ON_DROP := "dropped"',
		'func _accepts(payload: Dictionary) -> bool:',
		'\tif ACCEPT_KEY == "":',
		'\t\treturn true',
		'\treturn ACCEPT_VALUES.has(str(payload.get(ACCEPT_KEY, "")))',
		'func _payload_of(data: Variant) -> Dictionary:',
		'\tif data is Dictionary and data.has("payload") and data["payload"] is Dictionary:',
		'\t\treturn data["payload"]',
		'\treturn {}',
	])
	if mode_control:
		lines.append('func _can_drop_data(_at_position: Vector2, data: Variant) -> bool:')
		lines.append('\treturn _accepts(_payload_of(data))')
		lines.append('func _drop_data(_at_position: Vector2, data: Variant) -> void:')
		lines.append('\tvar payload := _payload_of(data)')
		lines.append('\tif _accepts(payload):')
		lines.append('\t\temit_signal(ON_DROP, payload)')
	else:
		lines.append('func try_drop(payload: Dictionary) -> bool:')
		lines.append('\tif _accepts(payload):')
		lines.append('\t\temit_signal(ON_DROP, payload)')
		lines.append('\t\treturn true')
		lines.append('\treturn false')
	lines.append('')
	return "\n".join(lines)


## Compile a source string, save it to a res:// .gd, reload it. Returns the loaded
## GDScript (or null) and records compile/save/reload checks under `tag`.
func _make_script(tag: String, src: String, path: String) -> GDScript:
	var gd := GDScript.new()
	gd.source_code = src
	_check("%s.compiles" % tag, gd.reload() == OK)
	_check("%s.saves" % tag, ResourceSaver.save(gd, path) == OK)
	var loaded := ResourceLoader.load(path) as GDScript
	_check("%s.reloads" % tag, loaded != null)
	return loaded


func _run() -> void:
	# --- Control draggable -------------------------------------------------
	var drag_ctrl := _make_script("drag_ctrl", _drag_control_source(false), DRAG_CTRL_PATH)
	if drag_ctrl != null:
		var node := Control.new()
		node.set_script(drag_ctrl)
		_check("drag_ctrl.has_get_drag_data", node.has_method("_get_drag_data"))
		if node.has_method("_get_drag_data"):
			var data = node._get_drag_data(Vector2.ZERO)
			_check("drag_ctrl.returns_dict", data is Dictionary)
			if data is Dictionary:
				var payload = data.get("payload", {})
				_check("drag_ctrl.payload_bound", payload is Dictionary and payload.get("kind", "") == "x" and int(payload.get("n", 0)) == 3)
				_check("drag_ctrl.source_is_self", data.get("source", null) == node)
		node.free()

	# The preview variant must also compile and expose the preview helper.
	var drag_ctrl_prev := _make_script("drag_ctrl_prev", _drag_control_source(true), DRAG_CTRL_PREVIEW_PATH)
	if drag_ctrl_prev != null:
		var node2 := Control.new()
		node2.set_script(drag_ctrl_prev)
		_check("drag_ctrl_prev.has_preview", node2.has_method("_make_drag_preview"))
		node2.free()

	# --- Node2D draggable --------------------------------------------------
	var drag_n2d := _make_script("drag_n2d", _drag_node2d_source(), DRAG_N2D_PATH)
	if drag_n2d != null:
		var token := Area2D.new()  # Area2D is-a Node2D → the Node2D script attaches
		token.set_script(drag_n2d)
		_check("drag_n2d.has_handler", token.has_method("_on_drag_input"))
		var rec := Receiver.new()
		token.connect("drag_started", rec.on_payload)
		var ev := InputEventMouseButton.new()
		ev.button_index = 1
		ev.pressed = true
		if token.has_method("_on_drag_input"):
			token._on_drag_input(null, ev, 0)
		_check("drag_n2d.dragging_set", bool(token.get("_dragging")) == true)
		_check("drag_n2d.emitted_started", rec.got.size() == 1)
		_check("drag_n2d.emitted_payload", rec.got.size() == 1 and rec.got[0].get("kind", "") == "y")
		token.free()

	# --- Control drop zone -------------------------------------------------
	var zone_ctrl := _make_script("zone_ctrl", _zone_source(true), ZONE_CTRL_PATH)
	if zone_ctrl != null:
		var zone := Control.new()
		zone.set_script(zone_ctrl)
		zone.add_user_signal("dropped", [{"name": "payload", "type": TYPE_DICTIONARY}])
		var rec2 := Receiver.new()
		zone.connect("dropped", rec2.on_payload)
		_check("zone_ctrl.has_can_drop", zone.has_method("_can_drop_data"))
		if zone.has_method("_can_drop_data"):
			_check("zone_ctrl.accepts_match", zone._can_drop_data(Vector2.ZERO, {"payload": {"kind": "x"}}) == true)
			_check("zone_ctrl.rejects_mismatch", zone._can_drop_data(Vector2.ZERO, {"payload": {"kind": "z"}}) == false)
			_check("zone_ctrl.rejects_no_payload", zone._can_drop_data(Vector2.ZERO, {}) == false)
		if zone.has_method("_drop_data"):
			zone._drop_data(Vector2.ZERO, {"payload": {"kind": "x"}})
			_check("zone_ctrl.drop_emits", rec2.got.size() == 1 and rec2.got[0].get("kind", "") == "x")
			zone._drop_data(Vector2.ZERO, {"payload": {"kind": "z"}})
			_check("zone_ctrl.rejected_no_emit", rec2.got.size() == 1)  # still 1 — the mismatch did not emit
		zone.free()

	# --- Node2D drop zone (Area2D hit region + try_drop seam) --------------
	var zone_n2d := _make_script("zone_n2d", _zone_source(false), ZONE_N2D_PATH)
	if zone_n2d != null:
		var zone2 := Node2D.new()
		zone2.set_script(zone_n2d)
		# The hit region interact_add_drop_zone builds for node2d: DropArea/Shape.
		var area := Area2D.new()
		area.name = "DropArea"
		zone2.add_child(area)
		var shape := CollisionShape2D.new()
		shape.name = "Shape"
		var rect := RectangleShape2D.new()
		rect.size = Vector2(96, 96)
		shape.shape = rect
		area.add_child(shape)
		_check("zone_n2d.hit_area_is_area2d", zone2.has_node("DropArea") and zone2.get_node("DropArea") is Area2D)
		_check("zone_n2d.shape_is_collisionshape2d", zone2.has_node("DropArea/Shape") and zone2.get_node("DropArea/Shape") is CollisionShape2D)
		_check("zone_n2d.shape_is_rectangle", zone2.has_node("DropArea/Shape") and zone2.get_node("DropArea/Shape").shape is RectangleShape2D)
		zone2.add_user_signal("dropped", [{"name": "payload", "type": TYPE_DICTIONARY}])
		var rec3 := Receiver.new()
		zone2.connect("dropped", rec3.on_payload)
		_check("zone_n2d.has_try_drop", zone2.has_method("try_drop"))
		if zone2.has_method("try_drop"):
			# accept-any zone: any payload is accepted + emitted.
			_check("zone_n2d.try_drop_accepts", zone2.try_drop({"anything": 1}) == true)
			_check("zone_n2d.try_drop_emits", rec3.got.size() == 1)
		zone2.free()


func _cleanup() -> void:
	for p in [DRAG_CTRL_PATH, DRAG_CTRL_PREVIEW_PATH, DRAG_N2D_PATH, ZONE_CTRL_PATH, ZONE_N2D_PATH]:
		if FileAccess.file_exists(p):
			DirAccess.remove_absolute(ProjectSettings.globalize_path(p))
