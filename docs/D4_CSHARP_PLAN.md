# D4 — C# / .NET plane — implementation plan (C1 → C3)

The C#/.NET language plane: the secondary-language mirror of the proven GDScript planes (LSP →
`gd_*`, DAP → `dbg_*`). It is the last and largest deferred track (`DEFERRED_TRACKS_PLAN.md` Group C):
heaviest new environment, most isolated, so it lands after all shared host infra (D1–D3, D6) is
stable. Chunked exactly the way Plane D was originally built: **fixture → semantic (LSP) → debugging
(DAP)**.

> **Status:** C1 is **merged** (PR #24) — the `example-csharp/` fixture builds and boots C# live on a
> real Mono Godot build, green on macOS and a real Linux CI runner. **C2 is implemented here**: the
> eight read-only `cs_*` tools are wired to an OmniSharp LSP client (spawned over stdio) and fully
> unit-tested over the same mock harness the `gd_*` tools use (tool count 70 → 78, host tests 124 →
> 139, contract check green); the experimental `csharp-plane` job now runs a live `cs_*` probe against
> a real OmniSharp (markers `C#_LSP_*`), and a green run of that probe on a real **Linux CI runner**
> (this PR) is the remaining C2 acceptance item — the same way C1 was accepted. C3 is design-only
> here. Nothing on `main` changes until a chunk is merged.

## Why last, and why it shares nothing
D4 mirrors Plane D for a *different language runtime*. It needs a **Mono/.NET Godot** build (not the
standard build every other plane downloads), the **.NET 8 SDK**, and a C# language server + a
.NET-capable debug adapter. None of that shares code with D2/D3/D6. Doing it last means the host's
notification/task/resource plumbing and the CI harness patterns are already settled, so D4 is purely
additive: new tools, new fixture, new CI job — no host refactor.

## Environment & toolchain
- **Mono/.NET Godot build.** The `*_mono_*` release asset, e.g.
  `Godot_v4.7-stable_mono_linux_x86_64.zip` (expands to a directory; the binary inside is
  `Godot_v4.7-stable_mono_linux.x86_64`). macOS/Windows are follow-ups.
- **.NET 8 SDK.** Godot C# packages moved to .NET 8, so `net8.0` is the target framework and the SDK
  must be 8.0.x. (`actions/setup-dotnet@v4` with `8.0.x` on CI; `brew install dotnet@8` / the
  official installer locally.)
- **C# language server (C2).** **OmniSharp** (`OmniSharp.Roslyn`) is the plan of record — it speaks
  LSP and drives the same operations `lsp.ts` already wraps. Note the modern alternative:
  the Roslyn-based `Microsoft.CodeAnalysis.LanguageServer` (the engine behind C# Dev Kit). Pick
  OmniSharp first for its permissive licence and standalone LSP; keep the host's LSP client generic
  enough to swap servers.
- **.NET debug adapter (C3).** Use **netcoredbg** (Samsung, MIT) — it is DAP-compatible and
  redistributable. Do **NOT** use Microsoft `vsdbg`: its licence forbids use outside Microsoft tools,
  which a third-party MCP host is not.

## Version alignment (the trap to watch)
Three versions must agree or the project silently retargets or fails to build:
1. the **Mono Godot build** (`GODOT_VERSION`, e.g. `4.7-stable`),
2. the **`Godot.NET.Sdk`** version in `example-csharp/ExampleCsharp.csproj` (currently `4.7.0`), and
3. the **`TargetFramework`** (`net8.0`).

Godot pins the SDK version to the engine that opens the project and will rewrite `TargetFramework`
to what that engine expects (Godot 4.4+ forces `net8.0`). When bumping the CI Godot version, bump
`Godot.NET.Sdk` in lockstep. Keep `csharp-plane`'s `GODOT_VERSION` and the csproj SDK version equal.

---

## C1 — C# fixture + Mono Godot in CI  *(1 PR — partially scaffolded here)*

**Goal.** Establish the environment and prove a Mono Godot build boots and runs C# headlessly.

**Scaffolded on this branch:**
- `example-csharp/` — `Player.cs` (mirrors `example/player.gd`: `Counter`, `_Ready`/`_Process`,
  `TakeDamage(int)`), `Main.tscn` (root **Main** running `Player.cs`), `ExampleCsharp.csproj`/`.sln`
  (`Godot.NET.Sdk/4.7.0`, `net8.0`), `project.godot` (`[dotnet]` assembly, `gl_compatibility`
  renderer), `.gitignore` (`bin/`,`obj/`,`.mono/`), `README.md`. **No** `claude_bridge` addon — the
  C# plane doesn't use the GDScript bridge, and omitting it avoids a third `ADDON_VERSION` copy that
  `contract_check.py` would track.
- `csharp-plane` job in `.github/workflows/integration.yml` — `continue-on-error` (never blocks):
  `setup-dotnet@v4` (8.0.x) → download the mono build → `dotnet build` the project standalone
  (OmniSharp-readiness) → `--import --build-solutions` → boot headless and assert
  `C#_PLANE_BOOT_OK` (the `[example-csharp] player ready` marker).

### C1 local validation — DONE ✅
Validated live on the maintainer's Apple-Silicon Mac (macOS 15.7, arm64):
- **.NET SDK 8.0.422** (installed to `~/.dotnet` via the official installer) and the **Mono Godot
  4.7-stable** macOS build (`Godot_v4.7-stable_mono_macos.universal.zip`).
- `dotnet restore` + `dotnet build -c Debug` → **Build succeeded, 0 warnings, 0 errors**; emits
  `.godot/mono/temp/bin/Debug/ExampleCsharp.dll`. Confirms the project resolves `Godot.NET.Sdk`
  4.7.0 + `GodotSharp` from NuGet **with no editor present** — the exact path OmniSharp drives in C2.
- `Godot_mono --headless --path example-csharp --import --build-solutions --quit-after 300` →
  `dotnet_build_project … [ DONE ]` (Godot builds the C# solution itself).
- `Godot_mono --headless --path example-csharp --quit-after 300` → prints
  `[example-csharp] player ready` → **`C#_PLANE_BOOT_OK`**. The C# `_Ready()` runs under the engine.
- Fixture needed **no corrections** — it built and booted first try. Only Godot's generated
  `Player.cs.uid` (a stable script UID, committed like the GDScript example's `*.uid`) was added.

**Remaining to fully close C1:**
- Run `csharp-plane` green on a real **Linux** CI runner (open a PR — the job only runs on PR /
  push-to-`main`). The Linux mono asset name is API-confirmed and the binary is resolved via `find`.
- Then keep it `continue-on-error` for a few runs before considering promotion to a required check,
  the way `runtime-plane` was promoted (§CHANGELOG note in `HANDOFF_SESSION20.md`).

**Acceptance.** `csharp-plane` prints `C#_PLANE_BOOT_OK` on a real runner (✅ locally on macOS;
Linux CI pending a PR); `dotnet build` green (✅); absent the mono toolchain, every other plane and
required check is unaffected (new job is additive).

---

## C2 — C# semantic plane via OmniSharp  *(1–2 PRs)*

**Goal.** Stand up an OmniSharp LSP client in the host and expose read-only `cs_*` tools that mirror
the proven, read-only `gd_*` surface, feature-detected the same way.

**Mirror set (read-only first — no mutators in the initial cut):**

| GDScript (`lsp.ts`) | C# (`cs_*`) | LSP method |
|---|---|---|
| `gd_definition` | `cs_definition` | `textDocument/definition` |
| `gd_references` | `cs_references` | `textDocument/references` |
| `gd_hover` | `cs_hover` | `textDocument/hover` |
| `gd_completion` | `cs_completion` | `textDocument/completion` |
| `gd_document_symbols` | `cs_document_symbols` | `textDocument/documentSymbol` |
| `gd_workspace_symbols` | `cs_workspace_symbols` | `workspace/symbol` |
| `gd_signature_help` | `cs_signature_help` | `textDocument/signatureHelp` |
| `gd_diagnostics` | `cs_diagnostics` | pull/push diagnostics |

Defer `cs_rename` / `cs_code_action` (mutators) to a later cut, mirroring how the GDScript mutators
were gated. (OmniSharp typically supports `workspace/symbol` for real, unlike Godot's GDScript LSP —
so `cs_workspace_symbols` should actually return results; assert that live.)

**Files.**
- `host/src/tools/cslsp.ts` — a second LSP client + `cs_*` registrations. Reuse the transport/
  request plumbing from `lsp.ts`; factor shared LSP client code if the duplication is meaningful.
- host spawns/points at OmniSharp over the `example-csharp` project root; feature-detect via the
  server's `initialize` capabilities exactly like the GDScript LSP.
- `host/src/schemas.ts` — frozen `outputSchema` for each new tool (the B1 discipline).
- `scripts/contract_check.py` + `host/test/registration.test.ts` — extend the tool-count/parity
  checks in the SAME PR (currently **70 tools**; each `cs_*` tool raises the count).
- `docs/TOOL_CATALOG.md` — a catalog entry per tool (contract check validates catalog↔code parity).
- `host/test/cslsp.test.ts` — unit tests against a mock OmniSharp; an `csharp-plane` integration
  assertion that `cs_definition`/`cs_hover` resolve against the live server (markers `C#_LSP_*`).

**Acceptance.** With OmniSharp up on `example-csharp`, `cs_definition` on `TakeDamage` resolves to
its declaration; `cs_hover` returns the `Counter : int` type; server absent → graceful "unsupported"
(feature-detected), never a hang. Contract check + registration meta-test green at the new count.

---

## C3 — C# debugging via the Godot Mono debugger  *(1–2 PRs)*

**Goal.** The C# analogue of the GDScript DAP plane (`dap.ts` / `dbg_*`): attach a .NET debug adapter
to a running C# Godot game, set breakpoints, inspect frames, evaluate — reusing the same gating and
fail-fast discipline (bounded deadlines, elicitation-gated mutators, cap feature-detection).

**Adapter.** **netcoredbg** (MIT, DAP-compatible). Godot 4 .NET launches the game with the debugger
attachable; netcoredbg either launches the game (`launch`) or attaches to the .NET process
(`attach`). Confirm which mode is reliable headless-under-Xvfb on CI during C3.

**Mirror set.** The read/inspect `dbg_*` tools first, then mutators:
`cs_dbg_set_breakpoints`, `cs_dbg_launch`/`cs_dbg_attach`, `cs_dbg_continue`/`cs_dbg_step`,
`cs_dbg_stack_trace`, `cs_dbg_scopes`, `cs_dbg_variables`, `cs_dbg_evaluate` — then the gated
`cs_dbg_set_variable` (reuse the F1 bounded-timeout discipline: a short deadline + a clear
"adapter did not answer" message instead of the generic DAP timeout).

**Files.** `host/src/tools/csdap.ts` (second DAP client, or generalize `dap.ts`); schemas; contract
check + registration parity; `docs/TOOL_CATALOG.md`; `host/test/csdap.test.ts` (mock adapter) + a
`csharp-plane` live probe (`TakeDamage`'s marked line is a natural breakpoint; markers `C#_DAP_*`).

**Acceptance.** Set a breakpoint on `TakeDamage`'s `Counter -= amount;`, run, hit it; `stack_trace`
shows the frame; `variables` shows `Counter`; `evaluate("Counter")` returns its value; the mutator is
elicitation-gated and fail-fast on a non-compliant adapter. Adapter absent → graceful, never a hang.

---

## Cross-cutting

**Marker discipline.** Every live probe gets grep-able markers, matching the existing `D_DAP_*` /
`D7_*` / `D6_CAP_*` convention: `C#_PLANE_*` (C1 boot), `C#_LSP_*` (C2), `C#_DAP_*` (C3). A future
session reads results with one `gh run view --job=<id> --log | grep 'C#_'`.

**Keep the plane non-blocking until proven.** `csharp-plane` stays `continue-on-error` through C1–C3.
Promote to a required branch-protection check only after it is green on real runners across a few
runs — the same discipline that took `runtime-plane` from experimental to required in session 20.

**Contract check + tool count.** Every PR that adds `cs_*` tools extends `scripts/contract_check.py`
and `host/test/registration.test.ts` in the same PR (tool-count + schema parity), and adds a
`docs/TOOL_CATALOG.md` entry per tool. The count moves off **70** for the first time since D2.

**Release cadence.** Cut a version when a chunk lands new surface: after C1 (fixture/CI only — likely
folded into the next release), after C2 (the `cs_*` semantic tools — a real minor), and after C3 (the
`cs_dbg_*` tools). Reuse the release recipe in `HANDOFF_SESSION15.md` §1.

## Risks & open questions
- **Mono build availability per version.** Confirm a `*_mono_linux_x86_64` asset exists for each
  targeted `GODOT_VERSION` before matrixing (as of 4.7 it does).
- **`--build-solutions` headless reliability.** May need the editor context or a separate `dotnet
  build` first; C1 validates the exact incantation.
- **OmniSharp project load.** OmniSharp wants a `.sln`/`.csproj` and a restored `obj/` — the CI job
  runs `dotnet restore`/`build` before starting the server so the design-time build is warm.
- **netcoredbg + Godot .NET attach semantics** under headless Xvfb — the least-certain piece; keep
  it `continue-on-error` and log-only until it is proven, exactly like the GDScript DAP probe began.
- **macOS/Windows CI** for the mono build are follow-ups; C1 establishes Linux first.

## Acceptance summary
| Chunk | Done when |
|---|---|
| **C1** | `csharp-plane` prints `C#_PLANE_BOOT_OK` on a real runner; `dotnet build` green; additive-only |
| **C2** | `cs_definition`/`cs_hover`/`cs_completion` resolve live via OmniSharp; contract check green at new count |
| **C3** | breakpoint on `TakeDamage` hits; stack/vars/evaluate work; mutator gated + fail-fast |
