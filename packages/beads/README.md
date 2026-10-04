# Beads for OMP

Optional, independently installable Beads integration for [oh-my-pi](https://github.com/can1357/oh-my-pi). Requires the installed `bd` CLI and a usable existing Beads database. It does not require CodeGraph or an active Shared Display host.

## Install

```sh
omp plugin install @codesook/omp-beads
# Or install from a checkout after bun install:
omp plugin install "$PWD/packages/beads"
# Root feature selection:
omp plugin install 'github:seenark/omp-plugins[beads]'
```

The package depends on `@codesook/omp-shared-display` 1.2.0 or newer for its client and settings contracts. Installing that dependency does not activate its display host. Beads is off by default in the root package's optional feature selection; standalone installation loads only the Beads extension.

## Commands

```text
/beads [status|auto|off]
```

`status` is read-only. Its focused overlay opens with `Loading…`, shows the inspection result or error, and closes with Enter/Esc. It works even when persistent status is hidden. Without interactive UI, status is reported as text.

`auto` and `off` explicitly write only Beads project policy. They do not change OMP plugin lifecycle state. No `/beads init` operation is provided: initialize or repair a workspace directly with the installed CLI, then inspect it again. The plugin never initializes, installs tools, writes agent instructions, provisions a server, installs hooks, or synchronizes remote data.

## Discovery and readiness

The **Integration Project** is the nearest Git working tree, or the current directory outside Git. It owns shared policy. The **Tool Workspace** is selected by native Beads discovery and may differ: ancestor lookup, environment overrides, redirects, and shared worktree databases remain native CLI behavior. Detailed status identifies both scopes and the database location.

Readiness requires the CLI, successful workspace discovery, and successful database access. A `.beads` directory or location result alone is insufficient. Status distinguishes uninitialized workspaces, missing prerequisites, database/inspection/configuration errors, readiness, and policy suppression. External initialization becomes visible on the next refresh without setup or generated project files.

## Policy and visibility

The unified `/codesook-omp-plugin` settings dialog stages both global defaults and project overrides:

- `behavior.beads.policy`: `auto` (default) or `off`.
- `display.beads.visibility`: `ready` (default), `always`, or `never`.

Global settings live in `~/.config/codesook-omp/config.json`. Project overrides use `<Integration Project>/.omp/codesook-omp.json` with the same `version: 1`, `display`, and `behavior` envelope. Project values win; selecting `inherit` removes an override. Apply saves staged changes; Cancel and Reload do not write them. Invalid configuration reports an actionable error, preserves its bytes, and disables plugin guidance. Unrelated configuration and CodeGraph settings remain unchanged.

`ready` displays only permitted ready status. `always` displays all states, including suppression and errors. `never` hides persistent status only; it does not disable guidance or read-only inspection. When Shared Display is active, Beads publishes one Status Segment and clears its native footer. Otherwise it uses the native footer, never both. Persisted legacy source orders retain their order and append the Beads source.

## On-demand workflow

Permitted ready workspaces append runtime instructions while preserving prior system-prompt entries. Availability is **not consent** to create, update, claim, close, or otherwise operate on issues. Use Beads only after an explicit user request, within that request's scope, through the installed CLI and machine-readable output where appropriate. Ordinary unrelated work does not gain automatic task tracking.

`off` suppresses only this plugin's guidance. It does not remove data, prohibit independent CLI access, modify existing repository instructions, or affect CodeGraph. Existing repository Beads obligations still apply independently.

Refresh occurs on startup, before turns, plugin commands, settings changes, and session/project switches. There is no idle watcher or polling; old workspace guidance is not retained when the project changes.
