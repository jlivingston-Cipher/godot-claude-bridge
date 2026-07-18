using Godot;

public partial class DemoCombat : Node2D
{
    public int Hp { get; set; } = 100;
    public int Armor { get; set; } = 5;
    public bool HealedEver { get; set; } = false;

    private Label _label;

    public override void _Ready()
    {
        _label = GetNode<Label>("Label");
        GD.Print($"[demo] combat start, hp={Hp}");
        foreach (int d in new[] { 3, 20, 4, 90 }) TakeHit(d);
    }

    public int TakeHit(int damage)
    {
        int effective = damage - Armor;      // BUG: no clamp
        int before = Hp;
        Hp -= effective;                     // <-- BREAKPOINT HERE (line 22)
        if (Hp > before) HealedEver = true;
        GD.Print($"[demo] hit for {damage} (effective {effective}), hp now {Hp}");
        if (Hp <= 0) { _label.Text = "YOU DIED"; GD.Print("[demo] YOU DIED"); }
        return Hp;
    }
}
