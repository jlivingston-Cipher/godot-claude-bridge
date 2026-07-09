# Distribution (D5)

How to ship the two artifacts this repo produces, and an honest statement of what
a **remote / Cowork** deployment can and cannot do. Nothing in the codebase
depends on this doc — it captures the decisions and the mechanics so a release is
repeatable rather than improvised.

The project ships **two** independently-installable things:

| Artifact | Where it goes | What it is |
|---|---|---|
| **Host** (`host/`) | **npm** | The TypeScript MCP server Claude talks to over stdio. |
| **Addon** (`addons/breakpoint_mcp/`) | **Godot Asset Library** | The GDScript `EditorPlugin` + in-game autoload the host connects to. |

They are useless apart: the host with no addon can only reach Plane B (headless
CLI); the addon with no host has nothing driving it. A user installs the host
once (globally / via `npx`) and drops the addon into each Godot project.

---

## Versioning convention

One repo version, moved together, tagged repo-wide (`v0.4.3`, `v0.4.4`,
`v0.4.5`, …). At each tag **all three** version stamps must agree:

- `host/package.json` → `version`
- `addons/breakpoint_mcp/plugin.cfg` → `version`
- `addons/breakpoint_mcp/operations.gd` → `ADDON_VERSION` (surfaced by
  `editor_ping.addon_version`, so it must match what `plugin.cfg` advertises)
- `example/addons/breakpoint_mcp/plugin.cfg` + `operations.gd` → the vendored copy
  the example project loads; keep it equal to the canonical copy above.

> These drifted before v0.4.5 (`plugin.cfg` was still `0.1.0` while `ADDON_VERSION`
> was `0.4.3`). v0.4.5 realigned all three. Keep them in lockstep on every bump.

---

## Pre-publish checklist (do this once per release, before either publish)

1. **CI is green** on the commit you intend to tag (contract-check + build on
   Node 18/20/22). A cloud session can't push, but it can re-verify locally:
   `python3 scripts/contract_check.py` and `cd host && npm ci && npm run build && npm run typecheck`.
2. **All three version stamps agree** (see above) and match the tag you're about
   to cut.
3. **`CHANGELOG.md` has an entry** for the version, dated.
4. **Tag and push:** `git tag vX.Y.Z && git push origin main && git push origin vX.Y.Z`.
   (Tagging is what both publish steps below reference.)

---

## Publishing the host to npm

### One-time decisions (maintainer)

- **Package name.** The `package.json` name is `breakpoint-mcp`.
  Options:
  - **Unscoped** `breakpoint-mcp` — cleanest to type (`npx breakpoint-mcp`)
    if the name is free on npm. **Check:** `npm view breakpoint-mcp` (a 404
    means it's available). *Recommended if free.*
  - **Scoped** `@jlivingston-cipher/breakpoint-mcp` — always available under
    your own scope; requires `--access public` on first publish. Good fallback.
  - Keep `-host` suffix only if you want the npm name to mirror the folder; it
    reads slightly awkwardly to consumers.
- **Whether to publish at all**, or leave install as "clone + `npm run build` +
  point `claude mcp add` at `dist/index.js`" (what the README documents today).
  Publishing mainly buys `npx`/global install and versioned releases.

### Package hygiene before first publish

- `files: ["dist"]` already restricts the tarball to built output — good. Source,
  `*.mjs` harness, and `node_modules` are excluded automatically.
- **Build must run before pack.** `dist/` is git-ignored, so a publish must build
  first. Add a guard script so you can never publish stale/empty output:
  ```jsonc
  // host/package.json → scripts
  "prepublishOnly": "npm run build"
  ```
- **`bin` is already set** (`"breakpoint-mcp": "dist/index.js"`), so
  `npx <name>` and a global install both expose the command. Confirm
  `dist/index.js` keeps its `#!/usr/bin/env node` shebang (tsc preserves a leading
  shebang in the entry source — verify it's present in `src/index.ts`).
- **LICENSE lives at repo root, not in `host/`.** npm only bundles files from the
  package dir, so either copy `LICENSE` into `host/` or add it to `files`. Do this
  or the published package ships without a license file.
- **README:** npm shows `host/README.md` if present; today the rich README is at
  repo root. Add a short `host/README.md` (install + `claude mcp add` snippet +
  link back to the repo) so the npm page isn't blank.
- Node floor is already declared (`engines.node >= 18`); the SDK floor is pinned
  (`^1.17.0`) with a committed lockfile pinning the validated `1.29.0`.

### Publish

```bash
cd host
npm run build                     # or rely on prepublishOnly
npm pack --dry-run                # inspect the tarball contents first
npm login                         # once; org/2FA as configured
npm publish                       # unscoped
# npm publish --access public     # scoped (@…/…) first publish
# npm publish --provenance        # optional: build provenance if publishing from CI
```

Cut releases from a clean tagged checkout (ideally a CI "release" job triggered by
the `vX.Y.Z` tag, so the published bits are exactly what CI built).

### How a consumer then wires it up

```bash
npx breakpoint-mcp           # or: npm i -g breakpoint-mcp
claude mcp add godot -- npx -y breakpoint-mcp
# set GODOT_BIN if `godot` isn't on PATH (see README env table)
```

---

## Publishing the addon to the Godot Asset Library

The Asset Library entry points at **this Git repo at a specific tag**; the AssetLib
installer copies the repo's `addons/` tree into the user's project.

### ✅ Repo layout (resolved in v0.4.7 — option A)

The canonical addon now lives at **`addons/breakpoint_mcp/`** at the repo root. In
v0.4.7 it was moved out of the old nested `addon/addons/…` location
(`git mv addon/addons addons`) and every path reference — `README.md`, `docs/*`,
`scripts/contract_check.py`, and `scripts/validate.sh` — was updated to match.
The AssetLib installer expects `addons/…` at the repo root, so an Asset Library
"install" now drops `addons/breakpoint_mcp/` into the user's `res://addons/` with
**no manual step**. This is the conventional layout AssetLib users expect.

> The alternative (keep the nested layout + document a manual copy) was rejected:
> simpler diff at the time, but a worse out-of-box AssetLib experience.

The example project vendors its own copy at `example/addons/breakpoint_mcp/` and is
the reference for "installed correctly."

### Submission fields (assetlib.godotengine.org → Submit Asset)

- **Repository / commit:** this repo URL + the `vX.Y.Z` **tag** commit.
- **Version string:** match the tag (`0.4.7`). The Asset Library version is
  independent of `plugin.cfg`, but keep them equal to avoid confusion.
- **Godot version:** minimum **4.2** (addon README notes 4.2+; the LSP/DAP planes
  were live-validated on 4.7). Set the compatible-version field accordingly.
- **Category:** *Tools* (editor tooling).
- **License:** MIT (repo `LICENSE`).
- **Icon:** a 128×128 PNG (AssetLib requires an icon URL). None ships yet — add
  one (e.g. `addons/breakpoint_mcp/icon.png`) before submitting.
- **Description:** reuse the `plugin.cfg` description; mention it needs the
  `breakpoint-mcp` MCP host to do anything.

### Update flow

A new Asset Library version is a new submission referencing a **new tag**. Bump
all three version stamps, changelog, tag, then edit the AssetLib entry to point at
the new tag. First submissions are moderated (expect a review delay).

---

## The remote / Cowork reality (state this honestly, don't paper over it)

This bridge is built for a developer running **Claude + Godot on one machine**.
Its high-value planes require a process on `localhost`:

| Plane | Needs | Works remotely (cloud/Cowork sandbox)? |
|---|---|---|
| **B — headless CLI** (`godot_*`) | a Godot binary on the same host as the MCP server | Only if that sandbox has a Godot binary **and** a GPU/`Xvfb` for anything that renders. Usually **no**. |
| **A — live editor** (`editor_*`/`scene_*`/`node_*`) | the editor's loopback server on `127.0.0.1:9080` | **No** — the editor runs on the user's Mac; a cloud MCP server can't reach that loopback port. |
| **D — LSP/DAP** (`gd_*`/`dbg_*`) | Godot's LSP/DAP on `127.0.0.1:6005/6006` | **No**, same reason. |
| **C — runtime bridge** (`runtime_*`) | the running game's loopback server on `127.0.0.1:9081` | **No**, same reason. |

> **D6 note (Godot 4.5+):** the runtime bridge now captures the game's console
> (`print()` / warnings / errors) in-process via a scriptable `Logger`
> (`OS.add_logger`), so `runtime_get_log` / `godot://runtime/log` return console
> output **without** the host having to be the game's managed parent
> (`godot_run_managed`). This relaxes a *local* constraint — launch the game any
> way you like (e.g. the editor's Play button) and still read its console — but it
> does **not** change the loopback-locality story above: a cloud MCP server still
> can't reach the game's `127.0.0.1:9081`. On Godot < 4.5 the capture is absent and
> console still needs `godot_run_managed` (host-side pipe).

Two hard constraints make this unavoidable, not a config gap:

1. **Loopback locality.** All four planes bridge over `127.0.0.1`. An MCP server
   running in Anthropic's cloud has a *different* loopback than the user's Mac; it
   cannot see the editor, the LSP/DAP, or the running game. The npm registry being
   reachable from the cloud is irrelevant — that's for *building* the host, not for
   *reaching a local editor*.
2. **Frame capture needs a GPU.** `screenshot_editor` / `runtime_screenshot` render
   real frames; a headless cloud box needs a GPU or an `Xvfb` virtual display, and
   even then it's rendering a *different* Godot than the user is looking at.

**So the honest framing for docs and any Asset Library / npm copy:** the bridge is
a **local co-development tool**. A remote/Cowork deployment is a **degraded subset**
— at best Plane B against a Godot binary co-located with the MCP server — and it
**cannot** drive the user's actual on-screen editor or game **without a local relay**
(a small agent on the user's machine that tunnels `9080/9081/6005/6006` out to the
remote MCP server). Building that relay is a separate track (not in this repo). Until
it exists, document plainly: *run the host on the same machine as Godot.* Do not
imply the cloud/Cowork product can see a local editor — it can't.

---

## Quick reference — cut a release

```bash
# 1. bump the three version stamps to X.Y.Z (package.json, plugin.cfg, ADDON_VERSION)
# 2. cd host && npm install        # refresh lockfile root version, then commit it
# 3. update CHANGELOG.md
# 4. verify
python3 scripts/contract_check.py
cd host && npm ci && npm run build && npm run typecheck
# 5. commit, tag, push
git commit -am "X.Y.Z — <summary>"
git tag vX.Y.Z && git push origin main && git push origin vX.Y.Z
# 6. npm:  cd host && npm publish        (after the one-time hygiene above)
# 7. AssetLib: submit/edit the entry pointing at tag vX.Y.Z
```
