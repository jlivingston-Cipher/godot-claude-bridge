extends Node2D
## Tiny script that gives every bridge plane something concrete to exercise:
##  - print() output           -> godot_output / captured console
##  - push_log()               -> runtime_get_log
##  - `counter` property       -> runtime_get_property / runtime_set_property
##  - take_damage()            -> runtime_call_method, and a good breakpoint line
##  - typed members            -> gd_completion / gd_hover / gd_diagnostics

var counter: int = 100


func _ready() -> void:
	print("[example] player ready")
	var bridge := get_node_or_null("/root/ClaudeRuntimeBridge")
	if bridge:
		bridge.push_log("info", "example scene started; counter=%d" % counter)


func _process(_delta: float) -> void:
	# Cheap activity so monitors (FPS, etc.) have something to report.
	counter += 0


func take_damage(amount: int) -> int:
	# Put a breakpoint on the next line to validate the DAP plane.
	counter -= amount
	print("[example] took %d damage, counter now %d" % [amount, counter])
	var bridge := get_node_or_null("/root/ClaudeRuntimeBridge")
	if bridge:
		bridge.push_log("warning", "took %d damage" % amount)
	return counter
