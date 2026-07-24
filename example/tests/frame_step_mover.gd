extends Node2D
## Deterministic test mover for the F4 frame-step integration probe.
##
## Increments `ticks` once per PHYSICS frame in which time is actually flowing (delta > 0), and
## advances its x position by a delta-based amount. Gating on `delta` — not pause — is deliberate:
## runtime_time_scale{scale:0} zeroes delta so this FREEZES, and runtime_step_frames (which restores
## a normal scale for the step) advances it by EXACTLY the requested frame count, with no pause
## boundary skew. Driven by the runtime bridge over the loopback socket in the runtime-plane CI job
## (see host/test-integration/runtime-frame-step.integration.mjs). Not a @tool: it runs in the game.

var ticks: int = 0

func _physics_process(delta: float) -> void:
	if delta > 0.0:
		ticks += 1
		position.x += 120.0 * delta
