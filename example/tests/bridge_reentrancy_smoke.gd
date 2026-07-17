extends SceneTree
## Headless regression for Finding D: bridge_server._process MUST be re-entrancy
## guarded. A request handler that pumps the editor main loop (e.g. scene.save's
## filesystem rescan/reimport) makes the engine call _process again *inside* the
## current dispatch. Because a client's line is only cleared from c["buf"] after
## _drain_lines returns, an unguarded re-entrant tick re-reads and re-dispatches
## the SAME buffered line, recursing until the stack overflows (the crash the
## session-83 dogfood hit on scene.save).
##
## This drives the REAL bridge_server.gd over a loopback socket with a stub _ops
## whose dispatch() re-enters _process (as the save pump would). With the guard,
## the one queued line dispatches EXACTLY ONCE; without it, the same line is
## re-dispatched on every re-entry. A bounded re-entry count keeps the test safe
## to run even against unguarded code (it fails by assertion, not by hanging).
##
## Prints BRIDGE_REENTRANCY_PASS/FAIL per assertion and a final
## BRIDGE_REENTRANCY_SUMMARY pass=<n>/<total>; quits non-zero on any failure. Run:
##   godot --headless --path example --script res://tests/bridge_reentrancy_smoke.gd

const BridgeServer := preload("res://addons/breakpoint_mcp/bridge_server.gd")
const Operations := preload("res://addons/breakpoint_mcp/operations.gd")
const TEST_PORT := 59087

var _pass := 0
var _fail := 0


func _check(label: String, cond: bool) -> void:
	if cond:
		_pass += 1
		print("BRIDGE_REENTRANCY_PASS %s" % label)
	else:
		_fail += 1
		print("BRIDGE_REENTRANCY_FAIL %s" % label)


## Stand-in for Operations. Each dispatch() re-enters the server's _process (as a
## handler that pumps the main loop would). The re-entry count is bounded so an
## UNGUARDED bridge_server recurses a few times then stops — failing by assertion
## (dispatch count > 1) instead of overflowing the stack / hanging the test.
class ReentrantOps extends Operations:
	var server: Node = null
	var calls: Array = []
	var _reentries := 0

	func dispatch(method: String, params: Dictionary) -> Dictionary:
		calls.append(method)
		if server != null and _reentries < 3:
			_reentries += 1
			server._process(0.0)  # simulate scene.save pumping the editor main loop
		return {"ok": true, "result": {"echo": method}}


func _initialize() -> void:
	_run()
	print("BRIDGE_REENTRANCY_SUMMARY pass=%d/%d" % [_pass, _pass + _fail])
	quit(0 if _fail == 0 else 1)


func _run() -> void:
	# This regression targets the _process re-entrancy guard, not the auth
	# handshake — run the bridge in insecure mode so the stub client's single
	# line dispatches without a secret (the handshake has its own smoke).
	OS.set_environment("BREAKPOINT_BRIDGE_INSECURE", "1")
	OS.set_environment("BREAKPOINT_BRIDGE_PORT", str(TEST_PORT))
	var server: Node = BridgeServer.new()
	# Bind the loopback port directly: a node added to the root during
	# SceneTree._initialize() does not get _ready() synchronously, and this test
	# drives _process() by hand anyway, so the server never needs to be in a tree.
	server._ready()

	var st: Dictionary = server.get_status()
	_check("server.listening", bool(st.get("listening", false)))

	var ops := ReentrantOps.new()
	ops.server = server
	server._ops = ops

	# Connect a real loopback client and send exactly ONE request line.
	var client := StreamPeerTCP.new()
	var err := client.connect_to_host("127.0.0.1", TEST_PORT)
	_check("client.connect_ok", err == OK)
	var connected := false
	for i in range(80):
		client.poll()
		server._process(0.0)  # let the server accept the connection
		if client.get_status() == StreamPeerTCP.STATUS_CONNECTED:
			connected = true
			break
		OS.delay_msec(5)
	_check("client.connected", connected)

	var line := '{"id":"1","method":"scene.save","params":{}}' + "\n"
	client.put_data(line.to_utf8_buffer())

	# Drive top-level _process until the line is dispatched (or a bounded timeout).
	# With the guard, dispatch runs once; the re-entrant _process calls from the
	# stub are no-ops. Without the guard, the same line would be re-dispatched.
	for i in range(80):
		client.poll()
		server._process(0.0)
		if ops.calls.size() > 0:
			break
		OS.delay_msec(5)

	_check("dispatched_at_least_once", ops.calls.size() >= 1)
	_check("dispatched_exactly_once (re-entrancy guarded)", ops.calls.size() == 1)
	_check("dispatched_scene_save", ops.calls.size() >= 1 and ops.calls[0] == "scene.save")

	# The single request should still get its single response back on the wire.
	var got_response := false
	for i in range(80):
		client.poll()
		if client.get_status() == StreamPeerTCP.STATUS_CONNECTED and client.get_available_bytes() > 0:
			got_response = true
			break
		server._process(0.0)
		OS.delay_msec(5)
	_check("one_response_delivered", got_response)

	client.disconnect_from_host()
	server.shutdown()
	server.free()
