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

var _server: TCPServer
var _ops: Operations
var _clients: Array = [] # Array of {peer: StreamPeerTCP, buf: String}
var _port: int = DEFAULT_PORT


func setup(plugin: EditorPlugin) -> void:
	_ops = Operations.new()
	_ops.setup(plugin)


func _ready() -> void:
	var env_port := OS.get_environment("BREAKPOINT_BRIDGE_PORT")
	if env_port != "" and env_port.is_valid_int():
		_port = int(env_port)
	_server = TCPServer.new()
	var err := _server.listen(_port, "127.0.0.1")
	if err != OK:
		push_error("[breakpoint_mcp] could not listen on 127.0.0.1:%d (error %d)" % [_port, err])
	else:
		print("[breakpoint_mcp] listening on 127.0.0.1:%d" % _port)


func shutdown() -> void:
	for c in _clients:
		var peer: StreamPeerTCP = c["peer"]
		if peer:
			peer.disconnect_from_host()
	_clients.clear()
	if _server:
		_server.stop()
		_server = null


func _process(_delta: float) -> void:
	if _server == null:
		return
	# Accept new connections.
	while _server.is_connection_available():
		var peer := _server.take_connection()
		if peer:
			_clients.append({"peer": peer, "buf": ""})
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
		still_alive.append(c)
	_clients = still_alive


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
			_handle_line(c["peer"], line)
	c["buf"] = buf


func _handle_line(peer: StreamPeerTCP, line: String) -> void:
	var parsed: Variant = JSON.parse_string(line)
	if typeof(parsed) != TYPE_DICTIONARY:
		_send(peer, {"id": null, "ok": false, "error": {"code": "bad_json", "message": "Could not parse request line"}})
		return
	var req: Dictionary = parsed
	var id: Variant = req.get("id", null)
	var method := String(req.get("method", ""))
	var params: Dictionary = req.get("params", {}) if typeof(req.get("params")) == TYPE_DICTIONARY else {}
	var result: Dictionary
	# Handlers never throw in normal operation; guard anyway.
	result = _ops.dispatch(method, params)
	var response := {"id": id}
	response.merge(result)
	_send(peer, response)


func _send(peer: StreamPeerTCP, obj: Dictionary) -> void:
	var text := JSON.stringify(obj) + "\n"
	peer.put_data(text.to_utf8_buffer())


## D3: push an unsolicited "resource changed" event to every connected client
## so a subscribed MCP host can emit notifications/resources/updated. Events carry
## no "id" (they are not responses); the host routes them by the "event" field.
func broadcast_event(uri: String) -> void:
	for c in _clients:
		var peer: StreamPeerTCP = c["peer"]
		if peer and peer.get_status() == StreamPeerTCP.STATUS_CONNECTED:
			_send(peer, {"event": "resource.changed", "uri": uri})
