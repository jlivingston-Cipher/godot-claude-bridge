import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerKnowledgeTools } from "../src/tools/knowledge.js";
import type { Config } from "../src/config.js";

type Handler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}>;

/** Register the Group K host-side tools against a recorder and return their handlers. */
function setup(projectPath: string): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  const server = {
    registerTool(name: string, _config: unknown, handler: Handler) { handlers[name] = handler; },
  };
  registerKnowledgeTools(server as unknown as Parameters<typeof registerKnowledgeTools>[0], { projectPath } as Config);
  return handlers;
}

/** A tiny throwaway Godot project with two scripts and a cache dir that must be skipped. */
function mkproject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcb-knowledge-"));
  fs.writeFileSync(path.join(dir, "project.godot"), "config_version=5\n");
  fs.writeFileSync(path.join(dir, "player.gd"), [
    "class_name Player",
    "extends CharacterBody2D",
    "signal died(score: int)",
    "const MAX_HP := 100",
    "var hp: int = MAX_HP",
    "func take_damage(amount: int) -> void:",
    "\thp -= amount",
    "\tif hp <= 0:",
    "\t\tdied.emit(hp)",
    "",
  ].join("\n"));
  fs.mkdirSync(path.join(dir, "enemies"));
  fs.writeFileSync(path.join(dir, "enemies", "goblin.gd"), [
    "extends Node",
    "func attack(target) -> void:",
    "\ttarget.take_damage(5)",
    "",
  ].join("\n"));
  // A .godot cache dir whose contents must NEVER appear in results.
  fs.mkdirSync(path.join(dir, ".godot"));
  fs.writeFileSync(path.join(dir, ".godot", "cache.gd"), "func take_damage(): pass\n");
  return dir;
}

function cleanup(dir: string) { fs.rmSync(dir, { recursive: true, force: true }); }

test("project_search finds a literal across files, uses res:// paths, and skips caches", async () => {
  const dir = mkproject();
  try {
    const h = setup(dir);
    const r = await h.project_search({ query: "take_damage" });
    const sc = r.structuredContent as { matches: Array<{ file: string; line: number; column: number }>; count: number };
    const files = sc.matches.map((m) => m.file);
    assert.ok(sc.count >= 2, `expected >=2 matches, got ${sc.count}`);
    assert.ok(files.includes("res://player.gd"));
    assert.ok(files.includes("res://enemies/goblin.gd"));
    assert.ok(!files.some((f) => f.includes(".godot")), "results must not include .godot cache");
    for (const m of sc.matches) assert.ok(m.line >= 1 && m.column >= 1, "1-based line/column");
  } finally { cleanup(dir); }
});

test("project_search supports regex and reports an invalid pattern as an error", async () => {
  const dir = mkproject();
  try {
    const h = setup(dir);
    const good = await h.project_search({ query: "func\\s+\\w+", regex: true });
    const sc = good.structuredContent as { count: number };
    assert.ok(sc.count >= 2, `expected >=2 func decls, got ${sc.count}`);

    const bad = await h.project_search({ query: "func(", regex: true });
    assert.equal(bad.isError, true);
    assert.equal(bad.structuredContent, undefined);
  } finally { cleanup(dir); }
});

test("find_symbol locates declarations by kind and honours exact vs substring", async () => {
  const dir = mkproject();
  try {
    const h = setup(dir);
    const fn = await h.find_symbol({ name: "take_damage", kinds: ["func"] });
    const sc = fn.structuredContent as { matches: Array<{ file: string; kind: string; symbol: string }>; count: number };
    assert.equal(sc.count, 1, `expected exactly one func decl (cache skipped), got ${sc.count}`);
    assert.equal(sc.matches[0].symbol, "take_damage");
    assert.equal(sc.matches[0].kind, "func");
    assert.equal(sc.matches[0].file, "res://player.gd");

    const cls = await h.find_symbol({ name: "Player", kinds: ["class_name"] });
    assert.equal((cls.structuredContent as { count: number }).count, 1);

    const sub = await h.find_symbol({ name: "damage" });
    assert.ok((sub.structuredContent as { count: number }).count >= 1, "substring should match take_damage");
    const exact = await h.find_symbol({ name: "damage", exact: true });
    assert.equal((exact.structuredContent as { count: number }).count, 0, "exact must not match take_damage");
  } finally { cleanup(dir); }
});

test("find_usages counts word-boundary occurrences across files, skipping caches", async () => {
  const dir = mkproject();
  try {
    const h = setup(dir);
    const r = await h.find_usages({ name: "take_damage" });
    const sc = r.structuredContent as { usages: Array<{ file: string }>; count: number };
    const files = new Set(sc.usages.map((u) => u.file));
    assert.ok(sc.count >= 2, `expected >=2 usages, got ${sc.count}`);
    assert.ok(files.has("res://player.gd") && files.has("res://enemies/goblin.gd"));
    assert.ok(![...files].some((f) => f.includes(".godot")));

    // Word-boundary: "damage" must NOT match inside the identifier "take_damage".
    const dmg = await h.find_usages({ name: "damage" });
    assert.equal((dmg.structuredContent as { count: number }).count, 0);
  } finally { cleanup(dir); }
});

test("example_snippet matches by keyword and lists all topics when unqueried", async () => {
  const dir = mkproject();
  try {
    const h = setup(dir);
    const s = await h.example_snippet({ query: "connect signal" });
    const sc = s.structuredContent as { count: number; snippets: Array<{ id: string }>; available: string[] };
    assert.ok(sc.count >= 1);
    assert.equal(sc.snippets[0].id, "signal_connect");
    assert.ok(sc.available.includes("autoload_singleton"));

    const none = await h.example_snippet({});
    const nsc = none.structuredContent as { query: string | null; count: number; available: string[] };
    assert.equal(nsc.query, null);
    assert.equal(nsc.count, 0);
    assert.ok(nsc.available.length >= 10);
  } finally { cleanup(dir); }
});
