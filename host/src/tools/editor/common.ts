import { ok } from "../lsp-common.js";
import type { BridgeClient, BridgeError } from "../../bridge.js";

/**
 * MCP error envelope for a failed editor-bridge call (never throws to the
 * caller). Distinct from lsp-common's `fail` (which labels errors "LSP error");
 * this one labels them "Bridge error".
 */
export function fail(err: unknown) {
  const be = err as Partial<BridgeError> & { message?: string };
  const code = be?.code ?? "error";
  const message = be?.message ?? String(err);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Bridge error [${code}]: ${message}` }],
  };
}

/**
 * Build the shared bridge-call helper used by every editor tool group: forward
 * a method to the in-editor addon over TCP and wrap the result in the standard
 * MCP success envelope, or a friendly Bridge-error envelope when unreachable.
 */
export function makeCall(bridge: BridgeClient) {
  return async (method: string, params: Record<string, unknown> = {}) => {
    try {
      return ok(await bridge.request(method, params));
    } catch (err) {
      return fail(err);
    }
  };
}

export type EditorCall = ReturnType<typeof makeCall>;
