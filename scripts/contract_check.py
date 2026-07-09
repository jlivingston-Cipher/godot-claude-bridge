#!/usr/bin/env python3
"""Static contract check for breakpoint-mcp.

Verifies, without running Godot or Node, that the three layers agree:
  1. every bridge method the host calls exists in a GDScript dispatcher
  2. every GDScript dispatch method is reachable from the host (orphan scan)
  3. registered MCP tool names are unique
  4. the tool catalog lists exactly the registered tools
  5. every fenced ```json block in the catalog is valid JSON

Exit code 0 = all hard checks pass; 1 = a hard check failed.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ADDON = ROOT / "addons/breakpoint_mcp"
TOOLS = ROOT / "host/src/tools"
CATALOG = ROOT / "docs/TOOL_CATALOG.md"

errors: list[str] = []
warnings: list[str] = []


def dispatch_methods(gd_file: Path, func_names: list[str]) -> set[str]:
    """Extract string case-labels inside the named dispatch function(s)."""
    text = gd_file.read_text()
    methods: set[str] = set()
    for fn in func_names:
        m = re.search(rf"func {re.escape(fn)}\(", text)
        if not m:
            continue
        start = m.end()
        nxt = re.search(r"\nfunc ", text[start:])
        body = text[start: start + (nxt.start() if nxt else len(text))]
        # Case labels look like:  "method.name":  on their own line.
        for lm in re.finditer(r'^\s*"([a-z_][a-z_.]*)":\s*$', body, re.M):
            methods.add(lm.group(1))
    return methods


def host_bridge_calls(ts_files: list[Path]) -> set[str]:
    """String methods passed to call("..") or *.request("..") in given files."""
    calls: set[str] = set()
    for f in ts_files:
        text = f.read_text()
        for m in re.finditer(r'\bcall\(\s*"([a-z_][a-z_.]*)"', text):
            calls.add(m.group(1))
        for m in re.finditer(r'\.request\(\s*"([a-z_][a-z_.]*)"', text):
            calls.add(m.group(1))
    return calls


def registered_tools() -> list[str]:
    names: list[str] = []
    for f in sorted(TOOLS.glob("*.ts")):
        text = f.read_text()
        # Plain tools: server.registerTool("name", ...)
        for m in re.finditer(r'registerTool\(\s*"([a-z_]+)"', text):
            names.append(m.group(1))
        # Task-model tools (D2): registerTaskTool(server, "name", ...)
        for m in re.finditer(r'registerTaskTool\(\s*\w+\s*,\s*"([a-z_]+)"', text):
            names.append(m.group(1))
    return names


def catalog_index_tools() -> set[str]:
    text = CATALOG.read_text()
    tools: set[str] = set()
    # Rows of the form: | `tool_name` | ... | ... | ... |
    for m in re.finditer(r"^\|\s*`([a-z_]+)`\s*\|", text, re.M):
        tools.add(m.group(1))
    return tools


def catalog_json_blocks() -> list[str]:
    text = CATALOG.read_text()
    return re.findall(r"```json\n(.*?)```", text, re.S)


# --- 1 & 2: GDScript dispatch <-> host calls -------------------------------
editor_methods = dispatch_methods(ADDON / "operations.gd", ["dispatch"])
runtime_methods = dispatch_methods(ADDON / "runtime_bridge.gd", ["_dispatch"])
gd_all = editor_methods | runtime_methods
host_calls = host_bridge_calls([TOOLS / "editor.ts", TOOLS / "runtime.ts", TOOLS / "resources.ts", TOOLS / "assetgen.ts", TOOLS / "netcode.ts"])

missing_in_gd = sorted(c for c in host_calls if c not in gd_all)
if missing_in_gd:
    errors.append(f"Host calls bridge methods with no GDScript handler: {missing_in_gd}")

orphans = sorted(m for m in gd_all if m not in host_calls and m != "ping")
if orphans:
    warnings.append(f"GDScript dispatch methods never called by host (ok if intentional): {orphans}")

# --- 3: tool-name uniqueness -----------------------------------------------
tools = registered_tools()
dupes = sorted({t for t in tools if tools.count(t) > 1})
if dupes:
    errors.append(f"Duplicate registerTool names: {dupes}")

# --- 4: catalog <-> code ----------------------------------------------------
tool_set = set(tools)
cat_tools = catalog_index_tools()
# Managed-process/editor/etc. tools should all be in the catalog index.
not_in_catalog = sorted(tool_set - cat_tools)
if not_in_catalog:
    errors.append(f"Registered tools missing from catalog index: {not_in_catalog}")
in_catalog_not_code = sorted(cat_tools - tool_set)
if in_catalog_not_code:
    warnings.append(f"Catalog lists tools not found in code (may be planned/renamed): {in_catalog_not_code}")

# --- 5: JSON lint -----------------------------------------------------------
bad_json = 0
for i, block in enumerate(catalog_json_blocks()):
    try:
        json.loads(block)
    except json.JSONDecodeError as e:
        bad_json += 1
        errors.append(f"Invalid JSON block #{i+1} in catalog: {e}")

# --- report -----------------------------------------------------------------
print("=== breakpoint-mcp static contract check ===")
print(f"GDScript editor methods : {len(editor_methods)}")
print(f"GDScript runtime methods: {len(runtime_methods)}")
print(f"Host bridge calls       : {len(host_calls)}")
print(f"Registered MCP tools    : {len(tools)} (unique: {len(tool_set)})")
print(f"Catalog index tools     : {len(cat_tools)}")
print(f"Catalog JSON blocks     : {len(catalog_json_blocks())} ({bad_json} invalid)")
print()
for w in warnings:
    print("WARN:", w)
for e in errors:
    print("FAIL:", e)
if not errors:
    print("\nALL HARD CHECKS PASSED ✅")
sys.exit(1 if errors else 0)
