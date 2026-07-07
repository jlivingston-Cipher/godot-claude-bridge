# example-csharp — C#/.NET fixture (D4)

The C#/.NET counterpart of [`../example`](../example) (the GDScript fixture). It exists so the
**D4 C#/.NET plane** — OmniSharp (LSP, C2) and the Godot Mono debugger (DAP, C3) — has a real,
minimal C# project to exercise, exactly the way `../example` exercises the GDScript planes.

## Contents
- `Player.cs` — mirrors `../example/player.gd`: a `Counter` property, `_Ready()` / `_Process()`,
  and `TakeDamage(int)` (a good breakpoint line and a call target).
- `Main.tscn` — root node **Main** (`Node2D`) running `Player.cs`, mirroring `../example/main.tscn`.
- `ExampleCsharp.csproj` / `.sln` — the .NET project. `Godot.NET.Sdk/4.7.0`, `net8.0`.
- `project.godot` — `[dotnet] project/assembly_name="ExampleCsharp"`, `gl_compatibility` renderer
  (CI has no GPU).

## Deliberately no claude_bridge addon
Unlike `../example`, this project does **not** bundle the GDScript `claude_bridge` addon. The C#
plane is served by OmniSharp and the Mono debugger, which are independent of the GDScript
editor/runtime bridge — and leaving the addon out avoids adding a third `ADDON_VERSION` copy that
`scripts/contract_check.py` would have to track.

## Requirements (not yet installed by this scaffold)
A **Mono/.NET Godot** build (not the standard build) + the **.NET 8 SDK**. See
[`../docs/D4_CSHARP_PLAN.md`](../docs/D4_CSHARP_PLAN.md) for the full C1→C3 plan and the exact
version-alignment rules.

## Quick local smoke (once the toolchain is installed)
```bash
GODOT_MONO=/path/to/Godot_mono            # a .NET/Mono build, NOT the standard build
dotnet build example-csharp               # OmniSharp-readiness: the project builds standalone
"$GODOT_MONO" --headless --path example-csharp --import --build-solutions --quit-after 200
"$GODOT_MONO" --headless --path example-csharp --quit-after 200   # expect: "[example-csharp] player ready"
```
