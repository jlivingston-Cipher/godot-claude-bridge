extends Node
## Claude Runtime Bridge — runs INSIDE the running game as an autoload.
##
## The editor plugin auto-registers this as an autoload singleton
## ("ClaudeRuntimeBridge"), so it is present whenever the project runs. It opens
## a loopback TCP server on 127.0.0.1:9081 (override CLAUDE_RUNTIME_PORT) speaking
## the SAME newline-delimited JSON protocol as the editor bridge, and exposes the
## live SceneTree: read/write properties, call methods, emit signals, inject
## input, read Performance monitors, capture frames, and read a log ring buffer.
##
## NOTE: this script is intentionally NOT @tool — it must run in the game, not
## the editor. All handlers run on the main thread (socket polled from _process).

const Codec := preload("res://addons/claude_bridge/variant_json.gd")
const DEFAULT_PORT := 9081
const LOG_CAP := 1000
# D6: source for the runtime-compiled Logger subclass (Godot 4.5+). Kept as a
# string so `extends Logger` is only ever compiled where the class exists — the
# addon stays parse-clean on Godot 4.3/4.4 (no Logger class).
const _LOG_CAPTURE_SRC := """extends Logger
var sink: Callable
func _log_message(message: String, error: bool) -> void:
	if sink.is_valid():
		sink.call("error" if error else "info", message)
func _log_error(function: String, file: String, line: int, code: String, rationale: String, editor_notify: bool, error_type: int, script_backtraces: Array) -> void:
	if sink.is_valid():
		var lvl := "warning" if error_type == 1 else "error"
		var detail := rationale if rationale != "" else code
		sink.call(lvl, "%s (%s:%d)" % [detail, file, line])
"""

# Curated Performance monitors exposed by runtime.get_monitors.
const MONITORS := {
	"time/fps": Performance.TIME_FPS,
	"time/process": Performance.TIME_PROCESS,
	"time/physics_process": Performance.TIME_PHYSICS_PROCESS,
	"memory/static": Performance.MEMORY_STATIC,
	"object/node_count": Performance.OBJECT_NODE_COUNT,
	"object/resource_count": Performance.OBJECT_RESOURCE_COUNT,
	"render/total_objects_drawn": Performance.RENDER_TOTAL_OBJECTS_IN_FRAME,
	"render/total_draw_calls": Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME,
	"render/video_mem_used": Performance.RENDER_VIDEO_MEM_USED,
	"physics_3d/active_objects": Performance.PHYSICS_3D_ACTIVE_OBJECTS,
	"physics_2d/active_objects": Performance.PHYSICS_2D_ACTIVE_OBJECTS,
	"audio/output_latency": Performance.AUDIO_OUTPUT_LATENCY,
}

var _server: TCPServer
var _clients: Array = [] # Array of {peer, buf}
var _port: int = DEFAULT_PORT
var _log: Array = []     # ring buffer of {seq, level, message}
var _log_seq: int = 0
var _tree_dirty: bool = false
var _log_dirty: bool = false
var _log_capture = null  # registered Logger (Godot 4.5+) or null
var _in_capture: bool = false


func _ready() -> void:
	# Keep servicing requests even while the game is paused (e.g. at a breakpoint).
	process_mode = Node.PROCESS_MODE_ALWAYS
	var env_port := OS.get_environment("CLAUDE_RUNTIME_PORT")
	if env_port != "" and env_port.is_valid_int():
		_port = int(env_port)
	_server = TCPServer.new()
	var err := _server.listen(_port, "127.0.0.1")
	if err != OK:
		push_error("[claude_runtime] could not listen on 127.0.0.1:%d (error %d)" % [_port, err])
	else:
		push_log("info", "ClaudeRuntimeBridge listening on 127.0.0.1:%d" % _port)
	# D3 follow-up: re-emit godot://runtime/tree when the live SceneTree structure
	# changes so subscribers re-read it. Collapsed to one push per frame via
	# _tree_dirty (see _process) so a burst of node adds/removes is a single event.
	var tree := get_tree()
	if tree:
		tree.node_added.connect(_on_tree_structure_changed)
		tree.node_removed.connect(_on_tree_structure_changed)
		tree.node_renamed.connect(_on_tree_structure_changed)
	_install_log_capture()


## Public API: game code can route its own logs here for runtime.get_log to read.
func push_log(level: String, message: String) -> void:
	_log_seq += 1
	_log.append({"seq": _log_seq, "level": level, "message": message})
	while _log.size() > LOG_CAP:
		_log.pop_front()
	_log_dirty = true


func _exit_tree() -> void:
	var tree := get_tree()
	if tree:
		if tree.node_added.is_connected(_on_tree_structure_changed):
			tree.node_added.disconnect(_on_tree_structure_changed)
		if tree.node_removed.is_connected(_on_tree_structure_changed):
			tree.node_removed.disconnect(_on_tree_structure_changed)
		if tree.node_renamed.is_connected(_on_tree_structure_changed):
			tree.node_renamed.disconnect(_on_tree_structure_changed)
	if _log_capture != null and ClassDB.class_has_method("OS", "remove_logger"):
		OS.remove_logger(_log_capture)
	_log_capture = null
	for c in _clients:
		var peer: StreamPeerTCP = c["peer"]
		if peer:
			peer.disconnect_from_host()
	_clients.clear()
	if _server:
		_server.stop()


func _process(_delta: float) -> void:
	if _server == null:
		return
	while _server.is_connection_available():
		var peer := _server.take_connection()
		if peer:
			_clients.append({"peer": peer, "buf": ""})
	var alive: Array = []
	for c in _clients:
		var peer: StreamPeerTCP = c["peer"]
		peer.poll()
		var status := peer.get_status()
		if status == StreamPeerTCP.STATUS_ERROR or status == StreamPeerTCP.STATUS_NONE:
			continue
		var available := peer.get_available_bytes()
		if available > 0:
			var chunk := peer.get_data(available)
			if chunk[0] == OK:
				var bytes: PackedByteArray = chunk[1]
				c["buf"] += bytes.get_string_from_utf8()
		_drain_lines(c)
		alive.append(c)
	_clients = alive
	# D3 follow-up: one runtime-tree push per frame if the SceneTree changed.
	if _tree_dirty:
		_tree_dirty = false
		broadcast_event("godot://runtime/tree")
	if _log_dirty:
		_log_dirty = false
		broadcast_event("godot://runtime/log")


func _drain_lines(c: Dictionary) -> void:
	var buf: String = c["buf"]
	while true:
		var nl := buf.find("\n")
		if nl == -1:
			break
		var line := buf.substr(0, nl).strip_edges()
		buf = buf.substr(nl + 1)
		if line != "":
			_handle_line(c["peer"], line)
	c["buf"] = buf


func _handle_line(peer: StreamPeerTCP, line: String) -> void:
	var parsed: Variant = JSON.parse_string(line)
	if typeof(parsed) != TYPE_DICTIONARY:
		_send(peer, {"id": null, "ok": false, "error": {"code": "bad_json", "message": "Bad request"}})
		return
	var req: Dictionary = parsed
	var id: Variant = req.get("id", null)
	var method := String(req.get("method", ""))
	var params: Dictionary = req.get("params", {}) if typeof(req.get("params")) == TYPE_DICTIONARY else {}
	var result := _dispatch(method, params)
	var response := {"id": id}
	response.merge(result)
	_send(peer, response)


func _send(peer: StreamPeerTCP, obj: Dictionary) -> void:
	peer.put_data((JSON.stringify(obj) + "\n").to_utf8_buffer())


## D3: push an unsolicited "resource changed" event to every connected client so
## a subscribed MCP host can emit notifications/resources/updated. Mirrors the
## editor bridge_server; events carry no "id" (they are not responses), so the
## host routes them by the "event" field without colliding with request/response.
func broadcast_event(uri: String) -> void:
	for c in _clients:
		var peer: StreamPeerTCP = c["peer"]
		if peer and peer.get_status() == StreamPeerTCP.STATUS_CONNECTED:
			_send(peer, {"event": "resource.changed", "uri": uri})


## D3 follow-up: the live SceneTree gained/lost/renamed a node. Mark it dirty;
## _process coalesces to a single godot://runtime/tree push per frame regardless
## of how many nodes changed this frame.
func _on_tree_structure_changed(_node: Node) -> void:
	_tree_dirty = true


## D6: zero-config console capture. Godot 4.5+ exposes a scriptable Logger
## (OS.add_logger); register one that funnels every print()/push_warning/
## push_error and engine message into the same ring buffer runtime.get_log reads,
## so the host gets the game's console with NO managed parent process. Compiled at
## runtime, so `extends Logger` is only ever parsed where the class exists.
func _install_log_capture() -> void:
	if _log_capture != null:
		return
	if not ClassDB.class_exists("Logger") or not ClassDB.class_has_method("OS", "add_logger"):
		return  # < 4.5: no scriptable logger; runtime.get_log still serves push_log entries.
	var src := GDScript.new()
	src.source_code = _LOG_CAPTURE_SRC
	if src.reload() != OK:
		return  # runtime script compilation unavailable — degrade quietly.
	var inst = src.new()
	inst.set("sink", Callable(self, "_on_captured_log"))
	OS.add_logger(inst)
	_log_capture = inst
	push_log("info", "log capture active (Godot %s)" % Engine.get_version_info().get("string", ""))


## Sink for the runtime-compiled Logger. Writes to the ring buffer only (never
## prints/errors — that would recurse through the logger we registered); the
## _in_capture guard is belt-and-braces in case a downstream call ever emits.
func _on_captured_log(level: String, message: String) -> void:
	if _in_capture:
		return
	_in_capture = true
	push_log(level, message.strip_edges())
	_in_capture = false


# ----------------------------------------------------------- dispatch --------

func _dispatch(method: String, params: Dictionary) -> Dictionary:
	match method:
		"ping":
			return _ok({"pong": true, "runtime": true, "godot": Engine.get_version_info().get("string", ""), "log_capture": _log_capture != null})
		"runtime.get_tree":
			return _get_tree(params)
		"runtime.get_property":
			return _get_property(params)
		"runtime.set_property":
			return _set_property(params)
		"runtime.call_method":
			return _call_method(params)
		"runtime.emit_signal":
			return _emit_signal(params)
		"runtime.inject_input":
			return _inject_input(params)
		"runtime.get_monitors":
			return _get_monitors(params)
		"runtime.screenshot":
			return _screenshot()
		"runtime.get_log":
			return _get_log(params)
		_:
			return _err("unknown_method", "No such method: %s" % method)


func _ok(result: Variant) -> Dictionary:
	return {"ok": true, "result": result}


func _err(code: String, message: String) -> Dictionary:
	return {"ok": false, "error": {"code": code, "message": message}}


func _base() -> Node:
	return get_tree().current_scene


func _resolve(path: String) -> Node:
	if path == "" or path == ".":
		return _base()
	if path.begins_with("/"):
		return get_node_or_null(NodePath(path))
	var b := _base()
	if b == null:
		return null
	return b.get_node_or_null(NodePath(path))


func _path_of(node: Node) -> String:
	var b := _base()
	if b and (node == b or b.is_ancestor_of(node)):
		return "." if node == b else String(b.get_path_to(node))
	return String(node.get_path())


func _serialize(node: Node, depth: int, max_depth: int) -> Dictionary:
	var d := {
		"name": String(node.name),
		"type": node.get_class(),
		"path": _path_of(node),
		"child_count": node.get_child_count(),
	}
	if node is CanvasItem:
		d["visible"] = (node as CanvasItem).visible
	elif node is Node3D:
		d["visible"] = (node as Node3D).visible
	if depth < max_depth and node.get_child_count() > 0:
		var kids: Array = []
		for c in node.get_children():
			kids.append(_serialize(c, depth + 1, max_depth))
		d["children"] = kids
	return d


func _get_tree(params: Dictionary) -> Dictionary:
	var base := _base()
	if base == null:
		return _err("no_scene", "No current scene is running")
	return _ok(_serialize(base, 0, int(params.get("max_depth", 64))))


func _get_property(params: Dictionary) -> Dictionary:
	var node := _resolve(String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var prop := String(params.get("property", ""))
	return _ok({"path": _path_of(node), "property": prop, "value": Codec.encode(node.get(prop))})


func _set_property(params: Dictionary) -> Dictionary:
	var node := _resolve(String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var prop := String(params.get("property", ""))
	node.set(prop, Codec.decode(params.get("value")))
	return _ok({"path": _path_of(node), "property": prop, "value": Codec.encode(node.get(prop))})


func _call_method(params: Dictionary) -> Dictionary:
	var node := _resolve(String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var method := String(params.get("method", ""))
	if not node.has_method(method):
		return _err("no_method", "%s has no method %s" % [node.get_class(), method])
	var args: Array = []
	for a in params.get("args", []):
		args.append(Codec.decode(a))
	var result: Variant = node.callv(method, args)
	return _ok({"return": Codec.encode(result)})


func _emit_signal(params: Dictionary) -> Dictionary:
	var node := _resolve(String(params.get("path", "")))
	if node == null:
		return _err("bad_path", "Node not found: %s" % params.get("path", ""))
	var sig := String(params.get("signal", ""))
	if not node.has_signal(sig):
		return _err("no_signal", "%s has no signal %s" % [node.get_class(), sig])
	var call_args: Array = [sig]
	for a in params.get("args", []):
		call_args.append(Codec.decode(a))
	node.callv("emit_signal", call_args)
	return _ok({"emitted": true})


func _inject_input(params: Dictionary) -> Dictionary:
	var ev: Dictionary = params.get("event", {})
	var kind := String(ev.get("kind", ""))
	match kind:
		"action":
			var action := String(ev.get("action", ""))
			if bool(ev.get("pressed", true)):
				Input.action_press(action, float(ev.get("strength", 1.0)))
			else:
				Input.action_release(action)
			return _ok({"injected": true, "kind": kind})
		"key":
			var k := InputEventKey.new()
			k.keycode = int(ev.get("keycode", 0))
			k.pressed = bool(ev.get("pressed", true))
			Input.parse_input_event(k)
			return _ok({"injected": true, "kind": kind})
		"mouse_button":
			var mb := InputEventMouseButton.new()
			mb.button_index = int(ev.get("button", 1))
			mb.pressed = bool(ev.get("pressed", true))
			var pos: Variant = Codec.decode(ev.get("position"))
			if pos is Vector2:
				mb.position = pos
			Input.parse_input_event(mb)
			return _ok({"injected": true, "kind": kind})
		"mouse_motion":
			var mm := InputEventMouseMotion.new()
			var mpos: Variant = Codec.decode(ev.get("position"))
			if mpos is Vector2:
				mm.position = mpos
			var rel: Variant = Codec.decode(ev.get("relative"))
			if rel is Vector2:
				mm.relative = rel
			Input.parse_input_event(mm)
			return _ok({"injected": true, "kind": kind})
		_:
			return _err("bad_kind", "Unknown input kind: %s" % kind)


func _get_monitors(params: Dictionary) -> Dictionary:
	var out := {}
	var keys: Array = params.get("keys", [])
	var wanted: Array = keys if keys.size() > 0 else MONITORS.keys()
	for key in wanted:
		var k := String(key)
		if MONITORS.has(k):
			out[k] = Performance.get_monitor(MONITORS[k])
	return _ok({"monitors": out})


func _screenshot() -> Dictionary:
	var vp := get_viewport()
	if vp == null:
		return _err("no_viewport", "No viewport")
	var tex := vp.get_texture()
	if tex == null:
		return _err("no_texture", "No viewport texture")
	var img := tex.get_image()
	if img == null:
		return _err("no_image", "Could not read frame")
	var buf := img.save_png_to_buffer()
	return _ok({
		"mime": "image/png",
		"base64": Marshalls.raw_to_base64(buf),
		"width": img.get_width(),
		"height": img.get_height(),
	})


func _get_log(params: Dictionary) -> Dictionary:
	var since := int(params.get("since_seq", 0))
	var levels: Array = params.get("levels", [])
	var entries: Array = []
	for e in _log:
		if int(e["seq"]) > since and (levels.is_empty() or levels.has(e["level"])):
			entries.append(e)
	return _ok({"entries": entries, "latest_seq": _log_seq, "capture": _log_capture != null})
