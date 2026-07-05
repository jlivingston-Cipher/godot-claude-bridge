#!/usr/bin/env bash
#
# godot-claude-bridge — smoke/validation helper.
# Automates the parts of validation that don't need a GUI editor or Claude.
# The interactive planes (editor bridge, LSP, DAP, runtime) are driven from
# Claude per docs/RUNBOOK.md after this script sets things up.
#
# Requires: Godot 4.4+ on PATH (or $GODOT_BIN), Node 18+, npm with registry access.

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GODOT="${GODOT_BIN:-godot}"
EXAMPLE="$ROOT/example"
ADDON_SRC="$ROOT/addon/addons/claude_bridge"
ADDON_DST="$EXAMPLE/addons/claude_bridge"
fail=0

echo "== 1. Godot version =="
if ! "$GODOT" --version; then
  echo "  ✗ Godot not found. Install Godot 4.4+ or set GODOT_BIN=/path/to/godot"
  fail=1
fi

echo "== 2. Static contract check (no Godot/Node needed) =="
python3 "$ROOT/scripts/contract_check.py" || fail=1

echo "== 3. Install addon into the example project =="
mkdir -p "$EXAMPLE/addons"
rm -rf "$ADDON_DST"
cp -r "$ADDON_SRC" "$ADDON_DST"
echo "  ✓ copied addon -> $ADDON_DST"

echo "== 4. Build the MCP host =="
if ( cd "$ROOT/host" && npm install --no-audit --no-fund && npm run build ); then
  echo "  ✓ host built (host/dist/index.js)"
else
  echo "  ✗ host build failed (needs npm registry access)"
  fail=1
fi

echo "== 5. Import the example project (headless) =="
"$GODOT" --headless --path "$EXAMPLE" --import 2>&1 | tail -n 5 || \
  echo "  (import returned nonzero; often fine on first run)"

echo
if [ "$fail" -eq 0 ]; then
  echo "Automated setup OK. Now do the interactive validation:"
else
  echo "Some automated steps failed (see above). After fixing, do the interactive validation:"
fi
cat <<'EOF'
  1. Open the example project in the Godot editor and enable the Claude Bridge
     plugin (Project > Project Settings > Plugins). Watch the Output panel for
     "[claude_bridge] listening on 127.0.0.1:9080".
  2. Register the host with Claude Code, pointing at the example project:
       claude mcp add godot -- node "REPO/host/dist/index.js"
     with env GODOT_BIN, GODOT_PROJECT="REPO/example".
  3. Follow docs/RUNBOOK.md and run the per-plane checklist.
EOF
exit "$fail"
