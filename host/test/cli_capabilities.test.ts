import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePrivilegedGroups } from "../src/cli/init.js";
import { serverEntry } from "../src/cli/clients.js";
import { checkCapabilities } from "../src/cli/doctor.js";
import { loadConfig } from "../src/config.js";

/**
 * The guided-front-door pieces for capability groups: the init preset resolver,
 * the serverEntry env it produces, and the doctor capability-groups section.
 */

test("resolvePrivilegedGroups: safe default, --trust presets, explicit list, unknown token", () => {
  assert.deepEqual(resolvePrivilegedGroups({}), { value: "" });
  assert.deepEqual(resolvePrivilegedGroups({ trust: "safe" }), { value: "" });
  assert.deepEqual(resolvePrivilegedGroups({ trust: "full" }), { value: "code-execution,network" });
  assert.deepEqual(resolvePrivilegedGroups({ "privileged-groups": "code-execution" }), { value: "code-execution" });
  assert.deepEqual(resolvePrivilegedGroups({ "privileged-groups": "all" }), { value: "code-execution,network" });

  const bad = resolvePrivilegedGroups({ "privileged-groups": "network, bogus" });
  assert.equal(bad.value, "network");
  assert.match(bad.warn ?? "", /bogus/);
});

test("serverEntry adds BREAKPOINT_PRIVILEGED_GROUPS only when opted in", () => {
  const safe = serverEntry("/proj", "godot", false) as { env: Record<string, string> };
  assert.equal(safe.env.BREAKPOINT_PRIVILEGED_GROUPS, undefined);
  const full = serverEntry("/proj", "godot", false, "code-execution,network") as { env: Record<string, string> };
  assert.equal(full.env.BREAKPOINT_PRIVILEGED_GROUPS, "code-execution,network");
});

test("doctor checkCapabilities reports the secure default (14 dropped) + how-to-enable hint", () => {
  const cfg = { ...loadConfig(), privilegedGroups: null };
  const main = checkCapabilities(cfg).find((c) => c.name === "capability-groups");
  assert.ok(main);
  assert.equal(main.severity, "info");
  assert.match(main.detail, /code-execution off/);
  assert.match(main.detail, /14 higher-trust tool/);
  assert.match(main.hint ?? "", /BREAKPOINT_PRIVILEGED_GROUPS/);
});

test("doctor checkCapabilities reports the full surface when both groups are on", () => {
  const cfg = { ...loadConfig(), privilegedGroups: ["all"] };
  const main = checkCapabilities(cfg).find((c) => c.name === "capability-groups");
  assert.ok(main);
  assert.match(main.detail, /full 286-tool surface/);
  assert.equal(main.hint, undefined);
});

test("doctor flags a configured asset-gen backend unless code-execution is on", () => {
  const off = { ...loadConfig(), privilegedGroups: null, assetGenBackend: "command", assetGenCommand: "/bin/echo" };
  assert.ok(checkCapabilities(off).some((c) => c.name === "capability-assetgen"));

  // network alone does NOT load the asset_gen_* tools — their only privileged
  // path is the local command backend (code-execution), so the hint still fires.
  const net = { ...off, privilegedGroups: ["network"] };
  assert.ok(checkCapabilities(net).some((c) => c.name === "capability-assetgen"));

  const on = { ...off, privilegedGroups: ["code-execution"] };
  assert.ok(!checkCapabilities(on).some((c) => c.name === "capability-assetgen"));
});
