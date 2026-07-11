extends SceneTree
## Headless scene-construction smoke for the Group N Board-slice fast-follow
## (tile-backed board cells: `board_tile_create` / `board_tile_place`), the (b)
## layer of the verification rig: it proves — WITHOUT an editor, bridge, or GUI —
## that a tile board shaped exactly like what `board_tile_create` emits is a valid
## Godot 4 scene, and that `board_tile_place`'s host-side coordinate math matches
## the real engine:
##   * builds a board (Node2D root + a `TileMapLayer` "Cells" bound to a TileSet
##     at a real tile_size, with a rows×cols region painted), packs it into a
##     PackedScene, and SAVES it,
##   * RE-LOADS + RE-INSTANCES that PackedScene (the round-trip that catches a
##     scene the composite could emit but Godot cannot actually persist) with the
##     bound tile_size and painted cells intact,
##   * asserts the KEY invariant: `TileMapLayer.map_to_local(coord)` equals the
##     host formula `(coord + 0.5) * tile_size` (cell centre) and `coord *
##     tile_size` (corner) — the exact positions `board_tile_place` computes, and
##   * exercises `board_tile_place`'s move: reparent a node under the layer and
##     snap it to a cell centre, asserting the final parent + local position.
##
## The host op-sequence unit tests (host/test/tabletop.test.ts) prove the tools
## emit the right primitives; this proves the primitives' RESULT is a real,
## round-trippable tile board AND that the placement math agrees with the engine.
##
## board_tile_create binds its TileSet by a `<scene>_tiles.tres` path; this smoke
## embeds an equivalent TileSet inline for a self-contained round-trip — the
## resulting TileMapLayer node shape (bound tile_size + painted cells) is the same.
##
## Nothing here is game-specific — the board is a plain rows×cols grid of tiles.
##
## Prints `BOARD_TILE_PASS` / `BOARD_TILE_FAIL` per assertion and a final
## `BOARD_TILE_SUMMARY pass=<n>/<total>` line; quits non-zero if anything fails so
## a CI step can gate on it. Run:
##   godot --headless --path example --script res://tests/board_tile_smoke.gd

var _pass := 0
var _fail := 0

const SCENE_PATH := "res://tests/_board_tile_smoke_gen.tscn"
const TILE := Vector2i(32, 32)
const ROWS := 3
const COLS := 4


func _check(label: String, cond: bool) -> void:
	if cond:
		_pass += 1
		print("BOARD_TILE_PASS %s" % label)
	else:
		_fail += 1
		print("BOARD_TILE_FAIL %s" % label)


func _initialize() -> void:
	_run()
	print("BOARD_TILE_SUMMARY pass=%d/%d" % [_pass, _pass + _fail])
	_cleanup()
	quit(0 if _fail == 0 else 1)


## A minimal 1-tile TileSet at TILE size (a white atlas cell), so the layer has a
## real tile_size and a source that can paint cells — the shape board_tile_create
## produces via tileset.create + (bound) atlas source.
func _make_tileset() -> TileSet:
	var ts := TileSet.new()
	ts.tile_size = TILE
	var img := Image.create(TILE.x, TILE.y, false, Image.FORMAT_RGBA8)
	img.fill(Color.WHITE)
	var src := TileSetAtlasSource.new()
	src.texture = ImageTexture.create_from_image(img)
	src.texture_region_size = TILE
	ts.add_source(src, 0)
	src.create_tile(Vector2i(0, 0))
	return ts


## Build the tile board in memory, owning every node to the root so it packs —
## the same structure board_tile_create emits (root → TileMapLayer "Cells" bound
## to a TileSet, with the rows×cols region painted from source 0).
func _build_board() -> Node:
	var root := Node2D.new()
	root.name = "TileBoard"

	var layer := TileMapLayer.new()
	layer.name = "Cells"
	layer.tile_set = _make_tileset()
	root.add_child(layer)
	layer.owner = root

	# Fill the whole rows×cols grid with the base tile (the set_cells_rect result).
	for y in range(ROWS):
		for x in range(COLS):
			layer.set_cell(Vector2i(x, y), 0, Vector2i(0, 0))

	return root


func _run() -> void:
	# Build → pack → save.
	var root := _build_board()
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
	_check("tree.root_is_node2d", inst is Node2D)
	_check("tree.has_cells_layer", inst.has_node("Cells"))
	if not inst.has_node("Cells"):
		inst.free()
		return
	var layer: TileMapLayer = inst.get_node("Cells")
	_check("tree.layer_is_tilemaplayer", layer is TileMapLayer)
	_check("tree.tileset_bound", layer.tile_set != null)
	_check("tree.tile_size_survives_roundtrip", layer.tile_set != null and layer.tile_set.tile_size == TILE)

	# Painted cells survive the round-trip (source 0 at every grid coordinate).
	var painted_ok := true
	for y in range(ROWS):
		for x in range(COLS):
			if layer.get_cell_source_id(Vector2i(x, y)) != 0:
				painted_ok = false
	_check("cells.painted_region_survives_roundtrip", painted_ok)
	# A coordinate outside the painted region reads back empty (source -1).
	_check("cells.outside_region_empty", layer.get_cell_source_id(Vector2i(COLS, ROWS)) == -1)

	# THE KEY INVARIANT: board_tile_place's host math == the engine's map_to_local.
	# Centre of cell (cx,cy) = (coord + 0.5) * tile_size; corner = coord * tile_size.
	var centre_ok := true
	var corner_ok := true
	for coord in [Vector2i(0, 0), Vector2i(2, 1), Vector2i(3, 2)]:
		var host_centre := Vector2((coord.x + 0.5) * TILE.x, (coord.y + 0.5) * TILE.y)
		var host_corner := Vector2(coord.x * TILE.x, coord.y * TILE.y)
		if not layer.map_to_local(coord).is_equal_approx(host_centre):
			centre_ok = false
		if not (layer.map_to_local(coord) - Vector2(TILE) * 0.5).is_equal_approx(host_corner):
			corner_ok = false
	_check("math.centre_matches_map_to_local", centre_ok)
	_check("math.corner_matches_map_to_local", corner_ok)

	# board_tile_place: reparent a node under the layer and snap it to a cell centre.
	var token := Marker2D.new()
	token.name = "Token"
	token.position = Vector2(999, 999)
	inst.add_child(token)
	token.owner = inst
	token.reparent(layer, false)
	var place_coord := Vector2i(2, 1)
	var host_pos := Vector2((place_coord.x + 0.5) * TILE.x, (place_coord.y + 0.5) * TILE.y)
	token.position = host_pos
	_check("place.reparented_under_layer", token.get_parent() == layer)
	_check("place.node_path_is_cells_token", inst.has_node("Cells/Token"))
	_check("place.snapped_to_cell_centre", token.position.is_equal_approx(layer.map_to_local(place_coord)))

	inst.free()


func _cleanup() -> void:
	if FileAccess.file_exists(SCENE_PATH):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(SCENE_PATH))
