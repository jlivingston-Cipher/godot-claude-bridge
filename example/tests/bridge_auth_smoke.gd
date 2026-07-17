extends SceneTree
## Headless regression for the loopback-bridge auth handshake (default-on).
##
## Drives the REAL bridge_server.gd over a loopback socket and asserts the three
## security invariants of the shared-secret handshake:
##   1. a request sent BEFORE authenticating is denied and NOT dispatched — the
##      destructive-op gate now has teeth at the addon, so a direct socket can't
##      bypass the host-side elicitation gate;
##   2. a WRONG secret is denied and still dispatches nothing;
##   3. the CORRECT secret authenticates, after which a request dispatches.
## Plus unit checks on BridgeSecret.const_time_eq (the constant-time compare).
##
## Prints BRIDGE_AUTH_PASS/FAIL per assertion and a final BRIDGE_AUTH_SUMMARY
## pass=<n>/<total>; quits non-zero on any failure. Run:
##   godot --headless --path example --script res://tests/bridge_auth_smoke.gd

const BridgeServer := preload("res://addons/breakpoint_mcp/bridge_server.gd")
const BridgeSecret := preload("res://addons/breakpoint_mcp/bridge_secret.gd")
const Operations := preload("res://addons/breakpoint_mcp/operations.gd")
const TEST_PORT := 59093

var _pass := 0
var _fail := 0


func _check(label: String, cond: bool) -> void:
	if cond:
		_pass += 1
		print("BRIDGE_AUTH_PASS %s" % label)
	else:
		_fail += 1
		print("BRIDGE_AUTH_FAIL %s" % label)


## Records dispatched methods without touching the editor; overrides Operations
## so no EditorPlugin is needed (mirrors the reentrancy smoke's stub ops).
class RecordingOps extends Operations:
	var calls: Array = []

	func dispatch(method: String, params: Dictionary) -> Dictionary:
		calls.append(method)
		return {"ok": true, "result": {"echo": method}}


func _initialize() -> void:
	_run()
	print("BRIDGE_AUTH_SUMMARY pass=%d/%d" % [_pass, _pass + _fail])
	quit(0 if _fail == 0 else 1)


func _connect_client() -> StreamPeerTCP:
	var client := StreamPeerTCP.new()
	client.connect_to_host("127.0.0.1", TEST_PORT)
	return client


func _pump(server: Node, client: StreamPeerTCP, ticks := 60) -> void:
	for i in range(ticks):
		client.poll()
		server._process(0.0)
		OS.delay_msec(3)


func _send_line(client: StreamPeerTCP, obj: Dictionary) -> void:
	client.put_data((JSON.stringify(obj) + "\n").to_utf8_buffer())


func _run() -> void:
	# --- const_time_eq unit checks (pure, no socket) ---------------------------
	_check("cteq_equal", BridgeSecret.const_time_eq("abc123", "abc123"))
	_check("cteq_diff_same_len", not BridgeSecret.const_time_eq("abc123", "abc124"))
	_check("cteq_diff_len", not BridgeSecret.const_time_eq("abc", "abcd"))
	_check("cteq_empty_vs_nonempty", not BridgeSecret.const_time_eq("", "x"))

	# Force default-on (clear any inherited insecure flag) and a hermetic port.
	OS.set_environment("BREAKPOINT_BRIDGE_INSECURE", "")
	OS.set_environment("BREAKPOINT_BRIDGE_PORT", str(TEST_PORT))
	var server: Node = BridgeServer.new()
	server._ready()  # mints/loads the secret + binds the loopback port
	_check("server.listening", bool(server.get_status().get("listening", false)))
	var secret: String = server._secret
	_check("secret_minted_nonempty", secret.length() > 0)
	_check("auth_required", bool(server._auth_required))

	var ops := RecordingOps.new()
	server._ops = ops

	# --- Case 1: a request BEFORE auth is denied and NOT dispatched. -----------
	var c1 := _connect_client()
	_pump(server, c1)  # accept the connection
	_send_line(c1, {"id": "1", "method": "scene.save", "params": {}})
	_pump(server, c1)
	_check("preauth_request_not_dispatched", ops.calls.size() == 0)
	# Authoritative closure check: the server drops the unauthenticated peer (a
	# client-side status read can lag the server's disconnect, so assert the
	# server's own client list emptied rather than the client's socket status).
	_check("preauth_dropped_by_server", server._clients.size() == 0)
	c1.disconnect_from_host()

	# --- Case 2: a WRONG secret is denied; still nothing dispatched. -----------
	var c2 := _connect_client()
	_pump(server, c2)
	_send_line(c2, {"id": "a", "method": "auth", "params": {"secret": "not-the-secret"}})
	_pump(server, c2)
	_check("wrong_secret_dropped_by_server", server._clients.size() == 0)
	_send_line(c2, {"id": "b", "method": "scene.save", "params": {}})
	_pump(server, c2)
	_check("wrong_secret_not_dispatched", ops.calls.size() == 0)
	c2.disconnect_from_host()

	# --- Case 3: the CORRECT secret authenticates; requests dispatch. ----------
	var c3 := _connect_client()
	_pump(server, c3)
	_send_line(c3, {"id": "x", "method": "auth", "params": {"secret": secret}})
	_pump(server, c3)
	_send_line(c3, {"id": "y", "method": "editor.ping", "params": {}})
	_pump(server, c3)
	_check("authed_request_dispatched", ops.calls.has("editor.ping"))
	_check("only_the_authed_request_dispatched", ops.calls.size() == 1)
	c3.disconnect_from_host()

	server.shutdown()
	server.free()
