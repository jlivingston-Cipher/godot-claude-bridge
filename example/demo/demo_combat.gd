extends Node2D

var hp: int = 100
var armor: int = 5
var healed_ever: bool = false   # verification hook: did HP ever go UP on a hit?

@onready var _label: Label = $Label

func _ready() -> void:
	print("[demo] combat start, hp=%d" % hp)
	for d in [3, 20, 4, 90]:
		take_hit(d)

func take_hit(damage: int) -> int:
	var effective := damage - armor          # BUG: no clamp -> light hits go negative -> healing (fix: maxi(0, ...))
	var before := hp
	hp -= effective                          # <-- BREAKPOINT HERE (line 17)
	if hp > before:
		healed_ever = true
	print("[demo] hit for %d (effective %d), hp now %d" % [damage, effective, hp])
	if hp <= 0:
		_label.text = "YOU DIED"
		print("[demo] YOU DIED")
	return hp
