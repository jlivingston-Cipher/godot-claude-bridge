extends SceneTree
## Headless unit tests for the PURE, editor-independent logic in the Breakpoint
## MCP addon — the parts a real editor is NOT needed to exercise:
##   * the Variant <-> JSON codec (variant_json.gd), and
##   * the pure helpers in operations.gd: the {ok}/{err} envelope, node-path
##     resolution (_resolve/_path_of), SceneTree serialization (_serialize_node,
##     _descendants), the doc-URL / type-name helpers, and _ping.
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

var _pass := 0
var _fail := 0


func _initialize() -> void:
	var ops = Ops.new()  # untyped: only editor-free helpers are called (no setup(plugin))
	_test_codec()
	_test_envelope(ops)
	_test_resolve_and_path(ops)
	_test_serialize(ops)
	_test_descendants(ops)
	_test_doc_helpers(ops)
	_test_ping(ops)
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
