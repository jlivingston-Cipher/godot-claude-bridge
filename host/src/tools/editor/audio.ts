import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gate } from "../../confirm.js";
import type { EditorCall } from "./common.js";

/** AudioStreamPlayer nodes + audio bus layout / effects. */
export function registerAudioTools(server: McpServer, call: EditorCall): void {
  server.registerTool(
    "audio_player_create",
    {
      title: "Create audio player",
      description:
        "Add an AudioStreamPlayer / AudioStreamPlayer2D / AudioStreamPlayer3D node under a parent in the edited scene (undoable). `dim` selects \"none\" (default, non-positional AudioStreamPlayer), \"2d\", or \"3d\". Optional initial stream_path (res:// AudioStream), autoplay, volume_db, bus. In-scene and undoable — not gated.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        dim: z.enum(["none", "2d", "3d"]).optional().describe("Player kind: \"none\" (default, AudioStreamPlayer), \"2d\" (AudioStreamPlayer2D), or \"3d\" (AudioStreamPlayer3D)"),
        name: z.string().optional().describe("Node name (default matches the player class)"),
        stream_path: z.string().optional().describe("res:// path to an AudioStream to assign to the new player"),
        autoplay: z.boolean().optional().describe("Whether the player starts automatically on scene load"),
        volume_db: z.number().optional().describe("Player volume in dB"),
        bus: z.string().optional().describe("Target audio bus name (default \"Master\")"),
      },
    },
    async ({ parent_path, dim, name, stream_path, autoplay, volume_db, bus }) => {
      const params: Record<string, unknown> = { parent_path };
      if (dim !== undefined) params.dim = dim;
      if (name !== undefined) params.name = name;
      if (stream_path !== undefined) params.stream_path = stream_path;
      if (autoplay !== undefined) params.autoplay = autoplay;
      if (volume_db !== undefined) params.volume_db = volume_db;
      if (bus !== undefined) params.bus = bus;
      return call("audio.player_create", params);
    },
  );

  server.registerTool(
    "audio_set_stream",
    {
      title: "Set audio stream",
      description:
        "Load an AudioStream from a res:// path and assign it as stream on an AudioStreamPlayer/2D/3D in the edited scene (undoable). In-scene and undoable — not gated.",
      inputSchema: {
        path: z.string().describe("AudioStreamPlayer/2D/3D node path relative to the scene root"),
        stream_path: z.string().describe("res:// path to an AudioStream resource"),
      },
    },
    async ({ path, stream_path }) => call("audio.set_stream", { path, stream_path }),
  );

  server.registerTool(
    "audio_bus_add",
    {
      title: "Add audio bus",
      description:
        "Add a bus to the project's global AudioServer layout, optionally naming it, positioning it (at_position), and setting its send bus. DESTRUCTIVE (project-wide audio state) — gated by confirmation.",
      inputSchema: {
        name: z.string().optional().describe("Name for the new bus"),
        at_position: z.number().optional().describe("Insert index (default -1 = append at end)"),
        send: z.string().optional().describe("Name of the bus this bus sends its output to"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ name, at_position, send, confirm }) => {
      const blocked = await gate(server, confirm, `Add audio bus${name ? ` "${name}"` : ""}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = {};
      if (name !== undefined) params.name = name;
      if (at_position !== undefined) params.at_position = at_position;
      if (send !== undefined) params.send = send;
      return call("audio.bus_add", params);
    },
  );

  server.registerTool(
    "audio_bus_add_effect",
    {
      title: "Add audio bus effect",
      description:
        "Instantiate an AudioEffect subclass (by class name, e.g. \"AudioEffectReverb\") and add it to a named bus on the global AudioServer, optionally at a position in the bus's effect chain. DESTRUCTIVE (project-wide audio state) — gated by confirmation.",
      inputSchema: {
        bus: z.string().describe("Target bus name"),
        effect: z.string().describe("AudioEffect subclass name, e.g. \"AudioEffectReverb\", \"AudioEffectDelay\""),
        at_position: z.number().optional().describe("Insert index within the bus's effect chain (default -1 = append)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ bus, effect, at_position, confirm }) => {
      const blocked = await gate(server, confirm, `Add ${effect} to audio bus "${bus}"`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { bus, effect };
      if (at_position !== undefined) params.at_position = at_position;
      return call("audio.bus_add_effect", params);
    },
  );

  server.registerTool(
    "audio_bus_set_volume",
    {
      title: "Set audio bus volume",
      description:
        "Set the volume (in dB) of a named bus on the global AudioServer. DESTRUCTIVE (project-wide audio state) — gated by confirmation.",
      inputSchema: {
        bus: z.string().describe("Bus name"),
        volume_db: z.number().describe("Volume in dB"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ bus, volume_db, confirm }) => {
      const blocked = await gate(server, confirm, `Set audio bus "${bus}" volume to ${volume_db} dB`);
      if (blocked) return blocked;
      return call("audio.bus_set_volume", { bus, volume_db });
    },
  );

  server.registerTool(
    "audio_set_bus_layout",
    {
      title: "Save audio bus layout",
      description:
        "Save the current AudioServer bus layout (buses, effects, volumes) to a .tres resource on disk (default res://default_bus_layout.tres) via generate_bus_layout + ResourceSaver.save. DESTRUCTIVE (writes a file) — gated by confirmation.",
      inputSchema: {
        to_path: z.string().optional().describe("Destination res:// path (default res://default_bus_layout.tres)"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ to_path, confirm }) => {
      const blocked = await gate(server, confirm, `Save audio bus layout to ${to_path ?? "res://default_bus_layout.tres"}`);
      if (blocked) return blocked;
      return call("audio.set_bus_layout", to_path !== undefined ? { to_path } : {});
    },
  );
}
