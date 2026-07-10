// Stage the editor addon into the npm package so `breakpoint-mcp init` can ship it.
//
// The addon's source of truth is the repo-root `addons/breakpoint_mcp/`, but the
// npm package root is `host/`, and npm cannot pack files above the package root.
// So this copies the addon to `host/addon/breakpoint_mcp/` — a build artifact
// (gitignored) that package.json `files` includes and that is rebuilt on
// `prepublishOnly`. Run via `npm run stage-addon` (from host/).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)); // host/scripts
const hostRoot = path.join(here, ".."); // host
const src = path.join(hostRoot, "..", "addons", "breakpoint_mcp"); // repo-root addons/
const dest = path.join(hostRoot, "addon", "breakpoint_mcp");

if (!fs.existsSync(path.join(src, "plugin.cfg"))) {
  console.error(`stage-addon: source addon not found at ${src}`);
  process.exit(1);
}

fs.rmSync(path.join(hostRoot, "addon"), { recursive: true, force: true });
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`stage-addon: copied ${src} -> ${dest}`);
