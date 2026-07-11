import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BridgeClient, BridgeError } from "../bridge.js";
import type { Config } from "../config.js";
import { gate } from "../confirm.js";
import { toFsPath, readFileText } from "../paths.js";

/**
 * Group N — Card / board / piece authoring composites (`card_*`, and later
 * `board_*` / `piece_*` / `interact_*`).
 *
 * Increment 1 is the Card slice: four composites that turn "build a card scene
 * from a spec", "stamp a card bound to data", "lay out a row/fan/stack/grid of
 * cards", and "stamp one card per row of a table" into single calls instead of
 * dozens of `scene_*` / `control_*` / `node_*` primitives each.
 *
 * Principle: **decompose onto audited primitives.** No tool here talks to the
 * engine directly — each emits an ordered list of existing bridge ops
 * (`scene.new`, `control.create`, `node.set_property`, `resource.create`, …)
 * through an injectable emit-sink, so the whole op-sequence is unit-tested
 * offline (given a spec, assert the exact primitive calls emitted) exactly like
 * the CLI's `runInit({fetchFn})` seam. Nothing new reaches the addon, so the
 * host↔addon contract is unchanged.
 *
 * These tools build *structure* only. They bind data a caller passes in; they
 * never invent card values, names, or rules. What a card looks like is Group N;
 * what a card does is not.
 */

// ---- result envelopes (mirror tools/netcode.ts + tools/assetgen.ts) ----

function ok(obj: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj,
  };
}

function fail(err: unknown) {
  const be = err as Partial<BridgeError> & { message?: string };
  const code = be?.code ?? "error";
  const message = be?.message ?? String(err);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Tabletop compose error [${code}]: ${message}` }],
  };
}

/** A bad-input failure that reads like a bridge error but never reaches the bridge. */
class ComposeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// -------------------------------------------------------------- emit sink ----

/**
 * The injectable primitive sink. In production it forwards to the editor
 * bridge; in tests it records `{method, params}` and returns a canned value, so
 * a composite's whole op-sequence is asserted without a live editor.
 */
export type Emit = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** Reader seam for `card_deck_from_table` — returns a table file's text. */
export type ReadFile = (path: string) => string;

// ------------------------------------------------------------ pure helpers ----

/** Join a scene-relative parent path and a child node name (`.`/`` = root). */
export function joinPath(parent: string, child: string): string {
  return parent === "" || parent === "." ? child : `${parent}/${child}`;
}

/** Derive a scene root node name from a `res://…/Foo.tscn` path (→ `Foo`). */
export function sceneRootName(scenePath: string): string {
  const base = scenePath.split("/").pop() ?? scenePath;
  const stem = base.replace(/\.[^.]+$/, "");
  const cleaned = stem.replace(/[^A-Za-z0-9_]/g, "");
  return cleaned.length > 0 ? cleaned : "Card";
}

/** Default `res://…/Foo.gd` script path derived from a `res://…/Foo.tscn`. */
function defaultScriptPath(scenePath: string): string {
  return scenePath.replace(/\.tscn$/, ".gd");
}

/** Reject node names that would break a node path. */
function assertNodeName(name: string): void {
  if (name === "" || /[/\s]/.test(name)) {
    throw new ComposeError("bad_params", `Invalid slot/node name: ${JSON.stringify(name)} (no spaces or slashes)`);
  }
}

/** Parse `#RGB[A]` hex into 0..1 [r,g,b,a]; throws on a malformed string. */
export function parseHexColor(hex: string): [number, number, number, number] {
  const m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(hex);
  if (!m) throw new ComposeError("bad_params", `Malformed colour ${JSON.stringify(hex)} (expected #RRGGBB or #RRGGBBAA)`);
  const h = m[1];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}

/** Tagged-Variant Color for `node.set_property` / `resource.create`. */
function colorVariant(hex: string): Record<string, unknown> {
  const [r, g, b, a] = parseHexColor(hex);
  return { __type__: "Color", r, g, b, a };
}

/** Tagged-Variant Vector2. */
function vec2(x: number, y: number): Record<string, unknown> {
  return { __type__: "Vector2", x, y };
}

/** Tagged-Variant Resource reference (a `res://` load by class). */
function resourceVariant(cls: string, path: string): Record<string, unknown> {
  return { __type__: "Resource", class: cls, path };
}

const ALIGN_TO_ENUM: Record<string, number> = { left: 0, center: 1, right: 2 };

// ------------------------------------------------------ column expressions ----

/**
 * Resolve a `card_deck_from_table` column expression against one row. A value is
 * either a bare `{column}` or a composed template like `{name} · {role}`; every
 * `{placeholder}` is replaced by that column's cell. A reference to a column the
 * row does not have is a hard error (surfaced, never silently blank).
 *
 * Returns both the resolved string and the set of columns it referenced (so the
 * caller can compute which table columns went unused). Pure — unit-tested.
 */
export function resolveColumnExpr(
  expr: string,
  row: Record<string, string>,
): { value: string; columns: string[] } {
  const columns: string[] = [];
  const value = expr.replace(/\{([^}]*)\}/g, (_full, rawName: string) => {
    const name = rawName.trim();
    if (name === "") throw new ComposeError("bad_params", `Empty {} placeholder in column expression ${JSON.stringify(expr)}`);
    if (!Object.prototype.hasOwnProperty.call(row, name)) {
      throw new ComposeError("bad_column", `Column ${JSON.stringify(name)} referenced by ${JSON.stringify(expr)} is not in the table`);
    }
    columns.push(name);
    return row[name] ?? "";
  });
  return { value, columns };
}

// --------------------------------------------------------------- CSV / JSON ----

/** Minimal RFC-4180-ish CSV parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field); field = "";
      if (record.length > 1 || record[0] !== "") rows.push(record);
      record = [];
    } else field += c;
  }
  if (field !== "" || record.length > 0) { record.push(field); if (record.length > 1 || record[0] !== "") rows.push(record); }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => { obj[h] = r[idx] ?? ""; });
    return obj;
  });
}

/** Coerce a parsed JSON document into a list of string-valued rows. */
export function jsonRows(text: string): Record<string, string>[] {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch (e) { throw new ComposeError("bad_table", `Table is not valid JSON: ${(e as Error).message}`); }
  let arr: unknown;
  if (Array.isArray(doc)) arr = doc;
  else if (doc && typeof doc === "object") {
    const vals = Object.values(doc as Record<string, unknown>);
    arr = (doc as Record<string, unknown>).rows ?? vals.find((v) => Array.isArray(v));
  }
  if (!Array.isArray(arr)) throw new ComposeError("bad_table", "JSON table must be an array of row objects (or an object holding one)");
  return arr.map((row) => {
    const obj: Record<string, string> = {};
    if (row && typeof row === "object") for (const [k, v] of Object.entries(row as Record<string, unknown>)) obj[k] = v == null ? "" : String(v);
    return obj;
  });
}

function readTableRows(text: string, format: "csv" | "json"): Record<string, string>[] {
  return format === "json" ? jsonRows(text) : parseCsv(text);
}

// ---------------------------------------------------------------- layout ----

export interface Placement { x: number; y: number; rotation?: number }

const DEFAULT_STEP = 110;
const DEFAULT_GRID_CELL = 120;

/**
 * Compute one placement per card for a layout mode. Pure and deterministic (no
 * engine, no card-size probing) so it is unit-tested directly. `rotation` is in
 * radians and only set for `fan`. Positions are top-left offsets in px.
 */
export function computeLayout(
  mode: "row" | "fan" | "stack" | "grid",
  count: number,
  opts: {
    spacing?: number; overlap?: number; fan_angle?: number;
    columns?: number; align?: "start" | "center" | "end"; origin?: { x: number; y: number };
  } = {},
): Placement[] {
  const origin = opts.origin ?? { x: 0, y: 0 };
  const align = opts.align ?? "center";
  const out: Placement[] = [];
  if (count <= 0) return out;

  if (mode === "row") {
    const step = (opts.spacing ?? DEFAULT_STEP) - (opts.overlap ?? 0);
    const span = step * (count - 1);
    const shift = align === "center" ? -span / 2 : align === "end" ? -span : 0;
    for (let i = 0; i < count; i++) out.push({ x: origin.x + shift + i * step, y: origin.y });
    return out;
  }
  if (mode === "fan") {
    const step = (opts.spacing ?? DEFAULT_STEP) - (opts.overlap ?? 0);
    const span = step * (count - 1);
    const shift = align === "end" ? -span : align === "start" ? 0 : -span / 2;
    const total = ((opts.fan_angle ?? 0) * Math.PI) / 180;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      out.push({ x: origin.x + shift + i * step, y: origin.y, rotation: count === 1 ? 0 : -total / 2 + t * total });
    }
    return out;
  }
  if (mode === "stack") {
    const off = opts.overlap ?? 0;
    for (let i = 0; i < count; i++) out.push({ x: origin.x + i * off, y: origin.y + i * off });
    return out;
  }
  // grid
  const cols = opts.columns ?? Math.max(1, Math.ceil(Math.sqrt(count)));
  const cell = opts.spacing ?? DEFAULT_GRID_CELL;
  const rowSpan = (cols - 1) * cell;
  const shift = align === "center" ? -rowSpan / 2 : align === "end" ? -rowSpan : 0;
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    out.push({ x: origin.x + shift + c * cell, y: origin.y + r * cell });
  }
  return out;
}

// ------------------------------------------------------- card spec typing ----

type SlotKind = "label" | "rich_text" | "texture" | "panel" | "badge";

interface Slot {
  name: string;
  kind: SlotKind;
  rect?: { x?: number; y?: number; w?: number; h?: number };
  anchor_preset?: number;
  font_size?: number;
  align?: "left" | "center" | "right";
  wrap?: boolean;
  color_by?: string;
  default_text?: string;
}

interface TemplateSpec {
  path: string;
  size: { width: number; height: number };
  root_type?: "PanelContainer" | "Panel" | "Control";
  slots: Slot[];
  face?: string[];
  back?: { art?: string; color?: string };
  theme_path?: string;
  theme?: {
    base_color?: string; accent_color?: string; font_path?: string; font_size?: number;
    panel_stylebox?: { bg_color?: string; corner_radius?: number; border_width?: number; border_color?: string };
  };
  script_path?: string;
  overwrite?: boolean;
}

/** Node path of a slot's bindable target (badge binds its inner Label). */
function slotTargetPath(slot: Slot): string {
  return slot.kind === "badge" ? `Face/${slot.name}/Label` : `Face/${slot.name}`;
}

const KIND_TO_CLASS: Record<SlotKind, string> = {
  label: "Label",
  rich_text: "RichTextLabel",
  texture: "TextureRect",
  panel: "Panel",
  badge: "Panel",
};

// ------------------------------------------------------ GDScript generator ----

/**
 * Generate the card's `set_data(data)` / `set_face(face_up)` GDScript. Pure and
 * exported for unit testing. Tab-indented to match the addon's GDScript. The
 * template carries this script so a bound instance updates through one method
 * call and can flip its face at runtime.
 */
export function buildCardScript(rootType: string, slots: Slot[], hasBack: boolean): string {
  const L: string[] = [];
  L.push(`extends ${rootType}`);
  L.push("## Card template generated by Breakpoint MCP (Group N). Do not edit by hand —");
  L.push("## re-run card_template_create to regenerate.");
  L.push("");
  L.push("func set_data(data: Dictionary) -> Dictionary:");
  L.push("\tvar bound: Array = []");
  L.push("\tfor key in data.keys():");
  L.push("\t\tvar v = data[key]");

  const branches: string[][] = [];
  for (const slot of slots) {
    const t = slotTargetPath(slot);
    if (slot.kind === "texture") {
      branches.push([
        `key == ${JSON.stringify(slot.name)} and has_node(${JSON.stringify(t)})`,
        `\t\t\tvar _tex = load(str(v))`,
        `\t\t\tif _tex: get_node(${JSON.stringify(t)}).texture = _tex`,
        `\t\t\tbound.append(key)`,
      ]);
    } else if (slot.kind === "panel") {
      branches.push([
        `key == ${JSON.stringify(slot.name)} and has_node(${JSON.stringify(t)})`,
        `\t\t\tget_node(${JSON.stringify(t)}).self_modulate = _to_color(str(v))`,
        `\t\t\tbound.append(key)`,
      ]);
    } else {
      branches.push([
        `key == ${JSON.stringify(slot.name)} and has_node(${JSON.stringify(t)})`,
        `\t\t\tget_node(${JSON.stringify(t)}).text = str(v)`,
        `\t\t\tbound.append(key)`,
      ]);
    }
  }
  // colour-by bindings: a slot tinted by another data key.
  for (const slot of slots) {
    if (!slot.color_by) continue;
    const t = `Face/${slot.name}`;
    branches.push([
      `key == ${JSON.stringify(slot.color_by)} and has_node(${JSON.stringify(t)})`,
      `\t\t\tget_node(${JSON.stringify(t)}).self_modulate = _to_color(str(v))`,
      `\t\t\tbound.append(key)`,
    ]);
  }

  branches.forEach((b, i) => {
    L.push(`\t\t${i === 0 ? "if" : "elif"} ${b[0]}:`);
    for (let j = 1; j < b.length; j++) L.push(b[j]);
  });

  L.push("\tvar unbound: Array = []");
  L.push("\tfor key in data.keys():");
  L.push("\t\tif not bound.has(key):");
  L.push("\t\t\tunbound.append(key)");
  L.push("\treturn {\"bound\": bound, \"unbound\": unbound}");
  L.push("");
  L.push("func set_face(face_up: bool) -> void:");
  L.push("\tif has_node(\"Face\"):");
  L.push("\t\tget_node(\"Face\").visible = face_up");
  if (hasBack) {
    L.push("\tif has_node(\"Back\"):");
    L.push("\t\tget_node(\"Back\").visible = not face_up");
  }
  L.push("");
  L.push("func _to_color(s: String) -> Color:");
  L.push("\treturn Color.html(s) if s.begins_with(\"#\") else Color(1, 1, 1, 1)");
  L.push("");
  return L.join("\n");
}

// ----------------------------------------------------- composite: template ----

interface TemplateResult {
  scene_path: string; script_path: string; root_type: string; has_back: boolean;
  node_count: number; saved: boolean;
  slots: Array<{ name: string; node_path: string; kind: string }>;
}

/** Emit the full op-sequence that builds + saves a card template scene. */
export async function emitCardTemplate(emit: Emit, spec: TemplateSpec): Promise<TemplateResult> {
  const rootType = spec.root_type ?? "PanelContainer";
  const scriptPath = spec.script_path ?? defaultScriptPath(spec.path);
  const rootName = sceneRootName(spec.path);
  const hasBack = spec.back !== undefined;
  for (const slot of spec.slots) assertNodeName(slot.name);

  // 1. fresh scene rooted at the card node.
  await emit("scene.new", { root_type: rootType, path: spec.path, name: rootName });

  // 2. the face container that holds every slot.
  await emit("control.create", { parent_path: ".", type: "Control", name: "Face" });

  // 3. optional inline theme (built on disk, then assigned at the end).
  let themePath = spec.theme_path;
  if (!themePath && spec.theme) {
    themePath = spec.path.replace(/\.tscn$/, ".theme.tres");
    const sb = spec.theme.panel_stylebox;
    if (sb) {
      const stylePath = spec.path.replace(/\.tscn$/, ".stylebox.tres");
      const props: Record<string, unknown> = {};
      if (sb.bg_color) props.bg_color = colorVariant(sb.bg_color);
      if (sb.corner_radius !== undefined) {
        for (const c of ["top_left", "top_right", "bottom_left", "bottom_right"]) props[`corner_radius_${c}`] = sb.corner_radius;
      }
      if (sb.border_width !== undefined) {
        for (const s of ["left", "top", "right", "bottom"]) props[`border_width_${s}`] = sb.border_width;
      }
      if (sb.border_color) props.border_color = colorVariant(sb.border_color);
      await emit("resource.create", { class_name: "StyleBoxFlat", to_path: stylePath, properties: props });
      await emit("theme.create", { to_path: themePath });
      await emit("theme.set_stylebox", { path: themePath, name: "panel", theme_type: rootType, stylebox_path: stylePath });
    } else {
      await emit("theme.create", { to_path: themePath });
    }
    if (spec.theme.base_color) {
      await emit("theme.set_color", { path: themePath, name: "font_color", theme_type: "Label", color: parseHexColor(spec.theme.base_color) });
    }
    if (spec.theme.font_path) {
      await emit("theme.set_font", { path: themePath, name: "font", theme_type: "Label", font_path: spec.theme.font_path });
    }
  }

  // 4. one node per slot, plus geometry + static styling.
  const slotMap: Array<{ name: string; node_path: string; kind: string }> = [];
  for (const slot of spec.slots) {
    const path = `Face/${slot.name}`;
    await emit("control.create", { parent_path: "Face", type: KIND_TO_CLASS[slot.kind], name: slot.name });
    if (slot.kind === "badge") {
      await emit("control.create", { parent_path: path, type: "Label", name: "Label" });
    }
    if (slot.rect) {
      await emit("node.set_property", { path, property: "position", value: vec2(slot.rect.x ?? 0, slot.rect.y ?? 0) });
      if (slot.rect.w !== undefined || slot.rect.h !== undefined) {
        await emit("node.set_property", { path, property: "size", value: vec2(slot.rect.w ?? 0, slot.rect.h ?? 0) });
      }
    } else if (slot.anchor_preset !== undefined) {
      await emit("control.set_layout_preset", { path, preset: slot.anchor_preset });
    }
    const textTarget = slotTargetPath(slot);
    const textual = slot.kind === "label" || slot.kind === "rich_text" || slot.kind === "badge";
    if (slot.default_text !== undefined && textual) {
      await emit("node.set_property", { path: textTarget, property: "text", value: slot.default_text });
    }
    if (slot.align && textual) {
      await emit("node.set_property", { path: textTarget, property: "horizontal_alignment", value: ALIGN_TO_ENUM[slot.align] });
    }
    if (slot.wrap && textual) {
      await emit("node.set_property", { path: textTarget, property: "autowrap_mode", value: 2 });
    }
    if (slot.font_size !== undefined && textual) {
      await emit("node.set_property", { path: textTarget, property: "theme_override_font_sizes/font_size", value: slot.font_size });
    }
    slotMap.push({ name: slot.name, node_path: textTarget, kind: slot.kind });
  }

  // 5. optional card back (makes the template two-sided).
  let backNodes = 0;
  if (spec.back) {
    await emit("control.create", { parent_path: ".", type: "Control", name: "Back" });
    backNodes++;
    if (spec.back.art) {
      await emit("control.create", { parent_path: "Back", type: "TextureRect", name: "Art" });
      backNodes++;
      if (spec.back.art.startsWith("res://")) {
        await emit("node.set_property", { path: "Back/Art", property: "texture", value: resourceVariant("Texture2D", spec.back.art) });
      }
    }
    if (spec.back.color) {
      await emit("control.create", { parent_path: "Back", type: "Panel", name: "Panel" });
      backNodes++;
      await emit("node.set_property", { path: "Back/Panel", property: "self_modulate", value: colorVariant(spec.back.color) });
    }
    await emit("node.set_property", { path: "Back", property: "visible", value: false });
  }

  // 6. generate + attach the card script.
  const source = buildCardScript(rootType, spec.slots, hasBack);
  await emit("resource.create", { class_name: "GDScript", to_path: scriptPath, properties: { source_code: source } });
  await emit("node.set_property", { path: ".", property: "script", value: resourceVariant("GDScript", scriptPath) });

  // 7. assign the theme (if any), then persist.
  if (themePath) await emit("control.set_theme", { path: ".", theme_path: themePath });
  await emit("scene.save", {});

  const nodeCount = 1 /* root */ + 1 /* Face */ + spec.slots.length +
    spec.slots.filter((s) => s.kind === "badge").length + backNodes;
  return {
    scene_path: spec.path, script_path: scriptPath, root_type: rootType, has_back: hasBack,
    node_count: nodeCount, saved: true, slots: slotMap,
  };
}

// ----------------------------------------------------- composite: instance ----

/** Extract a `{bound, unbound}` split from a `set_data` call result. */
function splitFromCall(res: unknown, data: Record<string, unknown>): { bound: string[]; unbound: string[] } {
  const result = (res as { result?: unknown } | undefined)?.result as { bound?: unknown; unbound?: unknown } | undefined;
  const bound = Array.isArray(result?.bound) ? (result!.bound as unknown[]).map(String) : [];
  const unbound = Array.isArray(result?.unbound)
    ? (result!.unbound as unknown[]).map(String)
    : Object.keys(data).filter((k) => !bound.includes(k));
  return { bound, unbound };
}

/** Instance one card + bind + set face. Returns the instance path + bind split. */
async function emitOneCard(
  emit: Emit,
  args: { template_path: string; parent: string; data: Record<string, unknown>; name: string; face_up: boolean; placement?: Placement },
): Promise<{ instance_path: string; bound: string[]; unbound: string[] }> {
  const instPath = joinPath(args.parent, args.name);
  await emit("node.instantiate_scene", { parent_path: args.parent, scene_path: args.template_path, name: args.name });
  if (args.placement) {
    await emit("node.set_property", { path: instPath, property: "position", value: vec2(args.placement.x, args.placement.y) });
    if (args.placement.rotation !== undefined && args.placement.rotation !== 0) {
      await emit("node.set_property", { path: instPath, property: "rotation", value: args.placement.rotation });
    }
  }
  const res = await emit("node.call_method", { path: instPath, method: "set_data", args: [args.data] });
  await emit("node.call_method", { path: instPath, method: "set_face", args: [args.face_up] });
  return { instance_path: instPath, ...splitFromCall(res, args.data) };
}

export async function emitCardInstance(
  emit: Emit,
  args: { template_path: string; parent: string; data: Record<string, unknown>; position?: { x: number; y: number }; face_up?: boolean; name?: string },
): Promise<{ instance_path: string; face_up: boolean; bound: string[]; unbound: string[] }> {
  const face_up = args.face_up ?? true;
  const name = args.name ?? sceneRootName(args.template_path);
  const { instance_path, bound, unbound } = await emitOneCard(emit, {
    template_path: args.template_path, parent: args.parent, data: args.data, name, face_up,
    placement: args.position ? { x: args.position.x, y: args.position.y } : undefined,
  });
  return { instance_path, face_up, bound, unbound };
}

// ------------------------------------------------------- composite: layout ----

interface LayoutKnobs {
  mode: "row" | "fan" | "stack" | "grid";
  spacing?: number; overlap?: number; fan_angle?: number; columns?: number;
  align?: "start" | "center" | "end"; origin?: { x: number; y: number };
}

export async function emitCardHand(
  emit: Emit,
  args: LayoutKnobs & {
    template_path: string; parent: string;
    cards: Array<{ data: Record<string, unknown>; face_up?: boolean }>;
  },
): Promise<{ container_path: string; mode: string; count: number; instances: Array<{ index: number; instance_path: string }> }> {
  const container = args.parent === "" ? "." : args.parent;
  const base = sceneRootName(args.template_path);
  const places = computeLayout(args.mode, args.cards.length, args);
  const instances: Array<{ index: number; instance_path: string }> = [];
  for (let i = 0; i < args.cards.length; i++) {
    const { instance_path } = await emitOneCard(emit, {
      template_path: args.template_path, parent: container, data: args.cards[i].data,
      name: `${base}_${i}`, face_up: args.cards[i].face_up ?? true, placement: places[i],
    });
    instances.push({ index: i, instance_path });
  }
  return { container_path: container, mode: args.mode, count: instances.length, instances };
}

// ----------------------------------------------------- composite: deck/table ----

interface DeckArgs {
  template_path: string; parent: string; table_path: string; format?: "csv" | "json";
  column_map: Record<string, string>;
  filter?: { column: string; equals: string | number | boolean };
  art_column?: string; limit?: number; face_up?: boolean;
  layout?: LayoutKnobs;
}

interface DeckResult {
  deck_container: string; count: number; rows_read: number; rows_skipped: number;
  unmapped_columns: string[]; instances: Array<{ row_index: number; instance_path: string }>;
}

export async function emitDeckFromTable(emit: Emit, readFile: ReadFile, args: DeckArgs): Promise<DeckResult> {
  const container = args.parent === "" ? "." : args.parent;
  const base = sceneRootName(args.template_path);
  const face_up = args.face_up ?? true;
  const format: "csv" | "json" = args.format ?? (args.table_path.toLowerCase().endsWith(".json") ? "json" : "csv");

  const text = readFile(args.table_path);
  if (text === "") throw new ComposeError("not_found", `Cannot read table ${args.table_path} (does it exist?)`);
  const allRows = readTableRows(text, format);
  const rows_read = allRows.length;
  const header = new Set<string>();
  for (const r of allRows) for (const k of Object.keys(r)) header.add(k);

  // which columns are actually referenced (by a placeholder, art, or filter)?
  const referenced = new Set<string>();
  if (args.art_column) referenced.add(args.art_column);
  if (args.filter) referenced.add(args.filter.column);

  // select rows: filter → limit.
  let selected = args.filter
    ? allRows.filter((r) => String(r[args.filter!.column] ?? "") === String(args.filter!.equals))
    : allRows.slice();
  if (args.limit !== undefined) selected = selected.slice(0, args.limit);

  const places = args.layout ? computeLayout(args.layout.mode, selected.length, args.layout) : [];
  const instances: Array<{ row_index: number; instance_path: string }> = [];

  for (let i = 0; i < selected.length; i++) {
    const row = selected[i];
    const data: Record<string, unknown> = {};
    for (const [slot, expr] of Object.entries(args.column_map)) {
      const { value, columns } = resolveColumnExpr(expr, row);
      for (const c of columns) referenced.add(c);
      data[slot] = value;
    }
    if (args.art_column && row[args.art_column]) data.art = row[args.art_column];
    const name = `${base}_${i}`;
    const { instance_path } = await emitOneCard(emit, {
      template_path: args.template_path, parent: container, data, name, face_up,
      placement: args.layout ? places[i] : undefined,
    });
    instances.push({ row_index: allRows.indexOf(row), instance_path });
  }

  const unmapped_columns = [...header].filter((c) => !referenced.has(c)).sort();
  return {
    deck_container: container, count: instances.length, rows_read,
    rows_skipped: rows_read - instances.length, unmapped_columns, instances,
  };
}

// ------------------------------------------------- composite: card set face ----

interface CardSetFaceAnimate { duration?: number; player?: string; anim?: string; transition?: number }
interface CardSetFaceArgs {
  node: string;
  face_up: boolean;
  method?: string;
  animate?: CardSetFaceAnimate;
}
interface CardSetFaceResult {
  node_path: string; face_up: boolean; method: string; animated: boolean;
  player_path: string | null; anim: string | null;
}

/**
 * Flip an instanced card (or any node exposing a `set_face(bool)` setter — the
 * generated card AND piece scripts both do) between its face and back.
 *
 * Instant (default): calls the setter now, so the visible side changes at once.
 *
 * Animated: instead authors a reusable flip *clip* under the node from existing
 * Group C anim primitives — a horizontal "pinch" on the node's own `scale`
 * (1 → edge-on `(0, 1)` → 1) plus a `method` key that calls the setter at the
 * edge-on midpoint, so playing the clip performs a believable flip and swaps the
 * side exactly when the card is thinnest. Purely additive: it emits only existing
 * `node.*` / `anim.*` ops — no new bridge method — so it stays offline-testable
 * and out of the host↔addon parity scan, exactly like `piece_move`. The clip is
 * played on demand (like `piece_move`'s pop); the current face is unchanged until
 * it plays. The method track path is `.` (the node itself, via the player's
 * default `root_node` of `..`), matching `piece_move`'s `.:scale` convention.
 */
export async function emitCardSetFace(emit: Emit, args: CardSetFaceArgs): Promise<CardSetFaceResult> {
  if (args.node === "") throw new ComposeError("bad_params", "Missing 'node' (the card to flip)");
  const method = args.method ?? "set_face";
  assertNodeName(method);

  if (!args.animate) {
    await emit("node.call_method", { path: args.node, method, args: [args.face_up] });
    return { node_path: args.node, face_up: args.face_up, method, animated: false, player_path: null, anim: null };
  }

  const player = args.animate.player ?? "FlipFX";
  const animName = args.animate.anim ?? "flip";
  const duration = args.animate.duration ?? 0.3;
  const transition = args.animate.transition ?? 1.0;
  const mid = duration / 2;
  const playerPath = joinPath(args.node, player);

  // Track 0 — a horizontal pinch on the node's own scale: 1 → edge-on → 1. Keyed
  // relative to the node (`.:scale`), so it needs no world-transform knowledge.
  await emit("anim.player_create", { parent_path: args.node, name: player });
  await emit("anim.create", { player_path: playerPath, name: animName, library: "" });
  await emit("anim.add_track", { player_path: playerPath, name: animName, path: ".:scale", type: "value", library: "" });
  await emit("anim.insert_key", { player_path: playerPath, name: animName, track: 0, time: 0, value: vec2(1, 1), transition, library: "" });
  await emit("anim.insert_key", { player_path: playerPath, name: animName, track: 0, time: mid, value: vec2(0, 1), transition, library: "" });
  await emit("anim.insert_key", { player_path: playerPath, name: animName, track: 0, time: duration, value: vec2(1, 1), transition, library: "" });

  // Track 1 — a method key that swaps the visible side at the edge-on midpoint.
  await emit("anim.add_track", { player_path: playerPath, name: animName, path: ".", type: "method", library: "" });
  await emit("anim.insert_key", { player_path: playerPath, name: animName, track: 1, time: mid, value: { method, args: [args.face_up] }, transition, library: "" });
  await emit("anim.set_length", { player_path: playerPath, name: animName, length: duration, library: "" });

  return { node_path: args.node, face_up: args.face_up, method, animated: true, player_path: playerPath, anim: animName };
}

// =============================================================================
// Group N — Increment 2: the Board slice (`board_create`, `board_place`)
//
// A board is a spatial frame: a scene whose children are addressable *cells*
// (named `cell_<id>`, all in the `board_cells` group). `board_create` builds it
// from one of three general-purpose layouts — a `ring` of ids, a `grid` of
// rows×cols, or an explicit `cells` list — and `board_place` snaps any existing
// node (a card or piece instance) onto a cell by id. Like the Card slice these
// are host-side scripted sequences of already-audited primitives (`scene.new`,
// `node.add`, `node.set_property`, `node.add_to_group`, `node.reparent`,
// `scene.save`) emitted through the same injectable sink, so the whole
// op-sequence is unit-tested offline. Nothing here is game-specific: cells carry
// only caller-supplied ids and nothing else — no domain concepts baked in.
// =============================================================================

/** One resolved board cell: an id and its local position under the board root. */
export interface BoardCell { id: string; x: number; y: number }

type CellKind = "marker" | "control";
type BoardRoot = "Node2D" | "Control";

const DEFAULT_CELL_SIZE = 96;
const BOARD_CELLS_GROUP = "board_cells";
const CELL_KIND_TO_CLASS: Record<CellKind, string> = { marker: "Marker2D", control: "Control" };

/** Degrees → radians. */
function deg2rad(d: number): number { return (d * Math.PI) / 180; }

/**
 * Place `ids` evenly around a ring. Pure + deterministic (no engine, no cell
 * probing) so it is unit-tested directly. Angle 0° points +x (right); +y is down
 * (Godot 2D), so with the default -90° start the first cell sits at the top and,
 * clockwise, the rest sweep right → bottom → left. Positions are local offsets in
 * px relative to `center` (default the board root's origin).
 */
export function computeRingCells(
  ids: string[],
  opts: { radius?: number; cell_size?: number; start_deg?: number; clockwise?: boolean; center?: { x: number; y: number } } = {},
): BoardCell[] {
  const n = ids.length;
  const cell = opts.cell_size ?? DEFAULT_CELL_SIZE;
  // Default radius keeps neighbouring cells about `cell_size` apart along the ring.
  const radius = opts.radius ?? (n <= 1 ? cell : Math.max(cell, (cell * n) / (2 * Math.PI)));
  const start = deg2rad(opts.start_deg ?? -90);
  const dir = (opts.clockwise ?? true) ? 1 : -1;
  const cx = opts.center?.x ?? 0;
  const cy = opts.center?.y ?? 0;
  const out: BoardCell[] = [];
  for (let i = 0; i < n; i++) {
    const a = start + dir * ((2 * Math.PI * i) / n);
    out.push({ id: ids[i], x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return out;
}

/**
 * Fill a rows×cols grid left-to-right, top-to-bottom. Cell id is `"<row>_<col>"`.
 * Pure + deterministic; positions are top-left offsets in px from `origin`.
 */
export function computeGridCells(
  rows: number, cols: number, cell_size?: number,
  opts: { origin?: { x: number; y: number } } = {},
): BoardCell[] {
  const cell = cell_size ?? DEFAULT_CELL_SIZE;
  const ox = opts.origin?.x ?? 0;
  const oy = opts.origin?.y ?? 0;
  const out: BoardCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push({ id: `${r}_${c}`, x: ox + c * cell, y: oy + r * cell });
  }
  return out;
}

interface BoardBackground { color?: string; art?: string; size?: { w?: number; h?: number } }

type BoardLayout =
  | { mode: "ring"; cells: string[]; radius?: number; start_deg?: number; clockwise?: boolean; center?: { x: number; y: number } }
  | { mode: "grid"; rows: number; cols: number }
  | { mode: "cells"; cells: Array<{ id: string; x: number; y: number }> };

interface BoardSpec {
  path: string;
  layout: BoardLayout;
  cell_size?: number;
  cell_kind?: CellKind;
  root_type?: BoardRoot;
  background?: BoardBackground;
  overwrite?: boolean;
}

/** Resolve a layout spec to the ordered list of cells (pure — no emit). */
export function resolveBoardCells(layout: BoardLayout, cell_size?: number): BoardCell[] {
  if (layout.mode === "ring") {
    if (layout.cells.length === 0) throw new ComposeError("bad_params", "A ring layout needs at least one cell id");
    return computeRingCells(layout.cells, {
      radius: layout.radius, cell_size, start_deg: layout.start_deg,
      clockwise: layout.clockwise, center: layout.center,
    });
  }
  if (layout.mode === "grid") {
    if (layout.rows < 1 || layout.cols < 1) throw new ComposeError("bad_params", "A grid layout needs rows >= 1 and cols >= 1");
    return computeGridCells(layout.rows, layout.cols, cell_size);
  }
  if (layout.cells.length === 0) throw new ComposeError("bad_params", "An explicit cells layout needs at least one cell");
  return layout.cells.map((c) => ({ id: c.id, x: c.x, y: c.y }));
}

/** Node name for a cell id, validated so it can never break a node path. */
function cellNodeName(id: string): string {
  const name = `cell_${id}`;
  assertNodeName(name);
  return name;
}

interface BoardResult {
  scene_path: string; root_type: string; cell_kind: string; layout_mode: string;
  cell_count: number; node_count: number; saved: boolean;
  cells: Array<{ id: string; node_path: string; x: number; y: number }>;
}

/** Emit the full op-sequence that builds + saves a board scene with addressable cells. */
export async function emitBoardCreate(emit: Emit, spec: BoardSpec): Promise<BoardResult> {
  const rootType = spec.root_type ?? "Node2D";
  const cellKind = spec.cell_kind ?? "marker";
  const cellClass = CELL_KIND_TO_CLASS[cellKind];
  const rootName = sceneRootName(spec.path);
  const cells = resolveBoardCells(spec.layout, spec.cell_size);

  // Ids must be unique and must form legal node names.
  const seen = new Set<string>();
  for (const c of cells) {
    cellNodeName(c.id);
    if (seen.has(c.id)) throw new ComposeError("bad_params", `Duplicate cell id ${JSON.stringify(c.id)}`);
    seen.add(c.id);
  }

  // 1. fresh scene rooted at the board node.
  await emit("scene.new", { root_type: rootType, path: spec.path, name: rootName });

  // 2. optional background (emitted first so it draws behind the cells).
  let backgroundNodes = 0;
  if (spec.background) {
    const bg = spec.background;
    const bgType = bg.art ? (rootType === "Control" ? "TextureRect" : "Sprite2D") : "ColorRect";
    await emit("node.add", { parent_path: ".", type: bgType, name: "Background" });
    backgroundNodes = 1;
    if (bg.art) {
      if (bg.art.startsWith("res://")) {
        await emit("node.set_property", { path: "Background", property: "texture", value: resourceVariant("Texture2D", bg.art) });
      }
    } else if (bg.color) {
      await emit("node.set_property", { path: "Background", property: "color", value: colorVariant(bg.color) });
    }
    if (bg.size && bgType !== "Sprite2D") {
      await emit("node.set_property", { path: "Background", property: "size", value: vec2(bg.size.w ?? 0, bg.size.h ?? 0) });
    }
  }

  // 3. one anchor node per cell: add → position → join the board_cells group.
  const outCells: Array<{ id: string; node_path: string; x: number; y: number }> = [];
  for (const c of cells) {
    const name = cellNodeName(c.id);
    await emit("node.add", { parent_path: ".", type: cellClass, name });
    await emit("node.set_property", { path: name, property: "position", value: vec2(c.x, c.y) });
    await emit("node.add_to_group", { path: name, group: BOARD_CELLS_GROUP });
    outCells.push({ id: c.id, node_path: name, x: c.x, y: c.y });
  }

  // 4. persist.
  await emit("scene.save", {});

  return {
    scene_path: spec.path, root_type: rootType, cell_kind: cellKind, layout_mode: spec.layout.mode,
    cell_count: outCells.length, node_count: 1 + backgroundNodes + outCells.length, saved: true,
    cells: outCells,
  };
}

// ------------------------------------------------------- composite: place ----

interface PlaceArgs { board: string; cell: string; node: string; align?: { x?: number; y?: number } }
interface PlaceResult { placed: boolean; cell: string; cell_path: string; node_path: string; align: { x: number; y: number } }

/**
 * Reparent an existing node onto a board cell and snap it to the cell anchor.
 * The composite computes the destination path itself (cell node name + the moved
 * node's own name), so the sequence is fully offline-testable. `align` is an
 * offset from the cell origin (default {0,0} — centred on the anchor).
 */
export async function emitBoardPlace(emit: Emit, args: PlaceArgs): Promise<PlaceResult> {
  if (args.board === "") throw new ComposeError("bad_params", "Missing 'board' (the board root node path)");
  if (args.node === "") throw new ComposeError("bad_params", "Missing 'node' (the node to place)");
  const cellPath = joinPath(args.board, cellNodeName(args.cell));
  const nodeName = args.node.split("/").pop() ?? args.node;
  const dest = joinPath(cellPath, nodeName);
  const ax = args.align?.x ?? 0;
  const ay = args.align?.y ?? 0;
  await emit("node.reparent", { path: args.node, new_parent_path: cellPath, keep_global_transform: false });
  await emit("node.set_property", { path: dest, property: "position", value: vec2(ax, ay) });
  return { placed: true, cell: args.cell, cell_path: cellPath, node_path: dest, align: { x: ax, y: ay } };
}

// =============================================================================
// Group N — Board-slice fast-follow: tile-backed board cells
// (`board_tile_create`, `board_tile_place`)
//
// A marker board addresses cells through per-cell `cell_<id>` anchor nodes and
// `board_place` reparents onto one. A *tile* board is the other Group D idiom:
// a `TileMapLayer` grid whose cells are addressed by integer `[x, y]` tile
// coordinates — no per-cell anchor node exists, so `board_tile_place` snaps a
// node onto a coordinate by computing the cell's local position from the layer's
// `tile_size` (the same value `TileMapLayer.map_to_local` uses: a cell's centre
// is `(coord + 0.5) * tile_size`; its corner is `coord * tile_size`). Both tools
// stay host-side scripted sequences of already-audited primitives — `scene.new`,
// `tileset.create`, `tilemaplayer.create`, `tilemap.set_cells_rect`,
// `node.reparent`, `node.set_property`, `scene.save` — emitted through the same
// injectable sink, so the whole op-sequence is unit-tested offline. Nothing here
// is domain-specific: cells carry only integer coordinates.
// =============================================================================

const DEFAULT_TILE_SIZE = 64;

/** Normalise an optional `[w, h]` tile size to two positive integers. */
function normTileSize(ts?: number[]): [number, number] {
  if (ts === undefined) return [DEFAULT_TILE_SIZE, DEFAULT_TILE_SIZE];
  if (ts.length !== 2 || !ts.every((v) => Number.isInteger(v) && v > 0)) {
    throw new ComposeError("bad_params", "tile_size must be [width, height] positive integers");
  }
  return [ts[0], ts[1]];
}

/** Normalise a `[x, y]` tile coordinate to two integers. */
function normCoord(c: number[]): [number, number] {
  if (!Array.isArray(c) || c.length !== 2 || !c.every((v) => Number.isInteger(v))) {
    throw new ComposeError("bad_params", "coord must be [x, y] integers");
  }
  return [c[0], c[1]];
}

/** Derive a sibling TileSet path from a `res://…/Foo.tscn` scene path. */
function deriveTilesetPath(scenePath: string): string {
  return scenePath.replace(/\.tscn$/, "_tiles.tres");
}

interface TileBoardSpec {
  path: string;
  rows: number;
  cols: number;
  tile_size?: number[];
  tileset?: string;
  paint?: { source_id: number; atlas_coords?: number[] };
  layer_name?: string;
  overwrite?: boolean;
}

interface TileBoardResult {
  scene_path: string; layer_path: string; layer_name: string;
  rows: number; cols: number; tile_size: number[];
  tileset_path: string; tileset_created: boolean;
  cell_count: number; painted: boolean; node_count: number; saved: boolean;
}

/**
 * Emit the op-sequence that builds + saves a tile-backed board: a `TileMapLayer`
 * bound to a TileSet (created here unless `tileset` is supplied) that establishes
 * a rows×cols coordinate frame at `tile_size`, optionally filled with one tile.
 */
export async function emitBoardTileCreate(emit: Emit, spec: TileBoardSpec): Promise<TileBoardResult> {
  if (!Number.isInteger(spec.rows) || spec.rows < 1) throw new ComposeError("bad_params", "rows must be an integer >= 1");
  if (!Number.isInteger(spec.cols) || spec.cols < 1) throw new ComposeError("bad_params", "cols must be an integer >= 1");
  const tile = normTileSize(spec.tile_size);
  const layerName = spec.layer_name ?? "Cells";
  assertNodeName(layerName);
  if (spec.paint && spec.tileset === undefined) {
    throw new ComposeError("bad_params", "`paint` needs an existing `tileset` (with a painted source) to fill the grid from");
  }
  const rootName = sceneRootName(spec.path);
  const tilesetCreated = spec.tileset === undefined;
  const tilesetPath = spec.tileset ?? deriveTilesetPath(spec.path);

  // 1. fresh Node2D scene rooted at the board node.
  await emit("scene.new", { root_type: "Node2D", path: spec.path, name: rootName });

  // 2. the coordinate frame: bind a supplied TileSet, or create a fresh one so
  //    the layer has a real tile_size (map_to_local reads it) even when unpainted.
  if (tilesetCreated) {
    await emit("tileset.create", { to_path: tilesetPath, tile_size: tile });
  }

  // 3. the TileMapLayer that holds the cells.
  await emit("tilemaplayer.create", { parent_path: ".", name: layerName, tileset_path: tilesetPath });

  // 4. optional: fill the whole grid with one tile in a single undoable action.
  const painted = spec.paint !== undefined;
  if (spec.paint) {
    const atlas = spec.paint.atlas_coords ?? [0, 0];
    await emit("tilemap.set_cells_rect", {
      path: layerName, rect: [0, 0, spec.cols, spec.rows], source_id: spec.paint.source_id, atlas_coords: atlas,
    });
  }

  // 5. persist.
  await emit("scene.save", {});

  return {
    scene_path: spec.path, layer_path: layerName, layer_name: layerName,
    rows: spec.rows, cols: spec.cols, tile_size: tile,
    tileset_path: tilesetPath, tileset_created: tilesetCreated,
    cell_count: spec.rows * spec.cols, painted, node_count: 2, saved: true,
  };
}

// ------------------------------------------------- composite: place on a tile ----

interface TilePlaceArgs {
  layer: string; node: string; coord: number[];
  tile_size?: number[]; anchor?: "center" | "corner"; align?: { x?: number; y?: number }; reparent?: boolean;
}
interface TilePlaceResult {
  placed: boolean; coord: number[]; layer_path: string; node_path: string;
  local_pos: { x: number; y: number }; tile_size: number[]; anchor: string;
  align: { x: number; y: number }; reparented: boolean;
}

/**
 * Snap an existing node onto a tile coordinate of a `TileMapLayer`. The cell's
 * local position is computed host-side from `tile_size` — cell centre is
 * `(coord + 0.5) * tile_size`, corner is `coord * tile_size` — matching Godot's
 * `TileMapLayer.map_to_local`, plus an optional `align` offset. With `reparent`
 * (default) the node is moved under the layer so the coordinate is layer-local.
 */
export async function emitBoardTilePlace(emit: Emit, args: TilePlaceArgs): Promise<TilePlaceResult> {
  if (args.layer === "") throw new ComposeError("bad_params", "Missing 'layer' (the TileMapLayer node path)");
  if (args.node === "") throw new ComposeError("bad_params", "Missing 'node' (the node to place)");
  const coord = normCoord(args.coord);
  const [tw, th] = normTileSize(args.tile_size);
  const anchor = args.anchor ?? "center";
  const reparent = args.reparent ?? true;
  const ax = args.align?.x ?? 0;
  const ay = args.align?.y ?? 0;
  const frac = anchor === "center" ? 0.5 : 0;
  const px = (coord[0] + frac) * tw + ax;
  const py = (coord[1] + frac) * th + ay;
  const nodeName = args.node.split("/").pop() ?? args.node;
  const dest = reparent ? joinPath(args.layer, nodeName) : args.node;
  if (reparent) {
    await emit("node.reparent", { path: args.node, new_parent_path: args.layer, keep_global_transform: false });
  }
  await emit("node.set_property", { path: dest, property: "position", value: vec2(px, py) });
  return {
    placed: true, coord: [coord[0], coord[1]], layer_path: args.layer, node_path: dest,
    local_pos: { x: px, y: py }, tile_size: [tw, th], anchor, align: { x: ax, y: ay }, reparented: reparent,
  };
}

// =============================================================================
// Group N — Increment 3: the Piece slice (`piece_template_create`,
// `piece_instance`, `piece_move`)
//
// A piece is a movable token: a small scene with an `Art` node, an optional
// `Label`, an optional hit area (`Area2D` + `CollisionShape2D`) for hit-testing,
// and an optional two-sided `Back`. Like the Card slice it carries a generated
// script-backed `set_data()` / `set_face()` so a bound instance updates through
// one method call. `piece_instance` can `place_on` a cell (reusing
// `board_place`) in the same call, and `piece_move` reparents a piece onto a new
// cell (again via `board_place`) with an optional scale "pop" authored from the
// existing Group C anim primitives. All host-side scripted sequences of
// already-audited ops emitted through the same injectable sink — nothing here is
// game-specific (Art / Label / colour / hit area only), and no addon method is
// added, so the host↔addon contract is unchanged.
// =============================================================================

type PieceRoot = "Node2D" | "Control";
type HitShape = "rectangle" | "circle";

interface PieceSpec {
  path: string;
  size: { width: number; height: number };
  root_type?: PieceRoot;
  art?: string;
  color?: string;
  label?: boolean;
  label_text?: string;
  hit_area?: { shape?: HitShape };
  back?: { art?: string; color?: string };
  script_path?: string;
  overwrite?: boolean;
}

/**
 * Generate the piece's `set_data(data)` / `set_face(face_up)` GDScript. Pure and
 * exported for unit testing — the same script-backed binding pattern as the card,
 * so a bound instance updates through one method call. `set_data` binds the
 * neutral keys `art` (texture), `color` (Art tint) and, when present, `label`
 * (text); `set_face` flips Art/Label vs Back visibility.
 */
export function buildPieceScript(rootType: string, opts: { hasLabel: boolean; hasBack: boolean }): string {
  const L: string[] = [];
  L.push(`extends ${rootType}`);
  L.push("## Piece template generated by Breakpoint MCP (Group N). Do not edit by hand —");
  L.push("## re-run piece_template_create to regenerate.");
  L.push("");
  L.push("func set_data(data: Dictionary) -> Dictionary:");
  L.push("\tvar bound: Array = []");
  L.push("\tfor key in data.keys():");
  L.push("\t\tvar v = data[key]");

  const branches: string[][] = [
    [
      `key == "art" and has_node("Art")`,
      `\t\t\tvar _tex = load(str(v))`,
      `\t\t\tif _tex: get_node("Art").texture = _tex`,
      `\t\t\tbound.append(key)`,
    ],
    [
      `key == "color" and has_node("Art")`,
      `\t\t\tget_node("Art").self_modulate = _to_color(str(v))`,
      `\t\t\tbound.append(key)`,
    ],
  ];
  if (opts.hasLabel) {
    branches.push([
      `key == "label" and has_node("Label")`,
      `\t\t\tget_node("Label").text = str(v)`,
      `\t\t\tbound.append(key)`,
    ]);
  }
  branches.forEach((b, i) => {
    L.push(`\t\t${i === 0 ? "if" : "elif"} ${b[0]}:`);
    for (let j = 1; j < b.length; j++) L.push(b[j]);
  });

  L.push("\tvar unbound: Array = []");
  L.push("\tfor key in data.keys():");
  L.push("\t\tif not bound.has(key):");
  L.push("\t\t\tunbound.append(key)");
  L.push("\treturn {\"bound\": bound, \"unbound\": unbound}");
  L.push("");
  L.push("func set_face(face_up: bool) -> void:");
  L.push("\tif has_node(\"Art\"):");
  L.push("\t\tget_node(\"Art\").visible = face_up");
  if (opts.hasLabel) {
    L.push("\tif has_node(\"Label\"):");
    L.push("\t\tget_node(\"Label\").visible = face_up");
  }
  if (opts.hasBack) {
    L.push("\tif has_node(\"Back\"):");
    L.push("\t\tget_node(\"Back\").visible = not face_up");
  }
  L.push("");
  L.push("func _to_color(s: String) -> Color:");
  L.push("\treturn Color.html(s) if s.begins_with(\"#\") else Color(1, 1, 1, 1)");
  L.push("");
  return L.join("\n");
}

// ----------------------------------------------------- composite: piece template ----

interface PieceTemplateResult {
  scene_path: string; script_path: string; root_type: string;
  has_label: boolean; has_hit_area: boolean; has_back: boolean;
  node_count: number; saved: boolean;
  nodes: Array<{ name: string; node_path: string; type: string }>;
}

/** Emit the full op-sequence that builds + saves a piece template scene. */
export async function emitPieceTemplate(emit: Emit, spec: PieceSpec): Promise<PieceTemplateResult> {
  const rootType = spec.root_type ?? "Node2D";
  const scriptPath = spec.script_path ?? defaultScriptPath(spec.path);
  const rootName = sceneRootName(spec.path);
  const hasLabel = spec.label ?? true;
  const hasHitArea = spec.hit_area !== undefined;
  const hasBack = spec.back !== undefined;
  const isControl = rootType === "Control";
  const artType = isControl ? "TextureRect" : "Sprite2D";
  const nodes: Array<{ name: string; node_path: string; type: string }> = [];

  // 1. fresh scene rooted at the piece node.
  await emit("scene.new", { root_type: rootType, path: spec.path, name: rootName });

  // 2. the Art node (Sprite2D / TextureRect) + optional texture / tint / size.
  await emit("node.add", { parent_path: ".", type: artType, name: "Art" });
  nodes.push({ name: "Art", node_path: "Art", type: artType });
  if (spec.art && spec.art.startsWith("res://")) {
    await emit("node.set_property", { path: "Art", property: "texture", value: resourceVariant("Texture2D", spec.art) });
  }
  if (spec.color) {
    await emit("node.set_property", { path: "Art", property: "self_modulate", value: colorVariant(spec.color) });
  }
  if (isControl) {
    await emit("node.set_property", { path: "Art", property: "size", value: vec2(spec.size.width, spec.size.height) });
  }

  // 3. optional Label (the piece's name).
  if (hasLabel) {
    await emit("node.add", { parent_path: ".", type: "Label", name: "Label" });
    nodes.push({ name: "Label", node_path: "Label", type: "Label" });
    if (spec.label_text !== undefined) {
      await emit("node.set_property", { path: "Label", property: "text", value: spec.label_text });
    }
  }

  // 4. optional hit area: Area2D + CollisionShape2D with a sized shape resource.
  if (spec.hit_area) {
    const shapeKind: HitShape = spec.hit_area.shape ?? "rectangle";
    await emit("node.add", { parent_path: ".", type: "Area2D", name: "HitArea" });
    nodes.push({ name: "HitArea", node_path: "HitArea", type: "Area2D" });
    const shapeClass = shapeKind === "circle" ? "CircleShape2D" : "RectangleShape2D";
    const shapePath = spec.path.replace(/\.tscn$/, ".shape.tres");
    const shapeProps = shapeKind === "circle"
      ? { radius: Math.min(spec.size.width, spec.size.height) / 2 }
      : { size: vec2(spec.size.width, spec.size.height) };
    await emit("resource.create", { class_name: shapeClass, to_path: shapePath, properties: shapeProps });
    await emit("node.add", { parent_path: "HitArea", type: "CollisionShape2D", name: "Shape" });
    nodes.push({ name: "Shape", node_path: "HitArea/Shape", type: "CollisionShape2D" });
    await emit("node.set_property", { path: "HitArea/Shape", property: "shape", value: resourceVariant(shapeClass, shapePath) });
  }

  // 5. optional two-sided Back (makes the piece flippable).
  if (spec.back) {
    const backType = spec.back.art ? artType : "ColorRect";
    await emit("node.add", { parent_path: ".", type: backType, name: "Back" });
    nodes.push({ name: "Back", node_path: "Back", type: backType });
    if (spec.back.art && spec.back.art.startsWith("res://")) {
      await emit("node.set_property", { path: "Back", property: "texture", value: resourceVariant("Texture2D", spec.back.art) });
    } else if (spec.back.color) {
      await emit("node.set_property", { path: "Back", property: "color", value: colorVariant(spec.back.color) });
    }
    await emit("node.set_property", { path: "Back", property: "visible", value: false });
  }

  // 6. generate + attach the piece script.
  const source = buildPieceScript(rootType, { hasLabel, hasBack });
  await emit("resource.create", { class_name: "GDScript", to_path: scriptPath, properties: { source_code: source } });
  await emit("node.set_property", { path: ".", property: "script", value: resourceVariant("GDScript", scriptPath) });

  // 7. persist.
  await emit("scene.save", {});

  return {
    scene_path: spec.path, script_path: scriptPath, root_type: rootType,
    has_label: hasLabel, has_hit_area: hasHitArea, has_back: hasBack,
    node_count: 1 + nodes.length, saved: true, nodes,
  };
}

// ----------------------------------------------------- composite: piece instance ----

interface PieceInstanceArgs {
  template_path: string; parent: string;
  data: Record<string, unknown>;
  position?: { x: number; y: number };
  face_up?: boolean; name?: string;
  place_on?: { board: string; cell: string; align?: { x?: number; y?: number } };
}

/** Instance one piece + bind + set face, optionally placing it on a board cell. */
export async function emitPieceInstance(emit: Emit, args: PieceInstanceArgs): Promise<{
  instance_path: string; face_up: boolean; bound: string[]; unbound: string[]; placed: boolean; cell: string | null;
}> {
  const face_up = args.face_up ?? true;
  const name = args.name ?? sceneRootName(args.template_path);
  const instPath = joinPath(args.parent, name);
  await emit("node.instantiate_scene", { parent_path: args.parent, scene_path: args.template_path, name });
  if (args.position) {
    await emit("node.set_property", { path: instPath, property: "position", value: vec2(args.position.x, args.position.y) });
  }
  const res = await emit("node.call_method", { path: instPath, method: "set_data", args: [args.data] });
  await emit("node.call_method", { path: instPath, method: "set_face", args: [face_up] });
  const { bound, unbound } = splitFromCall(res, args.data);
  if (args.place_on) {
    const placed = await emitBoardPlace(emit, {
      board: args.place_on.board, cell: args.place_on.cell, node: instPath, align: args.place_on.align,
    });
    return { instance_path: placed.node_path, face_up, bound, unbound, placed: true, cell: args.place_on.cell };
  }
  return { instance_path: instPath, face_up, bound, unbound, placed: false, cell: null };
}

// --------------------------------------------------------- composite: piece move ----

interface PieceAnimate { duration?: number; pop_scale?: number; player?: string; anim?: string; transition?: number }
interface PieceMoveArgs {
  board: string; node: string; to: string; from?: string;
  align?: { x?: number; y?: number };
  animate?: PieceAnimate;
}

/**
 * Move a piece onto a destination cell (reusing `board_place` for the reparent +
 * snap), optionally authoring a short scale "pop" via existing Group C anim
 * primitives. Purely additive: it emits only `node.*` + `anim.*` ops that already
 * exist — no new bridge method, so it stays offline-testable and out of the
 * host↔addon parity scan, exactly like the rest of Group N.
 */
export async function emitPieceMove(emit: Emit, args: PieceMoveArgs): Promise<{
  moved: boolean; from: string | null; to: string; node_path: string; animated: boolean;
}> {
  // Core move: reparent onto the destination cell and snap (the board_place seq).
  const placed = await emitBoardPlace(emit, { board: args.board, cell: args.to, node: args.node, align: args.align });
  const dest = placed.node_path;

  let animated = false;
  if (args.animate) {
    animated = true;
    const player = args.animate.player ?? "MoveFX";
    const animName = args.animate.anim ?? "move";
    const duration = args.animate.duration ?? 0.25;
    const pop = args.animate.pop_scale ?? 1.15;
    const transition = args.animate.transition ?? 1.0;
    const playerPath = joinPath(dest, player);
    // A scale pop (1 → pop → 1) on one value track of an AnimationPlayer added
    // under the moved piece. Keyed relative to the piece's own scale (`.:scale`),
    // so it is deterministic and needs no world-transform knowledge.
    await emit("anim.player_create", { parent_path: dest, name: player });
    await emit("anim.create", { player_path: playerPath, name: animName, library: "" });
    await emit("anim.add_track", { player_path: playerPath, name: animName, path: ".:scale", type: "value", library: "" });
    await emit("anim.insert_key", { player_path: playerPath, name: animName, track: 0, time: 0, value: vec2(1, 1), transition, library: "" });
    await emit("anim.insert_key", { player_path: playerPath, name: animName, track: 0, time: duration / 2, value: vec2(pop, pop), transition, library: "" });
    await emit("anim.insert_key", { player_path: playerPath, name: animName, track: 0, time: duration, value: vec2(1, 1), transition, library: "" });
    await emit("anim.set_length", { player_path: playerPath, name: animName, length: duration, library: "" });
  }

  return { moved: true, from: args.from ?? null, to: args.to, node_path: dest, animated };
}

// =============================================================================
// Group N — Increment 4: the Interaction slice (`interact_make_draggable`,
// `interact_add_drop_zone`)
//
// The interaction layer over the Card/Board/Piece structure: it wires an
// existing node so it can be *picked up* (a draggable) or *dropped onto* (a drop
// zone). Both are host-side scripted sequences of already-audited primitives —
// attach a generated behaviour script (`resource.create` GDScript +
// `node.set_property` script), build a hit region for the node2d path (Group E
// `node.add` Area2D + `resource.create` shape + `CollisionShape2D`), and wire
// events with the Group A/I primitives (`signal.connect`, `signal.add_user_signal`,
// `inputmap.add_action` / `inputmap.add_event`). No addon method is added, so the
// host↔addon contract is unchanged and the whole op-sequence is unit-tested
// offline through the same injectable sink.
//
// Two modes mirror Godot's two drag idioms: `control` uses the built-in Control
// drag-and-drop (`_get_drag_data` / `_can_drop_data` / `_drop_data`), `node2d`
// uses an Area2D hit region + a pointer-driven handler. Everything is
// general-purpose: the drag carries a caller-supplied neutral `payload`
// Dictionary and a drop zone validates it with a neutral key∈values predicate —
// no domain concepts are baked in. Per the plan, the *feel* (drag thresholds /
// snap distance / affordances) is tuned in a later live-editor pass; the
// generated scripts are a correct, compile-checked starting point and the
// op-sequence + a headless build smoke prove their structure offline.
// =============================================================================

type InteractMode = "control" | "node2d";
type InteractScalar = string | number | boolean;

/** Godot 4 `Variant.Type` for a Dictionary — the type of a drop signal's arg. */
const TYPE_DICTIONARY = 27;

/** A GDScript double-quoted string literal with the minimal escaping. Exported for tests. */
export function gdQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/** Render a JS scalar as a GDScript literal (string quoted, bool lower-case). */
function gdScalar(v: InteractScalar): string {
  if (typeof v === "string") return gdQuote(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/** Render a flat `{k: scalar}` map as a GDScript Dictionary literal. Exported for tests. */
export function gdDictLiteral(obj: Record<string, InteractScalar>): string {
  const entries = Object.entries(obj).map(([k, v]) => `${gdQuote(k)}: ${gdScalar(v)}`);
  return entries.length ? `{${entries.join(", ")}}` : "{}";
}

/** Render a `string[]` as a GDScript Array literal. */
function gdStrArray(items: string[]): string {
  return items.length ? `[${items.map(gdQuote).join(", ")}]` : "[]";
}

/**
 * Generate a draggable node's behaviour script. Pure + exported for unit tests.
 * `control` overrides Godot's `_get_drag_data` to hand off `{payload, source}`
 * (and, when `preview`, a translucent drag preview); `node2d` carries the payload
 * and flips a `_dragging` flag from a pointer handler (`_on_drag_input`), following
 * the mouse in `_process`. The base class is derived from the mode so the script
 * attaches to any Control- / Node2D-derived node.
 */
export function buildDraggableScript(
  mode: InteractMode,
  payload: Record<string, InteractScalar>,
  opts: { preview?: boolean; button?: number } = {},
): string {
  const dict = gdDictLiteral(payload);
  const L: string[] = [];
  if (mode === "control") {
    L.push("extends Control");
    L.push("## Draggable (Control drag-and-drop) generated by Breakpoint MCP (Group N).");
    L.push("## Do not edit by hand — re-run interact_make_draggable to regenerate.");
    L.push("");
    L.push("func get_drag_payload() -> Dictionary:");
    L.push(`\treturn ${dict}.duplicate(true)`);
    L.push("");
    L.push("func _get_drag_data(_at_position: Vector2) -> Variant:");
    L.push('\tvar data := {"payload": get_drag_payload(), "source": self}');
    if (opts.preview) L.push("\tset_drag_preview(_make_drag_preview())");
    L.push("\treturn data");
    if (opts.preview) {
      L.push("");
      L.push("func _make_drag_preview() -> Control:");
      L.push("\tvar ghost := duplicate()");
      L.push("\tghost.modulate = Color(1, 1, 1, 0.7)");
      L.push("\treturn ghost");
    }
    L.push("");
    return L.join("\n");
  }
  const button = opts.button ?? 1;
  L.push("extends Node2D");
  L.push("## Draggable (Node2D pointer drag) generated by Breakpoint MCP (Group N).");
  L.push("## Do not edit by hand — re-run interact_make_draggable to regenerate.");
  L.push("");
  L.push("signal drag_started(payload)");
  L.push("signal drag_ended(payload)");
  L.push("");
  L.push(`const DRAG_BUTTON := ${button}`);
  L.push("");
  L.push("var _dragging := false");
  L.push("");
  L.push("func get_drag_payload() -> Dictionary:");
  L.push(`\treturn ${dict}.duplicate(true)`);
  L.push("");
  L.push("func _on_drag_input(_viewport: Node, event: InputEvent, _shape_idx: int) -> void:");
  L.push("\tif event is InputEventMouseButton and event.button_index == DRAG_BUTTON and event.pressed:");
  L.push("\t\t_dragging = true");
  L.push("\t\tdrag_started.emit(get_drag_payload())");
  L.push("");
  L.push("func _process(_delta: float) -> void:");
  L.push("\tif not _dragging:");
  L.push("\t\treturn");
  L.push("\tglobal_position = get_global_mouse_position()");
  L.push("\tif not Input.is_mouse_button_pressed(DRAG_BUTTON):");
  L.push("\t\t_dragging = false");
  L.push("\t\tdrag_ended.emit(get_drag_payload())");
  L.push("");
  return L.join("\n");
}

/**
 * Generate a drop zone's validator/acceptor script. Pure + exported for unit
 * tests. `_accepts` is the neutral predicate: accept any payload when no key is
 * set, else accept when `payload[key]` is one of `values`. `control` overrides
 * `_can_drop_data` / `_drop_data`; `node2d` exposes a `try_drop(payload)` seam a
 * pointer-release handler calls. Both emit the caller's `on_drop` signal (added to
 * the node via `signal.add_user_signal`) with the accepted payload.
 */
export function buildDropZoneScript(
  mode: InteractMode,
  opts: { acceptKey: string; acceptValues: string[]; onDrop: string },
): string {
  const L: string[] = [];
  L.push(`extends ${mode === "control" ? "Control" : "Node2D"}`);
  L.push("## Drop zone (drag-and-drop target) generated by Breakpoint MCP (Group N).");
  L.push("## Do not edit by hand — re-run interact_add_drop_zone to regenerate.");
  L.push("");
  L.push(`const ACCEPT_KEY := ${gdQuote(opts.acceptKey)}`);
  L.push(`const ACCEPT_VALUES := ${gdStrArray(opts.acceptValues)}`);
  L.push(`const ON_DROP := ${gdQuote(opts.onDrop)}`);
  L.push("");
  L.push("func _accepts(payload: Dictionary) -> bool:");
  L.push('\tif ACCEPT_KEY == "":');
  L.push("\t\treturn true");
  L.push('\treturn ACCEPT_VALUES.has(str(payload.get(ACCEPT_KEY, "")))');
  L.push("");
  L.push("func _payload_of(data: Variant) -> Dictionary:");
  L.push('\tif data is Dictionary and data.has("payload") and data["payload"] is Dictionary:');
  L.push('\t\treturn data["payload"]');
  L.push("\treturn {}");
  L.push("");
  if (mode === "control") {
    L.push("func _can_drop_data(_at_position: Vector2, data: Variant) -> bool:");
    L.push("\treturn _accepts(_payload_of(data))");
    L.push("");
    L.push("func _drop_data(_at_position: Vector2, data: Variant) -> void:");
    L.push("\tvar payload := _payload_of(data)");
    L.push("\tif _accepts(payload):");
    L.push("\t\temit_signal(ON_DROP, payload)");
    L.push("");
  } else {
    L.push("## Call when a dragged node is released over this zone. Emits ON_DROP");
    L.push("## with the payload when accepted; returns whether it was accepted.");
    L.push("func try_drop(payload: Dictionary) -> bool:");
    L.push("\tif _accepts(payload):");
    L.push("\t\temit_signal(ON_DROP, payload)");
    L.push("\t\treturn true");
    L.push("\treturn false");
    L.push("");
  }
  return L.join("\n");
}

// ------------------------------------------------ composite: make draggable ----

interface MakeDraggableArgs {
  node: string; script_path: string; mode: InteractMode;
  payload?: Record<string, InteractScalar>;
  preview?: boolean; button?: number; action?: string; hit_area?: string;
}
interface MakeDraggableResult {
  node_path: string; mode: string; script_path: string;
  payload_keys: string[]; action: string | null; connected: boolean;
}

/**
 * Wire a node for drag-and-drop. `control` just attaches the drag script (Godot's
 * built-in Control DnD picks it up); `node2d` also registers a drag input action
 * and connects the hit area's `input_event` to the generated pointer handler.
 */
export async function emitMakeDraggable(emit: Emit, args: MakeDraggableArgs): Promise<MakeDraggableResult> {
  if (args.node === "") throw new ComposeError("bad_params", "Missing 'node' (the node to make draggable)");
  const payload = args.payload ?? {};
  const mode = args.mode;
  let action: string | null = null;

  if (mode === "node2d") {
    action = args.action ?? "drag";
    const button = args.button ?? 1;
    await emit("inputmap.add_action", { name: action, save: true });
    await emit("inputmap.add_event", { name: action, event: { type: "mouse_button", button_index: button }, save: true });
  }

  const source = buildDraggableScript(mode, payload, { preview: args.preview, button: args.button });
  await emit("resource.create", { class_name: "GDScript", to_path: args.script_path, properties: { source_code: source } });
  await emit("node.set_property", { path: args.node, property: "script", value: resourceVariant("GDScript", args.script_path) });

  let connected = false;
  if (mode === "node2d") {
    const hitSource = args.hit_area ? joinPath(args.node, args.hit_area) : args.node;
    await emit("signal.connect", { path: hitSource, signal: "input_event", target_path: args.node, method: "_on_drag_input", flags: 0 });
    connected = true;
  }

  return { node_path: args.node, mode, script_path: args.script_path, payload_keys: Object.keys(payload), action, connected };
}

// -------------------------------------------------- composite: add drop zone ----

interface AddDropZoneArgs {
  node: string; script_path: string; mode: InteractMode;
  accepts?: { key?: string; values?: string[] };
  on_drop?: string;
  notify?: { target: string; method: string };
  size?: { width: number; height: number };
  shape?: HitShape;
}
interface AddDropZoneResult {
  node_path: string; mode: string; script_path: string; on_drop: string;
  accepts_key: string; accepts_values: string[]; notified: boolean; area_path: string | null;
}

/**
 * Mark a node as a drop target: build an Area2D hit region for the node2d path,
 * attach the validator/acceptor script, add the `on_drop` user signal, and
 * optionally connect it to a handler. `accepts` is the neutral key∈values
 * predicate (accept-any when omitted).
 */
export async function emitAddDropZone(emit: Emit, args: AddDropZoneArgs): Promise<AddDropZoneResult> {
  if (args.node === "") throw new ComposeError("bad_params", "Missing 'node' (the node to mark as a drop zone)");
  const mode = args.mode;
  const onDrop = args.on_drop ?? "dropped";
  assertNodeName(onDrop);
  const acceptKey = args.accepts?.key ?? "";
  const acceptValues = args.accepts?.values ?? [];

  let areaPath: string | null = null;
  if (mode === "node2d") {
    const size = args.size ?? { width: DEFAULT_CELL_SIZE, height: DEFAULT_CELL_SIZE };
    const shapeKind: HitShape = args.shape ?? "rectangle";
    await emit("node.add", { parent_path: args.node, type: "Area2D", name: "DropArea" });
    areaPath = joinPath(args.node, "DropArea");
    const shapeClass = shapeKind === "circle" ? "CircleShape2D" : "RectangleShape2D";
    const shapePath = args.script_path.replace(/\.gd$/, ".shape.tres");
    const shapeProps = shapeKind === "circle"
      ? { radius: Math.min(size.width, size.height) / 2 }
      : { size: vec2(size.width, size.height) };
    await emit("resource.create", { class_name: shapeClass, to_path: shapePath, properties: shapeProps });
    await emit("node.add", { parent_path: areaPath, type: "CollisionShape2D", name: "Shape" });
    await emit("node.set_property", { path: joinPath(areaPath, "Shape"), property: "shape", value: resourceVariant(shapeClass, shapePath) });
  }

  const source = buildDropZoneScript(mode, { acceptKey, acceptValues, onDrop });
  await emit("resource.create", { class_name: "GDScript", to_path: args.script_path, properties: { source_code: source } });
  await emit("node.set_property", { path: args.node, property: "script", value: resourceVariant("GDScript", args.script_path) });
  await emit("signal.add_user_signal", { path: args.node, signal: onDrop, args: [{ name: "payload", type: TYPE_DICTIONARY }] });

  let notified = false;
  if (args.notify) {
    await emit("signal.connect", { path: args.node, signal: onDrop, target_path: args.notify.target, method: args.notify.method, flags: 0 });
    notified = true;
  }

  return {
    node_path: args.node, mode, script_path: args.script_path, on_drop: onDrop,
    accepts_key: acceptKey, accepts_values: acceptValues, notified, area_path: areaPath,
  };
}

// ------------------------------------------------------------- registration ----

export function registerTabletopTools(server: McpServer, bridge: BridgeClient, config: Config): void {
  const emit: Emit = (method, params) => bridge.request(method, params);
  const readFile: ReadFile = (p) => readFileText(toFsPath(p, config.projectPath));

  const slotSchema = z.object({
    name: z.string().describe("Slot key used by card_instance / card_deck_from_table data (e.g. title, cost, body, art)"),
    kind: z.enum(["label", "rich_text", "texture", "panel", "badge"]).describe("label→Label, rich_text→RichTextLabel, texture→TextureRect, panel→Panel, badge→Label-in-Panel"),
    rect: z.object({ x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional() }).optional().describe("Explicit local rect; mutually exclusive with anchor_preset"),
    anchor_preset: z.number().int().min(0).max(15).optional().describe("Control anchor preset (0–15) instead of an explicit rect"),
    font_size: z.number().int().positive().optional().describe("Font size override (label / rich_text / badge)"),
    align: z.enum(["left", "center", "right"]).optional().describe("Horizontal text alignment (default left)"),
    wrap: z.boolean().optional().describe("Autowrap the text (label / rich_text)"),
    color_by: z.string().optional().describe("Tint this slot's node from another data key (a #RRGGBB value)"),
    default_text: z.string().optional().describe("Static text shown before any data is bound"),
  });

  const layoutKnobs = {
    spacing: z.number().optional().describe("px between cards (row / grid)"),
    overlap: z.number().optional().describe("px overlap (row / fan / stack)"),
    fan_angle: z.number().optional().describe("Total fan spread in degrees (fan mode)"),
    columns: z.number().int().positive().optional().describe("Grid mode column count"),
    align: z.enum(["start", "center", "end"]).optional().describe("Alignment along the layout (default center)"),
    origin: z.object({ x: z.number(), y: z.number() }).optional().describe("Top-left origin offset in px"),
  };

  // ----------------------------------------------------- card_template_create ----
  server.registerTool(
    "card_template_create",
    {
      title: "Create card template",
      description:
        "Build a reusable card scene (a PackedScene) from a slot spec, with a generated script-backed set_data() / set_face(). " +
        "Named slots (label / rich_text / texture / panel / badge) become the card's regions; card_instance and card_deck_from_table " +
        "bind data to them by slot name. Optional inline theme and a two-sided card back. DESTRUCTIVE (writes a scene + script) — gated by confirmation.",
      inputSchema: {
        path: z.string().describe("Where to save the template scene, e.g. res://ui/cards/Card.tscn"),
        size: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).describe("Card dimensions in px"),
        root_type: z.enum(["PanelContainer", "Panel", "Control"]).optional().describe("Root node type (default PanelContainer)"),
        slots: z.array(slotSchema).min(1).describe("Named regions the card exposes"),
        face: z.array(z.string()).optional().describe("Slot names shown on the face; omitted → all slots"),
        back: z.object({
          art: z.string().optional().describe("res:// texture for the card back"),
          color: z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).optional().describe("Card-back panel colour"),
        }).optional().describe("Optional card-back state; its presence makes the template two-sided"),
        theme_path: z.string().optional().describe("Use an existing Theme resource (res://…tres); mutually exclusive with inline theme"),
        theme: z.object({
          base_color: z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).optional(),
          accent_color: z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).optional(),
          font_path: z.string().optional(),
          font_size: z.number().int().positive().optional(),
          panel_stylebox: z.object({
            bg_color: z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).optional(),
            corner_radius: z.number().int().nonnegative().optional(),
            border_width: z.number().int().nonnegative().optional(),
            border_color: z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).optional(),
          }).optional(),
        }).optional().describe("Inline theme built via theme_create + theme_set_*"),
        script_path: z.string().optional().describe("Generated card script path (default derives from `path`)"),
        overwrite: z.boolean().optional().describe("Overwrite an existing template at `path` (default false)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async (raw) => {
      const a = raw as unknown as TemplateSpec & { confirm?: boolean };
      if (!a.path.startsWith("res://") || !a.path.endsWith(".tscn")) return fail({ code: "bad_params", message: "'path' must be a res:// .tscn path" });
      if (a.theme_path && a.theme) return fail({ code: "bad_params", message: "Pass either theme_path or an inline theme, not both" });
      const blocked = await gate(server, a.confirm, `Create card template scene + script at ${a.path}`);
      if (blocked) return blocked;
      try {
        return ok(await emitCardTemplate(emit, a) as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ------------------------------------------------------------ card_instance ----
  server.registerTool(
    "card_instance",
    {
      title: "Instance a card",
      description:
        "Instance a card template into the open scene and bind data to its slots via the template's set_data(). Undoable node authoring. " +
        "Slot values are strings/numbers/booleans; any texture slot (e.g. art) takes a res:// texture path. Reports which data keys bound and which had no matching slot.",
      inputSchema: {
        template_path: z.string().describe("Card template scene, e.g. res://ui/cards/Card.tscn"),
        parent: z.string().describe("Node path to parent the instance under (in the open scene); \".\" for the root"),
        data: z.record(z.union([z.string(), z.number(), z.boolean()])).describe("Slot name → value; a texture slot takes a res:// path"),
        position: z.object({ x: z.number(), y: z.number() }).optional().describe("Local position of the instance"),
        face_up: z.boolean().optional().describe("Show the face (default true); false shows the back on two-sided cards"),
        name: z.string().optional().describe("Optional node name for the instance"),
      },
    },
    async (raw) => {
      const a = raw as unknown as Parameters<typeof emitCardInstance>[1];
      try {
        return ok(await emitCardInstance(emit, a) as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --------------------------------------------------------- card_hand_layout ----
  server.registerTool(
    "card_hand_layout",
    {
      title: "Lay out a hand of cards",
      description:
        "Instance N cards under a container and arrange them as a row, fan, stack, or grid. Undoable node authoring. Each card carries its own " +
        "data (bound via the template's set_data) and face state; spacing / overlap / fan_angle / columns / align / origin tune the arrangement.",
      inputSchema: {
        template_path: z.string().describe("Card template scene, e.g. res://ui/cards/Card.tscn"),
        parent: z.string().describe("Container node path the cards are instanced under; \".\" for the root"),
        cards: z.array(z.object({
          data: z.record(z.union([z.string(), z.number(), z.boolean()])).describe("Slot name → value for this card"),
          face_up: z.boolean().optional().describe("Show the face (default true)"),
        })).min(1).describe("One entry per card to instance"),
        mode: z.enum(["row", "fan", "stack", "grid"]).describe("Arrangement mode"),
        ...layoutKnobs,
      },
    },
    async (raw) => {
      const a = raw as unknown as Parameters<typeof emitCardHand>[1];
      try {
        return ok(await emitCardHand(emit, a) as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ------------------------------------------------------ card_deck_from_table ----
  server.registerTool(
    "card_deck_from_table",
    {
      title: "Stamp a deck from a table",
      description:
        "Read a CSV or JSON table and stamp one card per row, binding columns to slots via a column map. Undoable node authoring. " +
        "column_map values are bare {column} references or composed templates like \"{name} · {role}\"; a filter selects rows and an optional layout arranges them. " +
        "Table columns no slot referenced are surfaced (not silently dropped).",
      inputSchema: {
        template_path: z.string().describe("Card template scene, e.g. res://ui/cards/Card.tscn"),
        parent: z.string().describe("Container node path the cards are instanced under; \".\" for the root"),
        table_path: z.string().describe("CSV or JSON table on disk (res:// or absolute); format auto-detected by extension unless `format` set"),
        format: z.enum(["csv", "json"]).optional().describe("Override the table format"),
        column_map: z.record(z.string()).describe("Slot name → column expression (a bare {column} or a composed \"{a} · {b}\")"),
        filter: z.object({
          column: z.string(),
          equals: z.union([z.string(), z.number(), z.boolean()]),
        }).optional().describe("Optional row selector, e.g. {column:'set', equals:'base'}"),
        art_column: z.string().optional().describe("Column holding a res:// texture path bound to the `art` slot"),
        limit: z.number().int().positive().optional().describe("Cap the number of rows stamped"),
        face_up: z.boolean().optional().describe("Show the face (default true)"),
        layout: z.object({
          mode: z.enum(["row", "fan", "stack", "grid"]),
          spacing: z.number().optional(), overlap: z.number().optional(), fan_angle: z.number().optional(),
          columns: z.number().int().positive().optional(),
          align: z.enum(["start", "center", "end"]).optional(),
          origin: z.object({ x: z.number(), y: z.number() }).optional(),
        }).optional().describe("Optional arrangement (same knobs as card_hand_layout); omitted → stacked at origin"),
      },
    },
    async (raw) => {
      const a = raw as unknown as DeckArgs;
      try {
        return ok(await emitDeckFromTable(emit, readFile, a) as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // -------------------------------------------------------------- card_set_face ----
  server.registerTool(
    "card_set_face",
    {
      title: "Flip a card's face",
      description:
        "Flip an instanced card (or any node exposing set_face(bool) — the generated card and piece scripts both do) between its face and back. " +
        "Instant by default: calls the setter now, so the visible side changes immediately. With `animate`, instead authors a reusable flip clip under the node from Group C anim primitives — a scale pinch (1 → edge-on → 1) plus a method key that calls the setter at the edge-on midpoint — played on demand; purely additive (only existing node.* / anim.* ops, never a new engine call). Undoable node authoring. Returns the target state and any authored player / anim.",
      inputSchema: {
        node: z.string().describe("Node path of the card instance to flip (in the open scene); \".\" for the root"),
        face_up: z.boolean().describe("Target face state: true shows the face, false the back"),
        method: z.string().optional().describe("Setter method invoked with face_up (default \"set_face\"; the generated card/piece scripts expose it)"),
        animate: z.object({
          duration: z.number().positive().optional().describe("Flip duration in seconds (default 0.3)"),
          player: z.string().optional().describe("AnimationPlayer node name added under the card (default FlipFX)"),
          anim: z.string().optional().describe("Animation name (default flip)"),
          transition: z.number().optional().describe("Key transition curve exponent (default 1.0)"),
        }).optional().describe("Optional flip animation; omitted → an instant set_face"),
      },
    },
    async (raw) => {
      const a = raw as unknown as Parameters<typeof emitCardSetFace>[1];
      try {
        return ok(await emitCardSetFace(emit, a) as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // -------------------------------------------------------------- board_create ----
  const boardLayout = z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("ring"),
      cells: z.array(z.string()).min(1).describe("Cell ids placed evenly around the ring, in order"),
      radius: z.number().positive().optional().describe("Ring radius in px (default scales with cell_size × cell count)"),
      start_deg: z.number().optional().describe("Angle of the first cell in degrees (default -90 = top)"),
      clockwise: z.boolean().optional().describe("Sweep direction (default true)"),
      center: z.object({ x: z.number(), y: z.number() }).optional().describe("Ring centre offset from the root (default 0,0)"),
    }),
    z.object({
      mode: z.literal("grid"),
      rows: z.number().int().positive().describe("Grid row count"),
      cols: z.number().int().positive().describe("Grid column count; cell ids are \"<row>_<col>\""),
    }),
    z.object({
      mode: z.literal("cells"),
      cells: z.array(z.object({
        id: z.string().describe("Cell id (becomes node cell_<id>)"),
        x: z.number(), y: z.number(),
      })).min(1).describe("Explicit cell ids and local positions"),
    }),
  ]);

  server.registerTool(
    "board_create",
    {
      title: "Create board scene",
      description:
        "Build a board scene whose children are addressable cells (each a cell_<id> node in the board_cells group) from a ring, grid, or explicit-cells layout. " +
        "Cells are Marker2D (or Control) anchors positioned by pure layout math; an optional background (color or res:// art) sits behind them. " +
        "General-purpose — cells carry only caller-supplied ids. DESTRUCTIVE (writes a scene) — gated by confirmation. Returns the cell_id → node_path + position map.",
      inputSchema: {
        path: z.string().describe("Where to save the board scene, e.g. res://ui/board/Board.tscn"),
        layout: boardLayout.describe("ring{cells[]} | grid{rows,cols} | cells{cells[{id,x,y}]}"),
        cell_size: z.number().positive().optional().describe("Cell pitch in px (drives ring radius / grid spacing; default 96)"),
        cell_kind: z.enum(["marker", "control"]).optional().describe("marker→Marker2D anchor (default), control→Control anchor"),
        root_type: z.enum(["Node2D", "Control"]).optional().describe("Board root node type (default Node2D)"),
        background: z.object({
          color: z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).optional().describe("Solid ColorRect background"),
          art: z.string().optional().describe("res:// texture background (Sprite2D under Node2D, TextureRect under Control)"),
          size: z.object({ w: z.number().optional(), h: z.number().optional() }).optional().describe("Background size in px (ColorRect / TextureRect)"),
        }).optional().describe("Optional background drawn behind the cells"),
        overwrite: z.boolean().optional().describe("Overwrite an existing board at `path` (default false)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async (raw) => {
      const a = raw as unknown as BoardSpec & { confirm?: boolean };
      if (!a.path.startsWith("res://") || !a.path.endsWith(".tscn")) return fail({ code: "bad_params", message: "'path' must be a res:// .tscn path" });
      const blocked = await gate(server, a.confirm, `Create board scene at ${a.path}`);
      if (blocked) return blocked;
      try {
        return ok(await emitBoardCreate(emit, a) as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --------------------------------------------------------------- board_place ----
  server.registerTool(
    "board_place",
    {
      title: "Place a node on a board cell",
      description:
        "Reparent an existing node (a card or piece instance) onto a board cell by id and snap it to the cell anchor. Undoable node authoring. " +
        "The target cell is <board>/cell_<cell>; `align` offsets the node from the cell origin (default centred). Returns the node's new path.",
      inputSchema: {
        board: z.string().describe("Board root node path in the open scene (\".\" if the board is the scene root)"),
        cell: z.string().describe("Cell id to place onto (resolves to <board>/cell_<cell>)"),
        node: z.string().describe("Node path of the node to place (a card / piece already in the scene)"),
        align: z.object({ x: z.number(), y: z.number() }).optional().describe("Offset from the cell origin in px (default 0,0 — centred on the anchor)"),
      },
    },
    async (raw) => {
      const a = raw as unknown as PlaceArgs;
      try {
        return ok(await emitBoardPlace(emit, a) as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ----------------------------------------------------------- board_tile_create ----
  server.registerTool(
    "board_tile_create",
    {
      title: "Create tile-backed board",
      description:
        "Build a tile-backed board scene: a TileMapLayer grid whose cells are addressable by integer [x, y] tile coordinates (cols wide × rows tall). " +
        "The layer binds a TileSet — a supplied `tileset` .tres, or a fresh empty one created at <scene>_tiles.tres — so it has a real tile_size (the coordinate frame placement uses); `paint` optionally fills the whole grid with one tile from the bound tileset. " +
        "General-purpose — cells carry only coordinates. Adds no addon method — decomposes onto scene.new → tileset.create → tilemaplayer.create → tilemap.set_cells_rect → scene.save. DESTRUCTIVE (writes a scene, and a TileSet .tres unless `tileset` is supplied) — gated by confirmation. Returns the layer path + grid dimensions + tile size.",
      inputSchema: {
        path: z.string().describe("Where to save the board scene, e.g. res://ui/board/TileBoard.tscn"),
        rows: z.number().int().positive().describe("Grid row count (cell y ranges 0..rows-1)"),
        cols: z.number().int().positive().describe("Grid column count (cell x ranges 0..cols-1)"),
        tile_size: z.array(z.number().int().positive()).length(2).optional().describe("Tile cell size [w, h] in px (default [64, 64]); the coordinate frame board_tile_place snaps to"),
        tileset: z.string().optional().describe("Existing TileSet res:// .tres to bind; omitted → a fresh empty TileSet is created at <scene>_tiles.tres to establish the tile size"),
        paint: z.object({
          source_id: z.number().int().nonnegative().describe("Atlas source id in the bound tileset to fill the grid with"),
          atlas_coords: z.array(z.number().int()).length(2).optional().describe("Tile atlas coordinates [x, y] within the source (default [0, 0])"),
        }).optional().describe("Fill the whole grid with one tile (needs an existing `tileset` that has the source); omitted → cells stay empty (a coordinate frame only)"),
        layer_name: z.string().optional().describe("TileMapLayer node name (default \"Cells\")"),
        overwrite: z.boolean().optional().describe("Overwrite an existing board at `path` (default false)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async (raw) => {
      const a = raw as unknown as TileBoardSpec & { confirm?: boolean };
      if (!a.path.startsWith("res://") || !a.path.endsWith(".tscn")) return fail({ code: "bad_params", message: "'path' must be a res:// .tscn path" });
      if (a.tileset !== undefined && !(a.tileset.startsWith("res://") && a.tileset.endsWith(".tres"))) return fail({ code: "bad_params", message: "'tileset' must be a res:// .tres path" });
      const blocked = await gate(server, a.confirm, `Create tile-backed board scene at ${a.path}`);
      if (blocked) return blocked;
      try {
        return ok(await emitBoardTileCreate(emit, a) as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ------------------------------------------------------------ board_tile_place ----
  server.registerTool(
    "board_tile_place",
    {
      title: "Place a node on a tile coordinate",
      description:
        "Snap an existing node (a card or piece instance) onto a TileMapLayer cell by integer [x, y] tile coordinate. Undoable node authoring. " +
        "The cell's local position is computed from `tile_size` — centre `(coord + 0.5) × tile_size` (default) or corner `coord × tile_size` — matching Godot's TileMapLayer.map_to_local, plus an optional `align` offset. With `reparent` (default true) the node is moved under the layer so the coordinate is layer-local. Decomposes onto node.reparent + node.set_property. Returns the node's new path and local position.",
      inputSchema: {
        layer: z.string().describe("TileMapLayer node path in the open scene"),
        node: z.string().describe("Node path of the node to place (a card / piece already in the scene)"),
        coord: z.array(z.number().int()).length(2).describe("Tile coordinate [x, y] (in cells)"),
        tile_size: z.array(z.number().int().positive()).length(2).optional().describe("The layer's tile cell size [w, h] in px (default [64, 64]); must match the board's tile_size"),
        anchor: z.enum(["center", "corner"]).optional().describe("Snap to the cell centre (default) or its top-left corner"),
        align: z.object({ x: z.number(), y: z.number() }).optional().describe("Offset from the anchor in px (default 0,0)"),
        reparent: z.boolean().optional().describe("Reparent the node under the layer so the coordinate is layer-local (default true)"),
      },
    },
    async (raw) => {
      const a = raw as unknown as TilePlaceArgs;
      try {
        return ok(await emitBoardTilePlace(emit, a) as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------- piece_template_create ----
  server.registerTool(
    "piece_template_create",
    {
      title: "Create piece template",
      description:
        "Build a reusable piece (token) scene from a spec: an Art node (Sprite2D under a Node2D root, TextureRect under a Control root), an optional Label, an optional hit area (Area2D + CollisionShape2D), and an optional two-sided Back, plus a generated script-backed set_data() / set_face(). set_data binds art / color / label; set_face flips face/back visibility. " +
        "Decomposes onto scene.new → node.add → node.set_property → resource.create → scene.save. DESTRUCTIVE (writes a scene + script) — gated by confirmation. Returns the scene path + the created-node map.",
      inputSchema: {
        path: z.string().describe("Where to save the template scene, e.g. res://ui/pieces/Piece.tscn"),
        size: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).describe("Token size in px (drives the hit-area extents and, for a Control root, the Art size)"),
        root_type: z.enum(["Node2D", "Control"]).optional().describe("Root node type (default Node2D → Sprite2D art; Control → TextureRect art)"),
        art: z.string().optional().describe("res:// texture bound to the Art node at build time"),
        color: z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).optional().describe("Default Art tint (self_modulate), #RRGGBB or #RRGGBBAA"),
        label: z.boolean().optional().describe("Include a Label child for the piece name (default true)"),
        label_text: z.string().optional().describe("Static Label text shown before any data is bound"),
        hit_area: z.object({
          shape: z.enum(["rectangle", "circle"]).optional().describe("Collision shape (default rectangle sized to `size`; circle radius = min(w,h)/2)"),
        }).optional().describe("Optional Area2D + CollisionShape2D for hit-testing"),
        back: z.object({
          art: z.string().optional().describe("res:// texture for the piece back"),
          color: z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).optional().describe("Solid ColorRect back colour"),
        }).optional().describe("Optional back state; its presence makes the piece two-sided"),
        script_path: z.string().optional().describe("Generated piece script path (default derives from `path`)"),
        overwrite: z.boolean().optional().describe("Overwrite an existing template at `path` (default false)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async (raw) => {
      const a = raw as unknown as PieceSpec & { confirm?: boolean };
      if (!a.path.startsWith("res://") || !a.path.endsWith(".tscn")) return fail({ code: "bad_params", message: "'path' must be a res:// .tscn path" });
      const blocked = await gate(server, a.confirm, `Create piece template scene + script at ${a.path}`);
      if (blocked) return blocked;
      try {
        return ok(await emitPieceTemplate(emit, a) as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ------------------------------------------------------------------ piece_instance ----
  server.registerTool(
    "piece_instance",
    {
      title: "Instance a piece",
      description:
        "Instance a piece template into the open scene and bind data (art / color / label) via the template's set_data(). Undoable node authoring. " +
        "Optionally place_on a board cell in the same call (reparent + snap via board_place). Reports which data keys bound and which had no matching slot.",
      inputSchema: {
        template_path: z.string().describe("Piece template scene, e.g. res://ui/pieces/Piece.tscn"),
        parent: z.string().describe("Node path to parent the instance under (in the open scene); \".\" for the root"),
        data: z.record(z.union([z.string(), z.number(), z.boolean()])).describe("Slot name → value (art takes a res:// path; color a #RRGGBB; label a string)"),
        position: z.object({ x: z.number(), y: z.number() }).optional().describe("Local position of the instance (ignored when place_on snaps it to a cell)"),
        face_up: z.boolean().optional().describe("Show the face (default true); false shows the back on two-sided pieces"),
        name: z.string().optional().describe("Optional node name for the instance"),
        place_on: z.object({
          board: z.string().describe("Board root node path (\".\" if the board is the scene root)"),
          cell: z.string().describe("Cell id to place onto (resolves to <board>/cell_<cell>)"),
          align: z.object({ x: z.number(), y: z.number() }).optional().describe("Offset from the cell origin in px (default centred)"),
        }).optional().describe("Optionally place the new piece on a board cell in the same call"),
      },
    },
    async (raw) => {
      const a = raw as unknown as PieceInstanceArgs;
      try {
        return ok(await emitPieceInstance(emit, a) as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --------------------------------------------------------------------- piece_move ----
  server.registerTool(
    "piece_move",
    {
      title: "Move a piece to a cell",
      description:
        "Move a piece onto a board cell by id (reparent + snap via board_place), optionally with a short scale \"pop\" animation authored from Group C anim primitives. Undoable node authoring; purely additive — it emits only existing node / anim ops, never a new engine call. Returns the piece's new path.",
      inputSchema: {
        board: z.string().describe("Board root node path in the open scene (\".\" if the board is the scene root)"),
        node: z.string().describe("Node path of the piece to move"),
        to: z.string().describe("Destination cell id (resolves to <board>/cell_<to>)"),
        from: z.string().optional().describe("Source cell id, echoed in the result for the caller's convenience"),
        align: z.object({ x: z.number(), y: z.number() }).optional().describe("Offset from the cell origin in px (default 0,0 — centred on the anchor)"),
        animate: z.object({
          duration: z.number().positive().optional().describe("Pop duration in seconds (default 0.25)"),
          pop_scale: z.number().positive().optional().describe("Peak scale of the pop (default 1.15)"),
          player: z.string().optional().describe("AnimationPlayer node name added under the piece (default MoveFX)"),
          anim: z.string().optional().describe("Animation name (default move)"),
          transition: z.number().optional().describe("Key transition curve exponent (default 1.0)"),
        }).optional().describe("Optional pop animation; omitted → an instant snap"),
      },
    },
    async (raw) => {
      const a = raw as unknown as PieceMoveArgs;
      try {
        return ok(await emitPieceMove(emit, a) as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ------------------------------------------------------ interact_make_draggable ----
  server.registerTool(
    "interact_make_draggable",
    {
      title: "Make a node draggable",
      description:
        "Wire an existing node for drag-and-drop by attaching a generated reusable drag script (and, for node2d, a drag input action + a hit-area input_event connection). " +
        "control mode uses Godot's built-in Control drag-and-drop (_get_drag_data hands off {payload, source}, with an optional translucent preview); node2d mode carries the payload and follows the pointer from a button-driven handler. " +
        "General-purpose — the drag carries a caller-supplied neutral payload Dictionary. Decomposes onto resource.create → node.set_property (+ inputmap.add_action / add_event / signal.connect for node2d). DESTRUCTIVE (writes a script) — gated by confirmation.",
      inputSchema: {
        node: z.string().describe("Node path (in the open scene) to make draggable; \".\" for the root"),
        script_path: z.string().describe("Where to save the generated drag script, e.g. res://ui/interact/Draggable.gd"),
        mode: z.enum(["control", "node2d"]).describe("control→Control _get_drag_data DnD; node2d→Area2D hit region + pointer handler"),
        payload: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe("Neutral data the drag carries (bound into the script as a Dictionary); default empty"),
        preview: z.boolean().optional().describe("control mode: show a translucent drag preview (default false)"),
        button: z.number().int().nonnegative().optional().describe("node2d mode: mouse button index that begins the drag (default 1 = left)"),
        action: z.string().optional().describe("node2d mode: input action name registered for the drag button (default \"drag\")"),
        hit_area: z.string().optional().describe("node2d mode: sub-path to the Area2D whose input_event drives the drag (default the node itself)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async (raw) => {
      const a = raw as unknown as MakeDraggableArgs & { confirm?: boolean };
      if (!a.script_path.startsWith("res://") || !a.script_path.endsWith(".gd")) return fail({ code: "bad_params", message: "'script_path' must be a res:// .gd path" });
      const blocked = await gate(server, a.confirm, `Make ${a.node} draggable (writes script ${a.script_path})`);
      if (blocked) return blocked;
      try {
        return ok(await emitMakeDraggable(emit, a) as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ------------------------------------------------------- interact_add_drop_zone ----
  server.registerTool(
    "interact_add_drop_zone",
    {
      title: "Add a drop zone",
      description:
        "Mark a node as a drop target that validates an incoming payload and emits a signal on a valid drop. Attaches a generated validator/acceptor script, adds the on_drop user signal, and (for node2d) builds an Area2D + CollisionShape2D hit region; optionally connects on_drop to a handler. " +
        "accepts is the neutral predicate {key, values} — accept any payload when omitted, else accept when payload[key] is one of values. control mode overrides _can_drop_data / _drop_data; node2d exposes a try_drop(payload) seam. " +
        "General-purpose — no domain vocabulary. Decomposes onto (node.add + resource.create + node.set_property for node2d) → resource.create → node.set_property → signal.add_user_signal (+ signal.connect). DESTRUCTIVE (writes a script) — gated by confirmation.",
      inputSchema: {
        node: z.string().describe("Node path (in the open scene) to mark as a drop zone; \".\" for the root"),
        script_path: z.string().describe("Where to save the generated drop-zone script, e.g. res://ui/interact/DropZone.gd"),
        mode: z.enum(["control", "node2d"]).describe("control→_can_drop_data / _drop_data overrides; node2d→Area2D hit region + try_drop() seam"),
        accepts: z.object({
          key: z.string().optional().describe("Payload key to test; omitted → accept any payload"),
          values: z.array(z.string()).optional().describe("Accepted values for payload[key]"),
        }).optional().describe("Neutral accept predicate (accept-any when omitted)"),
        on_drop: z.string().optional().describe("User signal emitted with the payload on a valid drop (default \"dropped\")"),
        notify: z.object({
          target: z.string().describe("Node path of the handler to connect on_drop to"),
          method: z.string().describe("Method on the target invoked with the payload"),
        }).optional().describe("Optionally connect on_drop to a handler in the same call"),
        size: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional().describe("node2d mode: DropArea hit size in px (default 96×96)"),
        shape: z.enum(["rectangle", "circle"]).optional().describe("node2d mode: DropArea collision shape (default rectangle)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async (raw) => {
      const a = raw as unknown as AddDropZoneArgs & { confirm?: boolean };
      if (!a.script_path.startsWith("res://") || !a.script_path.endsWith(".gd")) return fail({ code: "bad_params", message: "'script_path' must be a res:// .gd path" });
      const blocked = await gate(server, a.confirm, `Add a drop zone on ${a.node} (writes script ${a.script_path})`);
      if (blocked) return blocked;
      try {
        return ok(await emitAddDropZone(emit, a) as unknown as Record<string, unknown>);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
