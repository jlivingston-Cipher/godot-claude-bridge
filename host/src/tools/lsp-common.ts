// Shared, protocol-generic helpers for the LSP tool wrappers. Both the GDScript
// plane (tools/lsp.ts) and the C#/OmniSharp plane (tools/cslsp.ts) reshape the
// same standard LSP result types (Location, SymbolKind, CompletionItemKind,
// MarkupContent), so these live once here rather than being duplicated per plane.

export interface Position { line: number; character: number }
export interface Range { start?: Position; end?: Position }
export interface Location { uri?: string; targetUri?: string; range?: Range; targetSelectionRange?: Range }

// LSP CompletionItemKind numeric -> readable name.
export const COMPLETION_KIND: Record<number, string> = {
  1: "text", 2: "method", 3: "function", 4: "constructor", 5: "field", 6: "variable",
  7: "class", 8: "interface", 9: "module", 10: "property", 11: "unit", 12: "value",
  13: "enum", 14: "keyword", 15: "snippet", 16: "color", 17: "file", 18: "reference",
  19: "folder", 20: "enumMember", 21: "constant", 22: "struct", 23: "event", 24: "operator", 25: "typeParameter",
};

// LSP SymbolKind numeric -> readable name.
export const SYMBOL_KIND: Record<number, string> = {
  1: "file", 2: "module", 3: "namespace", 4: "package", 5: "class", 6: "method", 7: "property",
  8: "field", 9: "constructor", 10: "enum", 11: "interface", 12: "function", 13: "variable",
  14: "constant", 15: "string", 16: "number", 17: "boolean", 18: "array", 19: "object",
  20: "key", 21: "null", 22: "enumMember", 23: "struct", 24: "event", 25: "operator", 26: "typeParameter",
};

/** MCP success envelope: human-readable JSON text plus the structured content. */
export function ok(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj as Record<string, unknown>,
  };
}

/** MCP error envelope for a failed LSP call (never throws to the caller). */
export function fail(err: unknown) {
  const e = err as { code?: number | string; message?: string };
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `LSP error [${e.code ?? "error"}]: ${e.message ?? String(err)}` }],
  };
}

/**
 * Normalize an LSP documentation / MarkupContent field (a plain string, a
 * `{ kind, value }` MarkupContent, or an array of either) down to a single
 * string. Used by hover-style and signature-help results.
 */
export function markupToString(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === "string" ? x : (x as { value?: string })?.value ?? "")).join("\n");
  if (c && typeof c === "object") return (c as { value?: string }).value ?? "";
  return "";
}

/** True for a JSON-RPC "method not found" (-32601) or an equivalent message. */
export function isMethodNotFound(err: unknown): boolean {
  const e = err as { code?: number | string; message?: string };
  return e.code === -32601 || /method not found/i.test(e.message ?? "");
}

/** Reshape one-or-many LSP Location / LocationLink results into a flat list. */
export function normalizeLocations(result: unknown): Array<{ uri: string; line: number; character: number }> {
  if (!result) return [];
  const arr = Array.isArray(result) ? result : [result];
  return arr.map((l) => {
    const loc = l as Location;
    const uri = loc.uri ?? loc.targetUri ?? "";
    const range = loc.range ?? loc.targetSelectionRange ?? {};
    return { uri, line: range.start?.line ?? 0, character: range.start?.character ?? 0 };
  });
}

// ---- WorkspaceEdit application (shared by the gd_* and cs_* rename mutators) --
// Applying an LSP edit to a file needs a (line, character) -> absolute offset map
// and then splicing edits back-to-front so earlier edits don't shift later ones.
// These live here (rather than in one plane's tool file) because the GDScript and
// C#/OmniSharp rename tools apply identical edit math.

/** Absolute character offset of a (0-based line, 0-based character) in `text`. */
export function offsetOf(text: string, line: number, character: number): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i++) offset += lines[i].length + 1;
  return offset + character;
}

/** Apply LSP TextEdits to a string, splicing back-to-front so ranges stay valid. */
export function applyTextEdits(text: string, edits: Array<{ range: Range; newText: string }>): string {
  const sorted = [...edits].sort((a, b) => {
    const la = a.range.start?.line ?? 0, lb = b.range.start?.line ?? 0;
    if (la !== lb) return lb - la;
    return (b.range.start?.character ?? 0) - (a.range.start?.character ?? 0);
  });
  let out = text;
  for (const e of sorted) {
    const start = offsetOf(out, e.range.start?.line ?? 0, e.range.start?.character ?? 0);
    const end = offsetOf(out, e.range.end?.line ?? 0, e.range.end?.character ?? 0);
    out = out.slice(0, start) + e.newText + out.slice(end);
  }
  return out;
}

/**
 * Normalize an LSP WorkspaceEdit into a plain `uri -> TextEdit[]` map. Handles
 * BOTH encodings a server may return: the legacy `changes` object AND the
 * versioned `documentChanges` array of `TextDocumentEdit`s (what OmniSharp emits
 * for a rename). File resource operations (create/rename/delete) inside
 * `documentChanges` carry no `edits` and are skipped.
 */
export function normalizeWorkspaceEdit(edit: unknown): Record<string, Array<{ range: Range; newText: string }>> {
  const out: Record<string, Array<{ range: Range; newText: string }>> = {};
  const e = edit as {
    changes?: Record<string, Array<{ range: Range; newText: string }>>;
    documentChanges?: Array<{ textDocument?: { uri?: string }; edits?: Array<{ range: Range; newText: string }> }>;
  } | null;
  if (!e) return out;
  if (e.changes) {
    for (const [uri, edits] of Object.entries(e.changes)) out[uri] = [...(out[uri] ?? []), ...(edits ?? [])];
  }
  if (Array.isArray(e.documentChanges)) {
    for (const dc of e.documentChanges) {
      const uri = dc?.textDocument?.uri;
      if (uri && Array.isArray(dc.edits)) out[uri] = [...(out[uri] ?? []), ...dc.edits];
    }
  }
  return out;
}
