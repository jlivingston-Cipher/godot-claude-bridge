import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { BridgeClient } from "./bridge.js";
import { log } from "./logger.js";

/**
 * D3 — resource subscriptions.
 *
 * Adds the MCP resources/subscribe + resources/unsubscribe requests and pushes
 * notifications/resources/updated when a subscribed `godot://…` resource
 * changes. The change signal originates in the editor addon (selection / edited
 * scene changed) or the in-game runtime autoload (live SceneTree changed),
 * travels over the same bridge socket D2's request path uses as an unsolicited
 * "resource.changed" event, and is fanned out here — but only for URIs a client
 * has actually subscribed to. Non-subscribers keep the unchanged pull-only
 * behavior.
 */

/**
 * Default trailing window (ms) for coalescing rapid resource.changed events into
 * fewer notifications/resources/updated. Override via CLAUDE_RESOURCE_COALESCE_MS.
 * Multiple `updated` are spec-harmless (the client just re-reads), so this only
 * trims volume; 0 disables coalescing entirely.
 */
export const DEFAULT_COALESCE_MS = 50;

/**
 * Server capability advertising resources/subscribe (and, by extension, the
 * notifications/resources/updated the SDK gates on `capabilities.resources`).
 * Merged with the task capabilities in index.ts.
 */
export const RESOURCE_CAPABILITIES = {
  resources: { subscribe: true },
} as const;

/** Tracks which `godot://…` resource URIs the connected client is subscribed to. */
export class ResourceSubscriptions {
  private uris = new Set<string>();

  subscribe(uri: string): void {
    this.uris.add(uri);
  }

  unsubscribe(uri: string): void {
    this.uris.delete(uri);
  }

  has(uri: string): boolean {
    return this.uris.has(uri);
  }

  get size(): number {
    return this.uris.size;
  }
}

/** Runtime-bridge resources live under godot://runtime/; the rest are editor-served. */
function isRuntimeUri(uri: string): boolean {
  return uri.startsWith("godot://runtime/");
}

/**
 * Install resources/subscribe + resources/unsubscribe on the low-level server,
 * hold the relevant bridge connected so the addon's push events flow, and
 * forward each "resource.changed" event to notifications/resources/updated for
 * exactly the subscribed URIs.
 *
 * Rapid changes are coalesced per-URI with a leading-edge + trailing-flush
 * throttle: the first change pushes immediately (responsive), then further
 * changes inside a `coalesceMs` window collapse into at most one trailing push.
 * This keeps a burst — e.g. many SceneTree mutations in one frame — from fanning
 * out as a flood of notifications. Set coalesceMs to 0 to disable.
 *
 * The subscribe/unsubscribe methods are not capability-gated by the SDK's
 * request-handler assertion, but sendResourceUpdated is gated on the `resources`
 * capability — hence RESOURCE_CAPABILITIES must be advertised at construction.
 */
export function registerResourceSubscriptions(
  server: McpServer,
  editor: BridgeClient,
  runtime: BridgeClient,
  subs: ResourceSubscriptions = new ResourceSubscriptions(),
  opts: { coalesceMs?: number } = {},
): ResourceSubscriptions {
  const low = server.server;
  const coalesceMs = opts.coalesceMs ?? DEFAULT_COALESCE_MS;

  low.setRequestHandler(SubscribeRequestSchema, async (request) => {
    const uri = request.params.uri;
    subs.subscribe(uri);
    // Keep the push channel open so the addon can deliver change events even if
    // the host never issued a pull request for this resource.
    const source = isRuntimeUri(uri) ? runtime : editor;
    void source.ensureConnected();
    log(`resources/subscribe ${uri} (${subs.size} active)`);
    return {};
  });

  // Per-URI leading-edge throttle with a trailing flush. `pending` records that
  // at least one change arrived during the open window and still needs a push.
  interface Throttle {
    timer: NodeJS.Timeout;
    pending: boolean;
  }
  const throttles = new Map<string, Throttle>();

  const push = (uri: string): void => {
    void low.sendResourceUpdated({ uri }).catch((err) => {
      log(`sendResourceUpdated ${uri} failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const clearThrottle = (uri: string): void => {
    const t = throttles.get(uri);
    if (t) {
      clearTimeout(t.timer);
      throttles.delete(uri);
    }
  };

  const arm = (uri: string): void => {
    const timer = setTimeout(() => onWindowEnd(uri), coalesceMs);
    // Never keep the event loop alive just for a coalescing window.
    timer.unref?.();
    throttles.set(uri, { timer, pending: false });
  };

  const onWindowEnd = (uri: string): void => {
    const t = throttles.get(uri);
    if (!t) return;
    if (t.pending && subs.has(uri)) {
      // A change landed during the window — flush it and hold the window open so
      // a sustained stream stays capped at ~one push per window instead of starving.
      push(uri);
      arm(uri);
    } else {
      throttles.delete(uri);
    }
  };

  const forward = (uri: string): void => {
    if (!subs.has(uri)) return;
    if (coalesceMs <= 0) {
      push(uri);
      return;
    }
    const t = throttles.get(uri);
    if (t) {
      // Inside an open window — collapse into the eventual trailing flush.
      t.pending = true;
    } else {
      // Leading edge — push now and open a coalescing window.
      push(uri);
      arm(uri);
    }
  };

  low.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    const uri = request.params.uri;
    subs.unsubscribe(uri);
    clearThrottle(uri);
    log(`resources/unsubscribe ${uri} (${subs.size} active)`);
    return {};
  });

  editor.onResourceChanged(forward);
  runtime.onResourceChanged(forward);

  return subs;
}
