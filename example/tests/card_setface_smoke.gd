extends SceneTree
## Headless scene-construction smoke for the Group N Card-slice fast-follow
## (`card_set_face`), the (b) layer of the verification rig: it proves — WITHOUT
## an editor, bridge, or GUI — that the flip an `card_set_face --animate` emits is
## a valid, round-trippable, *playable* Godot 4 animation. Specifically it builds a
## two-sided card + the exact `FlipFX` AnimationPlayer / `flip` clip the tool's
## op-sequence authors (a scale-pinch value track 1 → edge-on `(0,1)` → 1, plus a
## method-call key that invokes `set_face` at the edge-on midpoint), then:
##   * packs it into a PackedScene and SAVES it,
##   * RE-LOADS + RE-INSTANCES that scene (the round-trip that catches a clip the
##     composite could emit but Godot cannot actually persist), asserting the
##     player, both tracks, their paths/types, and the method key survive, and
##   * PLAYS the clip: the scale-pinch value track animates to edge-on at the
##     midpoint and back to 1 at the end, and the method key's own read-back call
##     (the exact call the track fires in a running game) flips the side face →
##     back. (Godot suppresses method-track side effects under a headless
##     advance()/seek(), so the swap is proven via the read-back call, not playback.)
##
## The host op-sequence unit tests (host/test/tabletop.test.ts) prove the tool
## emits the right primitives; this proves that primitives' RESULT is a real,
## round-trippable, playable flip. Together they cover the composite end-to-end
## offline.
##
## Nothing here is game-specific — a plain two-sided card with a `set_face` setter,
## exactly as a caller of the general-purpose tool would build.
##
## Prints `CARD_SETFACE_PASS` / `CARD_SETFACE_FAIL` per assertion and a final
## `CARD_SETFACE_SUMMARY pass=<n>/<total>` line; quits non-zero if anything fails so
## a CI step can gate on it. Run:
##   godot --headless --path example --script res://tests/card_setface_smoke.gd

var _pass := 0
var _fail := 0

const SCENE_PATH := "res://tests/_setface_smoke_gen.tscn"
const SCRIPT_PATH := "res://tests/_setface_smoke_gen.gd"

const DUR := 0.3
const MID := 0.15


func _check(label: String, cond: bool) -> void:
	if cond:
		_pass += 1
		print("CARD_SETFACE_PASS %s" % label)
	else:
		_fail += 1
		print("CARD_SETFACE_FAIL %s" % label)


func _initialize() -> void:
	_run()
	print("CARD_SETFACE_SUMMARY pass=%d/%d" % [_pass, _pass + _fail])
	_cleanup()
	quit(0 if _fail == 0 else 1)


## A minimal two-sided card script exposing the same set_face() shape
## card_template_create's generator (buildCardScript) emits.
func _script_source() -> String:
	return "\n".join(PackedStringArray([
		'extends PanelContainer',
		'func set_face(face_up: bool) -> void:',
		'\tif has_node("Face"):',
		'\t\tget_node("Face").visible = face_up',
		'\tif has_node("Back"):',
		'\t\tget_node("Back").visible = not face_up',
		'',
	]))


## Build a two-sided card (root + Face + Back), owning every node to the root.
func _build_card() -> Node:
	var root := PanelContainer.new()
	root.name = "Card"
	var face := Control.new()
	face.name = "Face"
	root.add_child(face)
	face.owner = root
	var back := Control.new()
	back.name = "Back"
	root.add_child(back)
	back.owner = root
	back.visible = false
	return root


## Author the FlipFX AnimationPlayer + `flip` clip exactly as emitCardSetFace's
## op-sequence does: a scale pinch on `.:scale` plus a `.` method key at the
## midpoint calling set_face(false).
func _build_flip(card: Node, root: Node) -> AnimationPlayer:
	var player := AnimationPlayer.new()
	player.name = "FlipFX"
	card.add_child(player)
	player.owner = root
	var lib := AnimationLibrary.new()
	player.add_animation_library("", lib)

	var anim := Animation.new()
	var t0 := anim.add_track(Animation.TYPE_VALUE)
	anim.track_set_path(t0, ".:scale")
	anim.track_insert_key(t0, 0.0, Vector2(1, 1))
	anim.track_insert_key(t0, MID, Vector2(0, 1))
	anim.track_insert_key(t0, DUR, Vector2(1, 1))
	var t1 := anim.add_track(Animation.TYPE_METHOD)
	anim.track_set_path(t1, ".")
	anim.track_insert_key(t1, MID, {"method": "set_face", "args": [false]})
	anim.length = DUR
	lib.add_animation("flip", anim)
	return player


func _run() -> void:
	# The card script saved to its own res:// .gd (as the tool does).
	var gd := GDScript.new()
	gd.source_code = _script_source()
	_check("script.compiles", gd.reload() == OK)
	_check("save.script", ResourceSaver.save(gd, SCRIPT_PATH) == OK)
	var loaded_script := ResourceLoader.load(SCRIPT_PATH)
	_check("script.reloads", loaded_script != null)

	# Build card + script + flip clip → pack → save.
	var root := _build_card()
	root.set_script(loaded_script)
	_build_flip(root, root)
	var packed := PackedScene.new()
	_check("pack.ok", packed.pack(root) == OK)
	_check("save.scene", ResourceSaver.save(packed, SCENE_PATH) == OK)
	root.free()

	# Re-load + re-instance the saved PackedScene (the round-trip).
	var reloaded := ResourceLoader.load(SCENE_PATH) as PackedScene
	_check("scene.reloads", reloaded != null)
	if reloaded == null:
		return
	var inst := reloaded.instantiate()
	_check("scene.instantiates", inst != null)

	# The player + clip survive the round-trip with the authored shape.
	_check("player.present", inst.has_node("FlipFX"))
	if not inst.has_node("FlipFX"):
		inst.free()
		return
	var player: AnimationPlayer = inst.get_node("FlipFX")
	_check("player.has_flip", player.has_animation("flip"))
	var anim := player.get_animation("flip")
	_check("anim.length", is_equal_approx(anim.length, DUR))
	_check("anim.two_tracks", anim.get_track_count() == 2)

	# Track 0 — the scale pinch: value track on `.:scale`, edge-on at the midpoint.
	_check("track0.is_value", anim.track_get_type(0) == Animation.TYPE_VALUE)
	_check("track0.path", String(anim.track_get_path(0)) == ".:scale")
	_check("track0.three_keys", anim.track_get_key_count(0) == 3)
	_check("track0.starts_full", anim.track_get_key_value(0, 0) == Vector2(1, 1))
	_check("track0.mid_edge_on", anim.track_get_key_value(0, 1) == Vector2(0, 1))
	_check("track0.ends_full", anim.track_get_key_value(0, 2) == Vector2(1, 1))

	# Track 1 — the method key: swaps the side at the midpoint via set_face(false).
	_check("track1.is_method", anim.track_get_type(1) == Animation.TYPE_METHOD)
	_check("track1.path", String(anim.track_get_path(1)) == ".")
	_check("track1.one_key", anim.track_get_key_count(1) == 1)
	_check("track1.key_at_mid", is_equal_approx(anim.track_get_key_time(1, 0), MID))
	_check("track1.method_name", String(anim.method_track_get_name(1, 0)) == "set_face")
	var params := anim.method_track_get_params(1, 0)
	_check("track1.method_args", params.size() == 1 and params[0] == false)

	# Playback proof, split into the two things a running game relies on:
	#  1. the value (pinch) track animates when the clip plays — edge-on `(0, 1)`
	#     at the midpoint, restored `(1, 1)` at the end (proven via advance), and
	#  2. the method key encodes exactly the setter call that swaps the side —
	#     proven by invoking the key's OWN read-back name + args, which is the
	#     exact call the track fires in a running game. (Method-call tracks do not
	#     fire under a headless `advance()`/`seek()` — Godot suppresses their side
	#     effects when not stepping real frames — so playback can't drive the swap
	#     here; the value track and the read-back call together cover it.)
	inst.set_face(true)
	_check("pre.face_shown", inst.get_node("Face").visible and not inst.get_node("Back").visible)
	get_root().add_child(inst)
	player.play("flip")
	player.advance(MID)
	_check("play.mid_edge_on", inst.scale.is_equal_approx(Vector2(0, 1)))
	player.advance(DUR - MID)
	_check("play.scale_restored", inst.scale.is_equal_approx(Vector2(1, 1)))
	inst.callv(String(anim.method_track_get_name(1, 0)), anim.method_track_get_params(1, 0))
	_check("methodkey.swaps_to_back", inst.get_node("Back").visible and not inst.get_node("Face").visible)
	get_root().remove_child(inst)

	inst.free()


func _cleanup() -> void:
	for p in [SCENE_PATH, SCRIPT_PATH]:
		if FileAccess.file_exists(p):
			DirAccess.remove_absolute(ProjectSettings.globalize_path(p))
