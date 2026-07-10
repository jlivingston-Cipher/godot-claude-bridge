import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli/args.js";

test("value-taking flags consume the next token", () => {
  const { flags, positionals } = parseArgs(["--project", "/tmp/proj", "--timeout", "500"]);
  assert.equal(flags.project, "/tmp/proj");
  assert.equal(flags.timeout, "500");
  assert.deepEqual(positionals, []);
});

test("--flag=value form is always value-taking", () => {
  const { flags } = parseArgs(["--project=/tmp/x", "--timeout=250"]);
  assert.equal(flags.project, "/tmp/x");
  assert.equal(flags.timeout, "250");
});

test("declared boolean flags do not consume the next token", () => {
  const { flags, positionals } = parseArgs(["--json", "/tmp/proj"], ["json"]);
  assert.equal(flags.json, true);
  assert.deepEqual(positionals, ["/tmp/proj"]);
});

test("multiple boolean flags all become true", () => {
  const { flags } = parseArgs(
    ["--json", "--require-live", "--include-csharp"],
    ["json", "require-live", "include-csharp"],
  );
  assert.equal(flags.json, true);
  assert.equal(flags["require-live"], true);
  assert.equal(flags["include-csharp"], true);
});

test("a value flag with no following value becomes a boolean", () => {
  const { flags } = parseArgs(["--project"]);
  assert.equal(flags.project, true);
});

test("short flags are booleans and positionals are collected", () => {
  const { flags, positionals } = parseArgs(["-h", "doctor", "extra"]);
  assert.equal(flags.h, true);
  assert.deepEqual(positionals, ["doctor", "extra"]);
});

test("`--` sends the rest to positionals verbatim", () => {
  const { flags, positionals } = parseArgs(["--json", "--", "--not-a-flag", "x"], ["json"]);
  assert.equal(flags.json, true);
  assert.deepEqual(positionals, ["--not-a-flag", "x"]);
});
