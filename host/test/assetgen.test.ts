import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerAssetGenTools } from "../src/tools/assetgen.js";
import type { Config } from "../src/config.js";

type Handler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
}>;

interface BridgeCall {
  method: string;
  params: Record<string, unknown>;
}

/** A recording fake bridge whose responses are canned per method. */
function fakeBridge(responses: Record<string, Record<string, unknown>>) {
  const calls: BridgeCall[] = [];
  const bridge = {
    async request(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params });
      if (method in responses) return responses[method];
      throw new Error(`unexpected bridge method ${method}`);
    },
  };
  return { bridge, calls };
}

/** Register Group J against a recorder + fake bridge; returns handlers + call log. */
function setup(cfg: Partial<Config>, responses: Record<string, Record<string, unknown>> = {}) {
  const handlers: Record<string, Handler> = {};
  const server = {
    registerTool(name: string, _config: unknown, handler: Handler) { handlers[name] = handler; },
    // Auto-accept any elicitation so gated writers proceed under test.
    server: { elicitInput: async () => ({ action: "accept", content: { proceed: true } }) },
  };
  const { bridge, calls } = fakeBridge(responses);
  const full: Config = {
    projectPath: cfg.projectPath ?? "/tmp/nonexistent",
    assetGenBackend: cfg.assetGenBackend ?? "none",
    assetGenCommand: cfg.assetGenCommand ?? "",
    assetGenProvider: cfg.assetGenProvider ?? "",
    assetGenTimeoutMs: cfg.assetGenTimeoutMs ?? 20000,
  } as Config;
  registerAssetGenTools(
    server as unknown as Parameters<typeof registerAssetGenTools>[0],
    bridge as unknown as Parameters<typeof registerAssetGenTools>[1],
    full,
  );
  return { handlers, calls };
}

test("asset_gen_configure reports the default 'none' backend and supported kinds", async () => {
  const { handlers } = setup({});
  const r = await handlers.asset_gen_configure({});
  const s = r.structuredContent!;
  assert.equal(s.backend, "none");
  assert.equal(s.configured, false);
  assert.deepEqual(s.supported_kinds, ["sprite", "texture", "icon", "audio_sfx", "model"]);
});

test("asset_gen_configure rejects the command backend without a command template", async () => {
  const { handlers } = setup({});
  const r = await handlers.asset_gen_configure({ backend: "command" });
  assert.equal(r.isError, true);
  assert.match(r.content![0].text!, /needs a command template/);
});

test("asset_gen_configure sets the command backend when given a template", async () => {
  const { handlers } = setup({});
  const r = await handlers.asset_gen_configure({ backend: "command", command: "gen {output}", provider: "local" });
  const s = r.structuredContent!;
  assert.equal(s.backend, "command");
  assert.equal(s.command, "gen {output}");
  assert.equal(s.provider, "local");
  assert.equal(s.configured, true);
});

test("generators DEGRADE with no backend: status no_backend, a request spec, and no bridge call", async () => {
  const { handlers, calls } = setup({});
  const r = await handlers.asset_gen_sprite({ prompt: "a hero", to_path: "res://hero.png", width: 32 });
  const s = r.structuredContent!;
  assert.equal(r.isError, undefined);
  assert.equal(s.status, "no_backend");
  assert.equal(s.path, null);
  assert.equal((s.request as Record<string, unknown>).kind, "sprite");
  assert.equal((s.request as Record<string, unknown>).to_path, "res://hero.png");
  assert.equal(calls.length, 0, "no file/bridge work on the degrade path");
});

test("asset_gen_placeholder always mints via the bridge regardless of backend", async () => {
  const { handlers, calls } = setup(
    { assetGenBackend: "none" },
    { "asset.gen_placeholder": { path: "res://p.png", imported_type: "CompressedTexture2D", width: 64, height: 64, bytes: 120, format: "png" } },
  );
  const r = await handlers.asset_gen_placeholder({ kind: "sprite", to_path: "res://p", confirm: true });
  const s = r.structuredContent!;
  assert.equal(s.status, "placeholder");
  assert.equal(s.kind, "sprite");
  assert.equal(s.imported_type, "CompressedTexture2D");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "asset.gen_placeholder");
  // The native .tres extension is appended when omitted.
  assert.equal(calls[0].params.to_path, "res://p.tres");
});

test("placeholder:true on a typed generator forces the in-engine path", async () => {
  const { handlers, calls } = setup(
    { assetGenBackend: "none" },
    { "asset.gen_placeholder": { path: "res://t.tres", imported_type: "ImageTexture" } },
  );
  const r = await handlers.asset_gen_texture({ prompt: "brick", to_path: "res://t.tres", placeholder: true, confirm: true });
  assert.equal(r.structuredContent!.status, "placeholder");
  assert.equal(calls[0].method, "asset.gen_placeholder");
  assert.equal(calls[0].params.kind, "texture");
});

test("placeholder mode rejects a wrong extension for the kind", async () => {
  const { handlers } = setup({ assetGenBackend: "placeholder" }, { "asset.gen_placeholder": {} });
  const r = await handlers.asset_gen_sprite({ prompt: "x", to_path: "res://x.png", confirm: true });
  assert.equal(r.isError, true);
  assert.match(r.content![0].text!, /writes \.tres/);
});

test("command backend runs the configured command, imports the file, returns 'generated'", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcb-assetgen-"));
  // A tiny fixture generator with no spaces in any argv token.
  const gen = path.join(dir, "gen.cjs");
  fs.writeFileSync(gen, "require('fs').writeFileSync(process.argv[2], Buffer.from([137,80,78,71]));\n");
  const { handlers, calls } = setup(
    { projectPath: dir, assetGenBackend: "command", assetGenCommand: `node ${gen} {output}`, assetGenProvider: "fixture" },
    { "asset.import": { path: "res://c.png", imported_type: "CompressedTexture2D", bytes: 4 } },
  );
  const r = await handlers.asset_gen_sprite({ prompt: "coin", to_path: "res://c.png", confirm: true });
  const s = r.structuredContent!;
  assert.equal(s.status, "generated");
  assert.equal(s.backend, "command");
  assert.equal(s.provider, "fixture");
  assert.equal(s.imported_type, "CompressedTexture2D");
  assert.ok(fs.existsSync(path.join(dir, "c.png")), "the backend wrote the file");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "asset.import");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("command backend that writes nothing surfaces a clear error", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcb-assetgen-"));
  const noop = path.join(dir, "noop.cjs");
  fs.writeFileSync(noop, "process.exit(0);\n");
  const { handlers, calls } = setup(
    { projectPath: dir, assetGenBackend: "command", assetGenCommand: `node ${noop} {output}` },
    {},
  );
  const r = await handlers.asset_gen_model({ prompt: "rock", to_path: "res://rock.tres", confirm: true });
  assert.equal(r.isError, true);
  assert.match(r.content![0].text!, /did not write/);
  assert.equal(calls.length, 0, "no import attempted when the file is missing");
  fs.rmSync(dir, { recursive: true, force: true });
});
