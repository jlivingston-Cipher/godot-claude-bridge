import fs from "node:fs";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { LspClient } from "../lsp.js";
import { toFileUri, toFsPath, readFileText } from "../paths.js";
import { gate } from "../confirm.js";
import {
  type Range, type Location,
  COMPLETION_KIND, SYMBOL_KIND, ok, fail, markupToString, isMethodNotFound, normalizeLocations,
  applyTextEdits,
} from "./lsp-common.js";

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

/**
 * Returned by gd_code_action when the connected Godot build's GDScript language
 * server doesn't offer code actions. Godot advertises `codeActionProvider: false`
 * on current builds (confirmed in CI against 4.3-stable) and replies -32601 to a
 * `textDocument/codeAction` request. Same graceful-degradation contract as
 * gd_workspace_symbols: a clear message, not a raw JSON-RPC error.
 */
function unsupportedCodeAction() {
  return {
    isError: true as const,
    content: [{
      type: "text" as const,
      text:
        "gd_code_action is unsupported by the connected Godot build: its GDScript " +
        "language server does not offer code actions (advertises codeActionProvider:false " +
        "and replies -32601 Method not found; observed on Godot 4.3). This is an engine " +
        "limitation, not a host error. Use gd_diagnostics to surface issues and " +
        "gd_completion / gd_rename to make edits.",
    }],
  };
}

/**
 * Generic graceful-degradation message for an optional LSP method the connected
 * Godot build doesn't implement. The newer read-only providers below
 * (documentHighlight, foldingRange, typeDefinition, implementation, declaration,
 * documentLink, formatting) are all *advertised* by Godot 4.3's language server —
 * but, as the D7 probe proved for workspace/symbol, advertised is not the same as
 * implemented. Each tool feature-detects its capability AND catches a -32601 from
 * a build that advertises the capability yet still answers "method not found",
 * returning this clear message instead of leaking a raw JSON-RPC error.
 */
function unsupportedLsp(tool: string, method: string, capability: string, alt: string) {
  return {
    isError: true as const,
    content: [{
      type: "text" as const,
      text:
        `${tool} is unsupported by the connected Godot build: its GDScript language server ` +
        `does not implement LSP '${method}' (advertises no ${capability}, or replies -32601 ` +
        `Method not found). This is an engine limitation, not a host error. ${alt}`,
    }],
  };
}

// textDocument/documentHighlight DocumentHighlightKind -> readable name.
const HIGHLIGHT_KIND: Record<number, string> = { 1: "text", 2: "read", 3: "write" };

function normalizeHighlights(result: unknown): Array<{ line: number; character: number; end_line: number; end_character: number; kind: string }> {
  const arr = Array.isArray(result) ? result : [];
  return arr.map((h) => {
    const hh = h as { range?: Range; kind?: number };
    const r = hh.range ?? {};
    return {
      line: r.start?.line ?? 0, character: r.start?.character ?? 0,
      end_line: r.end?.line ?? 0, end_character: r.end?.character ?? 0,
      kind: hh.kind ? HIGHLIGHT_KIND[hh.kind] ?? String(hh.kind) : "text",
    };
  });
}

function normalizeFolding(result: unknown): Array<{ start_line: number; end_line: number; kind: string }> {
  const arr = Array.isArray(result) ? result : [];
  return arr.map((f) => {
    const ff = f as { startLine?: number; endLine?: number; kind?: string };
    return { start_line: ff.startLine ?? 0, end_line: ff.endLine ?? 0, kind: ff.kind ?? "" };
  });
}

function normalizeLinks(result: unknown): Array<{ line: number; character: number; end_line: number; end_character: number; target: string }> {
  const arr = Array.isArray(result) ? result : [];
  return arr.map((l) => {
    const ll = l as { range?: Range; target?: string };
    const r = ll.range ?? {};
    return {
      line: r.start?.line ?? 0, character: r.start?.character ?? 0,
      end_line: r.end?.line ?? 0, end_character: r.end?.character ?? 0,
      target: ll.target ?? "",
    };
  });
}

// textDocument/documentColor -> ColorInformation[]: each { range, color:{red,green,blue,alpha} }
// with every channel a float in 0..1. We surface the raw 0..1 components AND a
// convenience #RRGGBBAA hex (Godot's Color.to_html() ordering) so a caller can
// eyeball the swatch without re-deriving it.
function normalizeColors(result: unknown): Array<{ line: number; character: number; end_line: number; end_character: number; red: number; green: number; blue: number; alpha: number; hex: string }> {
  const arr = Array.isArray(result) ? result : [];
  const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round((v ?? 0) * 255))).toString(16).padStart(2, "0");
  return arr.map((c) => {
    const cc = c as { range?: Range; color?: { red?: number; green?: number; blue?: number; alpha?: number } };
    const r = cc.range ?? {};
    const col = cc.color ?? {};
    const red = col.red ?? 0, green = col.green ?? 0, blue = col.blue ?? 0, alpha = col.alpha ?? 0;
    return {
      line: r.start?.line ?? 0, character: r.start?.character ?? 0,
      end_line: r.end?.line ?? 0, end_character: r.end?.character ?? 0,
      red, green, blue, alpha,
      hex: `#${hex2(red)}${hex2(green)}${hex2(blue)}${hex2(alpha)}`,
    };
  });
}

// offsetOf / applyTextEdits now live in ./lsp-common.js (shared with the C#
// rename mutator, cs_rename). Imported above.

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

  server.registerTool(
    "gd_signature_help",
    {
      title: "GDScript signature help",
      description:
        "Show the call signature(s) and active parameter at a position (the parameter hints an IDE pops up inside a call). " +
        "Godot's GDScript language server advertises signatureHelpProvider.",
      inputSchema: posSchema,
    },
    async ({ path, line, character }) => {
      try {
        const uri = await openAndPos(path);
        const result = (await lsp.request("textDocument/signatureHelp", { textDocument: { uri }, position: { line, character } })) as
          { signatures?: unknown[]; activeSignature?: number; activeParameter?: number } | null;
        const signatures = (result?.signatures ?? []).map((s) => {
          const sig = s as { label?: string; documentation?: unknown; parameters?: unknown[] };
          const sigLabel = sig.label ?? "";
          const parameters = (sig.parameters ?? []).map((p) => {
            const par = p as { label?: unknown; documentation?: unknown };
            let plabel = "";
            if (typeof par.label === "string") plabel = par.label;
            // Per LSP, a parameter label may be a [start,end] offset pair into the signature label.
            else if (Array.isArray(par.label) && par.label.length === 2) plabel = sigLabel.slice(Number(par.label[0]), Number(par.label[1]));
            return { label: plabel, documentation: markupToString(par.documentation) };
          });
          return { label: sigLabel, documentation: markupToString(sig.documentation), parameters };
        });
        return ok({ signatures, active_signature: result?.activeSignature ?? 0, active_parameter: result?.activeParameter ?? 0 });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "gd_code_action",
    {
      title: "GDScript code actions",
      description:
        "List the code actions (quick fixes / refactors) the language server offers for a range — the lightbulb menu. " +
        "Read-only: returns the available actions (title, kind, whether each carries a WorkspaceEdit or a Command) without applying any. " +
        "end_line/end_character default to the start position (a caret, not a selection).",
      inputSchema: {
        path: z.string().describe("Script path (res://..., absolute, or project-relative)"),
        start_line: z.number().int().describe("0-based start line"),
        start_character: z.number().int().describe("0-based start character"),
        end_line: z.number().int().optional().describe("0-based end line (default = start_line)"),
        end_character: z.number().int().optional().describe("0-based end character (default = start_character)"),
        only: z.array(z.string()).optional().describe("Restrict to these CodeActionKind prefixes, e.g. 'quickfix', 'refactor', 'source'"),
      },
    },
    async ({ path, start_line, start_character, end_line, end_character, only }) => {
      try {
        // Feature-detect: Godot's GDScript LSP advertises codeActionProvider:false
        // on current builds (confirmed in CI on 4.3-stable) and replies -32601 to
        // the request. Skip the call and return a clear message rather than leaking
        // a raw JSON-RPC error, mirroring gd_workspace_symbols.
        const caps = await lsp.getServerCapabilities();
        if (!caps.codeActionProvider) return unsupportedCodeAction();

        const uri = await openAndPos(path);
        const range = {
          start: { line: start_line, character: start_character },
          end: { line: end_line ?? start_line, character: end_character ?? start_character },
        };
        const context: Record<string, unknown> = { diagnostics: [] };
        if (only && only.length) context.only = only;
        const result = (await lsp.request("textDocument/codeAction", { textDocument: { uri }, range, context })) as unknown[] | null;
        const actions = (result ?? []).map((a) => {
          const act = a as { title?: string; kind?: string; edit?: unknown; command?: unknown };
          // A bare Command has `command` as a string; a CodeAction nests a Command object under `command`.
          const command = typeof act.command === "string" ? act.command : (act.command as { command?: string } | undefined)?.command ?? null;
          return { title: act.title ?? "", kind: act.kind ?? "", has_edit: act.edit !== undefined, command };
        });
        return ok({ actions });
      } catch (err) {
        // Belt-and-suspenders: a build that advertises the capability but still
        // answers -32601 gets the same graceful "unsupported" treatment.
        const e = err as { code?: number | string; message?: string };
        if (e.code === -32601 || /method not found/i.test(e.message ?? "")) return unsupportedCodeAction();
        return fail(err);
      }
    },
  );

  // ---- Phase 1 LSP-depth: read-only navigation/inspection providers --------
  // Godot 4.3's GDScript language server advertises documentHighlight, folding,
  // typeDefinition, implementation, declaration, documentLink and formatting in
  // its initialize capabilities. Each tool below feature-detects the capability
  // and keeps a -32601 belt-and-suspenders (the D7 lesson: advertised ≠ honoured),
  // returning a clear "unsupported" message rather than a raw JSON-RPC error.

  server.registerTool(
    "gd_document_highlight",
    {
      title: "GDScript document highlights",
      description:
        "Highlight every occurrence of the symbol at a position WITHIN the same file, tagged read / write / text " +
        "(the shading an editor shows for a variable's uses when the caret is on it). Read-only. " +
        "Godot's GDScript language server advertises documentHighlightProvider; feature-detected.",
      inputSchema: posSchema,
    },
    async ({ path, line, character }) => {
      const alt = "Use gd_references for project-wide uses of the symbol.";
      try {
        const caps = await lsp.getServerCapabilities();
        if (!caps.documentHighlightProvider) return unsupportedLsp("gd_document_highlight", "textDocument/documentHighlight", "documentHighlightProvider", alt);
        const uri = await openAndPos(path);
        const result = await lsp.request("textDocument/documentHighlight", { textDocument: { uri }, position: { line, character } });
        return ok({ highlights: normalizeHighlights(result) });
      } catch (err) {
        if (isMethodNotFound(err)) return unsupportedLsp("gd_document_highlight", "textDocument/documentHighlight", "documentHighlightProvider", alt);
        return fail(err);
      }
    },
  );

  server.registerTool(
    "gd_type_definition",
    {
      title: "GDScript go-to-type-definition",
      description:
        "Resolve the location of the TYPE of the symbol at a position (jump to the class of a typed variable), as opposed to the " +
        "symbol's own definition. Godot's GDScript language server advertises typeDefinitionProvider; feature-detected.",
      inputSchema: posSchema,
    },
    async ({ path, line, character }) => {
      const alt = "Use gd_definition to jump to the symbol's own definition.";
      try {
        const caps = await lsp.getServerCapabilities();
        if (!caps.typeDefinitionProvider) return unsupportedLsp("gd_type_definition", "textDocument/typeDefinition", "typeDefinitionProvider", alt);
        const uri = await openAndPos(path);
        const result = await lsp.request("textDocument/typeDefinition", { textDocument: { uri }, position: { line, character } });
        return ok({ locations: normalizeLocations(result) });
      } catch (err) {
        if (isMethodNotFound(err)) return unsupportedLsp("gd_type_definition", "textDocument/typeDefinition", "typeDefinitionProvider", alt);
        return fail(err);
      }
    },
  );

  server.registerTool(
    "gd_implementation",
    {
      title: "GDScript go-to-implementation",
      description:
        "Resolve the implementation location(s) of the symbol at a position (e.g. the concrete override of a method). " +
        "Godot's GDScript language server advertises implementationProvider; feature-detected.",
      inputSchema: posSchema,
    },
    async ({ path, line, character }) => {
      const alt = "Use gd_definition / gd_references to navigate the symbol.";
      try {
        const caps = await lsp.getServerCapabilities();
        if (!caps.implementationProvider) return unsupportedLsp("gd_implementation", "textDocument/implementation", "implementationProvider", alt);
        const uri = await openAndPos(path);
        const result = await lsp.request("textDocument/implementation", { textDocument: { uri }, position: { line, character } });
        return ok({ locations: normalizeLocations(result) });
      } catch (err) {
        if (isMethodNotFound(err)) return unsupportedLsp("gd_implementation", "textDocument/implementation", "implementationProvider", alt);
        return fail(err);
      }
    },
  );

  server.registerTool(
    "gd_declaration",
    {
      title: "GDScript go-to-declaration",
      description:
        "Resolve the declaration location(s) of the symbol at a position. (For many symbols this coincides with the definition; the " +
        "two differ for forward-declared or re-exported names.) Godot's GDScript language server advertises declarationProvider; feature-detected.",
      inputSchema: posSchema,
    },
    async ({ path, line, character }) => {
      const alt = "Use gd_definition to resolve the symbol's definition.";
      try {
        const caps = await lsp.getServerCapabilities();
        if (!caps.declarationProvider) return unsupportedLsp("gd_declaration", "textDocument/declaration", "declarationProvider", alt);
        const uri = await openAndPos(path);
        const result = await lsp.request("textDocument/declaration", { textDocument: { uri }, position: { line, character } });
        return ok({ locations: normalizeLocations(result) });
      } catch (err) {
        if (isMethodNotFound(err)) return unsupportedLsp("gd_declaration", "textDocument/declaration", "declarationProvider", alt);
        return fail(err);
      }
    },
  );

  server.registerTool(
    "gd_folding_ranges",
    {
      title: "GDScript folding ranges",
      description:
        "List the foldable regions of a script (functions, blocks, comment/region markers) — the ranges an editor's fold gutter offers. " +
        "Read-only. Godot's GDScript language server advertises foldingRangeProvider; feature-detected.",
      inputSchema: { path: z.string().describe("Script path (res://..., absolute, or project-relative)") },
    },
    async ({ path }) => {
      const alt = "Use gd_document_symbols to outline the file's structure instead.";
      try {
        const caps = await lsp.getServerCapabilities();
        if (!caps.foldingRangeProvider) return unsupportedLsp("gd_folding_ranges", "textDocument/foldingRange", "foldingRangeProvider", alt);
        const uri = await openAndPos(path);
        const result = await lsp.request("textDocument/foldingRange", { textDocument: { uri } });
        return ok({ ranges: normalizeFolding(result) });
      } catch (err) {
        if (isMethodNotFound(err)) return unsupportedLsp("gd_folding_ranges", "textDocument/foldingRange", "foldingRangeProvider", alt);
        return fail(err);
      }
    },
  );

  server.registerTool(
    "gd_document_link",
    {
      title: "GDScript document links",
      description:
        "List the links embedded in a script (res:// paths or URLs the language server recognizes) with their source ranges and targets. " +
        "Read-only. Godot's GDScript language server advertises documentLinkProvider; feature-detected.",
      inputSchema: { path: z.string().describe("Script path (res://..., absolute, or project-relative)") },
    },
    async ({ path }) => {
      const alt = "Links are an editor-only convenience; there is no host-side alternative.";
      try {
        const caps = await lsp.getServerCapabilities();
        if (!caps.documentLinkProvider) return unsupportedLsp("gd_document_link", "textDocument/documentLink", "documentLinkProvider", alt);
        const uri = await openAndPos(path);
        const result = await lsp.request("textDocument/documentLink", { textDocument: { uri } });
        return ok({ links: normalizeLinks(result) });
      } catch (err) {
        if (isMethodNotFound(err)) return unsupportedLsp("gd_document_link", "textDocument/documentLink", "documentLinkProvider", alt);
        return fail(err);
      }
    },
  );

  server.registerTool(
    "gd_formatting",
    {
      title: "GDScript format (preview)",
      description:
        "Compute how the language server would reformat a whole script and return the formatted TEXT — WITHOUT writing anything to disk " +
        "(read-only preview; apply it yourself with a file write if you want it). " +
        "Godot's GDScript language server advertises documentFormattingProvider; feature-detected.",
      inputSchema: {
        path: z.string().describe("Script path (res://..., absolute, or project-relative)"),
        tab_size: z.number().int().positive().optional().describe("Indent width the server should assume (default 4)"),
        insert_spaces: z.boolean().optional().describe("Indent with spaces instead of tabs (default false — Godot uses tabs)"),
      },
    },
    async ({ path, tab_size, insert_spaces }) => {
      const alt = "Formatting has no host-side fallback; the connected build must implement it.";
      try {
        const caps = await lsp.getServerCapabilities();
        if (!caps.documentFormattingProvider) return unsupportedLsp("gd_formatting", "textDocument/formatting", "documentFormattingProvider", alt);
        const fsPath = toFsPath(path, cfg.projectPath);
        const before = readFileText(fsPath);
        const uri = toFileUri(path, cfg.projectPath);
        await lsp.ensureOpen(uri, before);
        const result = (await lsp.request("textDocument/formatting", {
          textDocument: { uri },
          options: { tabSize: tab_size ?? 4, insertSpaces: insert_spaces ?? false },
        })) as Array<{ range: Range; newText: string }> | null;
        const edits = result ?? [];
        const formatted = applyTextEdits(before, edits);
        return ok({ edit_count: edits.length, formatted });
      } catch (err) {
        if (isMethodNotFound(err)) return unsupportedLsp("gd_formatting", "textDocument/formatting", "documentFormattingProvider", alt);
        return fail(err);
      }
    },
  );

  server.registerTool(
    "gd_document_color",
    {
      title: "GDScript document colors",
      description:
        "List the color literals the language server recognizes in a script — the Color(...) values an editor draws an inline swatch for — with each one's source range, its RGBA components (floats 0..1) and a convenience #RRGGBBAA hex. Read-only. " +
        "Godot's GDScript language server advertises colorProvider; feature-detected with a -32601 belt-and-suspenders (advertised ≠ implemented — the D7 lesson).",
      inputSchema: { path: z.string().describe("Script path (res://..., absolute, or project-relative)") },
    },
    async ({ path }) => {
      const alt = "Color inlays are an editor-only convenience; there is no host-side alternative.";
      try {
        const caps = await lsp.getServerCapabilities();
        if (!caps.colorProvider) return unsupportedLsp("gd_document_color", "textDocument/documentColor", "colorProvider", alt);
        const uri = await openAndPos(path);
        const result = await lsp.request("textDocument/documentColor", { textDocument: { uri } });
        return ok({ colors: normalizeColors(result) });
      } catch (err) {
        if (isMethodNotFound(err)) return unsupportedLsp("gd_document_color", "textDocument/documentColor", "colorProvider", alt);
        return fail(err);
      }
    },
  );
}
