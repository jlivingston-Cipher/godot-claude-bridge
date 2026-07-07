// Editor-plane resource-subscription probe (EXPERIMENTAL, D3) — connects to a
// REAL running Godot editor's Claude Bridge addon (:9080) and proves the LIVE
// addon PUSHES an unsolicited "resource.changed" event when the editor context
// moves — the one thing the mocked-bridge unit suite deliberately cannot do.
//
// It drives two real mutations over the bridge and watches BridgeClient's
// onResourceChanged callback:
//   * scene.open   -> EditorPlugin.scene_changed  -> godot://scene-tree + editor-state
//   * selection.set-> EditorSelection.selection_changed -> godot://editor-state
//
// Markers (grep-able): D3_SUB_PING / D3_SUB_EVENT / D3_SUB_RESULT. The reachability
// check is the gate (exit 1 if the addon is unreachable); the whole job runs under
// continue-on-error so live-engine timing never blocks a merge.
//
// Requires the editor up (booted under Xvfb by the workflow) with GODOT_PROJECT set.
import { BridgeClient } from "../dist/bridge.js";
import { loadConfig } from "../dist/config.js";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const cfg = loadConfig();
console.log(`D3 subscription probe -> editor bridge ${cfg.bridgeHost}:${cfg.bridgePort}  project=${cfg.projectPath}`);

const editor = new BridgeClient(cfg.bridgeHost, cfg.bridgePort, 15000);
const events = [];
editor.onResourceChanged((uri) => {
  events.push(uri);
  console.log(`D3_SUB_EVENT uri=${uri}`);
});

// Gate: the addon must be reachable. ensureConnected() never rejects (it retries),
// so prove reachability with a real request instead.
try {
  await editor.ensureConnected();
  const pong = await editor.request("ping", {}, 20000);
  console.log(`D3_SUB_PING ok addon_version=${pong?.addon_version ?? "?"} godot=${pong?.godot ?? "?"}`);
} catch (err) {
  console.error("✘ could not reach the editor bridge:", err?.message ?? String(err));
  editor.close();
  process.exit(1);
}

const countOf = (uri) => events.filter((u) => u === uri).length;

// 1) Opening a scene fires scene_changed -> scene-tree + editor-state.
try {
  await editor.request("scene.open", { path: "res://main.tscn" });
  await delay(1200);
  console.log(`D3_SUB_RESULT after_scene_open scene_tree=${countOf("godot://scene-tree")} editor_state=${countOf("godot://editor-state")}`);
} catch (err) {
  console.log("PROBE scene.open threw", err?.message ?? String(err));
}

// 2) Changing the selection fires selection_changed -> editor-state.
const before = countOf("godot://editor-state");
try {
  await editor.request("selection.set", { paths: ["."] });
  await delay(600);
  await editor.request("selection.set", { paths: [] });
  await delay(600);
} catch (err) {
  console.log("PROBE selection.set threw", err?.message ?? String(err));
}
const selEvents = countOf("godot://editor-state") - before;
console.log(`D3_SUB_RESULT selection_editor_state_events=${selEvents} total_events=${events.length}`);

// The gate for a green probe: a live selection change produced at least one
// editor-state change event. (Coalescing is allowed; multiple is fine too.)
if (selEvents < 1) {
  console.error("✘ expected >=1 godot://editor-state event from a live selection change");
  process.exitCode = 1;
} else {
  console.log("✔ live editor pushed resource.changed on selection change");
}

editor.close();
