import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchAddonFromGitHub, parseRepo, type FetchLike, type HttpResponse } from "../src/cli/github.js";

/**
 * Offline tests for the `--from-github` fetcher. Every network hit goes through an
 * injected fake `fetch`, so these run with no registry/GitHub access — the same
 * posture as the rest of the host suite.
 */

function jsonRes(status: number, body: unknown): HttpResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
}
function bytesRes(bytes: Uint8Array): HttpResponse {
  const copy = Uint8Array.from(bytes);
  return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => copy.buffer };
}
function tmpDest(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bpmcp-ghtest-"));
}

const TREE_OK = {
  truncated: false,
  tree: [
    { path: "addons/breakpoint_mcp/plugin.cfg", type: "blob" },
    { path: "addons/breakpoint_mcp/plugin.gd", type: "blob" },
    { path: "addons/breakpoint_mcp/icon.png", type: "blob" },
    { path: "addons/breakpoint_mcp", type: "tree" }, // dir entry — ignored
    { path: "README.md", type: "blob" }, // non-addon — ignored
    { path: "host/src/index.ts", type: "blob" }, // non-addon — ignored
  ],
};
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function router(handlers: { tree?: HttpResponse; raw?: (p: string) => HttpResponse }): { fn: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = async (url) => {
    calls.push(url);
    if (url.includes("/git/trees/")) return handlers.tree ?? jsonRes(500, {});
    const p = url.split("/breakpoint_mcp/")[1] ?? url;
    return handlers.raw ? handlers.raw(p) : jsonRes(404, {});
  };
  return { fn, calls };
}

test("fetchAddonFromGitHub writes only addon blobs, preserving bytes", async () => {
  const dest = tmpDest();
  const { fn, calls } = router({
    tree: jsonRes(200, TREE_OK),
    raw: (p) => {
      if (p === "plugin.cfg") return bytesRes(new TextEncoder().encode('[plugin]\nname="Breakpoint MCP"\n'));
      if (p === "plugin.gd") return bytesRes(new TextEncoder().encode("extends EditorPlugin\n"));
      if (p === "icon.png") return bytesRes(PNG_MAGIC);
      return jsonRes(404, {});
    },
  });
  const written = await fetchAddonFromGitHub({ repo: "o/r", ref: "main", dest }, fn);
  assert.deepEqual([...written].sort(), ["icon.png", "plugin.cfg", "plugin.gd"]);
  assert.ok(fs.existsSync(path.join(dest, "plugin.cfg")));
  assert.equal(fs.existsSync(path.join(dest, "README.md")), false, "non-addon file not written");
  assert.deepEqual(Uint8Array.from(fs.readFileSync(path.join(dest, "icon.png"))), PNG_MAGIC);
  assert.equal(calls.filter((u) => u.includes("/git/trees/")).length, 1, "exactly one API call");
  fs.rmSync(dest, { recursive: true, force: true });
});

test("fetchAddonFromGitHub throws a clear 404", async () => {
  const dest = tmpDest();
  const { fn } = router({ tree: jsonRes(404, {}) });
  await assert.rejects(() => fetchAddonFromGitHub({ repo: "o/r", ref: "nope", dest }, fn), /404/);
  fs.rmSync(dest, { recursive: true, force: true });
});

test("fetchAddonFromGitHub surfaces a 403 rate-limit hint", async () => {
  const dest = tmpDest();
  const { fn } = router({ tree: jsonRes(403, {}) });
  await assert.rejects(() => fetchAddonFromGitHub({ repo: "o/r", ref: "main", dest }, fn), /403|GITHUB_TOKEN/);
  fs.rmSync(dest, { recursive: true, force: true });
});

test("fetchAddonFromGitHub errors when the ref has no addon", async () => {
  const dest = tmpDest();
  const { fn } = router({ tree: jsonRes(200, { truncated: false, tree: [{ path: "README.md", type: "blob" }] }) });
  await assert.rejects(() => fetchAddonFromGitHub({ repo: "o/r", ref: "main", dest }, fn), /addons\/breakpoint_mcp/);
  fs.rmSync(dest, { recursive: true, force: true });
});

test("fetchAddonFromGitHub rejects a truncated tree", async () => {
  const dest = tmpDest();
  const { fn } = router({ tree: jsonRes(200, { truncated: true, tree: [] }) });
  await assert.rejects(() => fetchAddonFromGitHub({ repo: "o/r", ref: "main", dest }, fn), /too large/);
  fs.rmSync(dest, { recursive: true, force: true });
});

test("fetchAddonFromGitHub errors if a raw download fails", async () => {
  const dest = tmpDest();
  const { fn } = router({ tree: jsonRes(200, TREE_OK), raw: () => jsonRes(500, {}) });
  await assert.rejects(() => fetchAddonFromGitHub({ repo: "o/r", ref: "main", dest }, fn), /could not download/);
  fs.rmSync(dest, { recursive: true, force: true });
});

test("parseRepo splits owner/repo and rejects junk", () => {
  assert.deepEqual(parseRepo("jlivingston-Cipher/godot-breakpoint-mcp"), {
    owner: "jlivingston-Cipher",
    name: "godot-breakpoint-mcp",
  });
  assert.throws(() => parseRepo("not-a-repo"));
  assert.throws(() => parseRepo("too/many/parts"));
});
