import { spawn } from "node:child_process";
import fs from "node:fs";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge.js";
import type { Config } from "../config.js";
import { gate } from "../confirm.js";
import { toFsPath } from "../paths.js";

/**
 * Group J — AI asset generation.
 *
 * MCP-native framing: the server NEVER bundles or calls a model. Each generator
 * writes an asset to a res:// path, triggers an import (via the editor bridge),
 * and returns a schema'd result — but WHERE the bytes come from is delegated:
 *
 *   backend "none" (default) : the tool DEGRADES to a clear "no generation
 *       backend configured" and returns a `request` spec (kind / prompt / path /
 *       size / format) the connected multimodal client can fulfil itself. No file
 *       is written; not an error — degradation is a documented outcome.
 *   backend "placeholder"    : deterministic, in-engine procedural stand-ins
 *       (a hashed-colour PNG sprite/texture/icon, an AudioStreamWAV blip, a
 *       BoxMesh) — no model, fully reproducible, so CI can assert them.
 *   backend "command"        : delegate to a configured local backend. The argv
 *       TEMPLATE's tokens {kind} {prompt} {output} {width} {height} {format} are
 *       substituted per-argument (no shell) and the command writes the file; the
 *       host then imports it through the bridge. Bring-your-own-tool, same trust
 *       model as the OmniSharp / netcoredbg commands.
 *
 * The single always-on tool is asset_gen_placeholder (deterministic, ignores the
 * backend); the five typed generators (sprite/texture/icon/audio_sfx/model)
 * branch on the backend, and asset_gen_configure inspects/sets it for the session.
 */

const KINDS = ["sprite", "texture", "icon", "audio_sfx", "model"] as const;
type Kind = (typeof KINDS)[number];
const KIND_ENUM = z.enum(KINDS);

/**
 * Per-kind placeholder output: the in-engine generator writes NATIVE Godot
 * resources (.tres) — an ImageTexture / AudioStreamWAV / primitive mesh — so
 * they load synchronously with no async import pipeline. (A real `command`
 * backend may instead write an external format like .png; that goes through
 * asset.import.)
 */
const KIND_FORMAT: Record<Kind, { ext: string; format: string; allowed: string[] }> = {
  sprite: { ext: ".tres", format: "ImageTexture", allowed: [".tres", ".res"] },
  texture: { ext: ".tres", format: "ImageTexture", allowed: [".tres", ".res"] },
  icon: { ext: ".tres", format: "ImageTexture", allowed: [".tres", ".res"] },
  audio_sfx: { ext: ".tres", format: "AudioStreamWAV", allowed: [".tres", ".res"] },
  model: { ext: ".tres", format: "BoxMesh", allowed: [".tres", ".res"] },
};

type Backend = "none" | "placeholder" | "command";

function normalizeBackend(v: string): Backend {
  return v === "placeholder" || v === "command" ? v : "none";
}

// ---- result envelopes (mirror the ok()/fail() shape used across the tools) ----

function ok(obj: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj,
  };
}

function fail(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Asset generation error: ${message}` }],
  };
}

function extOf(p: string): string {
  const slash = p.lastIndexOf("/");
  const dot = p.lastIndexOf(".");
  return dot > slash ? p.slice(dot).toLowerCase() : "";
}

/**
 * Resolve the destination for placeholder mode: append the kind's default
 * extension when none is given, or reject a mismatched one. (The command backend
 * owns its own format, so this only guards the in-engine placeholder path.)
 */
function resolvePlaceholderPath(kind: Kind, toPath: string): { path?: string; error?: string } {
  if (!toPath.startsWith("res://")) return { error: "'to_path' must be a res:// path" };
  const spec = KIND_FORMAT[kind];
  const ext = extOf(toPath);
  if (!ext) return { path: toPath + spec.ext };
  if (!spec.allowed.includes(ext)) {
    return { error: `asset_gen placeholder for kind '${kind}' writes ${spec.allowed.join(" / ")}; got '${ext}'` };
  }
  return { path: toPath };
}

/** Substitute {tokens} in one argv template argument. */
function subToken(arg: string, tokens: Record<string, string>): string {
  return arg.replace(/\{(kind|prompt|output|width|height|format)\}/g, (_m, k: string) => tokens[k] ?? "");
}

/** Run the configured backend command (no shell). Resolves when it exits 0. */
function runCommand(
  template: string,
  tokens: Record<string, string>,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parts = template.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return Promise.resolve({ ok: false as const, message: "empty command template" });
  const argv = parts.map((a) => subToken(a, tokens));
  const [cmd, ...args] = argv;
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: { ok: true } | { ok: false; message: string }) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    let stderr = "";
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (err) {
      finish({ ok: false, message: `could not spawn backend '${cmd}': ${(err as Error).message}` });
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, message: `backend command timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    timer.unref?.();
    child.stderr?.on("data", (d) => {
      if (stderr.length < 4000) stderr += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({ ok: false, message: `backend '${cmd}' failed to start: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) finish({ ok: true });
      else finish({ ok: false, message: `backend '${cmd}' exited ${code}${stderr ? `: ${stderr.trim().slice(0, 400)}` : ""}` });
    });
  });
}

export function registerAssetGenTools(server: McpServer, bridge: BridgeClient, config: Config): void {
  // Mutable session state, seeded from the environment (the "flag").
  const state: { backend: Backend; command: string | null; provider: string | null } = {
    backend: normalizeBackend(config.assetGenBackend),
    command: config.assetGenCommand || null,
    provider: config.assetGenProvider || null,
  };

  const backendNote = (b: Backend): string =>
    b === "none"
      ? "No generation backend configured — asset_gen_* generators degrade to a request spec (asset_gen_placeholder still works)."
      : b === "placeholder"
        ? "Placeholder backend — generators write deterministic in-engine stand-ins."
        : "Command backend — generators delegate to the configured command.";

  // ------------------------------------------------------ asset_gen_configure ----
  server.registerTool(
    "asset_gen_configure",
    {
      title: "Configure asset-generation backend",
      description:
        "Inspect or set the asset-generation backend for this session (Group J's feature flag). " +
        "backend 'none' (default) makes the generators degrade to a clear 'no backend configured' request spec; " +
        "'placeholder' writes deterministic in-engine stand-ins; 'command' delegates to a configured local command " +
        "(argv template with {kind} {prompt} {output} {width} {height} {format} tokens; it must write the file). " +
        "Call with no arguments to just report the current configuration. Session-only (does not persist to disk).",
      inputSchema: {
        backend: z.enum(["none", "placeholder", "command"]).optional().describe("Backend to select (omit to leave unchanged)"),
        command: z.string().optional().describe("argv template for the 'command' backend, tokens {kind} {prompt} {output} {width} {height} {format}"),
        provider: z.string().optional().describe("Free-form provider label recorded in results (e.g. \"local-sd\", \"my-gen.py\")"),
      },
    },
    async ({ backend, command, provider }) => {
      if (command !== undefined) state.command = command || null;
      if (provider !== undefined) state.provider = provider || null;
      if (backend !== undefined) {
        if (backend === "command" && !state.command) {
          return fail("backend 'command' needs a command template — pass `command` in the same call (or set BREAKPOINT_ASSETGEN_CMD)");
        }
        state.backend = backend;
      }
      return ok({
        backend: state.backend,
        provider: state.provider,
        command: state.command,
        configured: state.backend !== "none",
        supported_kinds: [...KINDS],
        note: backendNote(state.backend),
      });
    },
  );

  // The shared generation flow for the 5 typed generators + the always-on placeholder.
  async function generate(
    kind: Kind,
    args: {
      prompt?: string;
      to_path: string;
      width?: number;
      height?: number;
      duration_ms?: number;
      shape?: string;
      placeholder?: boolean;
      confirm?: boolean;
      forcePlaceholder?: boolean;
    },
  ) {
    const { prompt, to_path, width, height, duration_ms, shape, placeholder, confirm, forcePlaceholder } = args;
    const spec = KIND_FORMAT[kind];
    const usePlaceholder = forcePlaceholder === true || placeholder === true || state.backend === "placeholder";
    const effectiveBackend: Backend = usePlaceholder ? "placeholder" : state.backend;

    // Degrade path — no file written, no confirmation needed.
    if (effectiveBackend === "none") {
      return ok({
        status: "no_backend",
        kind,
        backend: "none",
        path: null,
        prompt: prompt ?? null,
        format: spec.format,
        request: { kind, prompt: prompt ?? null, to_path, width: width ?? null, height: height ?? null, format: spec.format },
        message:
          `No generation backend configured. Configure one with asset_gen_configure (backend "command" or "placeholder"), ` +
          `pass placeholder:true for a deterministic stand-in, or have your multimodal client generate the ${kind} and write it to ${to_path}.`,
      });
    }

    // Everything below writes a file → gate it.
    const blocked = await gate(server, confirm, `Generate ${kind} asset at ${to_path}`);
    if (blocked) return blocked;

    if (effectiveBackend === "placeholder") {
      const resolved = resolvePlaceholderPath(kind, to_path);
      if (resolved.error) return fail(resolved.error);
      const path = resolved.path as string;
      try {
        const r = (await bridge.request("asset.gen_placeholder", {
          kind,
          to_path: path,
          prompt: prompt ?? "",
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
          ...(duration_ms !== undefined ? { duration_ms } : {}),
          ...(shape !== undefined ? { shape } : {}),
        })) as Record<string, unknown>;
        return ok({
          status: "placeholder",
          kind,
          backend: "placeholder",
          path: (r.path as string) ?? path,
          prompt: prompt ?? null,
          imported_type: (r.imported_type as string | null) ?? null,
          ...(r.width !== undefined ? { width: r.width } : {}),
          ...(r.height !== undefined ? { height: r.height } : {}),
          ...(r.bytes !== undefined ? { bytes: r.bytes } : {}),
          format: (r.format as string) ?? spec.format,
          message: `Wrote a deterministic ${kind} placeholder to ${(r.path as string) ?? path}.`,
        });
      } catch (err) {
        return fail((err as Error).message ?? String(err));
      }
    }

    // command backend
    if (!to_path.startsWith("res://")) return fail("'to_path' must be a res:// path");
    if (!state.command) return fail("backend 'command' has no command template configured");
    const output = toFsPath(to_path, config.projectPath);
    const tokens: Record<string, string> = {
      kind,
      prompt: prompt ?? "",
      output,
      width: String(width ?? ""),
      height: String(height ?? ""),
      format: spec.format,
    };
    const run = await runCommand(state.command, tokens, config.assetGenTimeoutMs);
    if (!run.ok) return fail(run.message);
    let bytes = 0;
    try {
      bytes = fs.statSync(output).size;
    } catch {
      return fail(`backend command exited 0 but did not write ${to_path}`);
    }
    if (bytes === 0) return fail(`backend command wrote an empty file at ${to_path}`);
    // Import the freshly-written file through the editor bridge.
    let importedType: string | null = null;
    try {
      const r = (await bridge.request("asset.import", { path: to_path })) as Record<string, unknown>;
      importedType = (r.imported_type as string | null) ?? null;
    } catch (err) {
      return fail(`generated ${to_path} (${bytes} bytes) but the editor import failed: ${(err as Error).message ?? String(err)}`);
    }
    return ok({
      status: "generated",
      kind,
      backend: "command",
      provider: state.provider,
      path: to_path,
      prompt: prompt ?? null,
      imported_type: importedType,
      bytes,
      message: `Generated ${kind} via the configured backend${state.provider ? ` (${state.provider})` : ""} at ${to_path}.`,
    });
  }

  // ----------------------------------------------------- asset_gen_placeholder ----
  server.registerTool(
    "asset_gen_placeholder",
    {
      title: "Generate a placeholder asset",
      description:
        "Write a deterministic, in-engine PROCEDURAL placeholder asset to a res:// path — no model, fully " +
        "reproducible (colour/frequency/size derive from a hash of the prompt). Always available regardless of the configured " +
        "backend. kind picks the asset (all native .tres resources that load synchronously): sprite/texture/icon → an ImageTexture; " +
        "audio_sfx → an AudioStreamWAV; model → a BoxMesh/primitive mesh. " +
        "DESTRUCTIVE (writes a file) — gated by confirmation.",
      inputSchema: {
        kind: KIND_ENUM.describe("Asset kind: sprite | texture | icon | audio_sfx | model"),
        to_path: z.string().describe("Destination res:// path; the correct extension is appended if omitted"),
        prompt: z.string().optional().describe("Seed text — deterministically colours/tunes/sizes the placeholder"),
        width: z.number().int().positive().optional().describe("Image width for sprite/texture/icon (default per-kind)"),
        height: z.number().int().positive().optional().describe("Image height for sprite/texture/icon (default per-kind)"),
        duration_ms: z.number().int().positive().optional().describe("Length in ms for audio_sfx (default 300)"),
        shape: z.enum(["box", "sphere", "cylinder", "prism"]).optional().describe("Primitive for model (default box)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ kind, to_path, prompt, width, height, duration_ms, shape, confirm }) =>
      generate(kind as Kind, { prompt, to_path, width, height, duration_ms, shape, confirm, forcePlaceholder: true }),
  );

  // The five typed generators share `generate`; they differ only in the fixed
  // `kind` and the per-kind input fields exposed.
  const imageInput = {
    prompt: z.string().describe("What to generate (delegated to the backend; seeds the placeholder)"),
    to_path: z.string().describe("Destination res:// path (a .tres ImageTexture for the placeholder backend)"),
    width: z.number().int().positive().optional().describe("Image width (default 64 sprite / 128 texture,icon)"),
    height: z.number().int().positive().optional().describe("Image height (default matches width)"),
    placeholder: z.boolean().optional().describe("Force a deterministic in-engine stand-in even if a real backend is configured"),
    confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
  } as const;

  server.registerTool(
    "asset_gen_sprite",
    {
      title: "Generate a sprite",
      description:
        "Generate a 2D sprite texture from a prompt and import it at a res:// path. Delegates the pixels to the configured " +
        "backend (asset_gen_configure); with no backend it degrades to a request spec, or pass placeholder:true for a " +
        "deterministic stand-in. DESTRUCTIVE (writes a file when a backend/placeholder is used) — gated by confirmation.",
      inputSchema: imageInput,
    },
    async ({ prompt, to_path, width, height, placeholder, confirm }) =>
      generate("sprite", { prompt, to_path, width, height, placeholder, confirm }),
  );

  server.registerTool(
    "asset_gen_texture",
    {
      title: "Generate a texture",
      description:
        "Generate a (tileable-intent) material texture from a prompt and import it at a res:// path. Delegates to the configured " +
        "backend; degrades to a request spec with no backend, or pass placeholder:true for a deterministic stand-in. " +
        "DESTRUCTIVE (writes a file when a backend/placeholder is used) — gated by confirmation.",
      inputSchema: imageInput,
    },
    async ({ prompt, to_path, width, height, placeholder, confirm }) =>
      generate("texture", { prompt, to_path, width, height, placeholder, confirm }),
  );

  server.registerTool(
    "asset_gen_icon",
    {
      title: "Generate an icon",
      description:
        "Generate a square icon from a prompt and import it at a res:// path. Delegates to the configured backend; degrades to a " +
        "request spec with no backend, or pass placeholder:true for a deterministic stand-in. DESTRUCTIVE (writes a file when a " +
        "backend/placeholder is used) — gated by confirmation.",
      inputSchema: imageInput,
    },
    async ({ prompt, to_path, width, height, placeholder, confirm }) =>
      generate("icon", { prompt, to_path, width, height, placeholder, confirm }),
  );

  server.registerTool(
    "asset_gen_audio_sfx",
    {
      title: "Generate a sound effect",
      description:
        "Generate a short sound effect from a prompt and import it at a res:// path (an AudioStreamWAV for the placeholder " +
        "backend). Delegates to the configured backend; degrades to a request spec with no backend, or pass placeholder:true " +
        "for a deterministic stand-in. DESTRUCTIVE (writes a file when a backend/placeholder is used) — gated by confirmation.",
      inputSchema: {
        prompt: z.string().describe("What the sound should be (delegated to the backend; seeds the placeholder)"),
        to_path: z.string().describe("Destination res:// path (a .tres AudioStreamWAV for the placeholder backend)"),
        duration_ms: z.number().int().positive().optional().describe("Length in milliseconds (default 300)"),
        placeholder: z.boolean().optional().describe("Force a deterministic in-engine stand-in even if a real backend is configured"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ prompt, to_path, duration_ms, placeholder, confirm }) =>
      generate("audio_sfx", { prompt, to_path, duration_ms, placeholder, confirm }),
  );

  server.registerTool(
    "asset_gen_model",
    {
      title: "Generate a 3D model",
      description:
        "Generate a 3D mesh from a prompt and import it at a res:// path (a BoxMesh/primitive for the placeholder backend). " +
        "Delegates to the configured backend; degrades to a request spec with no backend, or pass placeholder:true for a " +
        "deterministic stand-in. DESTRUCTIVE (writes a file when a backend/placeholder is used) — gated by confirmation.",
      inputSchema: {
        prompt: z.string().describe("What to model (delegated to the backend; seeds the placeholder)"),
        to_path: z.string().describe("Destination res:// path (a .tres mesh resource for the placeholder backend)"),
        shape: z.enum(["box", "sphere", "cylinder", "prism"]).optional().describe("Primitive shape for the placeholder (default box)"),
        placeholder: z.boolean().optional().describe("Force a deterministic in-engine stand-in even if a real backend is configured"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ prompt, to_path, shape, placeholder, confirm }) =>
      generate("model", { prompt, to_path, shape, placeholder, confirm }),
  );
}
