import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readProjectSecret, resolveBridgeSecret } from "../src/secret.js";

/** A throwaway project dir, optionally seeded with a minted secret file. */
function tmpProject(secret?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-secret-"));
  if (secret !== undefined) {
    fs.mkdirSync(path.join(dir, ".godot"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".godot", "breakpoint_mcp.secret"), secret);
  }
  return dir;
}

test("readProjectSecret reads and trims the minted secret file", () => {
  const dir = tmpProject("deadbeefcafe\n");
  try {
    assert.equal(readProjectSecret(dir), "deadbeefcafe");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readProjectSecret returns null when the file is absent", () => {
  const dir = tmpProject();
  try {
    assert.equal(readProjectSecret(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readProjectSecret returns null for an empty/whitespace file", () => {
  const dir = tmpProject("   \n");
  try {
    assert.equal(readProjectSecret(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveBridgeSecret prefers the env override over the file", () => {
  const dir = tmpProject("from-file");
  const KEY = "BREAKPOINT_TEST_SECRET_ENV";
  process.env[KEY] = "from-env";
  try {
    assert.equal(resolveBridgeSecret(dir, [KEY]), "from-env");
  } finally {
    delete process.env[KEY];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveBridgeSecret falls back to the file when no env var is set", () => {
  const dir = tmpProject("from-file");
  try {
    assert.equal(resolveBridgeSecret(dir, ["BREAKPOINT_TEST_UNSET_ENV"]), "from-file");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveBridgeSecret returns null when neither env nor file provides one", () => {
  const dir = tmpProject();
  try {
    assert.equal(resolveBridgeSecret(dir, ["BREAKPOINT_TEST_UNSET_ENV"]), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveBridgeSecret honors env precedence order (first non-empty wins)", () => {
  const dir = tmpProject();
  const A = "BREAKPOINT_TEST_A";
  const B = "BREAKPOINT_TEST_B";
  process.env[A] = "";        // empty -> skipped
  process.env[B] = "second";
  try {
    assert.equal(resolveBridgeSecret(dir, [A, B]), "second");
  } finally {
    delete process.env[A];
    delete process.env[B];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
