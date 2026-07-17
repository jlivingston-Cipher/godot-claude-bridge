@tool
extends Node
## Loopback TCP server speaking newline-delimited JSON-RPC-ish messages.
##
## Wire format (both directions), one JSON object per line ("\n" terminated):
##   request:  {"id": "<string>", "method": "<name>", "params": { ... }}
##   response: {"id": "<string>", "ok": true,  "result": { ... }}
##             {"id": "<string>", "ok": false, "error": {"code": ..., "message": ...}}
##
## Binds to 127.0.0.1 only. The port comes from the BREAKPOINT_BRIDGE_PORT env
## var (default 9080). The socket is polled from `_process`, so all request
## handlers run on the editor's main thread.

const Operations := preload("res://addons/breakpoint_mcp/operations.gd")
const DEFAULT_PORT := 9080
const BridgeSecret := preload("res://addons/breakpoint_mcp/bridge_secret.gd")

var _server: TCPServer
var _ops: Operations
var _clients: Array = [] # Array of {peer: StreamPeerTCP, buf: String}
var _port: int = DEFAULT_PORT
## Re-entrancy guard for `_process` (Finding D). True while a request dispatch is
## on the stack, so a handler that pumps the editor main loop (e.g. `scene.save`
## triggers a filesystem rescan/reimport) cannot re-enter `_process` and re-drain
## the same still-buffered line, which would recurse until the stack overflows.
var _dispatching: bool = false
## Loopback-auth handshake state (default-on; see bridge_secret.gd). `_secret` is
## the shared per-project secret; `_auth_required` is false only when auth is
## explicitly disabled (BREAKPOINT_BRIDGE_INSECURE) or the secret can't be minted.
var _secret: String = ""
var _auth_required: bool = false


func setup(plugin: EditorPlugin) -> void:
	_ops = Operations.new()
	_ops.setup(plugin)


func _ready() -> void:
	var env_port := OS.get_environment("BREAKPOINT_BRIDGE_PORT")
	if env_port != "" and env_port.is_valid_int():
		_port = int(env_port)
	_setup_auth()
	_server = TCPServer.new()
	var err := _server.listen(_port, "127.0.0.1")
	if err != OK:
		push_error("[breakpoint_mcp] could not listen on 127.0.0.1:%d (error %d)" % [_port, err])
	else:
		print("[breakpoint_mcp] listening on 127.0.0.1:%d" % _port)


## Establish the loopback-auth secret unless explicitly disabled. Default-on:
## BREAKPOINT_BRIDGE_INSECURE=1 (or =true) turns auth OFF (documented escape
## hatch, not recommended). If the secret can't be persisted, run WITHOUT auth
## rather than bricking the bridge (a broken mint must not lock out the host).
func _setup_auth() -> void:
	var insecure := OS.get_environment("BREAKPOINT_BRIDGE_INSECURE").to_lower()
	if insecure == "1" or insecure == "true":
		_auth_required = false
		push_warning("[breakpoint_mcp] BREAKPOINT_BRIDGE_INSECURE set — loopback bridge auth DISABLED")
		return
	_secret = BridgeSecret.load_or_mint()
	_auth_required = _secret != ""
	if not _auth_required:
		push_error("[breakpoint_mcp] could not establish bridge secret — running WITHOUT auth")


func shutdown() -> void:
	for c in _clients:
		var peer: StreamPeerTCP = c["peer"]
		if peer:
			peer.disconnect_from_host()
	_clients.clear()
	if _server:
		_server.stop()
		_server = null


## Read-only snapshot for the in-editor status dock. Pure — never mutates state.
## `listening` reflects the live TCPServer; `clients` is the current peer count.
## The dock lives inside this same process, so this is authoritative for the
## editor-bridge plane (no TCP self-probe needed).
func get_status() -> Dictionary:
	return {
		"listening": _server != null and _server.is_listening(),
		"host": "127.0.0.1",
		"port": _port,
		"clients": _clients.size(),
	}


func _process(_delta: float) -> void:
	if _server == null:
		return
	# Finding D: a request handler can pump the editor main loop (e.g. scene.save
	# runs a filesystem rescan/reimport), which makes the engine call _process
	# again *inside* the current dispatch. A client's line is only cleared from
	# c["buf"] after _drain_lines returns, so a re-entrant tick would re-read and
	# re-dispatch the SAME line, recursing until the stack overflows
	# (operations.gd:512 _scene_save <-> _drain_lines/_handle_line here). Skip
	# re-entrant ticks; buffered bytes are serviced on the next top-level tick.
	if _dispatching:
		return
	_dispatching = true
	# Accept new connections.
	while _server.is_connection_available():
		var peer := _server.take_connection()
		if peer:
			_clients.append({"peer": peer, "buf": "", "authed": not _auth_required})
	# Service existing connections.
	var still_alive: Array = []
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
		if c.get("close", false):
			peer.poll()
			peer.disconnect_from_host()
			continue
		still_alive.append(c)
	_clients = still_alive
	_dispatching = false


func _drain_lines(c: Dictionary) -> void:
	var buf: String = c["buf"]
	while true:
		var nl := buf.find("\n")
		if nl == -1:
			break
		var line := buf.substr(0, nl)
		buf = buf.substr(nl + 1)
		line = line.strip_edges()
		if line != "":
			_handle_line(c, line)
			if c.get("close", false):
				break
	c["buf"] = buf


func _handle_line(c: Dictionary, line: String) -> void:
	var peer: StreamPeerTCP = c["peer"]
	var parsed: Variant = JSON.parse_string(line)
	if typeof(parsed) != TYPE_DICTIONARY:
		# Pre-auth we don't even echo a parse error (no-echo discipline) — deny + close.
		if not c.get("authed", false):
			_deny_unauth(c)
			return
		_send(peer, {"id": null, "ok": false, "error": {"code": "bad_json", "message": "Could not parse request line"}})
		return
	var req: Dictionary = parsed
	var id: Variant = req.get("id", null)
	var method := String(req.get("method", ""))
	var params: Dictionary = req.get("params", {}) if typeof(req.get("params")) == TYPE_DICTIONARY else {}
	# Handshake gate: an unauthenticated peer may ONLY authenticate. Anything else
	# is denied with a generic code and the connection is closed.
	if not c.get("authed", false):
		if method == "auth" and BridgeSecret.const_time_eq(String(params.get("secret", "")), _secret):
			c["authed"] = true
			_send(peer, {"id": id, "ok": true})
		else:
			_deny_unauth(c)
		return
	var result: Dictionary
	# Handlers never throw in normal operation; guard anyway.
	result = _ops.dispatch(method, params)
	var response := {"id": id}
	response.merge(result)
	_send(peer, response)


## Generic, no-echo denial for an unauthenticated peer; marks the connection for
## closing. Never reveals the expected secret, the received value, the failing
## method, or any engine detail — only a fixed `unauthorized` code.
func _deny_unauth(c: Dictionary) -> void:
	_send(c["peer"], {"id": null, "ok": false, "error": {"code": "unauthorized"}})
	c["close"] = true


func _send(peer: StreamPeerTCP, obj: Dictionary) -> void:
	var text := JSON.stringify(obj) + "\n"
	peer.put_data(text.to_utf8_buffer())


## D3: push an unsolicited "resource changed" event to every connected client
## so a subscribed MCP host can emit notifications/resources/updated. Events carry
## no "id" (they are not responses); the host routes them by the "event" field.
func broadcast_event(uri: String) -> void:
	for c in _clients:
		var peer: StreamPeerTCP = c["peer"]
		if peer and c.get("authed", false) and peer.get_status() == StreamPeerTCP.STATUS_CONNECTED:
			_send(peer, {"event": "resource.changed", "uri": uri})
