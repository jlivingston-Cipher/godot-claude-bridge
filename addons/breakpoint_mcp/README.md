# Breakpoint MCP (Godot editor addon)

Loopback TCP/JSON bridge that exposes the live Godot editor (and, via the runtime autoload, the running game) to an MCP host so an AI assistant can drive it. Part of [breakpoint-mcp](../../../README.md).

## Install
1. Copy this `breakpoint_mcp/` folder into your project's `addons/` directory so the path is `res://addons/breakpoint_mcp/`.
2. Enable it under **Project → Project Settings → Plugins → Breakpoint MCP**.
3. On enable it listens on `127.0.0.1:9080`. Override the port by setting the `BREAKPOINT_BRIDGE_PORT` environment variable *before* launching Godot.

Requires **Godot 4.2+** (uses the `EditorInterface` singleton; 4.4+ recommended).

## Files
- `plugin.gd` — `EditorPlugin` entry point; starts/stops the server.
- `bridge_server.gd` — `TCPServer` polled from `_process`; newline-delimited JSON framing.
- `operations.gd` — request handlers; every mutation is wrapped in `EditorUndoRedoManager`.
- `variant_json.gd` — Variant ⇄ JSON codec (tagged rich types).

## Protocol
One JSON object per line (`\n`-terminated), both directions:
```
→ {"id":"<string>","method":"node.add","params":{"parent_path":".","type":"Sprite2D"}}
← {"id":"<string>","ok":true,"result":{"path":"Sprite2D","name":"Sprite2D","type":"Sprite2D"}}
← {"id":"<string>","ok":false,"error":{"code":"no_scene","message":"No scene is open"}}
```
Method names and payloads correspond 1:1 to the `editor_*` / `scene_*` / `node_*` tools in [`docs/TOOL_CATALOG.md`](../../../docs/TOOL_CATALOG.md).

## Security
Binds to loopback only. Handlers execute on the editor main thread. Treat the port as a local trust boundary — do not expose it beyond `127.0.0.1`.
