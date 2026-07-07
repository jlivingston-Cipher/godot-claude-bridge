@tool
extends EditorPlugin
## Claude Bridge — EditorPlugin entry point.
##
## Spins up a loopback TCP server (bridge_server.gd) when the plugin is enabled
## and tears it down when disabled. All engine interaction happens on the main
## thread: the server polls its socket from _process, so every request handler
## already runs in a main-thread context (no marshaling needed for this scaffold).
##
## D3: also watches the editor selection and the edited scene, and asks the
## bridge server to push a "resource.changed" event when either moves, so a
## subscribed MCP host can emit notifications/resources/updated.

const BridgeServer := preload("res://addons/claude_bridge/bridge_server.gd")
const RUNTIME_AUTOLOAD := "ClaudeRuntimeBridge"
const RUNTIME_SCRIPT := "res://addons/claude_bridge/runtime_bridge.gd"

var _server: Node = null
var _selection: EditorSelection = null


func _enter_tree() -> void:
	_server = BridgeServer.new()
	_server.name = "ClaudeBridgeServer"
	_server.setup(self)
	add_child(_server)
	# Inject the runtime bridge into every run of the project so the runtime_*
	# tools work as soon as the game starts. Removed cleanly on disable.
	add_autoload_singleton(RUNTIME_AUTOLOAD, RUNTIME_SCRIPT)
	# D3: emit resources/updated triggers. Selection + edited scene are reflected
	# in godot://editor-state; the edited tree in godot://scene-tree.
	_selection = EditorInterface.get_selection()
	if _selection and not _selection.selection_changed.is_connected(_on_selection_changed):
		_selection.selection_changed.connect(_on_selection_changed)
	if not scene_changed.is_connected(_on_scene_changed):
		scene_changed.connect(_on_scene_changed)
	print("[claude_bridge] plugin enabled")


func _exit_tree() -> void:
	if _selection and _selection.selection_changed.is_connected(_on_selection_changed):
		_selection.selection_changed.disconnect(_on_selection_changed)
	_selection = null
	if scene_changed.is_connected(_on_scene_changed):
		scene_changed.disconnect(_on_scene_changed)
	remove_autoload_singleton(RUNTIME_AUTOLOAD)
	if _server:
		_server.shutdown()
		_server.queue_free()
		_server = null
	print("[claude_bridge] plugin disabled")


## D3: the editor selection changed — godot://editor-state reflects the selection.
func _on_selection_changed() -> void:
	if _server:
		_server.broadcast_event("godot://editor-state")


## D3: a different scene is being edited — both the tree and editor state change.
func _on_scene_changed(_scene_root: Node) -> void:
	if _server:
		_server.broadcast_event("godot://scene-tree")
		_server.broadcast_event("godot://editor-state")
