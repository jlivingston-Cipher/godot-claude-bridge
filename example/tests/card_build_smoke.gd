extends SceneTree
## Headless scene-construction smoke for Group N (the Card slice), the (b) layer
## of the verification rig: it proves — WITHOUT an editor, bridge, or GUI — that a
## card scene shaped exactly like what `card_template_create` emits is a valid
## Godot 4 scene that:
##   * builds a script-backed card (root + Face container + label / texture /
##     badge slots + a two-sided Back), packs it into a PackedScene, and SAVES it,
##   * RE-LOADS + RE-INSTANCES that PackedScene (the round-trip that catches a
##     scene the composite could emit but Godot cannot actually persist), and
##   * exercises the generated setters: set_data() binds by slot and returns the
##     {bound, unbound} split, and set_face() flips Face/Back visibility.
##
## The host op-sequence unit tests (host/test/tabletop.test.ts) prove the tool
## emits the right primitives; this proves the primitives' RESULT is a real,
## round-trippable scene. Together they cover the composite end-to-end offline.
##
## Nothing here is game-specific — it uses placeholder slot names (title / art /
## cost) exactly as a caller of the general-purpose tool would.
##
## Prints `CARD_BUILD_PASS` / `CARD_BUILD_FAIL` per assertion and a final
## `CARD_BUILD_SUMMARY pass=<n>/<total>` line; quits non-zero if anything fails so
## a CI step can gate on it. Run:
##   godot --headless --path example --script res://tests/card_build_smoke.gd

var _pass := 0
var _fail := 0

const SCENE_PATH := "res://tests/_card_smoke_gen.tscn"
const SCRIPT_PATH := "res://tests/_card_smoke_gen.gd"
const TEX_PATH := "res://tests/_card_smoke_tex.tres"


func _check(label: String, cond: bool) -> void:
	if cond:
		_pass += 1
		print("CARD_BUILD_PASS %s" % label)
	else:
		_fail += 1
		print("CARD_BUILD_FAIL %s" % label)


func _initialize() -> void:
	_run()
	print("CARD_BUILD_SUMMARY pass=%d/%d" % [_pass, _pass + _fail])
	_cleanup()
	quit(0 if _fail == 0 else 1)


## The card's set_data()/set_face() — the same shape card_template_create's
## generator (buildCardScript) emits: match on slot name, collect bound/unbound.
func _script_source() -> String:
	return "\n".join(PackedStringArray([
		'extends PanelContainer',
		'func set_data(data: Dictionary) -> Dictionary:',
		'\tvar bound: Array = []',
		'\tfor key in data.keys():',
		'\t\tvar v = data[key]',
		'\t\tif key == "title" and has_node("Face/title"):',
		'\t\t\tget_node("Face/title").text = str(v)',
		'\t\t\tbound.append(key)',
		'\t\telif key == "art" and has_node("Face/art"):',
		'\t\t\tvar _tex = load(str(v))',
		'\t\t\tif _tex: get_node("Face/art").texture = _tex',
		'\t\t\tbound.append(key)',
		'\t\telif key == "cost" and has_node("Face/cost/Label"):',
		'\t\t\tget_node("Face/cost/Label").text = str(v)',
		'\t\t\tbound.append(key)',
		'\tvar unbound: Array = []',
		'\tfor key in data.keys():',
		'\t\tif not bound.has(key):',
		'\t\t\tunbound.append(key)',
		'\treturn {"bound": bound, "unbound": unbound}',
		'func set_face(face_up: bool) -> void:',
		'\tif has_node("Face"):',
		'\t\tget_node("Face").visible = face_up',
		'\tif has_node("Back"):',
		'\t\tget_node("Back").visible = not face_up',
		'',
	]))


## Build the card tree in memory, owning every node to the root so it packs.
func _build_card() -> Node:
	var root := PanelContainer.new()
	root.name = "Card"

	var face := Control.new()
	face.name = "Face"
	root.add_child(face)
	face.owner = root

	var title := Label.new()
	title.name = "title"
	face.add_child(title)
	title.owner = root

	var art := TextureRect.new()
	art.name = "art"
	face.add_child(art)
	art.owner = root

	var cost := Panel.new()
	cost.name = "cost"
	face.add_child(cost)
	cost.owner = root
	var cost_label := Label.new()
	cost_label.name = "Label"
	cost.add_child(cost_label)
	cost_label.owner = root

	var back := Control.new()
	back.name = "Back"
	root.add_child(back)
	back.owner = root
	back.visible = false
	var back_panel := Panel.new()
	back_panel.name = "Panel"
	back.add_child(back_panel)
	back_panel.owner = root

	return root


func _run() -> void:
	# A placeholder texture the art slot can bind to (proves texture binding).
	var tex := PlaceholderTexture2D.new()
	_check("save.texture", ResourceSaver.save(tex, TEX_PATH) == OK)

	# The generated card script, saved to its own res:// .gd (as the tool does).
	var gd := GDScript.new()
	gd.source_code = _script_source()
	var reload_err := gd.reload()
	_check("script.compiles", reload_err == OK)
	_check("save.script", ResourceSaver.save(gd, SCRIPT_PATH) == OK)
	var loaded_script := ResourceLoader.load(SCRIPT_PATH)
	_check("script.reloads", loaded_script != null)

	# Build → attach script → pack → save.
	var root := _build_card()
	root.set_script(loaded_script)
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

	# Node-tree assertions: slots present, correct types, two-sided.
	_check("tree.root_is_panelcontainer", inst is PanelContainer)
	_check("tree.has_face", inst.has_node("Face"))
	_check("tree.title_is_label", inst.has_node("Face/title") and inst.get_node("Face/title") is Label)
	_check("tree.art_is_texturerect", inst.has_node("Face/art") and inst.get_node("Face/art") is TextureRect)
	_check("tree.badge_inner_label", inst.has_node("Face/cost/Label") and inst.get_node("Face/cost/Label") is Label)
	_check("tree.has_back", inst.has_node("Back"))

	# Setters survive the round-trip and behave.
	_check("script.survives_roundtrip", inst.has_method("set_data") and inst.has_method("set_face"))
	if inst.has_method("set_data"):
		var split: Dictionary = inst.set_data({"title": "Alpha", "cost": "3", "art": TEX_PATH, "mystery": "?"})
		_check("bind.title_text", String(inst.get_node("Face/title").text) == "Alpha")
		_check("bind.badge_text", String(inst.get_node("Face/cost/Label").text) == "3")
		_check("bind.art_texture", inst.get_node("Face/art").texture != null)
		var bound: Array = split.get("bound", [])
		var unbound: Array = split.get("unbound", [])
		_check("bind.reports_bound", bound.has("title") and bound.has("cost") and bound.has("art"))
		_check("bind.reports_unbound", unbound.has("mystery"))
	if inst.has_method("set_face"):
		inst.set_face(false)
		_check("face.down_hides_face", not inst.get_node("Face").visible)
		_check("face.down_shows_back", inst.get_node("Back").visible)
		inst.set_face(true)
		_check("face.up_shows_face", inst.get_node("Face").visible)
		_check("face.up_hides_back", not inst.get_node("Back").visible)

	inst.free()


func _cleanup() -> void:
	for p in [SCENE_PATH, SCRIPT_PATH, TEX_PATH]:
		if FileAccess.file_exists(p):
			DirAccess.remove_absolute(ProjectSettings.globalize_path(p))
