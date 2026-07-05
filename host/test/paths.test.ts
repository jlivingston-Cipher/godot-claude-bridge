import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { toFsPath, toFileUri, readFileText } from "../src/paths.js";

const PROJECT = "/home/user/My Game";

test("toFsPath resolves res:// under the project root", () => {
  assert.equal(toFsPath("res://player.gd", PROJECT), path.join(PROJECT, "player.gd"));
  assert.equal(toFsPath("res://scenes/main.tscn", PROJECT), path.join(PROJECT, "scenes/main.tscn"));
});

test("toFsPath passes absolute paths through unchanged", () => {
  assert.equal(toFsPath("/etc/hosts", PROJECT), "/etc/hosts");
});

test("toFsPath joins project-relative paths onto the root", () => {
  assert.equal(toFsPath("player.gd", PROJECT), path.join(PROJECT, "player.gd"));
  assert.equal(toFsPath("scenes/main.tscn", PROJECT), path.join(PROJECT, "scenes/main.tscn"));
});

test("toFileUri produces a percent-encoded file:// URI (spaces in the path)", () => {
  const uri = toFileUri("res://player.gd", PROJECT);
  assert.ok(uri.startsWith("file://"), `expected file:// URI, got ${uri}`);
  assert.ok(uri.includes("%20"), `expected the space in "My Game" to be encoded, got ${uri}`);
  // Round-trips back to the real filesystem path.
  assert.equal(uri, pathToFileURL(path.join(PROJECT, "player.gd")).href);
});

test("readFileText returns file contents", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gcb-paths-"));
  const file = path.join(dir, "note.txt");
  fs.writeFileSync(file, "hello bridge", "utf8");
  assert.equal(readFileText(file), "hello bridge");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readFileText returns empty string for a missing file (never throws)", () => {
  assert.equal(readFileText("/no/such/path/really.gd"), "");
});
