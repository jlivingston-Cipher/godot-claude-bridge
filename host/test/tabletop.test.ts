import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  emitCardTemplate,
  emitCardInstance,
  emitCardHand,
  emitDeckFromTable,
  emitCardSetFace,
  resolveColumnExpr,
  computeLayout,
  parseCsv,
  jsonRows,
  buildCardScript,
  sceneRootName,
  joinPath,
  parseHexColor,
  emitBoardCreate,
  emitBoardPlace,
  emitBoardTileCreate,
  emitBoardTilePlace,
  computeRingCells,
  computeGridCells,
  resolveBoardCells,
  emitPieceTemplate,
  emitPieceInstance,
  emitPieceMove,
  buildPieceScript,
  emitMakeDraggable,
  emitAddDropZone,
  buildDraggableScript,
  buildDropZoneScript,
  gdDictLiteral,
  gdQuote,
  type Emit,
} from "../src/tools/tabletop.js";

/**
 * Group N — Card slice. Two things are proven here without a live editor:
 *
 *   1. Each composite emits the exact ordered sequence of existing primitive
 *      bridge ops (the offline crux — an injected emit-sink records them), and
 *   2. the one bit of real logic — the column-expression resolver — and the
 *      layout math are correct on their own.
 *
 * A third invariant matters to this package specifically: the Card tools are
 * general-purpose and carry NO game-specific vocabulary. That is asserted by
 * scanning the source directly.
 */

interface Call { method: string; params: Record<string, unknown> }

/** A recording emit-sink; set_data returns a plausible {bound,unbound} split. */
function recorder(): { calls: Call[]; emit: Emit } {
  const calls: Call[] = [];
  const emit: Emit = async (method, params) => {
    calls.push({ method, params });
    if (method === "node.call_method" && params.method === "set_data") {
      const data = (params.args as unknown[])[0] as Record<string, unknown>;
      return { result: { bound: Object.keys(data), unbound: [] } };
    }
    return {};
  };
  return { calls, emit };
}

const methods = (calls: Call[]) => calls.map((c) => c.method);

// ---------------------------------------------------- card_template_create ----

test("card_template_create emits scene.new → Face → one node per slot → script → save, in order", async () => {
  const { calls, emit } = recorder();
  const res = await emitCardTemplate(emit, {
    path: "res://ui/cards/Card.tscn",
    size: { width: 240, height: 336 },
    slots: [
      { name: "title", kind: "label" },
      { name: "art", kind: "texture" },
    ],
  });

  assert.deepEqual(methods(calls), [
    "scene.new",
    "control.create", // Face
    "control.create", // title
    "control.create", // art
    "resource.create", // GDScript
    "node.set_property", // attach script
    "scene.save",
  ]);
  assert.deepEqual(calls[0].params, { root_type: "PanelContainer", path: "res://ui/cards/Card.tscn", name: "Card" });
  assert.deepEqual(calls[1].params, { parent_path: ".", type: "Control", name: "Face" });
  assert.equal(calls[2].params.type, "Label");
  assert.equal(calls[3].params.type, "TextureRect");
  // the generated GDScript is created then attached as a Resource variant.
  assert.equal(calls[4].params.class_name, "GDScript");
  const src = (calls[4].params.properties as Record<string, string>).source_code;
  assert.match(src, /func set_data/);
  assert.match(src, /func set_face/);
  assert.deepEqual(calls[5].params.value, { __type__: "Resource", class: "GDScript", path: "res://ui/cards/Card.gd" });

  assert.equal(res.scene_path, "res://ui/cards/Card.tscn");
  assert.equal(res.script_path, "res://ui/cards/Card.gd");
  assert.equal(res.has_back, false);
  assert.equal(res.saved, true);
  assert.deepEqual(res.slots, [
    { name: "title", node_path: "Face/title", kind: "label" },
    { name: "art", node_path: "Face/art", kind: "texture" },
  ]);
});

test("card_template_create: a badge slot builds an inner Label and binds text to it", async () => {
  const { calls, emit } = recorder();
  const res = await emitCardTemplate(emit, {
    path: "res://ui/cards/Card.tscn",
    size: { width: 100, height: 140 },
    slots: [{ name: "cost", kind: "badge", default_text: "0" }],
  });
  const created = calls.filter((c) => c.method === "control.create");
  assert.deepEqual(created.map((c) => c.params.name), ["Face", "cost", "Label"]);
  assert.equal(created[1].params.type, "Panel"); // badge outer
  assert.equal(created[2].params.type, "Label"); // badge inner
  // default_text binds to the inner Label, not the Panel.
  const textSet = calls.find((c) => c.method === "node.set_property" && c.params.property === "text");
  assert.equal(textSet?.params.path, "Face/cost/Label");
  assert.equal(res.slots[0].node_path, "Face/cost/Label");
});

test("card_template_create: rect + align + wrap + font_size emit the expected property ops", async () => {
  const { calls, emit } = recorder();
  await emitCardTemplate(emit, {
    path: "res://ui/cards/Card.tscn",
    size: { width: 100, height: 140 },
    slots: [{ name: "body", kind: "rich_text", rect: { x: 8, y: 8, w: 84, h: 100 }, align: "center", wrap: true, font_size: 18 }],
  });
  const props = calls.filter((c) => c.method === "node.set_property").map((c) => c.params.property);
  assert.deepEqual(props, ["position", "size", "horizontal_alignment", "autowrap_mode", "theme_override_font_sizes/font_size", "script"]);
  const pos = calls.find((c) => c.params.property === "position")!;
  assert.deepEqual(pos.params.value, { __type__: "Vector2", x: 8, y: 8 });
});

test("card_template_create: a back makes the template two-sided and the script guards Back", async () => {
  const { calls, emit } = recorder();
  const res = await emitCardTemplate(emit, {
    path: "res://ui/cards/Card.tscn",
    size: { width: 100, height: 140 },
    slots: [{ name: "title", kind: "label" }],
    back: { color: "#334455" },
  });
  assert.equal(res.has_back, true);
  const names = calls.filter((c) => c.method === "control.create").map((c) => c.params.name);
  assert.ok(names.includes("Back"));
  const src = (calls.find((c) => c.method === "resource.create")!.params.properties as Record<string, string>).source_code;
  assert.match(src, /has_node\("Back"\)/);
});

test("card_template_create: anchor_preset is used instead of an explicit rect", async () => {
  const { calls, emit } = recorder();
  await emitCardTemplate(emit, {
    path: "res://ui/cards/Card.tscn",
    size: { width: 100, height: 140 },
    slots: [{ name: "art", kind: "texture", anchor_preset: 15 }],
  });
  const preset = calls.find((c) => c.method === "control.set_layout_preset");
  assert.equal(preset?.params.preset, 15);
  assert.equal(calls.find((c) => c.params && (c.params as Record<string, unknown>).property === "position"), undefined);
});

test("card_template_create: an inline panel_stylebox builds a StyleBoxFlat + theme and assigns it", async () => {
  const { calls, emit } = recorder();
  await emitCardTemplate(emit, {
    path: "res://ui/cards/Card.tscn",
    size: { width: 100, height: 140 },
    slots: [{ name: "title", kind: "label" }],
    theme: { panel_stylebox: { bg_color: "#101014", corner_radius: 8, border_width: 2, border_color: "#00ffaa" } },
  });
  const m = methods(calls);
  assert.ok(m.includes("resource.create") && m.includes("theme.create") && m.includes("theme.set_stylebox"));
  const setTheme = calls.find((c) => c.method === "control.set_theme");
  assert.equal(setTheme?.params.theme_path, "res://ui/cards/Card.theme.tres");
});

// ------------------------------------------------------------- card_instance ----

test("card_instance emits instantiate → set_data → set_face and surfaces the bind split", async () => {
  const { calls, emit } = recorder();
  const res = await emitCardInstance(emit, {
    template_path: "res://ui/cards/Card.tscn",
    parent: "Main/Hand",
    data: { title: "Alpha", cost: 3 },
  });
  assert.deepEqual(methods(calls), ["node.instantiate_scene", "node.call_method", "node.call_method"]);
  assert.deepEqual(calls[0].params, { parent_path: "Main/Hand", scene_path: "res://ui/cards/Card.tscn", name: "Card" });
  assert.equal(calls[1].params.method, "set_data");
  assert.deepEqual(calls[1].params.args, [{ title: "Alpha", cost: 3 }]);
  assert.equal(calls[2].params.method, "set_face");
  assert.equal(res.instance_path, "Main/Hand/Card");
  assert.equal(res.face_up, true);
  assert.deepEqual(res.bound.sort(), ["cost", "title"]);
  assert.deepEqual(res.unbound, []);
});

test("card_instance sets position when given and honours an explicit name", async () => {
  const { calls, emit } = recorder();
  const res = await emitCardInstance(emit, {
    template_path: "res://ui/cards/Card.tscn",
    parent: ".", data: {}, position: { x: 40, y: 60 }, name: "Draw", face_up: false,
  });
  assert.deepEqual(methods(calls), ["node.instantiate_scene", "node.set_property", "node.call_method", "node.call_method"]);
  assert.deepEqual(calls[1].params.value, { __type__: "Vector2", x: 40, y: 60 });
  assert.equal(res.instance_path, "Draw");
  assert.equal(calls[3].params.args?.[0 as keyof object], false);
});

// --------------------------------------------------------- card_hand_layout ----

test("card_hand_layout stamps one card per entry and positions each", async () => {
  const { calls, emit } = recorder();
  const res = await emitCardHand(emit, {
    template_path: "res://ui/cards/Card.tscn",
    parent: "Main/Hand",
    mode: "row",
    spacing: 100,
    cards: [{ data: { title: "A" } }, { data: { title: "B" } }, { data: { title: "C" } }],
  });
  assert.equal(res.count, 3);
  assert.equal(res.container_path, "Main/Hand");
  assert.deepEqual(res.instances.map((i) => i.instance_path), ["Main/Hand/Card_0", "Main/Hand/Card_1", "Main/Hand/Card_2"]);
  // each card: instantiate + position + set_data + set_face.
  const perCard = calls.filter((c) => c.method === "node.instantiate_scene").length;
  assert.equal(perCard, 3);
  assert.equal(calls.filter((c) => c.method === "node.set_property" && c.params.property === "position").length, 3);
});

// ------------------------------------------------------ card_deck_from_table ----

const CSV_FIXTURE = [
  "name,cost,type,flavor,unused",
  "Alpha,2,strike,\"Fast, and light\",x",
  "Bravo,3,guard,Steady,y",
  "Charlie,5,strike,Heavy,z",
].join("\n");

test("card_deck_from_table stamps one card per row, composes columns, filters, and reports unmapped columns", async () => {
  const { calls, emit } = recorder();
  const res = await emitDeckFromTable(emit, () => CSV_FIXTURE, {
    template_path: "res://ui/cards/Card.tscn",
    parent: "Deck",
    table_path: "res://data/cards.csv",
    column_map: { title: "{name}", footer: "{name} · {type}", points: "{cost}" },
    filter: { column: "type", equals: "strike" },
  });
  assert.equal(res.rows_read, 3);
  assert.equal(res.count, 2); // only the two "strike" rows
  assert.equal(res.rows_skipped, 1);
  assert.equal(res.deck_container, "Deck");
  // "flavor" and "unused" are the only columns no slot referenced ("type" is used by the filter + footer).
  assert.deepEqual(res.unmapped_columns, ["flavor", "unused"]);
  // the first stamped row is Alpha; its composed footer resolved.
  const firstSetData = calls.find((c) => c.method === "node.call_method" && c.params.method === "set_data")!;
  assert.deepEqual(firstSetData.params.args, [{ title: "Alpha", footer: "Alpha · strike", points: "2" }]);
  assert.deepEqual(res.instances.map((i) => i.row_index), [0, 2]);
});

test("card_deck_from_table: limit caps the stamped rows; art_column binds art", async () => {
  const { calls, emit } = recorder();
  const res = await emitDeckFromTable(emit, () => CSV_FIXTURE, {
    template_path: "res://ui/cards/Card.tscn",
    parent: ".",
    table_path: "res://data/cards.csv",
    column_map: { title: "{name}" },
    art_column: "type",
    limit: 1,
  });
  assert.equal(res.count, 1);
  const setData = calls.find((c) => c.params.method === "set_data")!;
  assert.deepEqual(setData.params.args, [{ title: "Alpha", art: "strike" }]);
});

test("card_deck_from_table reads a JSON table too", async () => {
  const json = JSON.stringify([{ name: "One", tag: "a" }, { name: "Two", tag: "b" }]);
  const { emit } = recorder();
  const res = await emitDeckFromTable(emit, () => json, {
    template_path: "res://ui/cards/Card.tscn",
    parent: ".", table_path: "res://data/cards.json",
    column_map: { title: "{name}" },
  });
  assert.equal(res.rows_read, 2);
  assert.equal(res.count, 2);
  assert.deepEqual(res.unmapped_columns, ["tag"]);
});

// -------------------------------------------------- column-expression resolver ----

test("resolveColumnExpr handles bare, composed, and missing columns", () => {
  const row = { name: "Alpha", role: "scout" };
  assert.deepEqual(resolveColumnExpr("{name}", row), { value: "Alpha", columns: ["name"] });
  assert.deepEqual(resolveColumnExpr("{name} · {role}", row), { value: "Alpha · scout", columns: ["name", "role"] });
  assert.deepEqual(resolveColumnExpr("plain text", row), { value: "plain text", columns: [] });
  assert.throws(() => resolveColumnExpr("{missing}", row), /not in the table/);
  assert.throws(() => resolveColumnExpr("{}", row), /Empty \{} placeholder/);
});

// ---------------------------------------------------------------- layout math ----

test("computeLayout row is evenly spaced and centred by default", () => {
  const p = computeLayout("row", 3, { spacing: 100 });
  assert.deepEqual(p, [{ x: -100, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }]);
});

test("computeLayout grid fills rows left-to-right", () => {
  const p = computeLayout("grid", 4, { spacing: 50, columns: 2, align: "start", origin: { x: 0, y: 0 } });
  assert.deepEqual(p, [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 50 }, { x: 50, y: 50 }]);
});

test("computeLayout fan sets a symmetric rotation sweep", () => {
  const p = computeLayout("fan", 3, { spacing: 40, fan_angle: 30, align: "center" });
  assert.equal(p.length, 3);
  assert.ok(Math.abs(p[1].rotation ?? 99) < 1e-9); // centre card is upright
  assert.ok((p[0].rotation ?? 0) < 0 && (p[2].rotation ?? 0) > 0); // symmetric sweep
});

test("computeLayout stack piles at (near) one point", () => {
  const p = computeLayout("stack", 3, { overlap: 2 });
  assert.deepEqual(p, [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 4 }]);
});

// --------------------------------------------------------------- CSV / JSON ----

test("parseCsv handles quoted fields with embedded commas", () => {
  const rows = parseCsv("a,b\n1,\"x,y\"\n2,z");
  assert.deepEqual(rows, [{ a: "1", b: "x,y" }, { a: "2", b: "z" }]);
});

test("jsonRows accepts an array or an object holding rows", () => {
  assert.deepEqual(jsonRows('[{"a":1}]'), [{ a: "1" }]);
  assert.deepEqual(jsonRows('{"rows":[{"a":2}]}'), [{ a: "2" }]);
  assert.throws(() => jsonRows("not json"), /not valid JSON/);
});

// --------------------------------------------------------------- misc helpers ----

test("sceneRootName / joinPath / parseHexColor", () => {
  assert.equal(sceneRootName("res://ui/cards/SampleCard.tscn"), "SampleCard");
  assert.equal(sceneRootName("res://x/weird name!.tscn"), "weirdname");
  assert.equal(joinPath(".", "Card"), "Card");
  assert.equal(joinPath("Main/Hand", "Card_0"), "Main/Hand/Card_0");
  assert.deepEqual(parseHexColor("#ff0000"), [1, 0, 0, 1]);
  assert.throws(() => parseHexColor("red"), /Malformed/);
});

test("buildCardScript is valid-looking GDScript with the two setters", () => {
  const src = buildCardScript("PanelContainer", [{ name: "title", kind: "label" }], false);
  assert.match(src, /^extends PanelContainer/);
  assert.match(src, /func set_data\(data: Dictionary\) -> Dictionary:/);
  assert.match(src, /func set_face\(face_up: bool\) -> void:/);
  assert.doesNotMatch(src, /has_node\("Back"\)/); // no back → no Back guard
});

// ============================================================================
// Group N — Board slice (Increment 2). Same offline crux as the Card slice: each
// composite emits the exact ordered sequence of existing primitive ops, and the
// pure ring/grid math is correct on its own.
// ============================================================================

test("board_create (explicit cells) emits scene.new → per-cell add/position/group → save, in order", async () => {
  const { calls, emit } = recorder();
  const res = await emitBoardCreate(emit, {
    path: "res://ui/board/Board.tscn",
    layout: { mode: "cells", cells: [{ id: "a", x: 10, y: 20 }, { id: "b", x: 30, y: 40 }] },
  });

  assert.deepEqual(methods(calls), [
    "scene.new",
    "node.add", "node.set_property", "node.add_to_group", // cell a
    "node.add", "node.set_property", "node.add_to_group", // cell b
    "scene.save",
  ]);
  assert.deepEqual(calls[0].params, { root_type: "Node2D", path: "res://ui/board/Board.tscn", name: "Board" });
  assert.deepEqual(calls[1].params, { parent_path: ".", type: "Marker2D", name: "cell_a" });
  assert.deepEqual(calls[2].params, { path: "cell_a", property: "position", value: { __type__: "Vector2", x: 10, y: 20 } });
  assert.deepEqual(calls[3].params, { path: "cell_a", group: "board_cells" });

  assert.equal(res.cell_count, 2);
  assert.equal(res.node_count, 3); // root + 2 cells
  assert.equal(res.layout_mode, "cells");
  assert.equal(res.root_type, "Node2D");
  assert.equal(res.cell_kind, "marker");
  assert.equal(res.saved, true);
  assert.deepEqual(res.cells, [
    { id: "a", node_path: "cell_a", x: 10, y: 20 },
    { id: "b", node_path: "cell_b", x: 30, y: 40 },
  ]);
});

test("board_create grid builds '<r>_<c>' cells at the right pitch", async () => {
  const { calls, emit } = recorder();
  const res = await emitBoardCreate(emit, {
    path: "res://ui/board/Grid.tscn",
    layout: { mode: "grid", rows: 2, cols: 2 },
    cell_size: 50,
  });
  const added = calls.filter((c) => c.method === "node.add").map((c) => c.params.name);
  assert.deepEqual(added, ["cell_0_0", "cell_0_1", "cell_1_0", "cell_1_1"]);
  assert.deepEqual(res.cells.map((c) => [c.x, c.y]), [[0, 0], [50, 0], [0, 50], [50, 50]]);
});

test("board_create ring: background is emitted first, cells honour cell_kind + root_type", async () => {
  const { calls, emit } = recorder();
  const res = await emitBoardCreate(emit, {
    path: "res://ui/board/Ring.tscn",
    layout: { mode: "ring", cells: ["top", "right", "bottom", "left"], radius: 100 },
    root_type: "Control",
    cell_kind: "control",
    background: { color: "#101014", size: { w: 400, h: 400 } },
  });
  // scene.new → Background add + color + size → then the cells.
  assert.deepEqual(methods(calls).slice(0, 4), ["scene.new", "node.add", "node.set_property", "node.set_property"]);
  assert.deepEqual(calls[1].params, { parent_path: ".", type: "ColorRect", name: "Background" });
  assert.equal(calls[2].params.property, "color");
  assert.deepEqual(calls[3].params, { path: "Background", property: "size", value: { __type__: "Vector2", x: 400, y: 400 } });

  const cellAdds = calls.filter((c) => c.method === "node.add" && String(c.params.name).startsWith("cell_"));
  assert.equal(cellAdds.length, 4);
  assert.ok(cellAdds.every((c) => c.params.type === "Control"));
  assert.equal(res.root_type, "Control");
  assert.equal(res.cell_kind, "control");
  assert.equal(res.node_count, 1 + 1 + 4); // root + background + 4 cells
  // the ring's first cell sits at the top (0, -radius).
  assert.ok(Math.abs(res.cells[0].x) < 1e-9 && Math.abs(res.cells[0].y + 100) < 1e-9);
});

test("board_create art background picks Sprite2D under a Node2D root", async () => {
  const { calls, emit } = recorder();
  await emitBoardCreate(emit, {
    path: "res://ui/board/Art.tscn",
    layout: { mode: "cells", cells: [{ id: "a", x: 0, y: 0 }] },
    background: { art: "res://art/board.png" },
  });
  assert.equal(calls[1].params.name, "Background");
  assert.equal(calls[1].params.type, "Sprite2D");
  assert.equal(calls[2].params.property, "texture");
});

test("board_create rejects duplicate and malformed cell ids", async () => {
  const { emit } = recorder();
  await assert.rejects(emitBoardCreate(emit, {
    path: "res://b.tscn",
    layout: { mode: "cells", cells: [{ id: "a", x: 0, y: 0 }, { id: "a", x: 1, y: 1 }] },
  }), /Duplicate cell id/);
  await assert.rejects(emitBoardCreate(emit, {
    path: "res://b.tscn",
    layout: { mode: "cells", cells: [{ id: "bad id", x: 0, y: 0 }] },
  }), /Invalid slot\/node name/);
});

test("board_place reparents onto <board>/cell_<cell> and snaps to the align offset", async () => {
  const { calls, emit } = recorder();
  const res = await emitBoardPlace(emit, { board: "Board", cell: "top", node: "Main/Pieces/Token", align: { x: 0, y: -8 } });
  assert.deepEqual(methods(calls), ["node.reparent", "node.set_property"]);
  assert.deepEqual(calls[0].params, { path: "Main/Pieces/Token", new_parent_path: "Board/cell_top", keep_global_transform: false });
  assert.deepEqual(calls[1].params, { path: "Board/cell_top/Token", property: "position", value: { __type__: "Vector2", x: 0, y: -8 } });
  assert.equal(res.placed, true);
  assert.equal(res.cell_path, "Board/cell_top");
  assert.equal(res.node_path, "Board/cell_top/Token");
  assert.deepEqual(res.align, { x: 0, y: -8 });
});

test("board_place: a '.' board and default align centre the node on the cell", async () => {
  const { calls, emit } = recorder();
  const res = await emitBoardPlace(emit, { board: ".", cell: "a", node: "Token" });
  assert.equal(calls[0].params.new_parent_path, "cell_a");
  assert.deepEqual(calls[1].params.value, { __type__: "Vector2", x: 0, y: 0 });
  assert.equal(res.node_path, "cell_a/Token");
  assert.deepEqual(res.align, { x: 0, y: 0 });
});

// -------------------------------------------------------------- board math ----

test("computeGridCells fills rows then columns with '<r>_<c>' ids", () => {
  const c = computeGridCells(2, 3, 10);
  assert.deepEqual(c.map((x) => x.id), ["0_0", "0_1", "0_2", "1_0", "1_1", "1_2"]);
  assert.deepEqual(c.map((x) => [x.x, x.y]), [[0, 0], [10, 0], [20, 0], [0, 10], [10, 10], [20, 10]]);
});

test("computeRingCells places the first cell at the top and sweeps clockwise", () => {
  const c = computeRingCells(["a", "b", "c", "d"], { radius: 100 });
  const near = (v: number, t: number) => Math.abs(v - t) < 1e-9;
  assert.ok(near(c[0].x, 0) && near(c[0].y, -100)); // top
  assert.ok(near(c[1].x, 100) && near(c[1].y, 0));  // right (clockwise, y-down)
  assert.ok(near(c[2].x, 0) && near(c[2].y, 100));  // bottom
  assert.ok(near(c[3].x, -100) && near(c[3].y, 0)); // left
});

test("resolveBoardCells rejects an empty grid", () => {
  assert.throws(() => resolveBoardCells({ mode: "grid", rows: 0, cols: 2 }), /rows >= 1/);
});

// --------------------------------------------------------- tile-backed board ----

test("board_tile_create (no tileset) emits scene.new → tileset.create → tilemaplayer.create → save; frame only", async () => {
  const { calls, emit } = recorder();
  const res = await emitBoardTileCreate(emit, { path: "res://ui/board/Tiles.tscn", rows: 3, cols: 4 });

  assert.deepEqual(methods(calls), ["scene.new", "tileset.create", "tilemaplayer.create", "scene.save"]);
  assert.deepEqual(calls[0].params, { root_type: "Node2D", path: "res://ui/board/Tiles.tscn", name: "Tiles" });
  assert.deepEqual(calls[1].params, { to_path: "res://ui/board/Tiles_tiles.tres", tile_size: [64, 64] });
  assert.deepEqual(calls[2].params, { parent_path: ".", name: "Cells", tileset_path: "res://ui/board/Tiles_tiles.tres" });

  assert.equal(res.layer_path, "Cells");
  assert.equal(res.rows, 3);
  assert.equal(res.cols, 4);
  assert.deepEqual(res.tile_size, [64, 64]);
  assert.equal(res.tileset_path, "res://ui/board/Tiles_tiles.tres");
  assert.equal(res.tileset_created, true);
  assert.equal(res.cell_count, 12);
  assert.equal(res.painted, false);
  assert.equal(res.node_count, 2);
  assert.equal(res.saved, true);
});

test("board_tile_create with a supplied tileset + paint binds it and fills the whole grid, no tileset.create", async () => {
  const { calls, emit } = recorder();
  const res = await emitBoardTileCreate(emit, {
    path: "res://b/Grid.tscn", rows: 2, cols: 5, tile_size: [32, 48],
    tileset: "res://tiles/world.tres", paint: { source_id: 0, atlas_coords: [1, 2] }, layer_name: "Floor",
  });

  assert.deepEqual(methods(calls), ["scene.new", "tilemaplayer.create", "tilemap.set_cells_rect", "scene.save"]);
  assert.deepEqual(calls[1].params, { parent_path: ".", name: "Floor", tileset_path: "res://tiles/world.tres" });
  assert.deepEqual(calls[2].params, { path: "Floor", rect: [0, 0, 5, 2], source_id: 0, atlas_coords: [1, 2] });
  assert.equal(res.tileset_created, false);
  assert.equal(res.painted, true);
  assert.equal(res.layer_name, "Floor");
  assert.deepEqual(res.tile_size, [32, 48]);
  assert.equal(res.cell_count, 10);
});

test("board_tile_create paint defaults atlas_coords to [0,0]", async () => {
  const { calls, emit } = recorder();
  await emitBoardTileCreate(emit, {
    path: "res://b.tscn", rows: 1, cols: 1, tileset: "res://t.tres", paint: { source_id: 3 },
  });
  const fill = calls.find((c) => c.method === "tilemap.set_cells_rect");
  assert.deepEqual(fill?.params.atlas_coords, [0, 0]);
});

test("board_tile_create rejects bad dims, a bad tile_size, and paint without a tileset", async () => {
  const { emit } = recorder();
  await assert.rejects(emitBoardTileCreate(emit, { path: "res://b.tscn", rows: 0, cols: 2 }), /rows must be an integer/);
  await assert.rejects(emitBoardTileCreate(emit, { path: "res://b.tscn", rows: 2, cols: 2, tile_size: [16] }), /tile_size must be/);
  await assert.rejects(emitBoardTileCreate(emit, { path: "res://b.tscn", rows: 2, cols: 2, paint: { source_id: 0 } }), /paint. needs an existing .tileset/);
});

test("board_tile_place (center, default reparent) snaps to the cell centre under the layer", async () => {
  const { calls, emit } = recorder();
  const res = await emitBoardTilePlace(emit, { layer: "Board/Cells", node: "Main/Token", coord: [2, 1], tile_size: [32, 32] });

  assert.deepEqual(methods(calls), ["node.reparent", "node.set_property"]);
  assert.deepEqual(calls[0].params, { path: "Main/Token", new_parent_path: "Board/Cells", keep_global_transform: false });
  // centre of cell (2,1) with 32px tiles: ((2+0.5)*32, (1+0.5)*32) = (80, 48).
  assert.deepEqual(calls[1].params, { path: "Board/Cells/Token", property: "position", value: { __type__: "Vector2", x: 80, y: 48 } });
  assert.equal(res.node_path, "Board/Cells/Token");
  assert.deepEqual(res.local_pos, { x: 80, y: 48 });
  assert.equal(res.anchor, "center");
  assert.equal(res.reparented, true);
  assert.deepEqual(res.coord, [2, 1]);
});

test("board_tile_place corner + align + no reparent sets position on the node in place", async () => {
  const { calls, emit } = recorder();
  const res = await emitBoardTilePlace(emit, {
    layer: "Cells", node: "Cells/Token", coord: [3, 0], tile_size: [16, 16],
    anchor: "corner", align: { x: 2, y: -4 }, reparent: false,
  });
  assert.deepEqual(methods(calls), ["node.set_property"]);
  // corner of cell (3,0) with 16px tiles: (48, 0), plus align (2,-4) = (50, -4).
  assert.deepEqual(calls[0].params, { path: "Cells/Token", property: "position", value: { __type__: "Vector2", x: 50, y: -4 } });
  assert.equal(res.node_path, "Cells/Token");
  assert.equal(res.reparented, false);
  assert.equal(res.anchor, "corner");
  assert.deepEqual(res.align, { x: 2, y: -4 });
});

test("board_tile_place defaults tile_size to 64 and rejects a bad coord", async () => {
  const { calls, emit } = recorder();
  await emitBoardTilePlace(emit, { layer: "Cells", node: "Token", coord: [0, 0] });
  assert.deepEqual(calls[1].params.value, { __type__: "Vector2", x: 32, y: 32 }); // (0+0.5)*64
  await assert.rejects(emitBoardTilePlace(emit, { layer: "Cells", node: "T", coord: [1] }), /coord must be/);
});

// ============================================================================
// Group N — Piece slice (Increment 3). Same offline crux: each composite emits
// the exact ordered sequence of existing primitive ops. `piece_instance` and
// `piece_move` compose `board_place`; `piece_move`'s animated path is proven to
// stay additive (only node.* + anim.* ops — never a new engine call).
// ============================================================================

test("piece_template_create emits scene.new → Art → Label → script → save, in order", async () => {
  const { calls, emit } = recorder();
  const res = await emitPieceTemplate(emit, {
    path: "res://ui/pieces/Piece.tscn",
    size: { width: 64, height: 64 },
  });

  assert.deepEqual(methods(calls), [
    "scene.new",
    "node.add", // Art
    "node.add", // Label
    "resource.create", // GDScript
    "node.set_property", // attach script
    "scene.save",
  ]);
  assert.deepEqual(calls[0].params, { root_type: "Node2D", path: "res://ui/pieces/Piece.tscn", name: "Piece" });
  assert.deepEqual(calls[1].params, { parent_path: ".", type: "Sprite2D", name: "Art" });
  assert.deepEqual(calls[2].params, { parent_path: ".", type: "Label", name: "Label" });
  assert.equal(calls[3].params.class_name, "GDScript");
  const src = (calls[3].params.properties as Record<string, string>).source_code;
  assert.match(src, /func set_data/);
  assert.match(src, /func set_face/);
  assert.deepEqual(calls[4].params.value, { __type__: "Resource", class: "GDScript", path: "res://ui/pieces/Piece.gd" });

  assert.equal(res.scene_path, "res://ui/pieces/Piece.tscn");
  assert.equal(res.script_path, "res://ui/pieces/Piece.gd");
  assert.equal(res.root_type, "Node2D");
  assert.equal(res.has_label, true);
  assert.equal(res.has_hit_area, false);
  assert.equal(res.has_back, false);
  assert.equal(res.node_count, 3); // root + Art + Label
  assert.equal(res.saved, true);
  assert.deepEqual(res.nodes, [
    { name: "Art", node_path: "Art", type: "Sprite2D" },
    { name: "Label", node_path: "Label", type: "Label" },
  ]);
});

test("piece_template_create: Control root + art + color + rectangle hit area + colour back", async () => {
  const { calls, emit } = recorder();
  const res = await emitPieceTemplate(emit, {
    path: "res://ui/pieces/Token.tscn",
    size: { width: 48, height: 72 },
    root_type: "Control",
    art: "res://art/token.png",
    color: "#00ffaa",
    hit_area: { shape: "rectangle" },
    back: { color: "#101014" },
  });

  // Art is a TextureRect under a Control root; texture + tint + size are set.
  assert.equal(calls[1].params.type, "TextureRect");
  const artProps = calls.filter((c) => c.method === "node.set_property" && c.params.path === "Art").map((c) => c.params.property);
  assert.deepEqual(artProps, ["texture", "self_modulate", "size"]);
  // Hit area: Area2D → sized RectangleShape2D resource → CollisionShape2D → bind.
  const shapeRes = calls.find((c) => c.method === "resource.create" && c.params.class_name === "RectangleShape2D")!;
  assert.deepEqual((shapeRes.params.properties as Record<string, unknown>).size, { __type__: "Vector2", x: 48, y: 72 });
  assert.ok(calls.some((c) => c.method === "node.add" && c.params.name === "HitArea" && c.params.type === "Area2D"));
  assert.ok(calls.some((c) => c.method === "node.add" && c.params.name === "Shape" && c.params.type === "CollisionShape2D"));
  const shapeBind = calls.find((c) => c.method === "node.set_property" && c.params.path === "HitArea/Shape" && c.params.property === "shape")!;
  assert.deepEqual(shapeBind.params.value, { __type__: "Resource", class: "RectangleShape2D", path: "res://ui/pieces/Token.shape.tres" });
  // Back is a ColorRect, coloured, and hidden by default.
  assert.ok(calls.some((c) => c.method === "node.add" && c.params.name === "Back" && c.params.type === "ColorRect"));
  const backVisible = calls.find((c) => c.method === "node.set_property" && c.params.path === "Back" && c.params.property === "visible")!;
  assert.equal(backVisible.params.value, false);
  // The generated script guards Back (two-sided).
  const src = (calls.find((c) => c.method === "resource.create" && c.params.class_name === "GDScript")!.params.properties as Record<string, string>).source_code;
  assert.match(src, /has_node\("Back"\)/);

  assert.equal(res.has_hit_area, true);
  assert.equal(res.has_back, true);
  assert.equal(res.node_count, 6); // root + Art + Label + HitArea + Shape + Back
});

test("piece_template_create: a circle hit area builds a CircleShape2D sized to min(w,h)/2", async () => {
  const { calls, emit } = recorder();
  await emitPieceTemplate(emit, {
    path: "res://ui/pieces/Round.tscn",
    size: { width: 40, height: 60 },
    label: false,
    hit_area: { shape: "circle" },
  });
  const shapeRes = calls.find((c) => c.method === "resource.create" && c.params.class_name === "CircleShape2D")!;
  assert.equal((shapeRes.params.properties as Record<string, unknown>).radius, 20); // min(40,60)/2
  assert.equal(calls.filter((c) => c.method === "node.add" && c.params.name === "Label").length, 0); // label:false
});

test("piece_instance emits instantiate → set_data → set_face and surfaces the bind split", async () => {
  const { calls, emit } = recorder();
  const res = await emitPieceInstance(emit, {
    template_path: "res://ui/pieces/Piece.tscn",
    parent: "Main/Pieces",
    data: { label: "Scout", color: "#ff8800" },
  });
  assert.deepEqual(methods(calls), ["node.instantiate_scene", "node.call_method", "node.call_method"]);
  assert.deepEqual(calls[0].params, { parent_path: "Main/Pieces", scene_path: "res://ui/pieces/Piece.tscn", name: "Piece" });
  assert.equal(calls[1].params.method, "set_data");
  assert.deepEqual(calls[1].params.args, [{ label: "Scout", color: "#ff8800" }]);
  assert.equal(calls[2].params.method, "set_face");
  assert.equal(res.instance_path, "Main/Pieces/Piece");
  assert.equal(res.placed, false);
  assert.equal(res.cell, null);
  assert.deepEqual(res.bound.sort(), ["color", "label"]);
});

test("piece_instance place_on reparents onto the cell in the same call and reports it", async () => {
  const { calls, emit } = recorder();
  const res = await emitPieceInstance(emit, {
    template_path: "res://ui/pieces/Piece.tscn",
    parent: "Main/Pieces",
    data: { label: "Scout" },
    place_on: { board: "Board", cell: "n", align: { x: 0, y: -8 } },
  });
  assert.deepEqual(methods(calls), [
    "node.instantiate_scene", "node.call_method", "node.call_method", // instance + bind + face
    "node.reparent", "node.set_property", // board_place
  ]);
  assert.deepEqual(calls[3].params, { path: "Main/Pieces/Piece", new_parent_path: "Board/cell_n", keep_global_transform: false });
  assert.deepEqual(calls[4].params.value, { __type__: "Vector2", x: 0, y: -8 });
  assert.equal(res.placed, true);
  assert.equal(res.cell, "n");
  assert.equal(res.instance_path, "Board/cell_n/Piece"); // final placed path
});

test("piece_move (no animation) emits only the board_place ops — additive, final cell correct", async () => {
  const { calls, emit } = recorder();
  const res = await emitPieceMove(emit, { board: "Board", node: "Board/cell_n/Piece", to: "e", from: "n" });
  assert.deepEqual(methods(calls), ["node.reparent", "node.set_property"]);
  assert.deepEqual(calls[0].params, { path: "Board/cell_n/Piece", new_parent_path: "Board/cell_e", keep_global_transform: false });
  assert.equal(res.moved, true);
  assert.equal(res.animated, false);
  assert.equal(res.from, "n");
  assert.equal(res.to, "e");
  assert.equal(res.node_path, "Board/cell_e/Piece");
});

test("piece_move animated appends a scale pop from Group C anim primitives, still additive", async () => {
  const { calls, emit } = recorder();
  const res = await emitPieceMove(emit, {
    board: ".", node: "cell_n/Token", to: "s",
    animate: { duration: 0.4, pop_scale: 1.2 },
  });
  assert.deepEqual(methods(calls), [
    "node.reparent", "node.set_property", // board_place
    "anim.player_create", "anim.create", "anim.add_track",
    "anim.insert_key", "anim.insert_key", "anim.insert_key", "anim.set_length",
  ]);
  // Additivity: every emitted method is an existing node.* / anim.* primitive.
  const allowed = new Set([
    "node.reparent", "node.set_property",
    "anim.player_create", "anim.create", "anim.add_track", "anim.insert_key", "anim.set_length",
  ]);
  assert.ok(methods(calls).every((m) => allowed.has(m)), "piece_move must emit no new engine call");
  // The pop keys the piece's own scale 1 → pop → 1 at 0, dur/2, dur.
  const player = calls.find((c) => c.method === "anim.player_create")!;
  assert.deepEqual(player.params, { parent_path: "cell_s/Token", name: "MoveFX" });
  const track = calls.find((c) => c.method === "anim.add_track")!;
  assert.equal(track.params.path, ".:scale");
  const keys = calls.filter((c) => c.method === "anim.insert_key");
  assert.deepEqual(keys.map((k) => k.params.time), [0, 0.2, 0.4]);
  assert.deepEqual(keys.map((k) => k.params.value), [
    { __type__: "Vector2", x: 1, y: 1 },
    { __type__: "Vector2", x: 1.2, y: 1.2 },
    { __type__: "Vector2", x: 1, y: 1 },
  ]);
  const len = calls.find((c) => c.method === "anim.set_length")!;
  assert.equal(len.params.length, 0.4);
  assert.equal(res.animated, true);
  assert.equal(res.node_path, "cell_s/Token");
});

test("buildPieceScript is valid-looking GDScript with the two setters; Back guard only when two-sided", () => {
  const oneSided = buildPieceScript("Node2D", { hasLabel: true, hasBack: false });
  assert.match(oneSided, /^extends Node2D/);
  assert.match(oneSided, /func set_data\(data: Dictionary\) -> Dictionary:/);
  assert.match(oneSided, /func set_face\(face_up: bool\) -> void:/);
  assert.match(oneSided, /key == "label" and has_node\("Label"\)/);
  assert.doesNotMatch(oneSided, /has_node\("Back"\)/); // no back → no Back guard
  const twoSided = buildPieceScript("Control", { hasLabel: false, hasBack: true });
  assert.match(twoSided, /has_node\("Back"\)/);
  assert.doesNotMatch(twoSided, /has_node\("Label"\)/); // label:false → no Label branch
});

// ============================================================================
// Group N — Card-slice fast-follow: card_set_face. Instant flips call the setter
// directly; animated flips author a reusable scale-pinch + method-key clip from
// Group C anim primitives, and must stay additive (only node.* / anim.* ops).
// ============================================================================

test("card_set_face (instant) emits a single set_face call — additive, target echoed", async () => {
  const { calls, emit } = recorder();
  const res = await emitCardSetFace(emit, { node: "Main/Hand/Card_0", face_up: false });
  assert.deepEqual(methods(calls), ["node.call_method"]);
  assert.deepEqual(calls[0].params, { path: "Main/Hand/Card_0", method: "set_face", args: [false] });
  assert.equal(res.animated, false);
  assert.equal(res.face_up, false);
  assert.equal(res.method, "set_face");
  assert.equal(res.node_path, "Main/Hand/Card_0");
  assert.equal(res.player_path, null);
  assert.equal(res.anim, null);
});

test("card_set_face honours a custom setter method name", async () => {
  const { calls, emit } = recorder();
  const res = await emitCardSetFace(emit, { node: "P", face_up: true, method: "reveal" });
  assert.deepEqual(calls[0].params, { path: "P", method: "reveal", args: [true] });
  assert.equal(res.method, "reveal");
});

test("card_set_face animated authors a scale-pinch + method-key flip from Group C anim primitives, still additive", async () => {
  const { calls, emit } = recorder();
  const res = await emitCardSetFace(emit, {
    node: "Main/Card", face_up: false,
    animate: { duration: 0.4 },
  });
  // No immediate call_method — the method key inside the clip owns the swap.
  assert.deepEqual(methods(calls), [
    "anim.player_create", "anim.create", "anim.add_track",
    "anim.insert_key", "anim.insert_key", "anim.insert_key",
    "anim.add_track", "anim.insert_key", "anim.set_length",
  ]);
  // Additivity: every emitted method is an existing node.* / anim.* primitive.
  const allowed = new Set([
    "node.call_method",
    "anim.player_create", "anim.create", "anim.add_track", "anim.insert_key", "anim.set_length",
  ]);
  assert.ok(methods(calls).every((m) => allowed.has(m)), "card_set_face must emit no new engine call");
  // The player is added under the card; the two tracks target the node itself.
  const player = calls.find((c) => c.method === "anim.player_create")!;
  assert.deepEqual(player.params, { parent_path: "Main/Card", name: "FlipFX" });
  const tracks = calls.filter((c) => c.method === "anim.add_track");
  assert.deepEqual(tracks.map((t) => [t.params.path, t.params.type]), [[".:scale", "value"], [".", "method"]]);
  // The scale track pinches x to 0 at the midpoint (edge-on), back to 1 at the end.
  const keys = calls.filter((c) => c.method === "anim.insert_key");
  const scaleKeys = keys.filter((k) => k.params.track === 0);
  assert.deepEqual(scaleKeys.map((k) => k.params.time), [0, 0.2, 0.4]);
  assert.deepEqual(scaleKeys.map((k) => k.params.value), [
    { __type__: "Vector2", x: 1, y: 1 },
    { __type__: "Vector2", x: 0, y: 1 },
    { __type__: "Vector2", x: 1, y: 1 },
  ]);
  // The method key fires the setter at the midpoint with the target face state.
  const methodKey = keys.find((k) => k.params.track === 1)!;
  assert.equal(methodKey.params.time, 0.2);
  assert.deepEqual(methodKey.params.value, { method: "set_face", args: [false] });
  const len = calls.find((c) => c.method === "anim.set_length")!;
  assert.equal(len.params.length, 0.4);
  assert.equal(res.animated, true);
  assert.equal(res.player_path, "Main/Card/FlipFX");
  assert.equal(res.anim, "flip");
});

test("card_set_face animated respects custom player / anim / method names", async () => {
  const { calls, emit } = recorder();
  const res = await emitCardSetFace(emit, {
    node: ".", face_up: true, method: "reveal",
    animate: { player: "Flipper", anim: "turn", duration: 0.2 },
  });
  const player = calls.find((c) => c.method === "anim.player_create")!;
  assert.deepEqual(player.params, { parent_path: ".", name: "Flipper" });
  const methodKey = calls.filter((c) => c.method === "anim.insert_key").find((k) => k.params.track === 1)!;
  assert.deepEqual(methodKey.params.value, { method: "reveal", args: [true] });
  assert.equal(res.player_path, "Flipper"); // joinPath(".", "Flipper")
  assert.equal(res.anim, "turn");
});

// ============================================================================
// Group N — Interaction slice (Increment 4). Same offline crux: each composite
// emits the exact ordered sequence of existing primitive ops. The generated
// behaviour scripts are pure string builders, unit-tested directly; a headless
// build smoke proves they compile + behave in real Godot.
// ============================================================================

test("gdQuote / gdDictLiteral render valid GDScript literals with escaping", () => {
  assert.equal(gdQuote("a\"b\\c"), '"a\\"b\\\\c"');
  assert.equal(gdDictLiteral({}), "{}");
  assert.equal(gdDictLiteral({ kind: "x", n: 3, on: true }), '{"kind": "x", "n": 3, "on": true}');
});

test("interact_make_draggable control emits only resource.create + attach; no input/signal ops", async () => {
  const { calls, emit } = recorder();
  const res = await emitMakeDraggable(emit, {
    node: "Main/Card", script_path: "res://ui/interact/Draggable.gd", mode: "control",
    payload: { kind: "x", n: 3 },
  });
  assert.deepEqual(methods(calls), ["resource.create", "node.set_property"]);
  assert.equal(calls[0].params.class_name, "GDScript");
  assert.equal(calls[0].params.to_path, "res://ui/interact/Draggable.gd");
  const src = (calls[0].params.properties as Record<string, string>).source_code;
  assert.match(src, /^extends Control/);
  assert.match(src, /func _get_drag_data/);
  assert.match(src, /\{"kind": "x", "n": 3\}/);
  assert.doesNotMatch(src, /set_drag_preview/); // preview off
  assert.deepEqual(calls[1].params.value, { __type__: "Resource", class: "GDScript", path: "res://ui/interact/Draggable.gd" });
  assert.equal(res.mode, "control");
  assert.equal(res.action, null);
  assert.equal(res.connected, false);
  assert.deepEqual(res.payload_keys.sort(), ["kind", "n"]);
});

test("interact_make_draggable control + preview emits the drag-preview helper", async () => {
  const { calls, emit } = recorder();
  await emitMakeDraggable(emit, {
    node: ".", script_path: "res://ui/interact/D.gd", mode: "control", preview: true,
  });
  const src = (calls[0].params.properties as Record<string, string>).source_code;
  assert.match(src, /set_drag_preview\(_make_drag_preview\(\)\)/);
  assert.match(src, /func _make_drag_preview\(\) -> Control:/);
});

test("interact_make_draggable node2d emits action → event → script → attach → connect, in order", async () => {
  const { calls, emit } = recorder();
  const res = await emitMakeDraggable(emit, {
    node: "World/Token", script_path: "res://ui/interact/Drag2D.gd", mode: "node2d",
  });
  assert.deepEqual(methods(calls), [
    "inputmap.add_action", "inputmap.add_event",
    "resource.create", "node.set_property", "signal.connect",
  ]);
  assert.deepEqual(calls[0].params, { name: "drag", save: true });
  assert.deepEqual(calls[1].params, { name: "drag", event: { type: "mouse_button", button_index: 1 }, save: true });
  // The hit source defaults to the node itself; the target method is the handler.
  assert.deepEqual(calls[4].params, { path: "World/Token", signal: "input_event", target_path: "World/Token", method: "_on_drag_input", flags: 0 });
  const src = (calls[2].params.properties as Record<string, string>).source_code;
  assert.match(src, /^extends Node2D/);
  assert.match(src, /const DRAG_BUTTON := 1/);
  assert.match(src, /func _on_drag_input/);
  assert.equal(res.action, "drag");
  assert.equal(res.connected, true);
});

test("interact_make_draggable node2d honours custom button / action / hit_area", async () => {
  const { calls, emit } = recorder();
  await emitMakeDraggable(emit, {
    node: "World/Token", script_path: "res://ui/interact/Drag2D.gd", mode: "node2d",
    button: 2, action: "grab", hit_area: "HitArea",
  });
  assert.equal(calls[0].params.name, "grab");
  assert.deepEqual(calls[1].params.event, { type: "mouse_button", button_index: 2 });
  assert.equal(calls[4].params.path, "World/Token/HitArea"); // hit source = node/hit_area
  assert.equal(calls[4].params.target_path, "World/Token");  // handler still on the node
  const src = (calls[2].params.properties as Record<string, string>).source_code;
  assert.match(src, /const DRAG_BUTTON := 2/);
});

test("interact_add_drop_zone control emits script → attach → add_user_signal (accept predicate baked in)", async () => {
  const { calls, emit } = recorder();
  const res = await emitAddDropZone(emit, {
    node: "Main/Keep", script_path: "res://ui/interact/Zone.gd", mode: "control",
    accepts: { key: "kind", values: ["x", "y"] },
  });
  assert.deepEqual(methods(calls), ["resource.create", "node.set_property", "signal.add_user_signal"]);
  const src = (calls[0].params.properties as Record<string, string>).source_code;
  assert.match(src, /^extends Control/);
  assert.match(src, /func _can_drop_data/);
  assert.match(src, /func _drop_data/);
  assert.match(src, /const ACCEPT_KEY := "kind"/);
  assert.match(src, /const ACCEPT_VALUES := \["x", "y"\]/);
  assert.match(src, /const ON_DROP := "dropped"/);
  assert.deepEqual(calls[2].params, { path: "Main/Keep", signal: "dropped", args: [{ name: "payload", type: 27 }] });
  assert.equal(res.accepts_key, "kind");
  assert.deepEqual(res.accepts_values, ["x", "y"]);
  assert.equal(res.notified, false);
  assert.equal(res.area_path, null);
});

test("interact_add_drop_zone accept-any (no key) + notify appends signal.connect", async () => {
  const { calls, emit } = recorder();
  const res = await emitAddDropZone(emit, {
    node: "Main/Keep", script_path: "res://ui/interact/Zone.gd", mode: "control",
    on_drop: "chosen", notify: { target: "Main", method: "_on_chosen" },
  });
  assert.deepEqual(methods(calls), ["resource.create", "node.set_property", "signal.add_user_signal", "signal.connect"]);
  const src = (calls[0].params.properties as Record<string, string>).source_code;
  assert.match(src, /const ACCEPT_KEY := ""/);
  assert.match(src, /const ACCEPT_VALUES := \[\]/);
  assert.deepEqual(calls[3].params, { path: "Main/Keep", signal: "chosen", target_path: "Main", method: "_on_chosen", flags: 0 });
  assert.equal(res.on_drop, "chosen");
  assert.equal(res.accepts_key, "");
  assert.deepEqual(res.accepts_values, []);
  assert.equal(res.notified, true);
});

test("interact_add_drop_zone node2d builds an Area2D + sized shape before the script", async () => {
  const { calls, emit } = recorder();
  const res = await emitAddDropZone(emit, {
    node: "World/Slot", script_path: "res://ui/interact/Zone2D.gd", mode: "node2d",
    size: { width: 80, height: 120 }, shape: "circle",
  });
  assert.deepEqual(methods(calls), [
    "node.add", "resource.create", "node.add", "node.set_property", // DropArea + shape + CollisionShape2D + bind
    "resource.create", "node.set_property", "signal.add_user_signal", // script + attach + user signal
  ]);
  assert.deepEqual(calls[0].params, { parent_path: "World/Slot", type: "Area2D", name: "DropArea" });
  const shapeRes = calls.find((c) => c.method === "resource.create" && c.params.class_name === "CircleShape2D")!;
  assert.equal((shapeRes.params.properties as Record<string, unknown>).radius, 40); // min(80,120)/2
  assert.equal(shapeRes.params.to_path, "res://ui/interact/Zone2D.shape.tres");
  assert.deepEqual(calls[2].params, { parent_path: "World/Slot/DropArea", type: "CollisionShape2D", name: "Shape" });
  const src = (calls[4].params.properties as Record<string, string>).source_code;
  assert.match(src, /^extends Node2D/);
  assert.match(src, /func try_drop\(payload: Dictionary\) -> bool:/);
  assert.equal(res.area_path, "World/Slot/DropArea");
});

test("buildDraggableScript / buildDropZoneScript are valid-looking GDScript for both modes", () => {
  const dragControl = buildDraggableScript("control", { kind: "x" });
  assert.match(dragControl, /^extends Control/);
  assert.match(dragControl, /func get_drag_payload\(\) -> Dictionary:/);
  const dragNode2d = buildDraggableScript("node2d", {}, { button: 3 });
  assert.match(dragNode2d, /^extends Node2D/);
  assert.match(dragNode2d, /signal drag_started\(payload\)/);
  assert.match(dragNode2d, /const DRAG_BUTTON := 3/);
  const zoneControl = buildDropZoneScript("control", { acceptKey: "", acceptValues: [], onDrop: "dropped" });
  assert.match(zoneControl, /func _can_drop_data/);
  assert.doesNotMatch(zoneControl, /func try_drop/); // control has no try_drop seam
  const zoneNode2d = buildDropZoneScript("node2d", { acceptKey: "k", acceptValues: ["a"], onDrop: "dropped" });
  assert.match(zoneNode2d, /func try_drop/);
  assert.doesNotMatch(zoneNode2d, /func _can_drop_data/); // node2d has no Control override
});

// -------------------------------------------------- game-neutrality guardrail ----

test("the Card + Board + Piece tools carry NO game-specific vocabulary (general-purpose only)", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/tools/tabletop.ts"), "utf8");
  const banned = /\bD!?3\b|\bDDD\b|faang|amari|social[- ]deduction|seat[- ]ring|\bseats?\b|\brunway\b|\bvaluation\b|\bclout\b|\bhype\b|\bdebt\b|\bagenda\b|ai[- ]track|agenda_type|character[- ]catalog|\broster\b/i;
  assert.doesNotMatch(src, banned, "tabletop.ts must not reference any specific game");
});
