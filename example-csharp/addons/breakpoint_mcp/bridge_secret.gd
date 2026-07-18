@tool
extends RefCounted
## Shared loopback-bridge auth: a per-project secret + a constant-time compare.
##
## The secret is a 64-char hex string minted once per project and stored at
## res://.godot/breakpoint_mcp.secret. The .godot dir is engine-managed and, by
## Godot convention, git-ignored — so the secret never lands in version control.
## Both bridges in a project (the editor bridge_server and the runtime autoload)
## read the SAME file, and the Node host reads it too, from
## <projectPath>/.godot/breakpoint_mcp.secret — so all three agree with ZERO user
## configuration. Host-side an env override (BREAKPOINT_BRIDGE_SECRET /
## BREAKPOINT_RUNTIME_SECRET) wins, for advanced / host-launched-child cases.
##
## Why: the loopback bind (127.0.0.1) is the only access control otherwise, so any
## OTHER local process on a shared machine could drive the bridge — including the
## destructive editor ops that are elicitation-gated in the HOST. A direct socket
## bypasses that host gate; requiring this handshake moves the gate's teeth to the
## addon. Defense-in-depth, not a remote-RCE fix (loopback already blocks the net).

const SECRET_PATH := "res://.godot/breakpoint_mcp.secret"


## Return the shared secret, minting + persisting a fresh one if none exists.
## Returns "" ONLY on an unrecoverable IO error — the caller then runs WITHOUT
## auth (logging a warning) rather than bricking the bridge.
static func load_or_mint() -> String:
	if FileAccess.file_exists(SECRET_PATH):
		var rf := FileAccess.open(SECRET_PATH, FileAccess.READ)
		if rf != null:
			var existing := rf.get_as_text().strip_edges()
			rf = null
			if existing.length() > 0:
				return existing
	# Mint 32 cryptographically-random bytes -> 64 hex chars.
	var crypto := Crypto.new()
	var hex := crypto.generate_random_bytes(32).hex_encode()
	var godot_dir := ProjectSettings.globalize_path("res://.godot")
	if not DirAccess.dir_exists_absolute(godot_dir):
		DirAccess.make_dir_recursive_absolute(godot_dir)
	var wf := FileAccess.open(SECRET_PATH, FileAccess.WRITE)
	if wf == null:
		return ""
	wf.store_string(hex)
	wf = null
	return hex


## Constant-time equality over the UTF-8 bytes of two strings. Folds any length
## difference into the result and always scans the longer input, so it never
## short-circuits on the first differing byte (no timing side channel on the
## secret's content). The secret's length is fixed (64) and not itself sensitive.
static func const_time_eq(a: String, b: String) -> bool:
	var ab := a.to_utf8_buffer()
	var bb := b.to_utf8_buffer()
	var diff: int = ab.size() ^ bb.size()
	var n: int = ab.size() if ab.size() > bb.size() else bb.size()
	for i in n:
		var x: int = ab[i] if i < ab.size() else 0
		var y: int = bb[i] if i < bb.size() else 0
		diff |= x ^ y
	return diff == 0
