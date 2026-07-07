import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { CsDapClient } from "../csdap.js";
import { DapError } from "../dap.js";
import { toFsPath } from "../paths.js";
import { gate } from "../confirm.js";

// How long step/continue wait for the program to settle (hit a breakpoint,
// finish a step, or terminate) before returning. On timeout the tool reports
// the current state — e.g. `continue` with no further breakpoint stays running.
const RESUME_WAIT_MS = 15000;

function ok(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj as Record<string, unknown>,
  };
}
function fail(err: unknown) {
  const e = err as { command?: string; message?: string };
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `C# DAP error [${e.command ?? "error"}]: ${e.message ?? String(err)}` }],
  };
}

/**
 * True when `err` is a DAP request that hit its own request deadline (not an
 * adapter-reported failure or a dropped connection). Used to turn a
 * setVariable / evaluate non-response into a clear message rather than the
 * generic timeout — the same F1 discipline the GDScript DAP plane uses.
 */
function isDapTimeout(err: unknown): err is DapError {
  return err instanceof DapError && /timed out after/.test(err.message);
}

/**
 * D4 C3 — the C#/.NET debugging plane. `cs_dbg_*` tools mirroring the read/inspect
 * GDScript `dbg_*` surface, but driven by **netcoredbg** (Samsung, MIT — spawned
 * over stdio by the host) attached to / launching a C# Godot game, instead of
 * Godot's built-in TCP debug adapter.
 *
 * Same disciplines as the GDScript plane: destructive tools (`cs_dbg_evaluate`,
 * `cs_dbg_set_variable`) are elicitation-gated; those two also carry a short
 * bounded deadline so a non-answering adapter fails fast with a clear message
 * (the F1 fix) instead of hanging the full DAP timeout. Adapter absent → the
 * lazy stdio spawn fails with an actionable hint, never a hang. Mutators beyond
 * `set_variable`, plus the richer extras (watch / restart / goto / exception &
 * data breakpoints), are deferred to a later cut, exactly as the C2 LSP mutators
 * were.
 */
export function registerCsDapTools(server: McpServer, dap: CsDapClient, cfg: Config): void {
  server.registerTool(
    "cs_dbg_launch",
    {
      title: "Launch C# debug session",
      description:
        "Start a C# Godot game under netcoredbg. `program` defaults to the configured Mono/.NET Godot binary " +
        "(GODOT_CSHARP_BIN) and `args` to ['--path', <C# project>]; override either to debug a different .NET program. " +
        "Any breakpoints set beforehand are applied during the handshake. Requires netcoredbg (GODOT_CSDAP_CMD) — " +
        "absent, the lazy spawn fails with an actionable hint rather than hanging.",
      inputSchema: {
        program: z.string().optional().describe("Path to the program to launch (default: the Mono/.NET Godot binary)"),
        args: z.array(z.string()).optional().describe("Program arguments (default: ['--path', <C# project>])"),
        stop_on_entry: z.boolean().optional().describe("Break at entry (default false)"),
        just_my_code: z.boolean().optional().describe("Restrict stepping/breakpoints to user code (netcoredbg justMyCode; default true)"),
      },
    },
    async ({ program, args, stop_on_entry, just_my_code }) => {
      try {
        await dap.start("launch", {
          program: program ?? cfg.csDapProgram,
          args: args ?? ["--path", cfg.csDapProjectPath],
          cwd: cfg.csDapProjectPath,
          stopAtEntry: stop_on_entry ?? false,
          justMyCode: just_my_code ?? true,
        });
        return ok({ session_id: "csharp", state: dap.state });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "cs_dbg_attach",
    {
      title: "Attach C# debug session",
      description:
        "Attach netcoredbg to an already-running .NET process (e.g. a C# Godot game launched separately) by its OS process id. " +
        "Any breakpoints set beforehand are applied during the handshake.",
      inputSchema: {
        process_id: z.number().int().describe("OS process id of the running .NET process to attach to"),
      },
    },
    async ({ process_id }) => {
      try {
        await dap.start("attach", { processId: process_id });
        return ok({ session_id: "csharp", state: dap.state });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "cs_dbg_set_breakpoints",
    {
      title: "Set C# breakpoints",
      description:
        "Set (replace) the breakpoints for a C# source file. Applied immediately if a session is running, else buffered until launch/attach. " +
        "Feature-detected: the per-line `conditions` modifier is only sent when the connected adapter advertises supportsConditionalBreakpoints " +
        "(netcoredbg does); on an adapter that advertises it unsupported the modifier is dropped and the result carries `unsupported_modifiers` " +
        "plus a `warning`. Detection needs a live session, so set conditions after cs_dbg_launch/cs_dbg_attach.",
      inputSchema: {
        path: z.string().describe("C# script path (res://..., absolute, or relative to the C# project root)"),
        lines: z.array(z.number().int().positive()).describe("1-based line numbers"),
        conditions: z.array(z.string().nullable()).optional().describe("Optional per-line condition expressions (aligned to lines, null to skip); break only when the expression is true"),
      },
    },
    async ({ path, lines, conditions }) => {
      try {
        const fsPath = toFsPath(path, cfg.csDapProjectPath);
        // Feature-detect the condition modifier against the connected adapter. Only when it does
        // not advertise supportsConditionalBreakpoints do we DROP conditions and warn — otherwise
        // a "conditional" breakpoint could halt unconditionally on an adapter that ignores them.
        const wantsCondition = Array.isArray(conditions) && conditions.some((c) => c != null && c !== "");
        const conditionUnsupported = wantsCondition && dap.capabilities != null && dap.capabilities["supportsConditionalBreakpoints"] !== true;
        const body = await dap.setBreakpoints(fsPath, lines, conditionUnsupported ? undefined : conditions);
        const verified = Array.isArray(body["breakpoints"])
          ? (body["breakpoints"] as Array<{ line?: number; verified?: boolean }>).map((b) => ({ line: b.line ?? 0, verified: Boolean(b.verified) }))
          : [];
        const result: Record<string, unknown> = { path: fsPath, buffered: body["buffered"] === true, breakpoints: verified };
        if (conditionUnsupported) {
          result.unsupported_modifiers = ["condition"];
          result.warning =
            "The connected C# debug adapter does not advertise supportsConditionalBreakpoints, so the per-line conditions were " +
            "dropped — the affected breakpoint(s) will halt unconditionally.";
        }
        return ok(result);
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "cs_dbg_continue",
    {
      title: "Continue (C#)",
      description:
        "Resume execution and wait for the program to settle again (next breakpoint or termination). " +
        "Returns the resulting state; if it runs on with no further breakpoint, reports state 'running'.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = await dap.resume("continue", { threadId: dap.threadId() }, RESUME_WAIT_MS);
        return ok({ state: r.state, stopped_reason: r.reason });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "cs_dbg_step",
    {
      title: "Step (C#)",
      description:
        "Step execution: 'over' (next), 'in' (stepIn), or 'out' (stepOut), then wait for the step to land. " +
        "Returns the resulting state and stop reason.",
      inputSchema: { kind: z.enum(["in", "over", "out"]).describe("Step kind") },
    },
    async ({ kind }) => {
      try {
        const command = kind === "in" ? "stepIn" : kind === "out" ? "stepOut" : "next";
        const r = await dap.resume(command, { threadId: dap.threadId() }, RESUME_WAIT_MS);
        return ok({ state: r.state, stopped_reason: r.reason });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "cs_dbg_stack_trace",
    {
      title: "Stack trace (C#)",
      description: "Return the current C# call stack (only meaningful while stopped at a breakpoint).",
      inputSchema: { levels: z.number().int().positive().optional().describe("Max frames (default 20)") },
    },
    async ({ levels }) => {
      try {
        const body = await dap.request("stackTrace", { threadId: dap.threadId(), startFrame: 0, levels: levels ?? 20 });
        const frames = Array.isArray(body["stackFrames"])
          ? (body["stackFrames"] as Array<{ id?: number; name?: string; source?: { path?: string; name?: string }; line?: number }>).map((f) => ({
              id: f.id ?? 0, name: f.name ?? "", source: f.source?.path ?? f.source?.name ?? "", line: f.line ?? 0,
            }))
          : [];
        return ok({ frames });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "cs_dbg_scopes",
    {
      title: "Scopes (C#)",
      description: "Return the variable scopes (Locals, etc.) for a C# stack frame.",
      inputSchema: { frame_id: z.number().int().describe("Frame id from cs_dbg_stack_trace") },
    },
    async ({ frame_id }) => {
      try {
        const body = await dap.request("scopes", { frameId: frame_id });
        const scopes = Array.isArray(body["scopes"])
          ? (body["scopes"] as Array<{ name?: string; variablesReference?: number }>).map((s) => ({ name: s.name ?? "", variables_ref: s.variablesReference ?? 0 }))
          : [];
        return ok({ scopes });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "cs_dbg_variables",
    {
      title: "Variables (C#)",
      description: "List variables under a scope or a complex value (via its variables_ref).",
      inputSchema: { variables_ref: z.number().int().describe("variablesReference from cs_dbg_scopes or a parent variable") },
    },
    async ({ variables_ref }) => {
      try {
        const body = await dap.request("variables", { variablesReference: variables_ref });
        const variables = Array.isArray(body["variables"])
          ? (body["variables"] as Array<{ name?: string; value?: string; type?: string; variablesReference?: number }>).map((v) => ({
              name: v.name ?? "", value: v.value ?? "", type: v.type ?? "", variables_ref: v.variablesReference ?? 0,
            }))
          : [];
        return ok({ variables });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "cs_dbg_evaluate",
    {
      title: "Evaluate C# expression",
      description:
        "Evaluate a C# expression in the context of a stopped frame. DESTRUCTIVE: arbitrary code execution — confirm with the user and keep this gated. " +
        "Bounded by a short deadline so a non-answering adapter fails fast rather than hanging the full DAP timeout.",
      inputSchema: {
        expression: z.string().describe("C# expression to evaluate"),
        frame_id: z.number().int().optional().describe("Frame id (from cs_dbg_stack_trace); omit for the top frame"),
        confirm: z.boolean().optional().describe("Auto-approve this arbitrary-code evaluation (skip the confirmation prompt)"),
      },
    },
    async ({ expression, frame_id, confirm }) => {
      try {
        const blocked = await gate(server, confirm, `Evaluate C# expression in the running game: ${expression}`);
        if (blocked) return blocked;
        let body: Record<string, unknown>;
        try {
          body = await dap.request("evaluate", { expression, frameId: frame_id, context: "repl" }, cfg.csDapEvaluateTimeoutMs);
        } catch (err) {
          if (isDapTimeout(err)) {
            return {
              isError: true as const,
              content: [{ type: "text" as const, text: `The C# debug adapter did not answer the evaluate request within ${cfg.csDapEvaluateTimeoutMs}ms — no result was returned. The debug session is still alive; use cs_dbg_variables to inspect state.` }],
            };
          }
          throw err;
        }
        return ok({ result: String(body["result"] ?? ""), type: String(body["type"] ?? ""), variables_ref: (body["variablesReference"] as number) ?? 0 });
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "cs_dbg_set_variable",
    {
      title: "Set C# variable value",
      description:
        "Change a variable's value in a stopped C# frame (DAP setVariable). DESTRUCTIVE: mutates live program state — confirm with the user and keep this gated. " +
        "`variables_ref` is the container's variablesReference (from cs_dbg_scopes, or a complex cs_dbg_variables entry), `name` is the variable within it, " +
        "`value` is the new value as a C# literal/expression. Feature-detected: on an adapter that advertises supportsSetVariable:false it returns a clear " +
        "\"unsupported\" message WITHOUT prompting; otherwise a bounded deadline turns a non-answering adapter into a clear message rather than a hang.",
      inputSchema: {
        variables_ref: z.number().int().describe("variablesReference of the containing scope/variable (from cs_dbg_scopes or cs_dbg_variables)"),
        name: z.string().describe("Variable name within that container"),
        value: z.string().describe("New value as a C# literal/expression"),
        confirm: z.boolean().optional().describe("Auto-approve this mutation (skip the confirmation prompt)"),
      },
    },
    async ({ variables_ref, name, value, confirm }) => {
      try {
        if (dap.capabilities && dap.capabilities["supportsSetVariable"] === false) {
          return {
            isError: true as const,
            content: [{ type: "text" as const, text: "cs_dbg_set_variable is unsupported by the connected C# debug adapter (it does not advertise supportsSetVariable). Read-only inspection (cs_dbg_variables) still works." }],
          };
        }
        const blocked = await gate(server, confirm, `Set C# variable ${name} = ${value} in the running game`);
        if (blocked) return blocked;
        let body: Record<string, unknown>;
        try {
          body = await dap.request("setVariable", { variablesReference: variables_ref, name, value }, cfg.csDapSetVarTimeoutMs);
        } catch (err) {
          if (isDapTimeout(err)) {
            return {
              isError: true as const,
              content: [{ type: "text" as const, text: `The C# debug adapter did not answer the setVariable request within ${cfg.csDapSetVarTimeoutMs}ms — no change was made; the variable is unchanged. Read-only inspection (cs_dbg_variables) still works.` }],
            };
          }
          throw err;
        }
        return ok({ name, value: String(body["value"] ?? value), type: String(body["type"] ?? ""), variables_ref: (body["variablesReference"] as number) ?? 0 });
      } catch (err) { return fail(err); }
    },
  );
}
