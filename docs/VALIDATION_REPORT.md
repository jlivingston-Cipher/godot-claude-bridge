# Validation Report

This scaffold was validated to the extent possible **without a running Godot editor or a package registry** (the authoring environment had neither). What was checked, and what still requires a live run, is recorded here so a reviewer knows exactly where the confidence line sits.

## Automated checks that PASS

| Check | Tool | Result |
|---|---|---|
| TypeScript host compiles against the SDK-1.x `registerTool`/`registerResource`/`elicitInput` contract + `@types/node` | `tsc -p host/tsconfig.typecheck.json` | ✅ clean (0 errors) |
| Every bridge method the host calls has a matching GDScript dispatch handler | `scripts/contract_check.py` | ✅ 28/28 resolve |
| No orphan GDScript dispatch methods (all reachable from host) | `scripts/contract_check.py` | ✅ 0 orphans |
| MCP tool names unique | `scripts/contract_check.py` | ✅ 54 unique |
| Catalog index lists exactly the registered tools | `scripts/contract_check.py` | ✅ 54 == 54 |
| Every fenced JSON schema in the catalog is valid JSON | `scripts/contract_check.py` | ✅ 45/45 valid |
| GDScript uses consistent tab indentation (no parser-breaking mixed whitespace) | grep | ✅ 0 offenders |

Run them yourself:
```bash
cd host && npx tsc -p tsconfig.typecheck.json    # or: npm run typecheck (after npm install)
cd .. && python3 scripts/contract_check.py
```

## What these checks DO prove
- The host is internally type-consistent and its tool/resource call-sites match the SDK contract as modeled.
- The host↔addon wire protocol is coherent: no tool calls a method the GDScript side doesn't implement, and no handler is unreachable.
- Tool identity is consistent across code and documentation.
- The published JSON Schemas are well-formed.
- The GDScript will not fail Godot's parser on indentation.

## What they do NOT prove (requires a live run — see RUNBOOK.md)
- That the real published `@modelcontextprotocol/sdk` matches the modeled shims exactly (verified by `npm install` + `npm run build` on a networked machine).
- That the Godot 4.x editor API calls behave as intended at runtime (EditorInterface, EditorUndoRedoManager, screenshots).
- That the LSP/DAP handshakes interoperate with Godot's actual language server and debug adapter.
- That the runtime autoload registers and serves requests inside a running game.
- End-to-end behavior of any individual tool.

## How to close the gap
Follow `RUNBOOK.md` in an environment that has **Node 18+ with registry access** and **Godot 4.4+ with a real display/GL**. The `example/` project and `scripts/validate.sh` automate the parts that can be automated (host build, project import, version checks); the interactive planes (editor bridge, LSP, DAP, runtime) are driven from Claude against the running editor per the runbook checklist.
