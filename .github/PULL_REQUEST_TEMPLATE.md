# Summary

Briefly describe what this pull request changes and why. Link any related
issues (for example, `Closes #123`).

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature / tool (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Documentation only
- [ ] Refactor / internal change (no behavior change)

## How was this tested?

Describe the checks you ran and, if the change touches the addon or a plane that
only a live engine exercises, how you verified it against a real Godot editor.

## Checklist

- [ ] `npm run build` passes with zero errors (in `host/`)
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `python3 scripts/contract_check.py` reports all hard checks passing (host ↔ addon ↔ catalog parity)
- [ ] `CHANGELOG.md` updated under the `## [Unreleased]` section
- [ ] Documentation updated where relevant (including `docs/TOOL_CATALOG.md` for tool changes)
- [ ] If GDScript changed, `addons/breakpoint_mcp/` and `example/addons/breakpoint_mcp/` are byte-identical
- [ ] No version-stamp bump (feature and fix PRs leave version numbers unchanged; releases are stamped separately)
- [ ] This PR is focused on a single logical change

## Additional notes

Anything reviewers should know — trade-offs, follow-ups, or areas you would like
a closer look at.
