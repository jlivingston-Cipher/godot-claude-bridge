import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { gate } from "../../confirm.js";
import type { EditorCall } from "./common.js";

/** TileSet authoring (disk-backed, gated) + TileMapLayer cell painting. */
export function registerTileTools(server: McpServer, call: EditorCall): void {
  server.registerTool(
    "tileset_create",
    {
      title: "Create TileSet",
      description:
        "Instantiate a TileSet resource and save it as a new .tres file. DESTRUCTIVE (writes a file) — gated by confirmation. tile_size is the base grid cell size in pixels (default 16×16).",
      inputSchema: {
        to_path: z.string().describe("Destination res:// path, e.g. res://tiles/world.tres"),
        tile_size: z.array(z.number().int()).optional().describe("Base tile grid size [x, y] in pixels (default [16, 16])"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ to_path, tile_size, confirm }) => {
      const blocked = await gate(server, confirm, `Create TileSet resource at ${to_path}`);
      if (blocked) return blocked;
      return call("tileset.create", tile_size !== undefined ? { to_path, tile_size } : { to_path });
    },
  );

  server.registerTool(
    "tileset_add_source",
    {
      title: "Add TileSet atlas source",
      description:
        "Add a TileSetAtlasSource (backed by a Texture2D) to a TileSet .tres and re-save. DESTRUCTIVE (writes a file) — gated by confirmation. texture_region_size defaults to the TileSet's tile_size; source_id -1 auto-assigns.",
      inputSchema: {
        tileset_path: z.string().describe("TileSet res:// .tres path"),
        texture_path: z.string().describe("Texture2D res:// path used as the atlas image"),
        texture_region_size: z.array(z.number().int()).optional().describe("Atlas cell size [x, y] in pixels (default = tile_size)"),
        source_id: z.number().int().optional().describe("Explicit source id, or -1 to auto-assign (default -1)"),
        margins: z.array(z.number().int()).optional().describe("Atlas margins [x, y] in pixels"),
        separation: z.array(z.number().int()).optional().describe("Atlas separation [x, y] in pixels"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ tileset_path, texture_path, texture_region_size, source_id, margins, separation, confirm }) => {
      const blocked = await gate(server, confirm, `Add atlas source (${texture_path}) to TileSet ${tileset_path}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { tileset_path, texture_path };
      if (texture_region_size !== undefined) params.texture_region_size = texture_region_size;
      if (source_id !== undefined) params.source_id = source_id;
      if (margins !== undefined) params.margins = margins;
      if (separation !== undefined) params.separation = separation;
      return call("tileset.add_source", params);
    },
  );

  server.registerTool(
    "tileset_add_tile",
    {
      title: "Add TileSet tile",
      description:
        "Create a tile at atlas_coords in an atlas source of a TileSet .tres and re-save. DESTRUCTIVE (writes a file) — gated by confirmation. size is measured in atlas cells (default [1, 1]).",
      inputSchema: {
        tileset_path: z.string().describe("TileSet res:// .tres path"),
        source_id: z.number().int().describe("Atlas source id within the TileSet"),
        atlas_coords: z.array(z.number().int()).describe("Tile atlas coordinates [x, y] (in cells)"),
        size: z.array(z.number().int()).optional().describe("Tile size in atlas cells [x, y] (default [1, 1])"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ tileset_path, source_id, atlas_coords, size, confirm }) => {
      const blocked = await gate(server, confirm, `Add tile ${JSON.stringify(atlas_coords)} to source ${source_id} in ${tileset_path}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { tileset_path, source_id, atlas_coords };
      if (size !== undefined) params.size = size;
      return call("tileset.add_tile", params);
    },
  );

  server.registerTool(
    "tileset_set_tile_collision",
    {
      title: "Set tile collision polygon",
      description:
        "Add a collision polygon to a tile on a TileSet physics layer and re-save. DESTRUCTIVE (writes a file) — gated by confirmation. Physics layers are created as needed. polygon is an array of [x, y] points (>= 3), tile-local pixels.",
      inputSchema: {
        tileset_path: z.string().describe("TileSet res:// .tres path"),
        source_id: z.number().int().describe("Atlas source id within the TileSet"),
        atlas_coords: z.array(z.number().int()).describe("Tile atlas coordinates [x, y] (in cells)"),
        polygon: z.array(z.array(z.number())).describe("Collision polygon points [[x, y], ...] (>= 3), tile-local pixels"),
        physics_layer: z.number().int().optional().describe("TileSet physics layer index (default 0; created if missing)"),
        one_way: z.boolean().optional().describe("Mark the polygon as one-way collision"),
        confirm: z.boolean().optional().describe("Auto-approve this destructive action (skip the confirmation prompt)"),
      },
    },
    async ({ tileset_path, source_id, atlas_coords, polygon, physics_layer, one_way, confirm }) => {
      const blocked = await gate(server, confirm, `Set collision on tile ${JSON.stringify(atlas_coords)} in ${tileset_path}`);
      if (blocked) return blocked;
      const params: Record<string, unknown> = { tileset_path, source_id, atlas_coords, polygon };
      if (physics_layer !== undefined) params.physics_layer = physics_layer;
      if (one_way !== undefined) params.one_way = one_way;
      return call("tileset.set_tile_collision", params);
    },
  );

  server.registerTool(
    "tilemaplayer_create",
    {
      title: "Create TileMapLayer",
      description:
        "Add a TileMapLayer node under a parent in the edited scene (undoable), optionally binding a TileSet .tres so cells can be painted. In-scene and undoable — not gated.",
      inputSchema: {
        parent_path: z.string().describe("Parent node path relative to the scene root; \".\" for the root"),
        name: z.string().optional().describe("Node name (default \"TileMapLayer\")"),
        tileset_path: z.string().optional().describe("TileSet res:// .tres path to bind as tile_set (e.g. from tileset_create)"),
      },
    },
    async ({ parent_path, name, tileset_path }) => {
      const params: Record<string, unknown> = { parent_path };
      if (name !== undefined) params.name = name;
      if (tileset_path !== undefined) params.tileset_path = tileset_path;
      return call("tilemaplayer.create", params);
    },
  );

  server.registerTool(
    "tilemap_set_cell",
    {
      title: "Set TileMapLayer cell",
      description:
        "Paint a single cell on a TileMapLayer (undoable). source_id -1 erases the cell (default). atlas_coords defaults to [0, 0]; alternative defaults to 0.",
      inputSchema: {
        path: z.string().describe("TileMapLayer node path relative to the scene root"),
        coords: z.array(z.number().int()).describe("Cell coordinates [x, y] (in cells)"),
        source_id: z.number().int().optional().describe("Atlas source id from the bound TileSet, or -1 to erase (default -1)"),
        atlas_coords: z.array(z.number().int()).optional().describe("Tile atlas coordinates [x, y] within the source (default [0, 0])"),
        alternative: z.number().int().optional().describe("Alternative tile id (default 0)"),
      },
    },
    async ({ path, coords, source_id, atlas_coords, alternative }) => {
      const params: Record<string, unknown> = { path, coords };
      if (source_id !== undefined) params.source_id = source_id;
      if (atlas_coords !== undefined) params.atlas_coords = atlas_coords;
      if (alternative !== undefined) params.alternative = alternative;
      return call("tilemap.set_cell", params);
    },
  );

  server.registerTool(
    "tilemap_set_cells_rect",
    {
      title: "Fill TileMapLayer cells (rect)",
      description:
        "Paint every cell in a rectangular region of a TileMapLayer with one tile (undoable, one action). source_id -1 clears the region. Capped at 65536 cells; split larger fills across calls.",
      inputSchema: {
        path: z.string().describe("TileMapLayer node path relative to the scene root"),
        rect: z.array(z.number().int()).describe("Region [x, y, width, height] in cells (width/height > 0)"),
        source_id: z.number().int().optional().describe("Atlas source id from the bound TileSet, or -1 to clear (default -1)"),
        atlas_coords: z.array(z.number().int()).optional().describe("Tile atlas coordinates [x, y] within the source (default [0, 0])"),
        alternative: z.number().int().optional().describe("Alternative tile id (default 0)"),
      },
    },
    async ({ path, rect, source_id, atlas_coords, alternative }) => {
      const params: Record<string, unknown> = { path, rect };
      if (source_id !== undefined) params.source_id = source_id;
      if (atlas_coords !== undefined) params.atlas_coords = atlas_coords;
      if (alternative !== undefined) params.alternative = alternative;
      return call("tilemap.set_cells_rect", params);
    },
  );

  server.registerTool(
    "tilemap_get_cell",
    {
      title: "Get TileMapLayer cell",
      description:
        "Read one cell of a TileMapLayer. An empty cell reads back as source_id -1, atlas_coords [-1, -1], alternative 0 (empty = true).",
      inputSchema: {
        path: z.string().describe("TileMapLayer node path relative to the scene root"),
        coords: z.array(z.number().int()).describe("Cell coordinates [x, y] (in cells)"),
      },
    },
    async ({ path, coords }) => call("tilemap.get_cell", { path, coords }),
  );

  server.registerTool(
    "tilemap_clear",
    {
      title: "Clear TileMapLayer",
      description:
        "Remove every painted cell from a TileMapLayer (undoable — prior cells are restored on undo). Returns the number of cells cleared.",
      inputSchema: {
        path: z.string().describe("TileMapLayer node path relative to the scene root"),
      },
    },
    async ({ path }) => call("tilemap.clear", { path }),
  );
}
