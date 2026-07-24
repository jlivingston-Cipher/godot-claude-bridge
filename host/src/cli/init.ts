/**
 * `breakpoint-mcp init` — one-command onboarding. Installs the editor addon into
 * a target Godot project, enables it in `project.godot`, and wires (or prints)
 * the MCP-client config. Idempotent and non-destructive: an existing addon is
 * skipped unless `--force`, an already-enabled plugin is a no-op, and a client
 * config is backed up (`.bak`) before it is merged. `--dry-run` touches nothing.
 *
 * By default the client snippet is printed; pass `--client <id>` to write/merge
 * it into that client's config file (see clients.ts for the id list + paths).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";
import { CLIENT_IDS, clientInfo, mergeClientConfig, serverEntry, snippet } from "./clients.js";
import { DEFAULT_REPO, fetchAddonFromGitHub, type FetchLike } from "./github.js";
import { CAPABILITY_GROUPS, parsePrivilegedGroups, selectPrivilegedGroups } from "../capabilities.js";

/**
 * Resolve the guided trust preset into a validated BREAKPOINT_PRIVILEGED_GROUPS
 * value ("" = the safe default — `code-execution` + `network` off). Accepts either
 * `--trust safe|full` (friendly presets) or `--privileged-groups <list>`
 * (`code-execution`, `network`, `all`, comma-separated). Unknown tokens are dropped
 * with a warning so a typo never silently enables a group.
 */
export function resolvePrivilegedGroups(flags: Record<string, string | boolean>): { value: string; warn?: string } {
  const trustAlias: Record<string, string> = { safe: "", none: "", off: "", full: "all", all: "all" };
  const raw =
    typeof flags["privileged-groups"] === "string"
      ? flags["privileged-groups"]
      : typeof flags.trust === "string"
        ? (trustAlias[flags.trust.toLowerCase()] ?? flags.trust)
        : "";
  if (!raw) return { value: "" };
  let warn: string | undefined;
  const enabled = selectPrivilegedGroups(parsePrivilegedGroups(raw), (unknown) => {
    warn = `ignoring unknown trust group(s): ${unknown.join(", ")} (valid: ${CAPABILITY_GROUPS.join(", ")}, all)`;
  });
  const value = [...enabled].sort().join(",");
  return warn ? { value, warn } : { value };
}

const PLUGIN_REL = "addons/breakpoint_mcp";
const PLUGIN_CFG_RES = "res://addons/breakpoint_mcp/plugin.cfg";
const SERVER_NAME = "godot";

/**
 * Locate the addon shipped with this package. In the published tarball it lives
 * at <pkg>/addon/breakpoint_mcp (staged there by scripts/stage-addon.mjs); in the
 * dev tree the package root is host/, so the canonical repo-root addons/ copy is
 * one level up. First match with a plugin.cfg wins.
 */
export function resolveBundledAddon(): string | null {
  // Escape hatch / test hook: an explicit addon source dir wins when it has a plugin.cfg.
  const override = process.env.BREAKPOINT_ADDON_SRC;
  if (override && fs.existsSync(path.join(override, "plugin.cfg"))) return override;
  const here = path.dirname(fileURLToPath(import.meta.url)); // dist/cli
  const pkgRoot = path.join(here, "..", ".."); // dist/cli -> dist -> package root
  const candidates = [
    path.join(pkgRoot, "addon", "breakpoint_mcp"), // published tarball
    path.join(pkgRoot, "..", "addons", "breakpoint_mcp"), // dev tree (host/../addons)
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "plugin.cfg"))) return c;
  }
  return null;
}

/** This package's own version, read from its package.json (null if unreadable). */
function packageVersion(): string | null {
  try {
    const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."); // dist/cli -> pkg
    const v = (JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8")) as { version?: unknown })
      .version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Default ref for --from-github: this package's version tag (vX.Y.Z), else main. */
function defaultGitHubRef(): string {
  const v = packageVersion();
  return v ? `v${v}` : "main";
}

export interface EnableResult {
  text: string;
  changed: boolean;
  alreadyEnabled: boolean;
}

/**
 * Add `res://addons/breakpoint_mcp/plugin.cfg` to project.godot's
 * `[editor_plugins] enabled=PackedStringArray(...)`, creating the section or the
 * line if absent and preserving every other plugin. Pure — returns the new text.
 */
export function enablePlugin(projectGodotText: string): EnableResult {
  const RES = PLUGIN_CFG_RES;
  const text = projectGodotText;
  const lines = text.split("\n");

  let sectionIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "[editor_plugins]") {
      sectionIdx = i;
      break;
    }
  }

  if (sectionIdx === -1) {
    const sep = text.length === 0 || text.endsWith("\n") ? "" : "\n";
    const block = `${sep}\n[editor_plugins]\n\nenabled=PackedStringArray("${RES}")\n`;
    return { text: text + block, changed: true, alreadyEnabled: false };
  }

  let enabledIdx = -1;
  for (let i = sectionIdx + 1; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s.startsWith("[") && s.endsWith("]")) break; // next section
    if (s.startsWith("enabled")) {
      enabledIdx = i;
      break;
    }
  }

  if (enabledIdx === -1) {
    lines.splice(sectionIdx + 1, 0, `enabled=PackedStringArray("${RES}")`);
    return { text: lines.join("\n"), changed: true, alreadyEnabled: false };
  }

  const line = lines[enabledIdx];
  if (line.includes(RES)) {
    return { text, changed: false, alreadyEnabled: true };
  }

  const m = /PackedStringArray\(([^)]*)\)/.exec(line);
  if (!m) {
    lines.splice(enabledIdx + 1, 0, `enabled=PackedStringArray("${RES}")`);
    return { text: lines.join("\n"), changed: true, alreadyEnabled: false };
  }

  const inside = m[1].trim();
  const newInside = inside.length === 0 ? `"${RES}"` : `${inside}, "${RES}"`;
  lines[enabledIdx] = line.replace(/PackedStringArray\([^)]*\)/, `PackedStringArray(${newInside})`);
  return { text: lines.join("\n"), changed: true, alreadyEnabled: false };
}

export interface InstallResult {
  action: "installed" | "overwritten" | "skipped";
  dest: string;
}

/** Copy the addon into <project>/addons/breakpoint_mcp; skip if present unless force. */
export function installAddon(addonSource: string, projectPath: string, opts: { force: boolean }): InstallResult {
  const dest = path.join(projectPath, PLUGIN_REL);
  const exists = fs.existsSync(path.join(dest, "plugin.cfg"));
  if (exists && !opts.force) return { action: "skipped", dest };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(addonSource, dest, { recursive: true });
  return { action: exists ? "overwritten" : "installed", dest };
}

function claudeCodeCommand(projectPath: string, privilegedGroups?: string): string {
  const groups = privilegedGroups ? ` --env BREAKPOINT_PRIVILEGED_GROUPS=${privilegedGroups}` : "";
  return `claude mcp add godot --env GODOT_PROJECT=${projectPath}${groups} -- npx -y breakpoint-mcp`;
}

/** Entry point for `breakpoint-mcp init`. Returns the process exit code. */
export async function runInit(argv: string[], deps: { fetchFn?: FetchLike } = {}): Promise<number> {
  const { flags } = parseArgs(argv, ["force", "dry-run"]);
  const projectPath =
    typeof flags.project === "string"
      ? path.resolve(flags.project)
      : process.env.GODOT_PROJECT ?? process.cwd();
  const dryRun = flags["dry-run"] === true;
  const force = flags.force === true;
  const client = typeof flags.client === "string" ? flags.client : "none";
  const godotBin = process.env.GODOT_BIN ?? "godot";
  // Guided trust preset → BREAKPOINT_PRIVILEGED_GROUPS ("" = safe default).
  const { value: privilegedGroups, warn: privilegedWarn } = resolvePrivilegedGroups(flags);

  // --from-github [ref]: source the addon from GitHub instead of the bundled copy.
  const fromGitHub = "from-github" in flags;
  const fgVal = flags["from-github"];
  const ref = typeof fgVal === "string" && fgVal.length > 0 ? fgVal : defaultGitHubRef();
  const repo = typeof flags.repo === "string" && flags.repo.length > 0 ? flags.repo : DEFAULT_REPO;

  const projGodot = path.join(projectPath, "project.godot");
  if (!fs.existsSync(projGodot)) {
    process.stderr.write(
      `init: no project.godot at ${projectPath}\n` +
        "  Pass --project <dir> pointing at your Godot project (the folder with project.godot).\n",
    );
    return 1;
  }

  const out: string[] = [];
  const say = (s = ""): void => {
    out.push(s);
  };

  say(`Project: ${projectPath}${dryRun ? "  (dry run — no changes written)" : ""}`);

  // Resolve the addon source: the bundled copy, or (--from-github) a temp dir
  // fetched from GitHub. The temp dir is removed once the addon is installed.
  let addonSource: string | null = null;
  let tmpFetchDir: string | null = null;
  if (fromGitHub) {
    if (dryRun) {
      say(`  addon source: would fetch ${repo}@${ref} from GitHub`);
    } else {
      say(`  addon source: fetching ${repo}@${ref} from GitHub…`);
      tmpFetchDir = fs.mkdtempSync(path.join(os.tmpdir(), "bpmcp-gh-"));
      try {
        const written = await fetchAddonFromGitHub({ repo, ref, dest: tmpFetchDir }, deps.fetchFn);
        say(`  addon source: fetched ${written.length} file(s) from ${repo}@${ref}`);
        addonSource = tmpFetchDir;
      } catch (err) {
        fs.rmSync(tmpFetchDir, { recursive: true, force: true });
        process.stderr.write(
          `init: --from-github failed: ${err instanceof Error ? err.message : String(err)}\n` +
            "  Omit --from-github to install the addon bundled with this package.\n",
        );
        return 1;
      }
    }
  } else {
    addonSource = resolveBundledAddon();
    if (!addonSource) {
      process.stderr.write(
        "init: could not locate the bundled editor addon inside the package.\n" +
          "  Reinstall breakpoint-mcp, or pass --from-github to fetch the addon from GitHub.\n",
      );
      return 1;
    }
  }

  // 1. Install the addon.
  const destHasAddon = fs.existsSync(path.join(projectPath, PLUGIN_REL, "plugin.cfg"));
  if (dryRun) {
    const verb = destHasAddon ? (force ? "overwrite" : "skip (already present; --force to overwrite)") : "install";
    const srcNote = fromGitHub ? ` (from ${repo}@${ref})` : "";
    say(`  addon: would ${verb} → ${PLUGIN_REL}/${srcNote}`);
  } else {
    if (!addonSource) {
      process.stderr.write("init: internal error — no addon source resolved.\n");
      return 1;
    }
    const r = installAddon(addonSource, projectPath, { force });
    if (tmpFetchDir) fs.rmSync(tmpFetchDir, { recursive: true, force: true });
    say(`  addon: ${r.action} → ${PLUGIN_REL}/`);
  }

  // 2. Enable it in project.godot.
  const before = fs.readFileSync(projGodot, "utf8");
  const en = enablePlugin(before);
  if (dryRun) {
    say(`  plugin: would ${en.alreadyEnabled ? "leave enabled (already enabled)" : "enable in project.godot"}`);
  } else if (en.changed) {
    fs.writeFileSync(projGodot, en.text);
    say("  plugin: enabled in project.godot");
  } else {
    say("  plugin: already enabled");
  }

  // 3. MCP-client config.
  say("");
  if (client === "claude-code") {
    say("MCP client (Claude Code) — run:");
    say(`  ${claudeCodeCommand(projectPath, privilegedGroups)}`);
  } else if (client === "none") {
    say('MCP client — add this to your client config (wrapper key "mcpServers"):');
    say(snippet("mcpServers", SERVER_NAME, serverEntry(projectPath, godotBin, false, privilegedGroups)));
    say("");
    say("Claude Code users can instead run:");
    say(`  ${claudeCodeCommand(projectPath, privilegedGroups)}`);
  } else {
    const info = clientInfo(client, projectPath);
    if (!info || info.configPath === null) {
      process.stderr.write(`init: unknown --client '${client}'. Known: ${CLIENT_IDS.join(", ")}.\n`);
      return 1;
    }
    const entry = serverEntry(projectPath, godotBin, info.needsType, privilegedGroups);
    if (dryRun) {
      say(`MCP client (${info.label}): would write ${info.configPath}`);
    } else {
      const existed = fs.existsSync(info.configPath);
      const prev = existed ? fs.readFileSync(info.configPath, "utf8") : null;
      let merged: string;
      try {
        merged = mergeClientConfig(prev, info.key, SERVER_NAME, entry);
      } catch {
        process.stderr.write(`init: ${info.configPath} is not valid JSON — leaving it untouched.\n`);
        return 1;
      }
      fs.mkdirSync(path.dirname(info.configPath), { recursive: true });
      if (existed) fs.copyFileSync(info.configPath, info.configPath + ".bak");
      fs.writeFileSync(info.configPath, merged);
      say(`MCP client (${info.label}): ${existed ? "updated" : "created"} ${info.configPath}${existed ? " (backup at .bak)" : ""}`);
    }
  }

  // Trust groups — surface the secure default so even a bare `init` teaches it.
  say("");
  if (privilegedGroups) {
    say(`Higher-trust tool groups enabled: ${privilegedGroups} — the full 282-tool surface loads.`);
  } else {
    say("Higher-trust tool groups are OFF by default (the secure default). The assistant loads the");
    say("everyday authoring/debug surface and drops the 14 code-execution + network tools (e.g.");
    say("godot_run_headless_script, the *_call_method / dbg_evaluate tools, asset-gen, backend_*).");
    say("Enable them by re-running with `--trust full` (or `--privileged-groups code-execution,network`),");
    say("or set BREAKPOINT_PRIVILEGED_GROUPS in the server env. The `godot://capabilities` resource and");
    say("`breakpoint-mcp doctor` list exactly what each group gates.");
  }
  if (privilegedWarn) say(`  note: ${privilegedWarn}`);

  say("");
  say("Next: open the project in Godot, then run `breakpoint-mcp doctor --require-live` to verify.");
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}
