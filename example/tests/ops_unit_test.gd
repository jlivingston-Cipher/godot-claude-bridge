extends SceneTree
## Headless unit tests for the PURE, editor-independent logic in the Breakpoint
## MCP addon — the parts a real editor is NOT needed to exercise:
##   * the Variant <-> JSON codec (variant_json.gd), including the tagged-object
##     branches (Object/Resource/Unsupported/packed arrays) and decode fallbacks,
##   * the pure helpers in operations.gd: the {ok}/{err} envelope, node-path
##     resolution (_resolve/_path_of), SceneTree serialization (_serialize_node,
##     _descendants), the doc-URL / type-name helpers, _resource_class_ok, and _ping,
##   * the pure helpers in runtime_bridge.gd exercised WITHOUT entering the tree
##     (so no TCP socket opens): the {ok}/{err} envelope, _dispatch's ping /
##     unknown-method paths, _get_monitors key filtering, the CLAUDE_*→BREAKPOINT_*
##     env-compat shim (_env_compat), and the push_log / _get_log ring buffer.
##
## The editor-COUPLED handlers (every mutator that drives EditorInterface /
## EditorUndoRedoManager) are already covered end-to-end by the authoring-plane
## integration probe. This suite needs no editor, no bridge, and no GUI — just
## `godot --headless --path example --script res://tests/ops_unit_test.gd`.
##
## Prints `OPS_UNIT_PASS` / `OPS_UNIT_FAIL` per assertion and a final
## `OPS_UNIT_SUMMARY pass=<n>/<total>` line, and quits non-zero if anything fails
## so a CI step can gate on it.

const Ops := preload("res://addons/breakpoint_mcp/operations.gd")
const Codec := preload("res://addons/breakpoint_mcp/variant_json.gd")
const RB := preload("res://addons/breakpoint_mcp/runtime_bridge.gd")

var _pass := 0
var _fail := 0


func _initialize() -> void:
	var ops = Ops.new()  # untyped: only editor-free helpers are called (no setup(plugin))
	_test_codec()
	_test_codec_edges()
	_test_envelope(ops)
	_test_resolve_and_path(ops)
	_test_serialize(ops)
	_test_descendants(ops)
	_test_doc_helpers(ops)
	_test_resource_class_ok(ops)
	_test_ping(ops)
	_test_runtime_envelope_and_dispatch()
	_test_runtime_env_compat()
	_test_runtime_log()
	print("OPS_UNIT_SUMMARY pass=%d/%d" % [_pass, _pass + _fail])
	quit(0 if _fail == 0 else 1)


func _check(label: String, cond: bool) -> void:
	if cond:
		_pass += 1
		print("OPS_UNIT_PASS %s" % label)
	else:
		_fail += 1
		print("OPS_UNIT_FAIL %s" % label)


func _eq(label: String, got: Variant, want: Variant) -> void:
	_check("%s (got=%s want=%s)" % [label, str(got), str(want)], got == want)


func _roundtrip(label: String, v: Variant) -> void:
	_eq("codec.roundtrip.%s" % label, Codec.decode(Codec.encode(v)), v)


# --- variant_json.gd -------------------------------------------------------
func _test_codec() -> void:
	# scalars pass straight through
	_eq("codec.int", Codec.encode(42), 42)
	_eq("codec.float", Codec.encode(1.5), 1.5)
	_eq("codec.bool", Codec.encode(true), true)
	_eq("codec.string", Codec.encode("hi"), "hi")
	_eq("codec.null", Codec.encode(null), null)
	_eq("codec.stringname", Codec.encode(&"foo"), "foo")
	# rich types encode to a tagged object
	var v3e: Variant = Codec.encode(Vector3(1, 2, 3))
	_eq("codec.vec3.tag", v3e.get("__type__"), "Vector3")
	_eq("codec.vec3.x", v3e.get("x"), 1)
	# lossless round-trips (values chosen to be exact in float32)
	_roundtrip("vec2", Vector2(3, 4))
	_roundtrip("vec2i", Vector2i(3, 4))
	_roundtrip("vec3", Vector3(1, 2, 3))
	_roundtrip("vec3i", Vector3i(1, 2, 3))
	_roundtrip("vec4", Vector4(1, 2, 3, 4))
	_roundtrip("color", Color(0.5, 0.25, 0.75, 1.0))
	_roundtrip("rect2", Rect2(1, 2, 3, 4))
	_roundtrip("quat", Quaternion(0, 0, 0, 1))
	_roundtrip("nodepath", NodePath("Player/Sprite2D"))
	# nested containers recurse
	var dec: Variant = Codec.decode(Codec.encode({"pos": Vector2(5, 6), "tags": [Vector2i(1, 1), "x"]}))
	_eq("codec.nested.pos", dec["pos"], Vector2(5, 6))
	_eq("codec.nested.tags0", dec["tags"][0], Vector2i(1, 1))
	_eq("codec.nested.tags1", dec["tags"][1], "x")


# --- operations.gd envelope ------------------------------------------------
func _test_envelope(ops) -> void:
	var okd: Dictionary = ops._ok({"a": 1})
	_eq("ok.ok", okd["ok"], true)
	_eq("ok.result", okd["result"]["a"], 1)
	var errd: Dictionary = ops._err("bad", "nope")
	_eq("err.ok", errd["ok"], false)
	_eq("err.code", errd["error"]["code"], "bad")
	_eq("err.msg", errd["error"]["message"], "nope")


# --- operations.gd node-path resolution ------------------------------------
func _test_resolve_and_path(ops) -> void:
	var root := Node.new()
	root.name = "Root"
	var player := Node.new()
	player.name = "Player"
	var sprite := Node.new()
	sprite.name = "Sprite2D"
	player.add_child(sprite)
	root.add_child(player)
	_check("resolve.empty->root", ops._resolve(root, "") == root)
	_check("resolve.dot->root", ops._resolve(root, ".") == root)
	_check("resolve.slashroot->root", ops._resolve(root, "/root") == root)
	_check("resolve.nested", ops._resolve(root, "Player/Sprite2D") == sprite)
	_check("resolve.missing->null", ops._resolve(root, "Nope") == null)
	_check("resolve.nullroot->null", ops._resolve(null, "x") == null)
	_eq("path.root", ops._path_of(root, root), ".")
	_eq("path.nested", ops._path_of(root, sprite), "Player/Sprite2D")
	root.free()


# --- operations.gd SceneTree serialization ---------------------------------
func _test_serialize(ops) -> void:
	var root := Node.new()
	root.name = "Root"
	var a := Node.new()
	a.name = "A"
	var a1 := Node.new()
	a1.name = "A1"
	var b := Node.new()
	b.name = "B"
	a.add_child(a1)
	root.add_child(a)
	root.add_child(b)
	var full: Dictionary = ops._serialize_node(root, root, 0, 64)
	_eq("ser.name", full["name"], "Root")
	_eq("ser.path", full["path"], ".")
	_eq("ser.child_count", full["child_count"], 2)
	_eq("ser.script_null", full["script"], null)
	_check("ser.has_children", full.has("children"))
	_eq("ser.children_len", (full["children"] as Array).size(), 2)
	var child_a: Dictionary = full["children"][0]
	_eq("ser.childA.name", child_a["name"], "A")
	_eq("ser.childA.path", child_a["path"], "A")
	_eq("ser.childA.child_count", child_a["child_count"], 1)
	_eq("ser.grandchild.path", child_a["children"][0]["path"], "A/A1")
	# max_depth truncation: at depth 0 with max_depth 0, children are omitted
	var shallow: Dictionary = ops._serialize_node(root, root, 0, 0)
	_check("ser.truncate.no_children_key", not shallow.has("children"))
	_eq("ser.truncate.child_count", shallow["child_count"], 2)
	root.free()


# --- operations.gd descendants ---------------------------------------------
func _test_descendants(ops) -> void:
	var root := Node.new()
	root.name = "Root"
	var a := Node.new()
	a.name = "A"
	var a1 := Node.new()
	a1.name = "A1"
	a.add_child(a1)
	root.add_child(a)
	_eq("descendants.count", (ops._descendants(root) as Array).size(), 2)
	root.free()


# --- operations.gd doc-URL / type-name helpers -----------------------------
func _test_doc_helpers(ops) -> void:
	_eq("type_name.class", ops._type_name({"class_name": "Sprite2D"}), "Sprite2D")
	_eq("type_name.nil", ops._type_name({"type": TYPE_NIL}), "Variant")
	_eq("type_name.int", ops._type_name({"type": TYPE_INT}), type_string(TYPE_INT))
	var base := "https://docs.godotengine.org/en/stable/classes/class_node.html"
	_eq("doc_url", ops._doc_url("Node"), base)
	_eq("doc_member_url", ops._doc_member_url("Node", "method", "add_child"), "%s#class-node-method-add-child" % base)
	_eq("doc_member_url.empty", ops._doc_member_url("Node", "method", ""), base)


# --- operations.gd _ping ---------------------------------------------------
func _test_ping(ops) -> void:
	var p: Dictionary = ops._ping()
	_eq("ping.pong", p["pong"], true)
	_eq("ping.version", p["addon_version"], Ops.ADDON_VERSION)
	_check("ping.godot_nonempty", String(p["godot"]) != "")


# --- variant_json.gd tagged-object + decode-fallback branches --------------
func _test_codec_edges() -> void:
	# non-Resource Object -> {__type__:"Object", class:<class>}
	var n := Node.new()
	var ne: Variant = Codec.encode(n)
	_eq("codec.object.tag", ne.get("__type__"), "Object")
	_eq("codec.object.class", ne.get("class"), "Node")
	n.free()
	# Resource -> {__type__:"Resource", class, path}
	var r := Resource.new()
	var re: Variant = Codec.encode(r)
	_eq("codec.resource.tag", re.get("__type__"), "Resource")
	_eq("codec.resource.class", re.get("class"), "Resource")
	_eq("codec.resource.path_empty", re.get("path"), "")
	# an unhandled Variant type -> {__type__:"Unsupported", repr, type_id}
	var ue: Variant = Codec.encode(Transform3D())
	_eq("codec.unsupported.tag", ue.get("__type__"), "Unsupported")
	_eq("codec.unsupported.type_id", ue.get("type_id"), TYPE_TRANSFORM3D)
	_check("codec.unsupported.has_repr", ue.has("repr"))
	# Rect2 tagged fields
	var r2: Variant = Codec.encode(Rect2(1, 2, 3, 4))
	_eq("codec.rect2.tag", r2.get("__type__"), "Rect2")
	_eq("codec.rect2.x", r2.get("x"), 1)
	_eq("codec.rect2.y", r2.get("y"), 2)
	_eq("codec.rect2.w", r2.get("w"), 3)
	_eq("codec.rect2.h", r2.get("h"), 4)
	# packed arrays encode element-wise to a plain JSON array
	var pi: Variant = Codec.encode(PackedInt32Array([1, 2, 3]))
	_check("codec.packed_int.is_array", pi is Array)
	_eq("codec.packed_int.vals", pi, [1, 2, 3])
	_eq("codec.packed_string.vals", Codec.encode(PackedStringArray(["a", "b"])), ["a", "b"])
	var pv: Variant = Codec.encode(PackedVector2Array([Vector2(1, 2)]))
	_eq("codec.packed_vec2.tag", pv[0].get("__type__"), "Vector2")
	_eq("codec.packed_vec2.x", pv[0].get("x"), 1)
	# decode fallbacks all resolve to null
	_check("codec.decode.unknown_tag_null", Codec.decode({"__type__": "Bogus"}) == null)
	_check("codec.decode.object_tag_null", Codec.decode({"__type__": "Object", "class": "Node"}) == null)
	_check("codec.decode.resource_missing_null", Codec.decode({"__type__": "Resource", "path": "res://__nope__.tres"}) == null)
	# decode defaults: Color alpha -> 1.0, Quaternion w -> 1.0
	_eq("codec.decode.color_default_a", Codec.decode({"__type__": "Color", "r": 0.5, "g": 0.25, "b": 0.75}), Color(0.5, 0.25, 0.75, 1.0))
	_eq("codec.decode.quat_default_w", Codec.decode({"__type__": "Quaternion"}), Quaternion(0, 0, 0, 1))
	# decode int-casts Vector2i / Vector3i components
	_eq("codec.decode.vec2i", Codec.decode({"__type__": "Vector2i", "x": 3, "y": 4}), Vector2i(3, 4))
	_eq("codec.decode.vec3i", Codec.decode({"__type__": "Vector3i", "x": 1, "y": 2, "z": 3}), Vector3i(1, 2, 3))


# --- operations.gd _resource_class_ok --------------------------------------
func _test_resource_class_ok(ops) -> void:
	_check("rclass.image_true", ops._resource_class_ok("Image") == true)
	_check("rclass.node_false", ops._resource_class_ok("Node") == false)
	_check("rclass.missing_false", ops._resource_class_ok("NotAClass_123") == false)


# --- runtime_bridge.gd envelope + dispatch (no tree, no socket) -------------
func _test_runtime_envelope_and_dispatch() -> void:
	var rb = RB.new()  # NOT added to the tree: _ready() never runs, so no TCP server opens
	var okd: Dictionary = rb._ok({"a": 1})
	_eq("rb.ok.ok", okd["ok"], true)
	_eq("rb.ok.result", okd["result"]["a"], 1)
	var errd: Dictionary = rb._err("bad", "nope")
	_eq("rb.err.ok", errd["ok"], false)
	_eq("rb.err.code", errd["error"]["code"], "bad")
	_eq("rb.err.msg", errd["error"]["message"], "nope")
	var pong: Dictionary = rb._dispatch("ping", {})
	_eq("rb.ping.ok", pong["ok"], true)
	_eq("rb.ping.pong", pong["result"]["pong"], true)
	_eq("rb.ping.runtime", pong["result"]["runtime"], true)
	_eq("rb.ping.capture_false", pong["result"]["log_capture"], false)
	_check("rb.ping.godot_nonempty", String(pong["result"]["godot"]) != "")
	var un: Dictionary = rb._dispatch("does.not.exist", {})
	_eq("rb.unknown.ok", un["ok"], false)
	_eq("rb.unknown.code", un["error"]["code"], "unknown_method")
	var mon: Dictionary = rb._get_monitors({"keys": ["time/fps"]})
	_check("rb.monitors.has_fps", (mon["result"]["monitors"] as Dictionary).has("time/fps"))
	var mon2: Dictionary = rb._get_monitors({"keys": ["bogus/nope"]})
	_eq("rb.monitors.unknown_empty", (mon2["result"]["monitors"] as Dictionary).size(), 0)
	rb.free()


# --- runtime_bridge.gd CLAUDE_* -> BREAKPOINT_* env-compat shim ------------
func _test_runtime_env_compat() -> void:
	var newn := "BREAKPOINT_MCP_UNITTEST_VAR"
	var oldn := "CLAUDE_MCP_UNITTEST_VAR"
	OS.set_environment(newn, "")
	OS.set_environment(oldn, "")
	_eq("rb.env.neither_empty", RB._env_compat(newn, oldn), "")
	# new name wins over legacy
	OS.set_environment(newn, "9091")
	OS.set_environment(oldn, "legacy")
	_eq("rb.env.new_precedence", RB._env_compat(newn, oldn), "9091")
	# only legacy set -> legacy value returned (with a deprecation warning)
	OS.set_environment(newn, "")
	OS.set_environment(oldn, "legacy")
	_eq("rb.env.legacy_fallback", RB._env_compat(newn, oldn), "legacy")
	OS.set_environment(newn, "")
	OS.set_environment(oldn, "")


# --- runtime_bridge.gd push_log / _get_log ring buffer ---------------------
func _test_runtime_log() -> void:
	var rb = RB.new()
	rb.push_log("info", "first")
	rb.push_log("warning", "second")
	rb.push_log("error", "third")
	var all: Dictionary = rb._get_log({})
	_eq("rb.log.count", (all["result"]["entries"] as Array).size(), 3)
	_eq("rb.log.latest_seq", all["result"]["latest_seq"], 3)
	_eq("rb.log.capture_false", all["result"]["capture"], false)
	_eq("rb.log.first_msg", all["result"]["entries"][0]["message"], "first")
	# since_seq filter: only entries with seq > since
	var since: Dictionary = rb._get_log({"since_seq": 2})
	_eq("rb.log.since.count", (since["result"]["entries"] as Array).size(), 1)
	_eq("rb.log.since.seq", since["result"]["entries"][0]["seq"], 3)
	# levels filter
	var lvl: Dictionary = rb._get_log({"levels": ["error"]})
	_eq("rb.log.levels.count", (lvl["result"]["entries"] as Array).size(), 1)
	_eq("rb.log.levels.msg", lvl["result"]["entries"][0]["message"], "third")
	rb.free()
	# ring buffer evicts oldest past LOG_CAP; latest_seq keeps counting
	var rb2 = RB.new()
	var total := RB.LOG_CAP + 5
	for i in range(total):
		rb2.push_log("info", "m%d" % i)
	var cap: Dictionary = rb2._get_log({})
	_eq("rb.log.cap.size", (cap["result"]["entries"] as Array).size(), RB.LOG_CAP)
	_eq("rb.log.cap.latest_seq", cap["result"]["latest_seq"], total)
	_eq("rb.log.cap.oldest_seq", cap["result"]["entries"][0]["seq"], total - RB.LOG_CAP + 1)
	rb2.free()
