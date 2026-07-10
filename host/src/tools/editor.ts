import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BridgeClient } from "../bridge.js";
import { makeCall } from "./editor/common.js";
import { registerCoreTools } from "./editor/core.js";
import { registerSceneTools } from "./editor/scene.js";
import { registerNodeTools } from "./editor/node.js";
import { registerSignalTools } from "./editor/signal.js";
import { registerIntrospectionTools } from "./editor/introspection.js";
import { registerResourceTools } from "./editor/resource.js";
import { registerFilesystemTools } from "./editor/filesystem.js";
import { registerAnimationTools } from "./editor/animation.js";
import { registerTileTools } from "./editor/tiles.js";
import { registerPhysicsTools } from "./editor/physics.js";
import { registerParticleTools } from "./editor/particles.js";
import { registerShaderTools } from "./editor/shader.js";
import { registerAudioTools } from "./editor/audio.js";
import { registerUiTools } from "./editor/ui.js";
import { registerSpatialTools } from "./editor/spatial.js";
import { registerProjectInputTestTools } from "./editor/project_input_test.js";

/**
 * Editor-bridge tools (Plane A): live-editor operations that forward to the
 * in-editor addon over TCP. Historically one ~2,600-line function; now split by
 * domain into ./editor/* modules. This thin entry builds the shared bridge-call
 * helper and registers each group in its original order, so the registered tool
 * set and its order are unchanged.
 */
export function registerEditorTools(server: McpServer, bridge: BridgeClient): void {
  const call = makeCall(bridge);
  registerCoreTools(server, call);
  registerSceneTools(server, call);
  registerNodeTools(server, call);
  registerSignalTools(server, call);
  registerIntrospectionTools(server, call, bridge);
  registerResourceTools(server, call);
  registerFilesystemTools(server, call);
  registerAnimationTools(server, call);
  registerTileTools(server, call);
  registerPhysicsTools(server, call);
  registerParticleTools(server, call);
  registerShaderTools(server, call);
  registerAudioTools(server, call);
  registerUiTools(server, call);
  registerSpatialTools(server, call);
  registerProjectInputTestTools(server, call);
}
