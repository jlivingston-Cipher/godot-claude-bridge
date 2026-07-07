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
 * scene changed), travels over the same bridge socket D2's request path uses as
 * an unsolicited "resource.changed" event, and is fanned out here — but only for
 * URIs a client has actually subscribed to. Non-subscribers keep the unchanged
 * pull-only behavior.
 */

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
 * The subscribe/unsubscribe methods are not capability-gated by the SDK's
 * request-handler assertion, but sendResourceUpdated is gated on the `resources`
 * capability — hence RESOURCE_CAPABILITIES must be advertised at construction.
 */
export function registerResourceSubscriptions(
  server: McpServer,
  editor: BridgeClient,
  runtime: BridgeClient,
  subs: ResourceSubscriptions = new ResourceSubscriptions(),
): ResourceSubscriptions {
  const low = server.server;

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

  low.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    subs.unsubscribe(request.params.uri);
    log(`resources/unsubscribe ${request.params.uri} (${subs.size} active)`);
    return {};
  });

  const forward = (uri: string): void => {
    if (!subs.has(uri)) return;
    void low.sendResourceUpdated({ uri }).catch((err) => {
      log(`sendResourceUpdated ${uri} failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };
  editor.onResourceChanged(forward);
  runtime.onResourceChanged(forward);

  return subs;
}
