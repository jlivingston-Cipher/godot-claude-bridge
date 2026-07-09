# breakpoint-mcp

The MCP **host** for [Breakpoint MCP](https://github.com/jlivingston-Cipher/godot-claude-bridge) —
a [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the
Godot game engine to AI coding assistants across four planes: headless CLI, the live
editor, Godot's own LSP + DAP, and a runtime bridge inside the running game. **242 tools
+ 5 MCP resources**, built against the stable `@modelcontextprotocol/sdk` 1.x API.
Developed and tested with **Claude**; because MCP is an open protocol, other clients can
connect too (currently untested — reports welcome).

This package is the TypeScript host that Claude talks to over stdio. It needs the
companion **Godot editor addon** (`breakpoint_mcp`) installed in your project to reach
anything beyond the headless-CLI plane — see the repository for the addon and the full
architecture.

## Install

```bash
npx breakpoint-mcp          # run on demand
# or
npm i -g breakpoint-mcp     # install the `breakpoint-mcp` command
```

Requires **Node ≥ 18**. The host targets the `@modelcontextprotocol/sdk` `1.x` line
(the `registerTool({ inputSchema, outputSchema })` + elicitation surface).

## Register with your MCP client

Claude is the primary, tested client. **Claude Code:**

```bash
claude mcp add godot -- npx -y breakpoint-mcp
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "godot": {
      "command": "npx",
      "args": ["-y", "breakpoint-mcp"],
      "env": {
        "GODOT_BIN": "/abs/path/to/Godot",
        "GODOT_PROJECT": "/abs/path/to/your/project"
      }
    }
  }
}
```

Set `GODOT_BIN` if `godot` isn't on your `PATH`. The full environment-variable table
(bridge / LSP / DAP / runtime hosts, ports, and timeouts) and a complete walkthrough are
in the [repository README](https://github.com/jlivingston-Cipher/godot-claude-bridge#configuration-environment-variables)
and the [User Guide](https://github.com/jlivingston-Cipher/godot-claude-bridge/blob/main/docs/USER_GUIDE.md).

Using Cursor, VS Code, Windsurf, or another MCP client? The command is identical — see
the [Compatibility](https://github.com/jlivingston-Cipher/godot-claude-bridge#compatibility)
section for each client's config file and format.

## The addon (required for the editor / runtime planes)

Install the `breakpoint_mcp` editor addon into your Godot project (drop
`addons/breakpoint_mcp/` in and enable it under Project Settings → Plugins). It opens the
loopback servers this host connects to and auto-registers the in-game runtime bridge.
Without it, only the headless-CLI (`godot_*`) plane works.

## Local-first

This bridge is a **local** co-development tool: all four planes talk to `127.0.0.1`, and
screenshots render real frames, so run the host on the same machine as Godot. A remote
deployment can't see a local editor and is limited to the headless subset.

## Security

The host spawns the Godot binary, can run GDScript and a configured local command, and
writes files into your project; destructive tools are confirmation-gated. See the
[security policy](https://github.com/jlivingston-Cipher/godot-claude-bridge/blob/main/SECURITY.md)
for the trust model and how to report a vulnerability.

## License

MIT — see [LICENSE](./LICENSE). Godot, Claude/Anthropic, and the named backend SDKs are
trademarks of their respective owners; Breakpoint MCP is an independent project and is
not affiliated with or endorsed by them.
