import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { outputSchemas, applyOutputSchemas } from "../src/schemas.js";

/** Build a validator from a tool's frozen ZodRawShape. */
const schemaOf = (name: string) => z.object(outputSchemas[name]);

test("every entry in outputSchemas is a valid ZodRawShape", () => {
  for (const [name, shape] of Object.entries(outputSchemas)) {
    assert.equal(typeof shape, "object", `${name} shape is not an object`);
    for (const [field, zt] of Object.entries(shape)) {
      assert.ok(zt && typeof (zt as z.ZodType).parse === "function", `${name}.${field} is not a Zod type`);
    }
  }
});

test("representative success shapes validate against their schema", () => {
  schemaOf("editor_ping").parse({ pong: true, addon_version: "0.4.9", godot: "4.4.1" });
  schemaOf("godot_version").parse({ version: "4.4.1", raw: { code: 0, stdout: "…", stderr: "", timedOut: false } });
  schemaOf("project_get_setting").parse({ name: "application/config/name", value: "My Game" });
  schemaOf("dbg_scopes").parse({ scopes: [{ name: "Locals", variables_ref: 1001 }] });
  schemaOf("dbg_evaluate").parse({ result: "42", type: "int", variables_ref: 0 });
  schemaOf("dbg_restart").parse({ session_id: "godot", method: "relaunch", state: "running", scene: null });
  schemaOf("dbg_goto").parse({ targets: [{ id: 1, label: "line 12", line: 12 }], jumped: true, target_id: 1 });
  schemaOf("dbg_data_breakpoints").parse({ breakpoints: [{ name: "hp", data_id: "hp@1", verified: true }], unresolved: [] });
  schemaOf("gd_rename").parse({ changed_files: ["res://player.gd"], edit_count: 3, applied: true, written: ["/abs/player.gd"] });
  schemaOf("gd_call_hierarchy").parse({
    direction: "incoming",
    items: [{ name: "take_damage", kind: "method", uri: "res://player.gd", line: 0, character: 5, detail: "func take_damage(n)",
      calls: [{ name: "_process", kind: "function", uri: "res://enemy.gd", line: 8, character: 5, detail: "", ranges: [{ line: 9, character: 8, end_line: 9, end_character: 19 }] }] }],
  });
  schemaOf("gd_semantic_tokens").parse({ token_count: 1, tokens: [{ line: 0, character: 0, length: 4, type: "keyword", modifiers: [] }] });
  schemaOf("runtime_get_monitors").parse({ monitors: { "time/fps": 60, "memory/static": 1234 } });
  schemaOf("godot_output").parse({
    id: "run-1", exited: false, exit_code: null, latest_seq: 2,
    lines: [{ seq: 1, stream: "stdout", text: "boot" }, { seq: 2, stream: "stderr", text: "warn" }],
  });
});

test("recursive scene/runtime tree schemas validate nested children", () => {
  schemaOf("scene_get_tree").parse({
    name: "Main", type: "Node2D", path: "/root/Main", script: null, child_count: 1,
    children: [{ name: "Player", type: "CharacterBody2D", path: "/root/Main/Player", script: "res://player.gd", child_count: 0 }],
  });
  schemaOf("runtime_get_tree").parse({
    name: "root", type: "Window", path: "/root", child_count: 1,
    children: [{ name: "Main", type: "Node2D", path: "/root/Main", child_count: 0, visible: true }],
  });
});

test("schemas are non-strict: EXTRA runtime fields still validate (catalog is a floor, not a ceiling)", () => {
  // runtime_get_tree gains visible/process_mode at runtime beyond the catalog shape.
  schemaOf("runtime_get_tree").parse({
    name: "root", type: "Window", path: "/root", child_count: 0,
    visible: true, process_mode: 0, extra_future_field: "ok",
  });
  // godot_output gains an unforeseen top-level field.
  schemaOf("godot_output").parse({
    id: "x", exited: true, exit_code: 0, latest_seq: 0, lines: [], server_time: 123,
  });
});

test("a deliberately WRONG shape is rejected (B1 enforcement)", () => {
  // pong must be boolean.
  assert.throws(() => schemaOf("editor_ping").parse({ pong: "yes", addon_version: "0.4.9", godot: "4.4.1" }), z.ZodError);
  // required field missing.
  assert.throws(() => schemaOf("scene_get_tree").parse({ name: "Main", path: "/root/Main", script: null, child_count: 0 }), z.ZodError);
  // stream must be one of the enum members.
  assert.throws(
    () => schemaOf("godot_output").parse({ id: "x", exited: false, exit_code: null, latest_seq: 1, lines: [{ seq: 1, stream: "network", text: "" }] }),
    z.ZodError,
  );
  // variables_ref must be a number.
  assert.throws(() => schemaOf("dbg_scopes").parse({ scopes: [{ name: "Locals", variables_ref: "1001" }] }), z.ZodError);
});

test("nullable fields accept null but not the wrong type", () => {
  schemaOf("godot_launch_editor").parse({ launched: true, pid: null, project: "/p" });
  schemaOf("godot_launch_editor").parse({ launched: true, pid: 4321, project: "/p" });
  assert.throws(() => schemaOf("godot_launch_editor").parse({ launched: true, pid: "4321", project: "/p" }), z.ZodError);
});

// ---- applyOutputSchemas injection mechanics -------------------------------

type ApplyTarget = Parameters<typeof applyOutputSchemas>[0];

function recordingRegisterServer() {
  const recorded: Array<{ name: string; config: Record<string, unknown> }> = [];
  const server = {
    registerTool(name: string, config: Record<string, unknown>) {
      recorded.push({ name, config });
      return { name };
    },
  };
  return { server: server as unknown as ApplyTarget, recorded };
}

test("applyOutputSchemas injects the frozen schema for a known tool", () => {
  const { server, recorded } = recordingRegisterServer();
  applyOutputSchemas(server);
  (server as unknown as { registerTool: (n: string, c: object, h: unknown) => void })
    .registerTool("editor_ping", { inputSchema: {} }, () => {});
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].config.outputSchema, outputSchemas["editor_ping"]);
});

test("applyOutputSchemas leaves an unknown tool without an outputSchema", () => {
  const { server, recorded } = recordingRegisterServer();
  applyOutputSchemas(server);
  (server as unknown as { registerTool: (n: string, c: object, h: unknown) => void })
    .registerTool("not_a_real_tool", { inputSchema: {} }, () => {});
  assert.equal(recorded[0].config.outputSchema, undefined);
});

test("applyOutputSchemas never overrides a tool's own explicit outputSchema", () => {
  const { server, recorded } = recordingRegisterServer();
  const sentinel = { marker: true };
  applyOutputSchemas(server);
  (server as unknown as { registerTool: (n: string, c: object, h: unknown) => void })
    .registerTool("editor_ping", { inputSchema: {}, outputSchema: sentinel }, () => {});
  assert.equal(recorded[0].config.outputSchema, sentinel);
});
