import fs from "node:fs";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { CsLspClient } from "../cslsp.js";
import { toFileUri, toFsPath, readFileText } from "../paths.js";
import { gate } from "../confirm.js";
import {
  COMPLETION_KIND, SYMBOL_KIND, ok, fail, markupToString, isMethodNotFound, normalizeLocations,
  applyTextEdits, normalizeWorkspaceEdit,
  type Range, type Location,
} from "./lsp-common.js";

/**
 * D4 C2 — the C#/.NET semantic plane. Read-only `cs_*` tools mirroring the proven
 * read-only `gd_*` LSP surface, but driven by OmniSharp (spawned over stdio by the
 * host) against a C# Godot project instead of Godot's built-in GDScript server.
 *
 * The tools are feature-detected the same way the `gd_*` tools are: a capability
 * the server never advertised, or a `-32601 Method not found` from a server that
 * lied about advertising it, yields a clear "unsupported" message rather than a
 * raw JSON-RPC error or a hang. The two mutators — `cs_rename` (elicitation-gated
 * on `apply=true`) and the read-only `cs_code_action` listing — mirror the GDScript
 * `gd_rename` / `gd_code_action`.
 */

/**
 * Returned when the connected C# language server doesn't implement an optional
 * LSP method. Same graceful-degradation contract as the GDScript plane, worded
 * for OmniSharp (which — unlike Godot's GDScript server — is expected to support
 * workspace/symbol; this only fires on a server that genuinely lacks it).
 */
function unsupportedCsLsp(tool: string, method: string, capability: string, alt: string) {
  return {
    isError: true as const,
    content: [{
      type: "text" as const,
      text:
        `${tool} is unsupported by the connected C# language server: it does not implement ` +
        `LSP '${method}' (advertises no ${capability}, or replies -32601 Method not found). ` +
        `This is a language-server limitation, not a host error. ${alt}`,
    }],
  };
}

export function registerCsLspTools(server: McpServer, cslsp: CsLspClient, cfg: Config): void {
  const root = cfg.csLspProjectPath;
  const openAndPos = async (path: string) => {
    const uri = toFileUri(path, root);
    await cslsp.ensureOpen(uri, readFileText(toFsPath(path, root)));
    return uri;
  };

  const posSchema = {
    path: z.string().describe("C# script path (res://..., absolute, or relative to the C# project root)"),
    line: z.number().int().describe("0-based line"),
    character: z.number().int().describe("0-based character"),
  };

  server.registerTool(
    "cs_completion",
    { title: "C# completion", description: "Type-aware C# code completion at a position via OmniSharp.", inputSchema: posSchema },
    async ({ path, line, character }) => {
      try {
        const uri = await openAndPos(path);
        const result = await cslsp.request("textDocument/completion", { textDocument: { uri }, position: { line, character } });
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
    "cs_hover",
    { title: "C# hover", description: "Hover documentation/type info at a position (e.g. the `Counter : int` type).", inputSchema: posSchema },
    async ({ path, line, character }) => {
      try {
        const uri = await openAndPos(path);
        const result = (await cslsp.request("textDocument/hover", { textDocument: { uri }, position: { line, character } })) as
          { contents?: unknown } | null;
        return ok({ contents: markupToString(result?.contents) });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "cs_definition",
    { title: "C# go-to-definition", description: "Resolve the definition location(s) of the C# symbol at a position.", inputSchema: posSchema },
    async ({ path, line, character }) => {
      try {
        const uri = await openAndPos(path);
        const result = await cslsp.request("textDocument/definition", { textDocument: { uri }, position: { line, character } });
        return ok({ locations: normalizeLocations(result) });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "cs_references",
    {
      title: "C# find-references",
      description: "Find all references to the C# symbol at a position.",
      inputSchema: { ...posSchema, include_declaration: z.boolean().optional().describe("Include the declaration (default true)") },
    },
    async ({ path, line, character, include_declaration }) => {
      try {
        const uri = await openAndPos(path);
        const result = await cslsp.request("textDocument/references", {
          textDocument: { uri }, position: { line, character },
          context: { includeDeclaration: include_declaration ?? true },
        });
        return ok({ locations: normalizeLocations(result) });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "cs_rename",
    {
      title: "C# rename symbol",
      description:
        "Rename a C# symbol project-wide via OmniSharp. Returns the planned edit; pass apply=true to WRITE the changes to disk (DESTRUCTIVE — confirm with the user).",
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
        const edit = await cslsp.request("textDocument/rename", {
          textDocument: { uri }, position: { line, character }, newName: new_name,
        });
        // OmniSharp returns a WorkspaceEdit as `documentChanges` (versioned
        // TextDocumentEdit[]); normalizeWorkspaceEdit also accepts the legacy
        // `changes` map, so cs_rename handles either encoding.
        const changes = normalizeWorkspaceEdit(edit);
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
    "cs_document_symbols",
    {
      title: "C# document symbols",
      description: "List the symbols (classes, methods, properties, fields) declared in a C# script.",
      inputSchema: { path: z.string().describe("C# script path") },
    },
    async ({ path }) => {
      try {
        const uri = await openAndPos(path);
        const result = (await cslsp.request("textDocument/documentSymbol", { textDocument: { uri } })) as unknown[] | null;
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
    "cs_workspace_symbols",
    {
      title: "C# workspace symbols",
      description:
        "Search C# symbols across the whole project by name. Unlike Godot's GDScript server, " +
        "OmniSharp implements LSP 'workspace/symbol', so this returns real results; it stays " +
        "feature-detected (with a -32601 belt-and-suspenders) so a server that lacks it degrades " +
        "gracefully rather than erroring opaquely.",
      inputSchema: { query: z.string().describe("Symbol name query") },
    },
    async ({ query }) => {
      const alt = "Use cs_document_symbols for a single file's symbols, or cs_definition / cs_references to navigate by a known name.";
      try {
        const caps = await cslsp.getServerCapabilities();
        if (!caps.workspaceSymbolProvider) return unsupportedCsLsp("cs_workspace_symbols", "workspace/symbol", "workspaceSymbolProvider", alt);

        const result = (await cslsp.request("workspace/symbol", { query })) as unknown[] | null;
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
        if (isMethodNotFound(err)) return unsupportedCsLsp("cs_workspace_symbols", "workspace/symbol", "workspaceSymbolProvider", alt);
        return fail(err);
      }
    },
  );

  server.registerTool(
    "cs_signature_help",
    {
      title: "C# signature help",
      description: "Show the call signature(s) and active parameter at a position (the parameter hints an IDE pops up inside a call).",
      inputSchema: posSchema,
    },
    async ({ path, line, character }) => {
      try {
        const uri = await openAndPos(path);
        const result = (await cslsp.request("textDocument/signatureHelp", { textDocument: { uri }, position: { line, character } })) as
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
    "cs_diagnostics",
    {
      title: "C# diagnostics",
      description: "Return compile/analyzer diagnostics (errors, warnings) for a C# script. Opens the file and waits briefly for OmniSharp to publish.",
      inputSchema: {
        path: z.string().describe("C# script path"),
        wait_ms: z.number().int().positive().optional().describe("Max time to wait for the first publish (default 2000; OmniSharp's first analysis can be slow)"),
      },
    },
    async ({ path, wait_ms }) => {
      try {
        const uri = await openAndPos(path);
        const diagnostics = await cslsp.waitForDiagnostics(uri, wait_ms ?? 2000);
        const named = diagnostics.map((d) => ({
          severity: (["", "error", "warning", "info", "hint"][d.severity] ?? "error"),
          message: d.message, line: d.line, character: d.character,
        }));
        return ok({ uri, diagnostics: named });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "cs_code_action",
    {
      title: "C# code actions",
      description:
        "List the code actions (quick fixes / refactors) OmniSharp offers for a range — the lightbulb menu. " +
        "Read-only: returns the available actions (title, kind, whether each carries a WorkspaceEdit or a Command) without applying any. " +
        "Unlike Godot's GDScript server, OmniSharp implements code actions, so this returns real results; it stays " +
        "feature-detected (with a -32601 belt-and-suspenders) so a server that lacks it degrades gracefully. " +
        "end_line/end_character default to the start position (a caret, not a selection).",
      inputSchema: {
        path: z.string().describe("C# script path (res://..., absolute, or relative to the C# project root)"),
        start_line: z.number().int().describe("0-based start line"),
        start_character: z.number().int().describe("0-based start character"),
        end_line: z.number().int().optional().describe("0-based end line (default = start_line)"),
        end_character: z.number().int().optional().describe("0-based end character (default = start_character)"),
        only: z.array(z.string()).optional().describe("Restrict to these CodeActionKind prefixes, e.g. 'quickfix', 'refactor'"),
      },
    },
    async ({ path, start_line, start_character, end_line, end_character, only }) => {
      const alt = "Use cs_diagnostics to surface issues and cs_completion / cs_rename to make edits.";
      try {
        const caps = await cslsp.getServerCapabilities();
        if (!caps.codeActionProvider) return unsupportedCsLsp("cs_code_action", "textDocument/codeAction", "codeActionProvider", alt);

        const uri = await openAndPos(path);
        const range = {
          start: { line: start_line, character: start_character },
          end: { line: end_line ?? start_line, character: end_character ?? start_character },
        };
        const context: Record<string, unknown> = { diagnostics: [] };
        if (only && only.length) context.only = only;
        const result = (await cslsp.request("textDocument/codeAction", { textDocument: { uri }, range, context })) as unknown[] | null;
        const actions = (result ?? []).map((a) => {
          const act = a as { title?: string; kind?: string; edit?: unknown; command?: unknown };
          // A bare Command has `command` as a string; a CodeAction nests a Command object under `command`.
          const command = typeof act.command === "string" ? act.command : (act.command as { command?: string } | undefined)?.command ?? null;
          return { title: act.title ?? "", kind: act.kind ?? "", has_edit: act.edit !== undefined, command };
        });
        return ok({ actions });
      } catch (err) {
        if (isMethodNotFound(err)) return unsupportedCsLsp("cs_code_action", "textDocument/codeAction", "codeActionProvider", alt);
        return fail(err);
      }
    },
  );
}
