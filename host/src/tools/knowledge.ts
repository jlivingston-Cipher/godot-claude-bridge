import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
import { toFsPath } from "../paths.js";

/**
 * Group K — Knowledge & search (read-only).
 *
 * Four host-side tools that answer "where / what / how" questions about the
 * project and the engine WITHOUT touching the editor bridge or the language
 * server, so they work headlessly and are deterministic:
 *   - project_search : ripgrep-style full-text/regex search across project files.
 *   - find_symbol    : declaration index over the project's GDScript (class_name,
 *                      func, var, const, signal, enum) — the workspace-symbol
 *                      answer Godot's LSP does not implement (see gd_workspace_symbols).
 *   - find_usages    : word-boundary occurrence search for an identifier — the
 *                      project-wide complement to the position-based gd_references.
 *   - example_snippet: curated GDScript idiom lookup.
 *
 * The two ClassDB-backed knowledge tools (class_reference, docs_search) live in
 * tools/editor.ts because they go over the editor bridge.
 */

// ---- result envelopes (mirrors the ok()/fail() shape used elsewhere) --------

function ok(obj: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj,
  };
}

function fail(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Search error: ${message}` }],
  };
}

// ---- filesystem walk --------------------------------------------------------

/** Directories never worth searching (VCS, Godot/import caches, build output). */
const SKIP_DIRS = new Set([
  ".git", ".godot", ".import", "node_modules", ".vs", ".vscode",
  "dist", "dist-test", "obj", "bin", ".mono",
]);

const MAX_FILE_BYTES = 2_000_000;

/** Default extension set for a project-wide text search. */
const SEARCH_EXTS = ["gd", "cs", "tscn", "tres", "gdshader", "shader", "godot", "cfg", "json", "md", "txt", "import", "csv", "xml"];

/** Convert an absolute path back to a `res://`-relative path when under the project. */
function toRes(abs: string, projectPath: string): string {
  const rel = path.relative(projectPath, abs);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    return "res://" + rel.split(path.sep).join("/");
  }
  return abs;
}

/**
 * Recursively collect files under `root` whose extension is in `exts` (or all,
 * when `exts` is null). Directory entries are visited in sorted order so results
 * are stable across runs. Returns absolute paths.
 */
function collectFiles(root: string, exts: Set<string> | null): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    // Push dirs last so the sorted files of this level are processed first (LIFO).
    const dirs: string[] = [];
    for (const e of entries) {
      if (e.name.startsWith(".") && e.isDirectory()) continue;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        dirs.push(path.join(dir, e.name));
      } else if (e.isFile()) {
        if (exts) {
          const ext = path.extname(e.name).slice(1).toLowerCase();
          if (!exts.has(ext)) continue;
        }
        out.push(path.join(dir, e.name));
      }
    }
    // Reverse so sibling directories are also walked in ascending order.
    for (let i = dirs.length - 1; i >= 0; i--) stack.push(dirs[i]);
  }
  out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return out;
}

/** Read a file as text, skipping oversized or binary content. Returns null to skip. */
function readText(abs: string): string | null {
  let buf: Buffer;
  try {
    const st = fs.statSync(abs);
    if (st.size > MAX_FILE_BYTES) return null;
    buf = fs.readFileSync(abs);
  } catch {
    return null;
  }
  // Binary sniff: a NUL byte in the first 8 KiB.
  const probe = buf.subarray(0, 8192);
  if (probe.includes(0)) return null;
  return buf.toString("utf8");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clip(s: string, max = 300): string {
  const t = s.replace(/\s+$/, "");
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/** Resolve the search root and the extension filter shared by the scanners. */
function resolveRoot(cfg: Config, sub?: string): string {
  return sub ? toFsPath(sub, cfg.projectPath) : cfg.projectPath;
}

// ---- curated idioms (example_snippet) ---------------------------------------

interface Snippet { id: string; title: string; tags: string[]; code: string; explanation: string; docs_url: string; }

const SNIPPETS: Snippet[] = [
  {
    id: "signal_connect",
    title: "Connect and emit a custom signal",
    tags: ["signal", "signals", "connect", "emit", "event", "callback", "observer"],
    code: [
      "signal health_changed(new_value: int)",
      "",
      "func _ready() -> void:",
      "\thealth_changed.connect(_on_health_changed)",
      "",
      "func take_damage(amount: int) -> void:",
      "\thealth -= amount",
      "\thealth_changed.emit(health)",
      "",
      "func _on_health_changed(new_value: int) -> void:",
      "\tprint(\"health is now \", new_value)",
    ].join("\n"),
    explanation: "Godot 4 uses first-class Signal objects: declare with `signal`, subscribe with `.connect(Callable)`, and fire with `.emit(...)`. Prefer this over the string-based `connect(\"name\", ...)` API.",
    docs_url: "https://docs.godotengine.org/en/stable/getting_started/step_by_step/signals.html",
  },
  {
    id: "autoload_singleton",
    title: "Global singleton via an autoload",
    tags: ["autoload", "singleton", "global", "manager", "gamestate"],
    code: [
      "# game_state.gd (registered as the autoload \"GameState\")",
      "extends Node",
      "",
      "var score: int = 0",
      "",
      "func add_score(points: int) -> void:",
      "\tscore += points",
      "",
      "# Anywhere else:",
      "# GameState.add_score(10)",
    ].join("\n"),
    explanation: "Register a script under Project > Project Settings > Autoload with a name; Godot instances it once at startup and exposes it as a global by that name. Use it for cross-scene state (score, settings, audio).",
    docs_url: "https://docs.godotengine.org/en/stable/tutorials/scripting/singletons_autoload.html",
  },
  {
    id: "input_handling",
    title: "Read input actions each frame",
    tags: ["input", "action", "keyboard", "movement", "controller", "is_action_pressed"],
    code: [
      "func _physics_process(delta: float) -> void:",
      "\tvar dir := Input.get_vector(\"move_left\", \"move_right\", \"move_up\", \"move_down\")",
      "\tvelocity = dir * speed",
      "\tmove_and_slide()",
      "",
      "func _unhandled_input(event: InputEvent) -> void:",
      "\tif event.is_action_pressed(\"jump\"):",
      "\t\tvelocity.y = jump_force",
    ].join("\n"),
    explanation: "Use `Input.get_vector` for smooth analog movement across four actions, and `_unhandled_input` with `is_action_pressed` for discrete one-shot actions. Define the action names in the Input Map.",
    docs_url: "https://docs.godotengine.org/en/stable/tutorials/inputs/input_examples.html",
  },
  {
    id: "timer_oneshot",
    title: "Wait without a Timer node (await)",
    tags: ["timer", "wait", "delay", "await", "coroutine", "timeout"],
    code: [
      "func flash() -> void:",
      "\tmodulate = Color.RED",
      "\tawait get_tree().create_timer(0.2).timeout",
      "\tmodulate = Color.WHITE",
    ].join("\n"),
    explanation: "`get_tree().create_timer(seconds)` returns a one-shot SceneTreeTimer; `await ...timeout` suspends the coroutine without needing a Timer node in the scene.",
    docs_url: "https://docs.godotengine.org/en/stable/classes/class_scenetree.html#class-scenetree-method-create-timer",
  },
  {
    id: "tween_property",
    title: "Animate a property with a Tween",
    tags: ["tween", "animation", "animate", "interpolate", "ease", "move"],
    code: [
      "func pop_in() -> void:",
      "\tscale = Vector2.ZERO",
      "\tvar tw := create_tween()",
      "\ttw.tween_property(self, \"scale\", Vector2.ONE, 0.3) \\",
      "\t\t.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)",
    ].join("\n"),
    explanation: "`create_tween()` builds a throwaway Tween; `tween_property(object, property, final_value, duration)` interpolates it. Chain `.set_trans`/`.set_ease` for easing and multiple `tween_property` calls run sequentially (use `.set_parallel()` for together).",
    docs_url: "https://docs.godotengine.org/en/stable/classes/class_tween.html",
  },
  {
    id: "load_scene_change",
    title: "Change to another scene",
    tags: ["scene", "change_scene", "load", "packedscene", "instantiate", "level"],
    code: [
      "# Simple full swap:",
      "get_tree().change_scene_to_file(\"res://levels/level_2.tscn\")",
      "",
      "# Or instance a scene as a child (keep the current one):",
      "var bullet_scene := preload(\"res://actors/bullet.tscn\")",
      "var bullet := bullet_scene.instantiate()",
      "add_child(bullet)",
    ].join("\n"),
    explanation: "`change_scene_to_file` replaces the whole running scene. To spawn objects instead, `preload`/`load` a PackedScene and `.instantiate()` it, then `add_child`.",
    docs_url: "https://docs.godotengine.org/en/stable/tutorials/scripting/scene_tree.html",
  },
  {
    id: "save_load_json",
    title: "Save and load JSON to user://",
    tags: ["save", "load", "json", "file", "persistence", "user"],
    code: [
      "func save_game(data: Dictionary) -> void:",
      "\tvar f := FileAccess.open(\"user://save.json\", FileAccess.WRITE)",
      "\tf.store_string(JSON.stringify(data))",
      "",
      "func load_game() -> Dictionary:",
      "\tif not FileAccess.file_exists(\"user://save.json\"):",
      "\t\treturn {}",
      "\tvar f := FileAccess.open(\"user://save.json\", FileAccess.READ)",
      "\treturn JSON.parse_string(f.get_as_text()) as Dictionary",
    ].join("\n"),
    explanation: "Write to `user://` (a per-user writable location) with FileAccess; serialize with `JSON.stringify` / `JSON.parse_string`. `res://` is read-only in exported games, so saves must go to `user://`.",
    docs_url: "https://docs.godotengine.org/en/stable/tutorials/io/saving_games.html",
  },
  {
    id: "rng",
    title: "Random numbers and picks",
    tags: ["random", "rng", "randi", "randf", "pick", "shuffle", "seed"],
    code: [
      "randomize() # seed once, e.g. in _ready",
      "var roll := randi_range(1, 6)",
      "var chance := randf() < 0.25 # 25% true",
      "var loot := [\"gold\", \"potion\", \"sword\"].pick_random()",
    ].join("\n"),
    explanation: "`randi_range`/`randf_range` give bounded integers/floats, `randf()` gives 0–1, and Array has `pick_random()`/`shuffle()`. Call `randomize()` once to seed from the clock (or `seed(n)` for reproducible runs).",
    docs_url: "https://docs.godotengine.org/en/stable/tutorials/math/random_number_generation.html",
  },
  {
    id: "group_call",
    title: "Call a method on every node in a group",
    tags: ["group", "groups", "call_group", "broadcast", "enemies"],
    code: [
      "# Tag nodes:  add_to_group(\"enemies\")  (or set a Group in the editor)",
      "func game_over() -> void:",
      "\tget_tree().call_group(\"enemies\", \"freeze\")",
      "\tvar count := get_tree().get_node_count_in_group(\"enemies\")",
    ].join("\n"),
    explanation: "Groups are lightweight tags. `get_tree().call_group(group, method, ...)` invokes a method on every member; `get_nodes_in_group` / `get_node_count_in_group` enumerate them. Great for broadcasting to all enemies, pickups, etc.",
    docs_url: "https://docs.godotengine.org/en/stable/tutorials/scripting/groups.html",
  },
  {
    id: "state_machine_enum",
    title: "Minimal enum state machine",
    tags: ["state", "state machine", "fsm", "enum", "match"],
    code: [
      "enum State { IDLE, RUN, JUMP }",
      "var state: State = State.IDLE",
      "",
      "func _physics_process(delta: float) -> void:",
      "\tmatch state:",
      "\t\tState.IDLE:",
      "\t\t\tif Input.is_action_pressed(\"move_right\"): state = State.RUN",
      "\t\tState.RUN:",
      "\t\t\tif Input.is_action_just_pressed(\"jump\"): state = State.JUMP",
      "\t\tState.JUMP:",
      "\t\t\tif is_on_floor(): state = State.IDLE",
    ].join("\n"),
    explanation: "A named `enum` plus a `match` on the current state is the simplest finite state machine — no extra nodes. Transition by assigning `state`; branch behaviour per state in the `match`.",
    docs_url: "https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_basics.html#match",
  },
  {
    id: "http_request",
    title: "Fetch data over HTTP",
    tags: ["http", "httprequest", "network", "rest", "api", "download", "web"],
    code: [
      "var http := HTTPRequest.new()",
      "",
      "func _ready() -> void:",
      "\tadd_child(http)",
      "\thttp.request_completed.connect(_on_done)",
      "\thttp.request(\"https://example.com/api/scores\")",
      "",
      "func _on_done(result, code, headers, body: PackedByteArray) -> void:",
      "\tvar data = JSON.parse_string(body.get_string_from_utf8())",
    ].join("\n"),
    explanation: "Add an HTTPRequest node, connect `request_completed`, then call `.request(url)`. The body arrives as a PackedByteArray — decode with `get_string_from_utf8()` and parse. Works in exported games and the web export.",
    docs_url: "https://docs.godotengine.org/en/stable/tutorials/networking/http_request_class.html",
  },
  {
    id: "onready_node",
    title: "Cache a child node with @onready",
    tags: ["onready", "get_node", "node reference", "$", "cache"],
    code: [
      "@onready var sprite: Sprite2D = $Sprite2D",
      "@onready var anim: AnimationPlayer = $AnimationPlayer",
      "",
      "func _ready() -> void:",
      "\tanim.play(\"spawn\")",
    ].join("\n"),
    explanation: "`@onready var x := $Path` resolves the node once, right before `_ready`, so you avoid repeated `get_node` calls. `$Name` is shorthand for `get_node(\"Name\")`; type the var for autocompletion and safety.",
    docs_url: "https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_basics.html#onready-annotation",
  },
];

const SNIPPET_IDS = SNIPPETS.map((s) => s.id);

function scoreSnippet(s: Snippet, terms: string[]): number {
  const hay = (s.id + " " + s.title + " " + s.tags.join(" ")).toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (!t) continue;
    if (s.id === t) score += 5;
    if (s.tags.includes(t)) score += 3;
    if (hay.includes(t)) score += 1;
  }
  return score;
}

// ---- registration -----------------------------------------------------------

export function registerKnowledgeTools(server: McpServer, cfg: Config): void {
  server.registerTool(
    "project_search",
    {
      title: "Search project files",
      description:
        "Full-text (or regex) search across the project's source files (ripgrep-style). Read-only. " +
        "Returns one match per line with its res:// path, 1-based line and column, and the matching text. " +
        "Binary and oversized files are skipped; caches (.git/.godot/.import/node_modules) are never searched.",
      inputSchema: {
        query: z.string().describe("Text to find (literal by default; a regular expression when regex=true)"),
        regex: z.boolean().optional().describe("Treat query as a JavaScript regular expression (default false = literal)"),
        ignore_case: z.boolean().optional().describe("Case-insensitive match (default false)"),
        extensions: z.array(z.string()).optional().describe("File extensions to include, without the dot (default: gd,cs,tscn,tres,gdshader,godot,cfg,json,md,txt,…)"),
        path: z.string().optional().describe("Limit the search to a res:// or project-relative subdirectory (default: whole project)"),
        max_results: z.number().int().positive().optional().describe("Cap on returned matches (default 200)"),
      },
    },
    async ({ query, regex, ignore_case, extensions, path: sub, max_results }) => {
      const cap = max_results ?? 200;
      let re: RegExp;
      try {
        re = new RegExp(regex ? query : escapeRegExp(query), ignore_case ? "i" : "");
      } catch (err) {
        return fail(`invalid regular expression: ${(err as Error).message}`);
      }
      const exts = extensions && extensions.length
        ? new Set(extensions.map((e) => e.replace(/^\./, "").toLowerCase()))
        : new Set(SEARCH_EXTS);
      const root = resolveRoot(cfg, sub);
      const files = collectFiles(root, exts);
      const matches: Array<{ file: string; line: number; column: number; text: string }> = [];
      let truncated = false;
      outer: for (const abs of files) {
        const text = readText(abs);
        if (text === null) continue;
        const rel = toRes(abs, cfg.projectPath);
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const m = re.exec(lines[i]);
          if (m) {
            matches.push({ file: rel, line: i + 1, column: (m.index ?? 0) + 1, text: clip(lines[i]) });
            if (matches.length >= cap) { truncated = true; break outer; }
          }
        }
      }
      return ok({ query, regex: Boolean(regex), matches, count: matches.length, truncated });
    },
  );

  const SYMBOL_KINDS: Array<{ kind: string; re: RegExp }> = [
    { kind: "class_name", re: /^\s*class_name\s+([A-Za-z_]\w*)/ },
    { kind: "class", re: /^\s*class\s+([A-Za-z_]\w*)/ },
    { kind: "func", re: /^\s*(?:static\s+)?func\s+([A-Za-z_]\w*)/ },
    { kind: "signal", re: /^\s*signal\s+([A-Za-z_]\w*)/ },
    { kind: "enum", re: /^\s*enum\s+([A-Za-z_]\w*)/ },
    { kind: "const", re: /^\s*const\s+([A-Za-z_]\w*)/ },
    { kind: "var", re: /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:static\s+)?var\s+([A-Za-z_]\w*)/ },
  ];

  server.registerTool(
    "find_symbol",
    {
      title: "Find symbol declarations",
      description:
        "Locate where GDScript symbols are DECLARED across the project — class_name, inner class, func, " +
        "signal, enum, const and var. Read-only project index. This is the workspace-symbol answer Godot's " +
        "language server does not implement (gd_workspace_symbols returns 'unsupported'); for the semantic, " +
        "position-based lookup on a single build use gd_definition instead.",
      inputSchema: {
        name: z.string().describe("Symbol name to look for"),
        exact: z.boolean().optional().describe("Require an exact name match (default false = substring)"),
        kinds: z.array(z.enum(["class_name", "class", "func", "signal", "enum", "const", "var"])).optional().describe("Restrict to these declaration kinds (default: all)"),
        max_results: z.number().int().positive().optional().describe("Cap on returned declarations (default 200)"),
      },
    },
    async ({ name, exact, kinds, max_results }) => {
      const cap = max_results ?? 200;
      const wanted: Set<string> | null = kinds && kinds.length ? new Set<string>(kinds) : null;
      const rules = SYMBOL_KINDS.filter((r) => !wanted || wanted.has(r.kind));
      const files = collectFiles(cfg.projectPath, new Set(["gd"]));
      const out: Array<{ file: string; line: number; kind: string; symbol: string; text: string }> = [];
      let truncated = false;
      outer: for (const abs of files) {
        const text = readText(abs);
        if (text === null) continue;
        const rel = toRes(abs, cfg.projectPath);
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          for (const r of rules) {
            const m = r.re.exec(lines[i]);
            if (!m) continue;
            const sym = m[1];
            const hit = exact ? sym === name : sym.includes(name);
            if (!hit) continue;
            out.push({ file: rel, line: i + 1, kind: r.kind, symbol: sym, text: clip(lines[i]) });
            if (out.length >= cap) { truncated = true; break outer; }
          }
        }
      }
      return ok({ name, matches: out, count: out.length, truncated });
    },
  );

  server.registerTool(
    "find_usages",
    {
      title: "Find identifier usages",
      description:
        "Find every word-boundary occurrence of an identifier across the project's source files. Read-only. " +
        "The project-wide, build-independent complement to gd_references (which needs the live language server " +
        "and a cursor position). Returns res:// path, 1-based line/column and the line text for each hit.",
      inputSchema: {
        name: z.string().describe("Identifier to find (matched on word boundaries)"),
        extensions: z.array(z.string()).optional().describe("File extensions to include, without the dot (default: gd,cs,tscn,tres,gdshader)"),
        ignore_case: z.boolean().optional().describe("Case-insensitive match (default false)"),
        max_results: z.number().int().positive().optional().describe("Cap on returned usages (default 200)"),
      },
    },
    async ({ name, extensions, ignore_case, max_results }) => {
      const cap = max_results ?? 200;
      if (!/\S/.test(name)) return fail("name must not be empty");
      const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, ignore_case ? "gi" : "g");
      const exts = extensions && extensions.length
        ? new Set(extensions.map((e) => e.replace(/^\./, "").toLowerCase()))
        : new Set(["gd", "cs", "tscn", "tres", "gdshader"]);
      const files = collectFiles(cfg.projectPath, exts);
      const out: Array<{ file: string; line: number; column: number; text: string }> = [];
      let truncated = false;
      outer: for (const abs of files) {
        const text = readText(abs);
        if (text === null) continue;
        const rel = toRes(abs, cfg.projectPath);
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(lines[i])) !== null) {
            out.push({ file: rel, line: i + 1, column: m.index + 1, text: clip(lines[i]) });
            if (out.length >= cap) { truncated = true; break outer; }
            if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width
          }
        }
      }
      return ok({ name, usages: out, count: out.length, truncated });
    },
  );

  server.registerTool(
    "example_snippet",
    {
      title: "Look up a GDScript idiom",
      description:
        "Return curated, ready-to-adapt GDScript snippets for common Godot tasks (signals, autoload singletons, " +
        "input, tweens, timers, scene changes, saving, RNG, groups, state machines, HTTP, @onready). Read-only. " +
        "Omit the query to list every available topic id.",
      inputSchema: {
        query: z.string().optional().describe("Topic or keywords, e.g. \"tween\", \"save json\", \"connect signal\". Omit to list all topics."),
        limit: z.number().int().positive().optional().describe("Max snippets to return (default 5)"),
      },
    },
    async ({ query, limit }) => {
      const cap = limit ?? 5;
      let chosen: Snippet[];
      if (!query || !query.trim()) {
        chosen = [];
      } else {
        const terms = query.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
        chosen = SNIPPETS
          .map((s) => ({ s, score: scoreSnippet(s, terms) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, cap)
          .map((x) => x.s);
      }
      return ok({
        query: query ?? null,
        count: chosen.length,
        snippets: chosen.map((s) => ({ id: s.id, title: s.title, tags: s.tags, code: s.code, explanation: s.explanation, docs_url: s.docs_url })),
        available: SNIPPET_IDS,
      });
    },
  );
}
