import fs from "node:fs";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { LspClient } from "../lsp.js";
import { toFileUri, toFsPath, readFileText } from "../paths.js";
import { gate } from "../confirm.js";

// LSP CompletionItemKind / SymbolKind numeric -> readable name.
const COMPLETION_KIND: Record<number, string> = {
  1: "text", 2: "method", 3: "function", 4: "constructor", 5: "field", 6: "variable",
  7: "class", 8: "interface", 9: "module", 10: "property", 11: "unit", 12: "value",
  13: "enum", 14: "keyword", 15: "snippet", 16: "color", 17: "file", 18: "reference",
  19: "folder", 20: "enumMember", 21: "constant", 22: "struct", 23: "event", 24: "operator", 25: "typeParameter",
};
const SYMBOL_KIND: Record<number, string> = {
  1: "file", 2: "module", 3: "namespace", 4: "package", 5: "class", 6: "method", 7: "property",
  8: "field", 9: "constructor", 10: "enum", 11: "interface", 12: "function", 13: "variable",
  14: "constant", 15: "string", 16: "number", 17: "boolean", 18: "array", 19: "object",
  20: "key", 21: "null", 22: "enumMember", 23: "struct", 24: "event", 25: "operator", 26: "typeParameter",
};

interface Position { line: number; character: number }
interface Range { start?: Position; end?: Position }
interface Location { uri?: string; targetUri?: string; range?: Range; targetSelectionRange?: Range }

function ok(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj as Record<string, unknown>,
  };
}
function fail(err: unknown) {
  const e = err as { code?: number | string; message?: string };
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `LSP error [${e.code ?? "error"}]: ${e.message ?? String(err)}` }],
  };
}

/**
 * Returned by gd_workspace_symbols when the connected Godot build's GDScript
 * language server has no `workspace/symbol` method. This is an engine limitation
 * (observed through Godot 4.7, which replies -32601 Method not found), not a host
 * fault, so the message is explicit and points at the working alternative rather
 * than leaking a raw JSON-RPC error code.
 */
function unsupportedWorkspaceSymbols() {
  return {
    isError: true as const,
    content: [{
      type: "text" as const,
      text:
        "gd_workspace_symbols is unsupported by the connected Godot build: its GDScript " +
        "language server does not implement LSP 'workspace/symbol' (replies -32601 Method " +
        "not found; observed through Godot 4.7). This is an engine limitation, not a host " +
        "error. Use gd_document_symbols for a single file's symbols, or gd_definition / " +
        "gd_references to navigate by a known name.",
    }],
  };
}

function normalizeLocations(result: unknown): Array<{ uri: string; line: number; character: number }> {
  if (!result) return [];
  const arr = Array.isArray(result) ? result : [result];
  return arr.map((l) => {
    const loc = l as Location;
    const uri = loc.uri ?? loc.targetUri ?? "";
    const range = loc.range ?? loc.targetSelectionRange ?? {};
    return { uri, line: range.start?.line ?? 0, character: range.start?.character ?? 0 };
  });
}

function offsetOf(text: string, line: number, character: number): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i++) offset += lines[i].length + 1;
  return offset + character;
}

function applyTextEdits(text: string, edits: Array<{ range: Range; newText: string }>): string {
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

export function registerLspTools(server: McpServer, lsp: LspClient, cfg: Config): void {
  const openAndPos = async (path: string) => {
    const uri = toFileUri(path, cfg.projectPath);
    await lsp.ensureOpen(uri, readFileText(toFsPath(path, cfg.projectPath)));
    return uri;
  };

  const posSchema = {
    path: z.string().describe("Script path (res://..., absolute, or project-relative)"),
    line: z.number().int().describe("0-based line"),
    character: z.number().int().describe("0-based character"),
  };

  server.registerTool(
    "gd_completion",
    { title: "GDScript completion", description: "Type-aware code completion at a position via the Godot language server.", inputSchema: posSchema },
    async ({ path, line, character }) => {
      try {
        const uri = await openAndPos(path);
        const result = await lsp.request("textDocument/completion", { textDocument: { uri }, position: { line, character } });
        const raw = Array.isArray(result) ? result : ((result as { items?: unknown[] })?.items ?? []);
        const items = raw.map((i) => {
          const it = i as { label?: string; kind?: number; detail?: string; insertText?: string };
          return { label: it.label ?? "", kind: it.kind ? COMPLETION_KIND[it.kind] ?? String(it.kind) : "", detail: it.detail ?? "", insertText: it.insertText ?? it.label ?? "" };
        });
        return ok({ items });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "gd_hover",
    { title: "GDScript hover", description: "Hover documentation/type info at a position.", inputSchema: posSchema },
    async ({ path, line, character }) => {
      try {
        const uri = await openAndPos(path);
        const result = (await lsp.request("textDocument/hover", { textDocument: { uri }, position: { line, character } })) as
          { contents?: unknown } | null;
        let contents = "";
        const c = result?.contents;
        if (typeof c === "string") contents = c;
        else if (Array.isArray(c)) contents = c.map((x) => (typeof x === "string" ? x : (x as { value?: string })?.value ?? "")).join("\n");
        else if (c && typeof c === "object") contents = (c as { value?: string }).value ?? "";
        return ok({ contents });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "gd_definition",
    { title: "GDScript go-to-definition", description: "Resolve the definition location(s) of the symbol at a position.", inputSchema: posSchema },
    async ({ path, line, character }) => {
      try {
        const uri = await openAndPos(path);
        const result = await lsp.request("textDocument/definition", { textDocument: { uri }, position: { line, character } });
        return ok({ locations: normalizeLocations(result) });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "gd_references",
    {
      title: "GDScript find-references",
      description: "Find all references to the symbol at a position.",
      inputSchema: { ...posSchema, include_declaration: z.boolean().optional().describe("Include the declaration (default true)") },
    },
    async ({ path, line, character, include_declaration }) => {
      try {
        const uri = await openAndPos(path);
        const result = await lsp.request("textDocument/references", {
          textDocument: { uri }, position: { line, character },
          context: { includeDeclaration: include_declaration ?? true },
        });
        return ok({ locations: normalizeLocations(result) });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "gd_rename",
    {
      title: "GDScript rename symbol",
      description:
        "Rename a symbol project-wide. Returns the planned edit; pass apply=true to WRITE the changes to disk (DESTRUCTIVE — confirm with the user).",
      inputSchema: {
        ...posSchema,
        new_name: z.string().describe("New symbol name"),
        apply: z.boolean().optional().describe("Write edits to disk (default false = dry run)"),
        confirm: z.boolean().optional().describe("Auto-approve writing edits (skip the confirmation prompt); only relevant with apply=true"),
      },
    },
    async ({ path, line, character, new_name, apply, confirm }) => {
      try {
        const uri = await openAndPos(path);
        const edit = (await lsp.request("textDocument/rename", {
          textDocument: { uri }, position: { line, character }, newName: new_name,
        })) as { changes?: Record<string, Array<{ range: Range; newText: string }>> } | null;
        const changes = edit?.changes ?? {};
        const files = Object.keys(changes);
        let editCount = 0;
        for (const f of files) editCount += changes[f].length;
        let written: string[] = [];
        if (apply) {
          const blocked = await gate(server, confirm, `Rename to "${new_name}" — write ${editCount} edit(s) across ${files.length} file(s)`);
          if (blocked) return blocked;
          for (const fileUri of files) {
            const fsPath = decodeURIComponent(fileUri.replace(/^file:\/\//, ""));
            const before = fs.readFileSync(fsPath, "utf8");
            fs.writeFileSync(fsPath, applyTextEdits(before, changes[fileUri]), "utf8");
            written.push(fsPath);
          }
        }
        return ok({ changed_files: files, edit_count: editCount, applied: Boolean(apply), written });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "gd_document_symbols",
    {
      title: "GDScript document symbols",
      description: "List the symbols (classes, functions, variables, signals) declared in a script.",
      inputSchema: { path: z.string().describe("Script path") },
    },
    async ({ path }) => {
      try {
        const uri = await openAndPos(path);
        const result = (await lsp.request("textDocument/documentSymbol", { textDocument: { uri } })) as unknown[] | null;
        const symbols = (result ?? []).map((s) => {
          const sym = s as { name?: string; kind?: number; range?: Range; location?: Location; selectionRange?: Range };
          const range = sym.range ?? sym.selectionRange ?? sym.location?.range ?? {};
          return { name: sym.name ?? "", kind: sym.kind ? SYMBOL_KIND[sym.kind] ?? String(sym.kind) : "", line: range.start?.line ?? 0 };
        });
        return ok({ symbols });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "gd_workspace_symbols",
    {
      title: "GDScript workspace symbols",
      description:
        "Search symbols across the whole project by name. Note: Godot's GDScript " +
        "language server does not implement LSP 'workspace/symbol' (observed through " +
        "4.7), so on those builds this returns a clear 'unsupported' error rather " +
        "than results — use gd_document_symbols for per-file symbols.",
      inputSchema: { query: z.string().describe("Symbol name query") },
    },
    async ({ query }) => {
      try {
        // Feature-detect before calling: if the server never advertised
        // workspaceSymbolProvider, skip the request and return a clear message
        // instead of provoking a raw -32601.
        const caps = await lsp.getServerCapabilities();
        if (!caps.workspaceSymbolProvider) return unsupportedWorkspaceSymbols();

        const result = (await lsp.request("workspace/symbol", { query })) as unknown[] | null;
        const symbols = (result ?? []).map((s) => {
          const sym = s as { name?: string; kind?: number; location?: Location };
          return {
            name: sym.name ?? "",
            kind: sym.kind ? SYMBOL_KIND[sym.kind] ?? String(sym.kind) : "",
            uri: sym.location?.uri ?? "",
            line: sym.location?.range?.start?.line ?? 0,
          };
        });
        return ok({ symbols });
      } catch (err) {
        // Belt-and-suspenders: some builds advertise the capability but still
        // answer -32601 (or the equivalent "method not found"). Treat that as the
        // same engine limitation rather than an opaque protocol error.
        const e = err as { code?: number | string; message?: string };
        if (e.code === -32601 || /method not found/i.test(e.message ?? "")) {
          return unsupportedWorkspaceSymbols();
        }
        return fail(err);
      }
    },
  );

  server.registerTool(
    "gd_diagnostics",
    {
      title: "GDScript diagnostics",
      description: "Return compile/lint diagnostics (errors, warnings) for a script. Opens the file and waits briefly for the server to publish.",
      inputSchema: {
        path: z.string().describe("Script path"),
        wait_ms: z.number().int().positive().optional().describe("Max time to wait for the first publish (default 1500)"),
      },
    },
    async ({ path, wait_ms }) => {
      try {
        const uri = await openAndPos(path);
        const diagnostics = await lsp.waitForDiagnostics(uri, wait_ms ?? 1500);
        const named = diagnostics.map((d) => ({
          severity: (["", "error", "warning", "info", "hint"][d.severity] ?? "error"),
          message: d.message, line: d.line, character: d.character,
        }));
        return ok({ uri, diagnostics: named });
      } catch (err) { return fail(err); }
    },
  );
}
