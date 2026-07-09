// C#/DAP-plane integration probe (EXPERIMENTAL, D4 C3) — spawns a REAL netcoredbg
// over stdio (via the host's own StdioChannel) and live-exercises the cs_dbg_*
// tools. It (1) verifies an `initialize` handshake against netcoredbg succeeds —
// the gate, independent of Godot — then (2) runs a best-effort, LOG-ONLY live
// breakpoint flow (launch the C# game under the debugger, arm breakpoints on
// Player.cs, continue, and dump stack/vars if it stops). Markers are grep-able
// (C#_DAP_REACHED / C#_DAP_CAPS / C#_DAP …). netcoredbg + Godot native-host
// launch/attach semantics under headless CI are the least-certain piece of the
// C# debugging plane, so ONLY the initialize gate is fatal; every
// live-flow probe failure is logged and swallowed, exactly like the GDScript
// dap-plane probe began.
//
// Requires netcoredbg resolvable via GODOT_CSDAP_CMD, the Mono/.NET Godot binary
// via GODOT_CSHARP_BIN, and GODOT_CSHARP_PROJECT pointing at the fixture.
import { CsDapClient } from "../dist/csdap.js";
import { StdioChannel } from "../dist/stdio.js";
import { loadConfig } from "../dist/config.js";
import { registerCsDapTools } from "../dist/tools/csdap.js";

const cfg = loadConfig();
console.log(`C# DAP: cmd='${cfg.csDapCmd} ${cfg.csDapArgs.join(" ")}'  program=${cfg.csDapProgram}  project=${cfg.csDapProjectPath}`);

const newChannel = () =>
  new StdioChannel(
    cfg.csDapCmd,
    cfg.csDapArgs,
    cfg.csDapProjectPath,
    "C# DAP (netcoredbg)",
    "Is netcoredbg installed and GODOT_CSDAP_CMD/GODOT_CSHARP_PROJECT set?",
  );

// ---- Gate: a raw initialize proves the adapter is reachable & speaks DAP ----
// netcoredbg answers initialize immediately on spawn, independent of Godot, so this
// is a reliable, Godot-free gate — the analogue of the LSP probe's getServerCapabilities().
let reached = false;
{
  const gate = new CsDapClient(newChannel(), 30000);
  try {
    const caps = await gate.request("initialize", {
      clientID: "breakpoint-mcp",
      clientName: "Godot Breakpoint MCP",
      adapterID: "coreclr",
      pathFormat: "path",
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
    });
    console.log("C#_DAP_REACHED: initialize OK — capabilities:", Object.keys(caps).sort().join(", ") || "(none advertised)");
    console.log(
      `C#_DAP_CAPS: configurationDone=${!!caps.supportsConfigurationDoneRequest}` +
      ` conditionalBreakpoints=${!!caps.supportsConditionalBreakpoints}` +
      ` setVariable=${!!caps.supportsSetVariable}` +
      ` evaluateForHovers=${!!caps.supportsEvaluateForHovers}` +
      ` exceptionOptions=${!!caps.supportsExceptionOptions}`,
    );
    reached = true;
  } catch (err) {
    console.error("C#_DAP_UNREACHED: could not reach netcoredbg:", err?.message ?? String(err));
    process.exitCode = 1;
  }
  gate.close();
}

// ---- Best-effort live breakpoint flow (LOG-ONLY, never fatal) --------------
if (reached) {
  const dap = new CsDapClient(newChannel(), 30000);
  // Pull tool handlers out and call them directly — the same code path a real MCP
  // client hits, without standing up a transport. Auto-approve gated tools.
  const tools = new Map();
  const rec = {
    registerTool: (name, _config, handler) => tools.set(name, handler),
    registerResource: () => {},
    server: { elicitInput: async () => ({ action: "accept", content: { proceed: true } }) },
  };
  registerCsDapTools(rec, dap, cfg);
  const call = (name, args) => tools.get(name)(args, {});

  try {
    // Arm breakpoints BEFORE launch so they apply during the handshake. Line 24
    // (`Counter += 0;` in _Process) runs every frame — the surest live hit; line 30
    // (`Counter -= amount;` in TakeDamage) is the documented natural breakpoint.
    const bp = await call("cs_dbg_set_breakpoints", { path: "res://Player.cs", lines: [24, 30] });
    console.log(`C#_DAP PROBE set_breakpoints: isError=${!!bp.isError} buffered=${bp.structuredContent?.buffered}`);

    // Launch the C# game under netcoredbg, headless. Whether netcoredbg can debug the
    // CoreCLR the Godot native host loads is exactly what this probe is here to reveal.
    const launch = await call("cs_dbg_launch", {
      program: cfg.csDapProgram,
      args: ["--path", cfg.csDapProjectPath, "--headless"],
      just_my_code: false,
    });
    console.log(`C#_DAP_LAUNCH: isError=${!!launch.isError} state=${launch.structuredContent?.state ?? "-"}` +
      (launch.isError ? ` detail=${JSON.stringify(launch.content?.[0]?.text ?? "").slice(0, 160)}` : ""));

    if (!launch.isError) {
      // Continue and see whether a breakpoint is hit within the resume window.
      const cont = await call("cs_dbg_continue", {});
      const stopped = cont.structuredContent?.state === "stopped";
      console.log(`C#_DAP_STOP: stopped=${stopped} reason=${cont.structuredContent?.stopped_reason ?? "-"}`);

      if (stopped) {
        const st = await call("cs_dbg_stack_trace", {});
        const frames = st.structuredContent?.frames ?? [];
        console.log(`C#_DAP_STACK: frames=${frames.length} top=${JSON.stringify(frames[0] ?? {}).slice(0, 160)}`);
        if (frames.length) {
          const sc = await call("cs_dbg_scopes", { frame_id: frames[0].id });
          const scope = sc.structuredContent?.scopes?.[0];
          if (scope) {
            const vars = await call("cs_dbg_variables", { variables_ref: scope.variables_ref });
            const names = (vars.structuredContent?.variables ?? []).map((v) => v.name);
            const counter = (vars.structuredContent?.variables ?? []).find((v) => v.name === "Counter");
            console.log(`C#_DAP_VARS: count=${names.length} hasCounter=${!!counter} counter=${counter?.value ?? "-"}`);
          }
        }
        // Headline acceptance marker: did the full breakpoint→stack→variables path work live?
        console.log(`C#_DAP_SEMANTIC_OK: stopped=true stack=${frames.length > 0}`);
      }
    }
  } catch (err) {
    console.log("C#_DAP live-flow probe threw", err?.message ?? String(err));
  }
  dap.close();
}

// The game launched under netcoredbg is a grandchild that can inherit the adapter's stdio pipe
// and keep this process alive after the probe is done — so node would otherwise linger until the
// step's outer `timeout` kills it (exit 124), a false failure even though every marker above
// passed. Exit explicitly; the gate already set exitCode=1 if netcoredbg was unreachable.
process.exit(process.exitCode ?? 0);
