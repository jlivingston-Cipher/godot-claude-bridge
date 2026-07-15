import { test } from "node:test";
import assert from "node:assert/strict";
import { registerRecipes, RECIPE_NAMES } from "../src/recipes.js";

/** Capture registerPrompt(name, config, cb) calls. */
function recorder() {
  const prompts: Array<{ name: string; config: Record<string, unknown>; cb: (a: Record<string, unknown>) => any }> = [];
  const server = {
    registerPrompt(name: string, config: Record<string, unknown>, cb: (a: Record<string, unknown>) => any) {
      prompts.push({ name, config, cb });
      return { name };
    },
  };
  return { prompts, server };
}

function build() {
  const r = recorder();
  registerRecipes(r.server as unknown as Parameters<typeof registerRecipes>[0]);
  return r.prompts;
}

test("registers exactly the declared recipes, in order", () => {
  assert.deepEqual(build().map((p) => p.name), [...RECIPE_NAMES]);
});

test("every recipe has a title + description and an argsSchema object", () => {
  for (const p of build()) {
    assert.equal(typeof p.config.title, "string");
    assert.equal(typeof p.config.description, "string");
    assert.equal(typeof p.config.argsSchema, "object");
  }
});

test("every recipe returns one non-empty user text message (defaults + args)", () => {
  const sample = { scene_path: "res://x.tscn", player_name: "Hero", speed: "400", signal_name: "timeout", script_path: "res://y.gd", line: "10", reference_path: "res://ref.png", tolerance: "0.01" };
  for (const p of build()) {
    for (const args of [{}, sample]) {
      const res = p.cb(args);
      assert.equal(res.messages.length, 1);
      assert.equal(res.messages[0].role, "user");
      assert.equal(res.messages[0].content.type, "text");
      assert.ok(res.messages[0].content.text.length > 200, `${p.name} text too short`);
      assert.ok(typeof res.description === "string" && res.description.length > 0, `${p.name} missing description`);
    }
  }
});

test("every recipe drives the verify/debug loop (the differentiator)", () => {
  for (const p of build()) {
    const text: string = p.cb({}).messages[0].content.text;
    assert.ok(
      /runtime_assert_|runtime_screenshot_diff|\bdbg_|\bcs_dbg_/.test(text),
      `${p.name} has no runtime_assert_* / dbg_* verify step`,
    );
  }
});

test("parameterized recipes interpolate their args", () => {
  const player = build().find((p) => p.name === "recipe_2d_player_controller")!;
  const text: string = player.cb({ player_name: "Hero", scene_path: "res://lvl.tscn", speed: "400" }).messages[0].content.text;
  assert.ok(text.includes("Hero"), "player_name not interpolated");
  assert.ok(text.includes("res://lvl.tscn"), "scene_path not interpolated");
  assert.ok(text.includes("400"), "speed not interpolated");
});

test("recipe defaults fill in when args are omitted", () => {
  const player = build().find((p) => p.name === "recipe_2d_player_controller")!;
  const text: string = player.cb({}).messages[0].content.text;
  assert.ok(text.includes("res://main.tscn") && text.includes("Player"), "defaults not applied");
});
