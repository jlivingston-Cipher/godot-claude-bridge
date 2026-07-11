import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  emitCardTemplate,
  emitCardInstance,
  emitCardHand,
  emitDeckFromTable,
  resolveColumnExpr,
  computeLayout,
  parseCsv,
  jsonRows,
  buildCardScript,
  sceneRootName,
  joinPath,
  parseHexColor,
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

// -------------------------------------------------- game-neutrality guardrail ----

test("the Card tools carry NO game-specific vocabulary (general-purpose only)", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/tools/tabletop.ts"), "utf8");
  const banned = /\bD!?3\b|\bDDD\b|faang|amari|social[- ]deduction|seat[- ]ring|\brunway\b|\bvaluation\b|\bclout\b|agenda_type|character[- ]catalog/i;
  assert.doesNotMatch(src, banned, "tabletop.ts must not reference any specific game");
});
