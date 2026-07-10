#!/usr/bin/env python3
"""Static contract check for breakpoint-mcp.

Verifies, without running Godot or Node, that the three layers agree:
  1. every bridge method the host calls exists in a GDScript dispatcher
  2. every GDScript dispatch method is reachable from the host (orphan scan)
  3. registered MCP tool names are unique
  4. the tool catalog lists exactly the registered tools
  5. every fenced ```json block in the catalog is valid JSON
  6. NAME parity is not enough — SHAPE parity too: for every tool the catalog
     documents with an Input block, its documented params match the tool's
     `inputSchema` param names (shared schemas, `{...spread}`, and the universal
     `confirm` gate param are resolved/ignored)
  7. every field a tool pins in `host/src/schemas.ts` `outputSchemas` is
     documented in that tool's catalog Output block (return-shape parity)
  8. `outputSchemas` hygiene: no schema entry names a tool that does not exist

Exit code 0 = all hard checks pass; 1 = a hard check failed.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ADDON = ROOT / "addons/breakpoint_mcp"
TOOLS = ROOT / "host/src/tools"
SCHEMAS = ROOT / "host/src/schemas.ts"
CATALOG = ROOT / "docs/TOOL_CATALOG.md"

# The universal elicitation-gate bypass param. It is added to every destructive
# tool's inputSchema by convention and documented once (not per-tool in the
# catalog Input blocks), so it is excluded from per-tool param-shape parity.
IGNORED_PARAMS = {"confirm"}

# Tools that deliberately return image content with NO structuredContent, so they
# carry no outputSchema and have no Output block to compare.
NO_OUTPUT_SCHEMA_OK = {"screenshot_editor", "runtime_screenshot"}

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
    for f in sorted(TOOLS.rglob("*.ts")):
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


# --- shape helpers: brace-matching + top-level key extraction ---------------
def _match_braces(text: str, open_idx: int) -> int:
    """Index just past the '}' matching the '{'/'['/'(' at `open_idx`.
    Tracks nesting and skips string literals so brackets inside strings/args
    don't confuse the depth count."""
    depth, i, n = 0, open_idx, len(text)
    while i < n:
        c = text[i]
        if c in "\"'":
            q = c
            i += 1
            while i < n and text[i] != q:
                if text[i] == "\\":
                    i += 1
                i += 1
        elif c in "{[(":
            depth += 1
        elif c in "}])":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


def _strip_comments(body: str) -> str:
    """Remove `//` line and `/* */` block comments, respecting string and
    backtick literals, so commented-out text inside an object literal can't be
    misread as a key or spread. Line comments keep their trailing newline;
    block comments collapse to a single space (so neighbouring tokens don't
    fuse)."""
    out: list[str] = []
    i, n = 0, len(body)
    while i < n:
        c = body[i]
        if c in "\"'`":
            q = c
            out.append(c)
            i += 1
            while i < n and body[i] != q:
                if body[i] == "\\" and i + 1 < n:
                    out.append(body[i])
                    out.append(body[i + 1])
                    i += 2
                    continue
                out.append(body[i])
                i += 1
            if i < n:
                out.append(body[i])  # closing quote
                i += 1
            continue
        if c == "/" and i + 1 < n and body[i + 1] == "/":
            i += 2
            while i < n and body[i] != "\n":
                i += 1
            continue  # leave the newline for the next iteration
        if c == "/" and i + 1 < n and body[i + 1] == "*":
            i += 2
            while i + 1 < n and not (body[i] == "*" and body[i + 1] == "/"):
                i += 1
            i += 2  # skip the closing */
            out.append(" ")
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _top_level_keys(body: str) -> set[str]:
    """`identifier:` keys at depth 0 of an object-literal body (between braces)."""
    body = _strip_comments(body)
    keys: set[str] = set()
    depth, i, n, tok = 0, 0, len(body), ""
    while i < n:
        c = body[i]
        if c in "\"'":
            q = c
            i += 1
            while i < n and body[i] != q:
                if body[i] == "\\":
                    i += 1
                i += 1
            i += 1
            continue
        if c in "{[(":
            depth += 1
        elif c in "}])":
            depth -= 1
        elif depth == 0 and c == ":":
            km = re.search(r"([A-Za-z_][A-Za-z0-9_]*)\s*$", tok)
            if km:
                keys.add(km.group(1))
            tok = ""
            i += 1
            continue
        elif depth == 0 and c == ",":
            tok = ""
            i += 1
            continue
        tok += c
        i += 1
    return keys


def _top_level_spreads(body: str) -> set[str]:
    """`...ident` object-spread names at depth 0 of an object-literal body."""
    body = _strip_comments(body)
    spreads: set[str] = set()
    depth, i, n = 0, 0, len(body)
    while i < n:
        c = body[i]
        if c in "\"'":
            q = c
            i += 1
            while i < n and body[i] != q:
                if body[i] == "\\":
                    i += 1
                i += 1
            i += 1
            continue
        if c in "{[(":
            depth += 1
        elif c in "}])":
            depth -= 1
        elif depth == 0 and body[i : i + 3] == "...":
            sm = re.match(r"\.\.\.([A-Za-z_][A-Za-z0-9_]*)", body[i:])
            if sm:
                spreads.add(sm.group(1))
        i += 1
    return spreads


def _file_const_shapes(text: str) -> dict[str, set[str]]:
    """`const NAME[: type] = { ... }` object literals in one file -> their
    top-level keys. Resolves `inputSchema: sharedSchema` refs / `{ ...sharedSchema }`
    and the shared `outputSchemas` envelopes (e.g. `const netcodeScaffold: z.ZodRawShape = {…}`).
    Only bare `= {` object literals are captured; `= z.object({…})` is skipped
    (its shape lives inside the call, not at the tool-entry level)."""
    out: dict[str, set[str]] = {}
    for m in re.finditer(r"const\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=\n]+)?=\s*\{", text):
        brace = text.index("{", m.end() - 1)
        out[m.group(1)] = _top_level_keys(text[brace + 1 : _match_braces(text, brace) - 1])
    return out


def input_schema_shapes() -> dict[str, set[str]]:
    """tool name -> set of inputSchema param names (shared-schema refs and
    `{...spread}` resolved; `confirm` excluded). Each tool's inputSchema is
    bounded to its own registerTool/registerTaskTool call to avoid bleeding
    into the next tool's schema."""
    shapes: dict[str, set[str]] = {}
    for f in sorted(TOOLS.rglob("*.ts")):
        text = f.read_text()
        consts = _file_const_shapes(text)
        regs = list(re.finditer(r'register(?:Task)?Tool\(\s*(?:\w+\s*,\s*)?"([a-z_]+)"', text))
        for idx, m in enumerate(regs):
            name = m.group(1)
            end = regs[idx + 1].start() if idx + 1 < len(regs) else len(text)
            window = text[m.end() : end]
            im = re.search(r"inputSchema:\s*", window)
            if not im:
                continue
            rest = window[im.end() :]
            keys: set[str] = set()
            if rest[:1] == "{":
                body = rest[1 : _match_braces(rest, 0) - 1]
                keys |= _top_level_keys(body)
                for sp in _top_level_spreads(body):
                    keys |= consts.get(sp, set())
            else:
                idm = re.match(r"([A-Za-z_][A-Za-z0-9_]*)", rest)
                if idm:
                    keys |= consts.get(idm.group(1), set())
            shapes[name] = keys - IGNORED_PARAMS
    return shapes


def output_schema_shapes() -> dict[str, set[str]]:
    """tool name -> set of field names it pins in schemas.ts `outputSchemas`.

    Handles both entry forms the file uses: inline `tool: { …fields… }` and the
    shared-envelope refs spread via IIFEs — `...(() => { const env = {…}; return
    { tool_a: env, tool_b: env }; })()`. A tool's ZodRawShape value is always
    either a `{` object literal or a bare shared-const identifier (never `z.x`),
    so scanning the region for those two entry forms is unambiguous."""
    text = SCHEMAS.read_text()
    m = re.search(r"export const outputSchemas[^=]*=\s*\{", text)
    if not m:
        return {}
    start = text.index("{", m.end() - 1)
    region = text[start : _match_braces(text, start)]
    consts = _file_const_shapes(text)
    shapes: dict[str, set[str]] = {}
    # inline entries: `tool: { … }`
    for em in re.finditer(r"(?m)^\s+([a-z_][a-z0-9_]*)\s*:\s*\{", region):
        brace = em.end() - 1
        shapes[em.group(1)] = _top_level_keys(region[brace + 1 : _match_braces(region, brace) - 1])
    # shared-envelope refs: `tool: envelopeConst,`
    for em in re.finditer(r"(?m)^\s+([a-z_][a-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*,", region):
        if em.group(2) in consts:
            shapes[em.group(1)] = consts[em.group(2)]
    return shapes


def catalog_shapes() -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """Per-tool documented Input/Output property names from the catalog's
    `**Input**` / `**Output**` JSON blocks. `confirm` excluded from inputs."""
    text = CATALOG.read_text()
    parts = re.split(r"^###\s+`([a-z_]+)`", text, flags=re.M)
    inputs: dict[str, set[str]] = {}
    outputs: dict[str, set[str]] = {}
    for i in range(1, len(parts), 2):
        name, body = parts[i], parts[i + 1]
        for label, bucket in (("Input", inputs), ("Output", outputs)):
            lm = re.search(rf"\*\*{label}\*\*\s*\n```json\n(.*?)```", body, re.S)
            if not lm:
                continue
            try:
                props = json.loads(lm.group(1)).get("properties")
            except json.JSONDecodeError:
                continue
            if isinstance(props, dict):
                bucket[name] = set(props.keys())
    for name in inputs:
        inputs[name] -= IGNORED_PARAMS
    return inputs, outputs


# --- 1 & 2: GDScript dispatch <-> host calls -------------------------------
editor_methods = dispatch_methods(ADDON / "operations.gd", ["dispatch"])
runtime_methods = dispatch_methods(ADDON / "runtime_bridge.gd", ["_dispatch"])
gd_all = editor_methods | runtime_methods
host_calls = host_bridge_calls([*sorted((TOOLS / "editor").glob("*.ts")), TOOLS / "runtime.ts", TOOLS / "resources.ts", TOOLS / "assetgen.ts", TOOLS / "netcode.ts", TOOLS / "backend.ts"])

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

# --- 6: input SHAPE parity (inputSchema params <-> catalog Input) -----------
code_inputs = input_schema_shapes()
cat_inputs, cat_outputs = catalog_shapes()
input_comparable = sorted(set(code_inputs) & set(cat_inputs))
for name in input_comparable:
    code_only = sorted(code_inputs[name] - cat_inputs[name])
    doc_only = sorted(cat_inputs[name] - code_inputs[name])
    if code_only or doc_only:
        errors.append(
            f"Input shape drift for `{name}`: params in code not documented={code_only}, "
            f"documented but not in code={doc_only}"
        )

# --- 7: output/return SHAPE parity (schemas.ts <-> catalog Output) ----------
code_outputs = output_schema_shapes()
output_comparable = sorted(set(code_outputs) & set(cat_outputs))
for name in output_comparable:
    # schemas.ts pins the REQUIRED envelope (z.object is non-strict), so the
    # catalog may document additional fields; every pinned field must be there.
    undocumented = sorted(code_outputs[name] - cat_outputs[name])
    if undocumented:
        errors.append(
            f"Output shape drift for `{name}`: fields pinned in schemas.ts but "
            f"absent from the catalog Output block={undocumented}"
        )

# --- 8: outputSchemas hygiene (no schema for a non-existent tool) -----------
stale_schemas = sorted(set(code_outputs) - tool_set)
if stale_schemas:
    errors.append(f"schemas.ts outputSchemas names non-existent tools: {stale_schemas}")
missing_output_schema = sorted(tool_set - set(code_outputs) - NO_OUTPUT_SCHEMA_OK)
if missing_output_schema:
    warnings.append(
        f"Registered tools without an outputSchema (success shape unvalidated at "
        f"runtime): {missing_output_schema}"
    )

# --- report -----------------------------------------------------------------
print("=== breakpoint-mcp static contract check ===")
print(f"GDScript editor methods : {len(editor_methods)}")
print(f"GDScript runtime methods: {len(runtime_methods)}")
print(f"Host bridge calls       : {len(host_calls)}")
print(f"Registered MCP tools    : {len(tools)} (unique: {len(tool_set)})")
print(f"Catalog index tools     : {len(cat_tools)}")
print(f"Catalog JSON blocks     : {len(catalog_json_blocks())} ({bad_json} invalid)")
print(f"Input shapes            : {len(code_inputs)} parsed · {len(input_comparable)} checked vs catalog")
print(f"Output shapes           : {len(code_outputs)} in schemas.ts · {len(output_comparable)} checked vs catalog")
print()
for w in warnings:
    print("WARN:", w)
for e in errors:
    print("FAIL:", e)
if not errors:
    print("\nALL HARD CHECKS PASSED ✅")
sys.exit(1 if errors else 0)
