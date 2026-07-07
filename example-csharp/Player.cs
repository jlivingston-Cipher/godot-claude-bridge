using Godot;

// Tiny C# script mirroring ../example/player.gd — gives every C# bridge plane
// something concrete to exercise:
//   - GD.Print() output        -> console capture (future C# runtime plane)
//   - Counter property         -> cs_hover / cs_completion; future runtime get/set
//   - TakeDamage()             -> a good breakpoint line for the C# DAP plane (C3),
//                                 and a call target for a future runtime plane
//   - typed members            -> cs_completion / cs_hover / cs_diagnostics (OmniSharp, C2)
//
// `partial` is required by the Godot 4 C# source generators.
public partial class Player : Node2D
{
    public int Counter { get; set; } = 100;

    public override void _Ready()
    {
        GD.Print("[example-csharp] player ready");
    }

    public override void _Process(double delta)
    {
        // Cheap activity so monitors (FPS, etc.) have something to report.
        Counter += 0;
    }

    public int TakeDamage(int amount)
    {
        // Put a breakpoint on the next line to validate the C# DAP plane (C3).
        Counter -= amount;
        GD.Print($"[example-csharp] took {amount} damage, counter now {Counter}");
        return Counter;
    }
}
