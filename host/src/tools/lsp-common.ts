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
