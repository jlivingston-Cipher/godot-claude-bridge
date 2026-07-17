import fs from "node:fs";
import path from "node:path";

/**
 * Loopback-bridge shared secret (host side).
 *
 * The editor addon / runtime autoload mint a per-project secret to
 * <projectPath>/.godot/breakpoint_mcp.secret (see addons/breakpoint_mcp/
 * bridge_secret.gd). Reading the same file lets the host authenticate to the
 * loopback bridges with ZERO configuration. An env override wins for advanced /
 * host-launched-child cases. When no material is available (an insecure or
 * not-yet-provisioned bridge) the resolver returns null and the client connects
 * without an auth line — backward-compatible with a bridge that isn't enforcing.
 */

/** Read the minted project secret, or null if absent/empty/unreadable. */
export function readProjectSecret(projectPath: string): string | null {
  try {
    const p = path.join(projectPath, ".godot", "breakpoint_mcp.secret");
    const s = fs.readFileSync(p, "utf8").trim();
    return s.length ? s : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the bridge secret: the first non-empty env var in `envNames` wins,
 * else the minted project-secret file. Read lazily per connect so a secret that
 * appears after startup (the editor launched later) is picked up on reconnect.
 */
export function resolveBridgeSecret(projectPath: string, envNames: string[]): string | null {
  for (const name of envNames) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return readProjectSecret(projectPath);
}
