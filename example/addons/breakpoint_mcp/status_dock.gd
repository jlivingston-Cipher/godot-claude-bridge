@tool
extends VBoxContainer
## Breakpoint MCP — in-editor status/config dock (Phase-4 adoption item).
##
## The GUI twin of `breakpoint-mcp doctor` + `init`: it surfaces the four bridge
## planes' health, the configured ports, the project path, and a one-click
## "Copy MCP-client config" yielding the exact snippet `init` prints. Scope is
## connection / status / config ONLY — it is NOT a chat UI. The AI assistant
## still lives in the user's MCP client; this dock only wires it up and reports.
##
## The editor-bridge plane is read directly from the in-process bridge server
## (server.get_status()); the runtime / LSP / DAP planes are checked with short,
## non-blocking StreamPeerTCP probes ticked from _process, so the editor main
## thread never stalls. LSP/DAP ports are read from EditorSettings, so the dock
## reflects the user's actual configuration, not just the defaults.

const DEFAULT_BRIDGE_PORT := 9080
const DEFAULT_RUNTIME_PORT := 9081
const DEFAULT_LSP_PORT := 6005
const DEFAULT_DAP_PORT := 6006
const SERVER_NAME := "godot"
const REFRESH_INTERVAL_SEC := 2.0
const PROBE_DEADLINE_MSEC := 1500

const COLOR_OK := Color(0.38, 0.85, 0.45)
const COLOR_FAIL := Color(0.92, 0.47, 0.40)
const COLOR_PENDING := Color(0.62, 0.62, 0.62)

const PLANES := [
	{"key": "editor", "name": "editor-bridge"},
	{"key": "runtime", "name": "runtime-bridge"},
	{"key": "lsp", "name": "gdscript-lsp"},
	{"key": "dap", "name": "gdscript-dap"},
]


# --- pure helpers: editor-free, socket-free, unit-tested --------------------

## The stdio server entry an MCP client config needs, matching the host's
## clients.ts serverEntry() default (GODOT_BIN omitted when it is the default).
static func server_entry(project_path: String) -> Dictionary:
	return {
		"command": "npx",
		"args": ["-y", "breakpoint-mcp"],
		"env": {"GODOT_PROJECT": project_path},
	}

## Copy-pasteable single-server snippet (wrapper key "mcpServers"), pretty JSON
## with 2-space indent and insertion order preserved (sort_keys=false) so it is
## the same shape `breakpoint-mcp init` prints — dock and CLI never drift.
static func client_snippet(project_path: String) -> String:
	var obj := {"mcpServers": {SERVER_NAME: server_entry(project_path)}}
	return JSON.stringify(obj, "  ", false)

## Status glyph, mirroring doctor's check / cross / dash vocabulary.
static func plane_glyph(status: String) -> String:
	match status:
		"ok":
			return "✓"
		"fail":
			return "✗"
		_:
			return "–"

## One plane row's text: "<glyph> <name>  <detail>".
static func plane_line(pname: String, status: String, detail: String) -> String:
	return "%s %s  %s" % [plane_glyph(status), pname, detail]


# --- state -----------------------------------------------------------------

var _server: Node = null       # bridge_server.gd instance, injected by plugin.gd
var _rows := {}                # plane key -> Label
var _probes := {}              # plane key -> {peer, deadline, port}
var _config_label: Label = null
var _copy_feedback: Label = null
var _timer: Timer = null


## plugin.gd injects the live bridge server so the editor-bridge plane is read
## in-process (authoritative) instead of self-probing the loopback port.
func set_server(server: Node) -> void:
	_server = server


func _ready() -> void:
	_build_ui()
	_timer = Timer.new()
	_timer.wait_time = REFRESH_INTERVAL_SEC
	_timer.autostart = true
	_timer.timeout.connect(_refresh)
	add_child(_timer)
	set_process(true)
	_refresh()


func _exit_tree() -> void:
	for key in _probes:
		var pr: Dictionary = _probes[key]
		if pr["peer"] != null:
			pr["peer"].disconnect_from_host()
	_probes.clear()


# --- UI --------------------------------------------------------------------

func _build_ui() -> void:
	name = "Breakpoint"
	add_theme_constant_override("separation", 6)

	var header := Label.new()
	header.text = "Breakpoint MCP"
	header.add_theme_font_size_override("font_size", 15)
	add_child(header)

	var sub := Label.new()
	sub.text = "bridge status · ports · client setup"
	sub.modulate = Color(1, 1, 1, 0.6)
	add_child(sub)

	add_child(HSeparator.new())

	var bridges_hdr := Label.new()
	bridges_hdr.text = "Bridges"
	bridges_hdr.modulate = Color(1, 1, 1, 0.75)
	add_child(bridges_hdr)

	for p in PLANES:
		var row := Label.new()
		row.add_theme_font_size_override("font_size", 13)
		_rows[p["key"]] = row
		add_child(row)
		_set_plane(p["key"], "pending", "…")
	add_child(HSeparator.new())

	var cfg_hdr := Label.new()
	cfg_hdr.text = "Config"
	cfg_hdr.modulate = Color(1, 1, 1, 0.75)
	add_child(cfg_hdr)

	_config_label = Label.new()
	_config_label.add_theme_font_size_override("font_size", 12)
	_config_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_config_label)

	add_child(HSeparator.new())

	var copy_btn := Button.new()
	copy_btn.text = "Copy MCP-client config"
	copy_btn.tooltip_text = "Copy the mcpServers snippet for this project to the clipboard."
	copy_btn.pressed.connect(_on_copy_pressed)
	add_child(copy_btn)

	var refresh_btn := Button.new()
	refresh_btn.text = "Refresh"
	refresh_btn.pressed.connect(_refresh)
	add_child(refresh_btn)

	_copy_feedback = Label.new()
	_copy_feedback.add_theme_font_size_override("font_size", 12)
	_copy_feedback.modulate = Color(1, 1, 1, 0.7)
	_copy_feedback.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_copy_feedback)

	var foot := Label.new()
	foot.text = "Status/config only — the assistant runs in your MCP client, not here."
	foot.modulate = Color(1, 1, 1, 0.5)
	foot.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(foot)


func _display_name(key: String) -> String:
	for p in PLANES:
		if p["key"] == key:
			return String(p["name"])
	return key


func _set_plane(key: String, status: String, detail: String) -> void:
	var row: Label = _rows.get(key)
	if row == null:
		return
	row.text = plane_line(_display_name(key), status, detail)
	var col := COLOR_PENDING
	if status == "ok":
		col = COLOR_OK
	elif status == "fail":
		col = COLOR_FAIL
	row.add_theme_color_override("font_color", col)


# --- refresh ---------------------------------------------------------------

func _refresh() -> void:
	_update_editor_plane()
	_start_probe("runtime", _runtime_port())
	_start_probe("lsp", _lsp_port())
	_start_probe("dap", _dap_port())
	_update_config_line()


func _update_editor_plane() -> void:
	if _server != null and _server.has_method("get_status"):
		var s: Dictionary = _server.get_status()
		if bool(s.get("listening", false)):
			var n := int(s.get("clients", 0))
			var host := String(s.get("host", "127.0.0.1"))
			var suffix := "client" if n == 1 else "clients"
			_set_plane("editor", "ok", "%s:%d · %d %s" % [host, int(s.get("port", DEFAULT_BRIDGE_PORT)), n, suffix])
		else:
			_set_plane("editor", "fail", "not listening")
	else:
		_set_plane("editor", "fail", "server unavailable")


func _update_config_line() -> void:
	if _config_label == null:
		return
	_config_label.text = "project  %s\neditor %d · runtime %d · lsp %d · dap %d" % [
		_project_path(), _bridge_port(), _runtime_port(), _lsp_port(), _dap_port(),
	]


func _on_copy_pressed() -> void:
	DisplayServer.clipboard_set(client_snippet(_project_path()))
	if _copy_feedback != null:
		_copy_feedback.text = "Copied the mcpServers snippet to the clipboard."


# --- ports -----------------------------------------------------------------

func _project_path() -> String:
	return ProjectSettings.globalize_path("res://").trim_suffix("/")


func _bridge_port() -> int:
	if _server != null and _server.has_method("get_status"):
		var s: Dictionary = _server.get_status()
		return int(s.get("port", DEFAULT_BRIDGE_PORT))
	return _env_port("BREAKPOINT_BRIDGE_PORT", DEFAULT_BRIDGE_PORT)


func _runtime_port() -> int:
	return _env_port("BREAKPOINT_RUNTIME_PORT", DEFAULT_RUNTIME_PORT)


func _env_port(var_name: String, fallback: int) -> int:
	var env := OS.get_environment(var_name)
	if env != "" and env.is_valid_int():
		return int(env)
	return fallback


func _editor_setting_int(key: String, fallback: int) -> int:
	var es := EditorInterface.get_editor_settings()
	if es != null and es.has_setting(key):
		var v: Variant = es.get_setting(key)
		if typeof(v) == TYPE_INT or typeof(v) == TYPE_FLOAT:
			return int(v)
	return fallback


func _lsp_port() -> int:
	return _editor_setting_int("network/language_server/remote_port", DEFAULT_LSP_PORT)


func _dap_port() -> int:
	return _editor_setting_int("network/debug_adapter/remote_port", DEFAULT_DAP_PORT)


# --- non-blocking TCP probes -----------------------------------------------
# The editor-bridge plane is read in-process (see _update_editor_plane); only
# runtime / LSP / DAP are probed. connect_to_host is non-blocking; the socket is
# polled from _process across frames, so a slow/closed port never stalls the UI.

func _start_probe(key: String, port: int) -> void:
	if _probes.has(key):
		var old: Dictionary = _probes[key]
		if old["peer"] != null:
			old["peer"].disconnect_from_host()
		_probes.erase(key)
	var peer := StreamPeerTCP.new()
	var err := peer.connect_to_host("127.0.0.1", port)
	if err != OK:
		_set_plane(key, "fail", "127.0.0.1:%d unreachable" % port)
		return
	_set_plane(key, "pending", "127.0.0.1:%d checking…" % port)
	_probes[key] = {"peer": peer, "deadline": Time.get_ticks_msec() + PROBE_DEADLINE_MSEC, "port": port}


func _process(_delta: float) -> void:
	if _probes.is_empty():
		return
	var done: Array = []
	for key in _probes:
		var pr: Dictionary = _probes[key]
		var peer: StreamPeerTCP = pr["peer"]
		peer.poll()
		var st := peer.get_status()
		if st == StreamPeerTCP.STATUS_CONNECTED:
			_set_plane(key, "ok", "127.0.0.1:%d reachable" % int(pr["port"]))
			peer.disconnect_from_host()
			done.append(key)
		elif st == StreamPeerTCP.STATUS_ERROR:
			_set_plane(key, "fail", "127.0.0.1:%d unreachable" % int(pr["port"]))
			done.append(key)
		elif Time.get_ticks_msec() > int(pr["deadline"]):
			_set_plane(key, "fail", "127.0.0.1:%d no response" % int(pr["port"]))
			peer.disconnect_from_host()
			done.append(key)
	for key in done:
		_probes.erase(key)
