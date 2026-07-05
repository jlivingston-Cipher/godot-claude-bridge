#!/usr/bin/env node
// gcb-drive — minimal MCP stdio client to exercise the godot-claude-bridge host.
//
// Usage (run from the host/ directory):
//   node drive.mjs list                          # list tool names + resource URIs
//   node drive.mjs call <toolName> [jsonArgs]    # call a tool (jsonArgs default {})
//   node drive.mjs read <resourceUri>            # read an MCP resource
//
// Env:
//   ELICIT=accept|decline   how to answer confirmation prompts (default: decline)
//   GODOT_BIN=/path/to/godot override the godot binary (default: "godot" on PATH)
//   GODOT_PROJECT=/path      override the project (default: ../example)
//
// It spawns the host (dist/index.js) over stdio with GODOT_BIN + GODOT_PROJECT set,
// runs one command, prints the JSON result, and exits. Long base64 blobs
// (screenshots) are truncated so the pasted output stays small.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HOST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HOST_DIR, "..");
const DIST = path.join(HOST_DIR, "dist", "index.js");
const GODOT_PROJECT = process.env.GODOT_PROJECT || path.join(REPO, "example");
const GODOT_BIN = process.env.GODOT_BIN || "godot";
const ELICIT = (process.env.ELICIT || "decline").toLowerCase();

const [, , cmd, a1, a2] = process.argv;

// Keep pasted output small: shorten any very long string (e.g. base64 images).
function shorten(_key, val) {
  if (typeof val === "string" && val.length > 400) {
    return `«${val.length} chars, truncated» ` + val.slice(0, 80) + "…";
  }
  return val;
}

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [DIST],
    cwd: HOST_DIR,
    env: { ...process.env, GODOT_BIN, GODOT_PROJECT },
    stderr: "inherit",
  });

  const client = new Client(
    { name: "gcb-drive", version: "1.0.0" },
    { capabilities: { elicitation: {} } },
  );

  // Answer confirmation prompts from destructive tools.
  client.setRequestHandler(ElicitRequestSchema, async () => {
    if (ELICIT === "accept") {
      process.stderr.write("[drive] elicitation prompt → ACCEPT\n");
      return { action: "accept", content: { proceed: true } };
    }
    process.stderr.write("[drive] elicitation prompt → DECLINE\n");
    return { action: "decline" };
  });

  await client.connect(transport);

  let out;
  if (cmd === "list") {
    const tools = await client.listTools();
    let resources = { resources: [] };
    try { resources = await client.listResources(); } catch {}
    out = {
      toolCount: tools.tools.length,
      tools: tools.tools.map((t) => t.name),
      resources: (resources.resources || []).map((r) => r.uri),
    };
  } else if (cmd === "call") {
    if (!a1) throw new Error("call needs a tool name");
    const args = a2 ? JSON.parse(a2) : {};
    out = await client.callTool({ name: a1, arguments: args }, undefined, { timeout: 120000 });
  } else if (cmd === "read") {
    if (!a1) throw new Error("read needs a resource URI");
    out = await client.readResource({ uri: a1 });
  } else {
    throw new Error(`Unknown command '${cmd}'. Use: list | call <tool> [json] | read <uri>`);
  }

  process.stdout.write(JSON.stringify(out, shorten, 2) + "\n");
  await client.close();
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`[drive] ERROR: ${e?.stack || e}\n`);
  process.exit(1);
});
