# Security Policy

Breakpoint MCP is a **local developer tool**. It runs on your machine, alongside the
Godot editor and your game, and acts on your project on your behalf. This document
explains what it can touch, the controls that keep you in charge, and how to report a
vulnerability.

## Supported versions

Security fixes are made against the **latest released version** and the `main` branch.
Please upgrade to the latest release before reporting an issue where possible.

## Trust model — what the host can do

When you run the host and connect it to Claude, it can, on request:

- **Spawn the Godot binary** (`GODOT_BIN`) — to launch the editor, run the project, and
  run headless scripts, exports, and imports.
- **Execute GDScript** — `godot_run_headless_script` and `godot_run_managed` run script
  code in a Godot process.
- **Run a local command you configure** — the optional `asset_generate` *command* backend
  invokes a command supplied via the `BREAKPOINT_ASSETGEN_CMD` environment variable or a
  tool argument. This backend is **off by default** and only runs a command you have
  explicitly configured.
- **Read and write files in your project** — create/edit scenes, resources, and scripts
  under the project directory (`GODOT_PROJECT`).
- **Open loopback sockets** — the host connects to `127.0.0.1` on the editor bridge
  (9080), the in-game runtime bridge (9081), Godot's language server (6005), and Godot's
  debug adapter (6006).

### Network scope

All connections are **loopback-only (`127.0.0.1`)**. The host does not open any
externally reachable port and does not phone home. Run the host on the **same machine** as
Godot; it is not designed to be exposed to a network.

### Controls that keep you in charge

- **Undo/redo:** every edit-time mutation is wrapped in `EditorUndoRedoManager` — Ctrl-Z
  reverts anything the assistant did — and goes through the editor API rather than raw
  file writes.
- **Confirmation gating:** destructive tools (delete, overwrite, file/script/resource
  writes, project-setting changes, runtime mutators, and the code/command surfaces above)
  are **elicitation-gated** — the host asks your client to confirm before executing. Pass
  `confirm: true` to auto-approve; if the client can't prompt, the tool blocks rather than
  acting silently.
- **Main-thread execution:** editor handlers run on the editor main thread, avoiding
  threading hazards.

### Your responsibilities

Because the tool can run scripts and (if you enable it) a configured command, treat the
project you point it at and any `asset_generate` command as you would any code you run
locally: **only use it with projects and commands you trust.** Review confirmation
prompts before approving destructive actions.

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

Use GitHub's **private vulnerability reporting** for this repository:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability** to open a private advisory.
3. Include a description, affected version, reproduction steps, and impact.

We aim to acknowledge a report within a few days and will coordinate a fix and disclosure
timeline with you. Responsible disclosure is appreciated — thank you for helping keep the
project and its users safe.
