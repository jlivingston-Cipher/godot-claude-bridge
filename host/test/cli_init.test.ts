import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  enablePlugin,
  installAddon,
  runInit,
} from "../src/cli/init.js";
import { mergeClientConfig, serverEntry } from "../src/cli/clients.js";

/**
 * Tests for `breakpoint-mcp init`. The addon source is a tiny fixture (pointed at
 * via BREAKPOINT_ADDON_SRC), and every write goes to a temp project — nothing
 * touches the real user home. Client-config writing is tested through the
 * project-scoped VS Code target so no home-dir config is created.
 */

let dir: string;
let addonSrc: string;

const ENABLED_RES = "res://addons/breakpoint_mcp/plugin.cfg";

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bpmcp-init-"));
  addonSrc = path.join(dir, "addon-src");
  fs.mkdirSync(addonSrc, { recursive: true });
  fs.writeFileSync(path.join(addonSrc, "plugin.cfg"), '[plugin]\nname="Breakpoint MCP"\nversion="9.9.9"\nscript="plugin.gd"\n');
  fs.writeFileSync(path.join(addonSrc, "plugin.gd"), "extends EditorPlugin\n");
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function makeProject(godotBody = 'config_version=5\n\n[application]\n\nconfig/name="fix"\n'): string {
  const p = fs.mkdtempSync(path.join(dir, "proj-"));
  fs.writeFileSync(path.join(p, "project.godot"), godotBody);
  return p;
}

// ---- enablePlugin (pure) --------------------------------------------------

test("enablePlugin creates the [editor_plugins] section when absent", () => {
  const r = enablePlugin('config_version=5\n\n[application]\n\nconfig/name="x"\n');
  assert.equal(r.changed, true);
  assert.equal(r.alreadyEnabled, false);
  assert.match(r.text, /\[editor_plugins\]/);
  assert.ok(r.text.includes(ENABLED_RES));
});

test("enablePlugin fills an empty PackedStringArray", () => {
  const r = enablePlugin("[editor_plugins]\n\nenabled=PackedStringArray()\n");
  assert.equal(r.changed, true);
  assert.equal(r.text.includes(`PackedStringArray("${ENABLED_RES}")`), true);
});

test("enablePlugin appends without dropping an existing plugin", () => {
  const r = enablePlugin('[editor_plugins]\n\nenabled=PackedStringArray("res://addons/other/plugin.cfg")\n');
  assert.equal(r.changed, true);
  assert.ok(r.text.includes("res://addons/other/plugin.cfg"));
  assert.ok(r.text.includes(ENABLED_RES));
  assert.match(r.text, /PackedStringArray\("res:\/\/addons\/other\/plugin\.cfg", "res:\/\/addons\/breakpoint_mcp\/plugin\.cfg"\)/);
});

test("enablePlugin is a no-op when already enabled", () => {
  const src = `[editor_plugins]\n\nenabled=PackedStringArray("${ENABLED_RES}")\n`;
  const r = enablePlugin(src);
  assert.equal(r.changed, false);
  assert.equal(r.alreadyEnabled, true);
  assert.equal(r.text, src);
});

test("enablePlugin adds an enabled line to an existing empty section", () => {
  const r = enablePlugin("[editor_plugins]\n");
  assert.equal(r.changed, true);
  assert.ok(r.text.includes(`enabled=PackedStringArray("${ENABLED_RES}")`));
});

// ---- installAddon ---------------------------------------------------------

test("installAddon copies the addon into the project", () => {
  const proj = makeProject();
  const r = installAddon(addonSrc, proj, { force: false });
  assert.equal(r.action, "installed");
  assert.ok(fs.existsSync(path.join(proj, "addons", "breakpoint_mcp", "plugin.cfg")));
});

test("installAddon skips an existing addon without --force, overwrites with it", () => {
  const proj = makeProject();
  installAddon(addonSrc, proj, { force: false });
  const skipped = installAddon(addonSrc, proj, { force: false });
  assert.equal(skipped.action, "skipped");
  const forced = installAddon(addonSrc, proj, { force: true });
  assert.equal(forced.action, "overwritten");
});

// ---- client config merge --------------------------------------------------

test("mergeClientConfig preserves sibling servers", () => {
  const existing = JSON.stringify({ mcpServers: { other: { command: "x" } } });
  const entry = serverEntry("/p", "godot", false);
  const merged = JSON.parse(mergeClientConfig(existing, "mcpServers", "godot", entry)) as {
    mcpServers: Record<string, unknown>;
  };
  assert.ok(merged.mcpServers.other, "existing server preserved");
  assert.ok(merged.mcpServers.godot, "new server added");
});

test("serverEntry omits GODOT_BIN when default, includes it when custom, and adds type for vscode", () => {
  const def = serverEntry("/p", "godot", false) as { env: Record<string, string>; type?: string };
  assert.equal(def.env.GODOT_BIN, undefined);
  assert.equal(def.env.GODOT_PROJECT, "/p");
  assert.equal(def.type, undefined);
  const custom = serverEntry("/p", "/opt/godot", true) as { env: Record<string, string>; type?: string };
  assert.equal(custom.env.GODOT_BIN, "/opt/godot");
  assert.equal(custom.type, "stdio");
});

test("mergeClientConfig throws on invalid existing JSON (so init refuses to clobber)", () => {
  assert.throws(() => mergeClientConfig("{ not json", "mcpServers", "godot", {}));
});

// ---- runInit (end to end, via the fixture addon + temp project) -----------

async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const orig = process.stdout.write.bind(process.stdout);
  let out = "";
  (process.stdout as unknown as { write: (c: string | Uint8Array) => boolean }).write = (
    c: string | Uint8Array,
  ) => {
    out += typeof c === "string" ? c : Buffer.from(c).toString("utf8");
    return true;
  };
  try {
    const code = await fn();
    return { code, out };
  } finally {
    (process.stdout as unknown as { write: typeof orig }).write = orig;
  }
}

test("runInit installs, enables, and prints the snippet (default client)", async () => {
  const proj = makeProject();
  const savedSrc = process.env.BREAKPOINT_ADDON_SRC;
  const savedProj = process.env.GODOT_PROJECT;
  try {
    process.env.BREAKPOINT_ADDON_SRC = addonSrc;
    delete process.env.GODOT_PROJECT;
    const { code, out } = await capture(() => runInit(["--project", proj, "--client", "none"]));
    assert.equal(code, 0);
    assert.ok(fs.existsSync(path.join(proj, "addons", "breakpoint_mcp", "plugin.cfg")));
    assert.ok(fs.readFileSync(path.join(proj, "project.godot"), "utf8").includes(ENABLED_RES));
    assert.match(out, /mcpServers/);
  } finally {
    if (savedSrc === undefined) delete process.env.BREAKPOINT_ADDON_SRC;
    else process.env.BREAKPOINT_ADDON_SRC = savedSrc;
    if (savedProj === undefined) delete process.env.GODOT_PROJECT;
    else process.env.GODOT_PROJECT = savedProj;
  }
});

test("runInit --client vscode writes a project-scoped .vscode/mcp.json", async () => {
  const proj = makeProject();
  const savedSrc = process.env.BREAKPOINT_ADDON_SRC;
  try {
    process.env.BREAKPOINT_ADDON_SRC = addonSrc;
    const { code } = await capture(() => runInit(["--project", proj, "--client", "vscode"]));
    assert.equal(code, 0);
    const cfgPath = path.join(proj, ".vscode", "mcp.json");
    assert.ok(fs.existsSync(cfgPath), "vscode config written");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as {
      servers: { godot: { type: string } };
    };
    assert.equal(cfg.servers.godot.type, "stdio");
  } finally {
    if (savedSrc === undefined) delete process.env.BREAKPOINT_ADDON_SRC;
    else process.env.BREAKPOINT_ADDON_SRC = savedSrc;
  }
});

test("runInit --dry-run writes nothing", async () => {
  const proj = makeProject();
  const savedSrc = process.env.BREAKPOINT_ADDON_SRC;
  try {
    process.env.BREAKPOINT_ADDON_SRC = addonSrc;
    const { code } = await capture(() => runInit(["--project", proj, "--dry-run", "--client", "none"]));
    assert.equal(code, 0);
    assert.equal(fs.existsSync(path.join(proj, "addons", "breakpoint_mcp")), false);
    assert.equal(fs.readFileSync(path.join(proj, "project.godot"), "utf8").includes(ENABLED_RES), false);
  } finally {
    if (savedSrc === undefined) delete process.env.BREAKPOINT_ADDON_SRC;
    else process.env.BREAKPOINT_ADDON_SRC = savedSrc;
  }
});

test("runInit fails clearly when the target has no project.godot", async () => {
  const empty = fs.mkdtempSync(path.join(dir, "empty-"));
  const savedSrc = process.env.BREAKPOINT_ADDON_SRC;
  try {
    process.env.BREAKPOINT_ADDON_SRC = addonSrc;
    const { code } = await capture(() => runInit(["--project", empty]));
    assert.equal(code, 1);
  } finally {
    if (savedSrc === undefined) delete process.env.BREAKPOINT_ADDON_SRC;
    else process.env.BREAKPOINT_ADDON_SRC = savedSrc;
  }
});
