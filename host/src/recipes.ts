/**
 * Recipes — a free, curated task-recipe layer exposed as MCP **prompts**.
 *
 * A recipe is a short, opinionated workflow that drives Breakpoint's own
 * enforced tools to accomplish a common Godot task and then *verifies* it. It
 * is the same idea as a paid "skill pack", with two differences that matter:
 * it's **free** (MIT, shipped in the server), and it sits **over typed,
 * schema-validated, undoable tools** — so the contract is executed by the
 * server, not merely described in prose the model might misapply. Recipes are
 * discoverable via MCP `prompts/list`; they add **no tools** (the 276-tool
 * count is unchanged) and cost nothing until a client pulls one.
 */
import { z } from "zod";

/** Minimal shape of the McpServer surface a recipe needs. */
interface RecipeServer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerPrompt: (name: string, config: any, cb: any) => unknown;
}

type Args = Record<string, unknown>;
const str = (a: Args, k: string, dflt: string): string =>
  typeof a?.[k] === "string" && (a[k] as string).length ? (a[k] as string) : dflt;

/** Wrap recipe body text as a single-message GetPromptResult. */
function recipe(description: string, text: string) {
  return { description, messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

/** The shared closing note every recipe carries — the safety/story hook. */
const SAFETY =
  "Throughout: every edit goes through the editor's undo stack (editor_undo / Ctrl-Z " +
  "reverts anything), destructive tools are confirmation-gated, and the runtime_assert_* " +
  "verification family is free and read-only — a failed assert is one dbg_* step from *why*.";

export const RECIPE_NAMES = [
  "recipe_2d_player_controller",
  "recipe_wire_signal_and_assert",
  "recipe_debug_inspect_variable",
  "recipe_screenshot_regression",
  "recipe_type_safe_edit",
  "recipe_csharp_fix_and_debug",
] as const;

export function registerRecipes(server: RecipeServer): void {
  // 1 — 2D player controller, then verify it moves.
  server.registerPrompt(
    "recipe_2d_player_controller",
    {
      title: "2D player: CharacterBody2D + input + camera, then verify",
      description: "Build a movable 2D player (input actions, body, collision, sprite, camera), type-check the script, then run and assert it actually moved.",
      argsSchema: {
        scene_path: z.string().optional().describe("Scene to edit (default res://main.tscn)"),
        player_name: z.string().optional().describe("Node name for the player (default Player)"),
        speed: z.string().optional().describe("Move speed in px/s (default 220)"),
      },
    },
    (a: Args) => {
      const scene = str(a, "scene_path", "res://main.tscn");
      const player = str(a, "player_name", "Player");
      const speed = str(a, "speed", "220");
      return recipe(
        "2D player controller with a runtime movement check.",
        [
          `Goal: add a keyboard-movable "${player}" to ${scene} and prove it moves.`,
          "",
          "1. Input: inputmap_add_action for move_left/right/up/down (skip any inputmap_list already reports), then inputmap_add_event to bind arrow keys / WASD.",
          `2. Scene: scene_open ${scene} (or scene_new). node_add a CharacterBody2D named "${player}"; collisionshape_add a rectangle to it; node_add a Sprite2D (set its texture via node_set_property, or asset_gen_sprite if no art yet); camera_create as a child so the view follows.`,
          `3. Script: author a _physics_process that reads Input.get_vector("move_left","move_right","move_up","move_down") * ${speed} into velocity and calls move_and_slide(); attach it to "${player}" (node_set_property script). Run gd_diagnostics on the script and fix until it reports zero errors BEFORE running.`,
          `4. Verify: godot_run_project. runtime_assert_scene_structure that "${player}" (+ Camera2D, CollisionShape2D) exists. Capture the start position (runtime_get_property position), runtime_inject_input a right/up press for a few frames, then runtime_assert_node_state that position changed in the expected direction. godot_stop.`,
          "",
          SAFETY,
        ].join("\n"),
      );
    },
  );

  // 2 — Wire a signal and assert at runtime that it fired.
  server.registerPrompt(
    "recipe_wire_signal_and_assert",
    {
      title: "Wire a signal and assert at runtime that it fired",
      description: "Connect a signal to a handler, then run the game, trigger it, and confirm the handler actually ran — the contract enforced, not assumed.",
      argsSchema: {
        signal_name: z.string().optional().describe("Signal to wire (e.g. body_entered, pressed, timeout)"),
      },
    },
    (a: Args) => {
      const sig = str(a, "signal_name", "pressed");
      return recipe(
        "Signal wiring with a runtime firing assertion.",
        [
          `Goal: wire the "${sig}" signal to a handler and prove the handler runs.`,
          "",
          `1. Inspect: signal_list on the emitter to confirm "${sig}" exists (or signal_add_user_signal to declare a custom one).`,
          `2. Connect: signal_connect the emitter's "${sig}" to a method on the receiver (signal_list_connections to confirm the edge).`,
          "3. Handler: author the handler so it leaves an observable trace — set a Label's text, flip a property, or print() (captured by the runtime log). Run gd_diagnostics until clean.",
          "4. Run + trigger: godot_run_project, then cause the signal — runtime_inject_input for input signals, runtime_call_method / runtime_emit_signal for logic signals.",
          "5. Assert: confirm the trace — runtime_assert_screen_text for the label, runtime_assert_node_state for the flipped property, or scan runtime_get_log for the print. A green assert means the wire is real, not hoped-for. godot_stop.",
          "",
          SAFETY,
        ].join("\n"),
      );
    },
  );

  // 3 — Debugger loop: breakpoint, launch, inspect a real variable.
  server.registerPrompt(
    "recipe_debug_inspect_variable",
    {
      title: "Set a breakpoint, launch under the debugger, read a real variable",
      description: "The core differentiator: stop a running GDScript (or C#) game at a line and read actual call-stack values over Godot's Debug Adapter — not a guess from the outside.",
      argsSchema: {
        script_path: z.string().optional().describe("Script to break in (e.g. res://player.gd)"),
        line: z.string().optional().describe("1-based line to break on"),
      },
    },
    (a: Args) => {
      const path = str(a, "script_path", "res://player.gd");
      const line = str(a, "line", "24");
      return recipe(
        "Live step-debugging with real variable inspection.",
        [
          `Goal: pause the running game inside ${path}:${line} and read live state.`,
          "",
          `1. Breakpoint: dbg_set_breakpoints on ${path} at line ${line} (find the right line first with gd_document_symbols / gd_definition if unsure).`,
          "2. Launch: dbg_launch to start the game under the Debug Adapter and run to the breakpoint.",
          "3. Inspect (paused): dbg_stack_trace for the frames, dbg_scopes + dbg_variables for the real locals/members in the top frame, and dbg_evaluate to compute an expression in that frame. dbg_watch to track a value across steps.",
          "4. Step: dbg_step over/into to watch state evolve; dbg_continue to resume (or dbg_set_exception_breakpoints to stop on the next error). dbg_restart to re-run.",
          "",
          "This is the capability a screenshot-and-scene-tree server can't offer: it observes from outside; Breakpoint stops execution and looks inside. (C#? the same flow with cs_dbg_* via netcoredbg.)",
          "",
          SAFETY,
        ].join("\n"),
      );
    },
  );

  // 4 — Screenshot regression: reference frame, then diff.
  server.registerPrompt(
    "recipe_screenshot_regression",
    {
      title: "Capture a reference frame and assert a scene hasn't visually regressed",
      description: "Golden-image testing for a Godot scene using the free, read-only runtime_screenshot_diff — and the debugger on hand when it fails.",
      argsSchema: {
        reference_path: z.string().optional().describe("Project path for the golden PNG (default res://tests/ref.png)"),
        tolerance: z.string().optional().describe("Max fraction of differing pixels (default 0.02)"),
      },
    },
    (a: Args) => {
      const ref = str(a, "reference_path", "res://tests/ref.png");
      const tol = str(a, "tolerance", "0.02");
      return recipe(
        "Golden-image regression check for a scene.",
        [
          `Goal: lock a scene's look to a golden image at ${ref} and catch visual drift.`,
          "",
          `1. Establish the golden (first run only): godot_run_project, drive the game to the state under test (runtime_inject_input / runtime_call_method), then runtime_screenshot and save the frame to ${ref}. Commit it (vcs_add) so it's the reference.`,
          `2. Regression run (every time after): godot_run_project, reproduce the same state, then runtime_screenshot_diff against ${ref} with tolerance ${tol} (pass a region to ignore volatile HUD areas). ok:true means no meaningful drift.`,
          "3. On failure: the diff returns diff_ratio + differing_pixels — don't just eyeball it. runtime_get_tree / runtime_assert_node_state to find the node that changed, or dbg_* to break where the offending value is set. Update the golden deliberately (re-do step 1) only once you've confirmed the change is intended.",
          "",
          "The whole diff runs engine-side (Image), so there's no OCR/image dependency and it stays read-only and ungated.",
          "",
          SAFETY,
        ].join("\n"),
      );
    },
  );

  // 5 — Type-safe edit with the language server before running.
  server.registerPrompt(
    "recipe_type_safe_edit",
    {
      title: "Make a type-checked edit with the language server before running",
      description: "Edit GDScript the way an IDE does — symbols, references, hover, and diagnostics from Godot's real LSP — so errors are caught before the game runs.",
      argsSchema: {
        script_path: z.string().optional().describe("Script to edit (e.g. res://player.gd)"),
      },
    },
    (a: Args) => {
      const path = str(a, "script_path", "res://player.gd");
      return recipe(
        "Type-aware editing gated by the language server.",
        [
          `Goal: change ${path} with real symbol knowledge and land it error-free.`,
          "",
          `1. Understand: gd_document_symbols for the file's shape; gd_definition / gd_references before touching a symbol so you know every call site; find_usages across the project for wider blast radius.`,
          "2. Edit with help: while writing, use gd_completion and gd_hover to get exact API names and signatures (this is where a generic 'call any method' tool hallucinates — the LSP gives you the truth). gd_rename to rename safely across the project.",
          "3. Gate: run gd_diagnostics and do not proceed until it's clean. gd_code_action for quick-fixes it suggests.",
          "4. Prove behavior: godot_run_project and a runtime_assert_* that the change did what you intended. If it didn't, dbg_* into it.",
          "",
          "Every mutation is on the undo stack — editor_undo reverts a bad edit instantly.",
          "",
          SAFETY,
        ].join("\n"),
      );
    },
  );

  // 6 — C#: inspect, fix with diagnostics, and debug.
  server.registerPrompt(
    "recipe_csharp_fix_and_debug",
    {
      title: "C#: inspect, fix with diagnostics, and debug via netcoredbg",
      description: "Full C# parity — OmniSharp for symbols and diagnostics, netcoredbg for real step-debugging — the same enforced loop GDScript gets.",
      argsSchema: {
        script_path: z.string().optional().describe("C# file to work in (e.g. res://Player.cs)"),
      },
    },
    (a: Args) => {
      const path = str(a, "script_path", "res://Player.cs");
      return recipe(
        "C# fix-and-debug loop over OmniSharp + netcoredbg.",
        [
          `Goal: diagnose and fix ${path}, then step through it to confirm the fix.`,
          "",
          `1. Locate: cs_document_symbols / cs_workspace_symbols to navigate; cs_diagnostics to list the actual compiler errors/warnings in ${path}.`,
          "2. Fix: cs_hover / cs_definition / cs_references for correct types and call sites; cs_code_action for offered fixes; cs_rename to rename safely. Re-run cs_diagnostics until clean.",
          `3. Debug: cs_dbg_set_breakpoints in ${path}, cs_dbg_launch, then at the stop cs_dbg_stack_trace + cs_dbg_variables + cs_dbg_evaluate to inspect real values; cs_dbg_step / cs_dbg_continue to walk the fix. (netcoredbg is spawned lazily, so this costs nothing until used.)`,
          "",
          "Same schema-validated, undoable discipline as the GDScript planes — C# is a first-class citizen here, not an afterthought.",
          "",
          SAFETY,
        ].join("\n"),
      );
    },
  );
}
