@tool
extends EditorPlugin
## Claude Bridge — EditorPlugin entry point.
##
## Spins up a loopback TCP server (bridge_server.gd) when the plugin is enabled
## and tears it down when disabled. All engine interaction happens on the main
## thread: the server polls its socket from `_process`, so every request handler
## already runs in a main-thread context (no marshaling needed for this scaffold).

const BridgeServer := preload("res://addons/claude_bridge/bridge_server.gd")
const RUNTIME_AUTOLOAD := "ClaudeRuntimeBridge"
const RUNTIME_SCRIPT := "res://addons/claude_bridge/runtime_bridge.gd"

var _server: Node = null


func _enter_tree() -> void:
	_server = BridgeServer.new()
	_server.name = "ClaudeBridgeServer"
	_server.setup(self)
	add_child(_server)
	# Inject the runtime bridge into every run of the project so the runtime_*
	# tools work as soon as the game starts. Removed cleanly on disable.
	add_autoload_singleton(RUNTIME_AUTOLOAD, RUNTIME_SCRIPT)
	print("[claude_bridge] plugin enabled")


func _exit_tree() -> void:
	remove_autoload_singleton(RUNTIME_AUTOLOAD)
	if _server:
		_server.shutdown()
		_server.queue_free()
		_server = null
	print("[claude_bridge] plugin disabled")
