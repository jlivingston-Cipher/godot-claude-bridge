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
}
