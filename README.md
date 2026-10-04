# omp-plugins

Standalone [oh-my-pi](https://github.com/can1357/oh-my-pi) extensions in one Bun workspace.

## Packages and features

| Package | Feature | Default | Entry |
| --- | --- | --- | --- |
| `@codesook/omp-plugin-settings` | root settings command | yes with root install | `packages/codesook-omp-plugin/index.ts` |
| `@codesook/omp-headroom` | `headroom` | yes | `packages/headroom/index.ts` |
| `@codesook/omp-prompt-border-style` | `prompt-border-style` | yes | `packages/prompt-border-style/src/main.ts` |
| `@codesook/omp-shared-display` | `shared-display` | no | `packages/shared-display/src/index.ts` |
| `@codesook/omp-caveman` | `caveman` | no | `packages/caveman/src/index.ts` |
| `@codesook/omp-codegraph` | `codegraph` | no | `packages/codegraph/src/index.ts` |
| `@codesook/omp-beads` | `beads` | no | `packages/beads/src/index.ts` |
| `@codesook/omp-theme-catppuccin` | theme package | — | `packages/theme-catppuccin/bin/install.js` |

Root install loads unified settings plus default Headroom and Prompt Border features. Shared Display, Caveman, CodeGraph, and Beads remain opt-in.

## Requirements

- Bun 1.4.0 or newer
- OMP 18.1.16 or newer

```sh
bun --version
omp --version
```

## Install from GitHub

```sh
omp plugin install github:seenark/omp-plugins
omp plugin install 'github:seenark/omp-plugins[headroom,prompt-border-style]'
omp plugin install 'github:seenark/omp-plugins[shared-display,caveman]'
omp plugin install 'github:seenark/omp-plugins[codegraph]'
omp plugin install 'github:seenark/omp-plugins[beads]'
omp plugin install 'github:seenark/omp-plugins[*]'
```

Feature selectors are package names, not directories. Keep selectors quoted because `[` and `]` are special in many shells.

Install one package from a checkout:

```sh
bun install
omp plugin install "$PWD/packages/headroom"
omp plugin install "$PWD/packages/prompt-border-style"
omp plugin install "$PWD/packages/shared-display"
omp plugin install "$PWD/packages/caveman"
omp plugin install "$PWD/packages/codegraph"
omp plugin install "$PWD/packages/beads"
```

Install Catppuccin themes:

```sh
bun packages/theme-catppuccin/bin/install.js
```

## Command tree

```text
/codesook-omp-plugin
/codesook-omp-plugin status
/codesook-omp-plugin init config
/headroom [status|on|off|health|stats|init [config|glyphs|all]]
/caveman [status|off|lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra]
/codegraph [status|auto|off]
/beads [init|status|auto|off]
/prompt-border [status|<style> [layout]|layout <layout>|reset|rail toggle|glyphs debug [frames|demo|on|off]]
```

Root settings owns persisted configuration. Feature commands own session behavior; CodeGraph and Beads policy commands explicitly write shared project policy. Feature `config` commands and `/shared-display` are removed. Status commands open focused read-only overlays; Enter/Esc closes. `/codesook-omp-plugin init config` creates the v1 global config only when absent and seeds only missing glyph files.

`/codesook-omp-plugin` edits a draft. Shift+Enter applies directly. Bare Enter on Apply opens confirmation inside the same focused overlay without saving. Enter confirms; Esc declines and returns to the unchanged draft without writes or live-change events. Reload discards draft; Cancel leaves persisted and live state unchanged.

## Configuration and migration

All feature settings persist in one root envelope:

```text
~/.config/codesook-omp/config.json
```

Shape:

```json
{
  "version": 1,
  "display": {},
  "behavior": {}
}
```

`display` stores presentation settings. `behavior` stores feature runtime settings. Glyph/frame bytes stay in external files:

```text
~/.config/codesook-omp/caveman/glyphs/
~/.config/codesook-omp/headroom/
~/.config/codesook-omp/prompt-border/
~/.config/codesook-omp/context-rail/
```

Missing valid legacy package/settings files migrate into missing root sections. Invalid root JSON wins and is never overwritten. Successful migration removes only valid imported legacy JSON; invalid files remain for repair. Asset files remain external.

### CodeGraph project integration

CodeGraph detects existing native Tool Workspaces without initializing, indexing, installing tools, changing MCP setup, or writing agent instructions. Ready requires successful CLI project-data inspection and an active configured exploration MCP tool. Status distinguishes suppression, missing data/prerequisites, readiness, and errors; MCP connection health was not tested.

Global defaults use `behavior.codegraph.policy` (`auto`/`off`) and `display.codegraph.visibility` (`ready`/`always`/`never`). Shared project overrides use the same v1 envelope in `<Integration Project>/.omp/codesook-omp.json`; project values win. The nearest Git working tree owns policy, or the operating directory outside Git. Native CodeGraph ancestor discovery and overrides can resolve a different Tool Workspace. Detailed status identifies both.

The unified dialog stages global values and project overrides; inherit removes an override. Invalid policy is reported, preserved, and fails closed. Unknown fields survive writes. Detection, Reload, and Cancel create no project settings; explicit Apply or policy commands may write them, never commit them.

Both integrations fail closed when Git cannot inspect the Integration Project, including missing Git, permission errors, and unsafe repository ownership. Repair the reported Git error before enabling guidance or saving project settings. The operating-directory fallback applies only when Git confirms that the directory is outside a repository; inspection errors never select a child directory as a new policy root.

When Beads cannot resolve project scope, valid global visibility still controls persistent error display: `always` shows the error, while `never` keeps it hidden. This display-only fallback never permits guidance or reads a guessed project settings file; read-only status remains available.

Permitted ready integrations append CodeGraph-first guidance with an explicit resolved `projectPath`, preserving prior prompt entries and allowing grep/read for missing or stale source. Off suppresses only this plugin's instructions. Visibility defaults to ready; always shows all states, never hides persistent status only. CodeGraph uses Shared Display when its host is active, otherwise the native footer, never both. Refresh runs on startup, before turns, commands, settings changes, and session switches; no idle polling.

See [CodeGraph package documentation](packages/codegraph/README.md) for installation, native MCP configuration, and the shared policy/client interfaces.

### Beads project integration

Beads detects a usable existing native Tool Workspace through the installed `bd` CLI. Discovery respects ancestor lookup, environment overrides, redirects, and worktree sharing; a folder or location result alone is not readiness. Status identifies the Integration Project, Tool Workspace, database, policy, and errors. `/beads init` reuses existing usable workspaces first. New initialization offers standard/team or personal stealth mode, with supported Git hooks opt-in and off by default; Esc in either choice cancels the entire operation. Agent generation is always skipped. Initialization preserves policy, including off, and does not authorize issue operations, install tools, provision servers, or add automatic remote push/sync.

New data belongs to the Integration Project. Linked-worktree initialization uses a one-command native `BEADS_DIR` target, then verifies ordinary discovery without the override; existing native shared/redirected/environment-selected workspaces remain unchanged. Partial data, native backend failures, invalid settings, and remote-history refusals are never bypassed. Native Beads 1.3.1 standard init makes a Git commit, including staged or auto-staged user files. The plugin refuses unsafe staged entries and dirty setup/root Markdown files before invoking it; explicit stealth preserves the index. See the package documentation for the safety boundary and native hook behavior.

Global `behavior.beads.policy` (`auto`/`off`) and `display.beads.visibility` (`ready`/`always`/`never`) use the same settings envelope and staged project overrides as CodeGraph, independently. Invalid configuration fails closed and remains unchanged. Beads depends on Shared Display's 1.2.0 client/settings contracts, not on an active host or the CodeGraph plugin.

Ready, permitted Beads guidance authorizes issue operations only after an explicit user request and within its scope. Availability alone never enables automatic issue tracking for unrelated work. Off removes only plugin guidance, not CLI access, data, or existing repository obligations. Status remains a read-only overlay even with hidden persistent display. Host-active display uses one shared segment; otherwise it uses the native footer. Refresh follows startup, turns, commands, settings changes, and project switches without polling.

See [Beads package documentation](packages/beads/README.md) for independent installation and operation.


## Implemented ownership

- Shared Display owns the single `codesook-shared-display` widget, source composition, and animation clock.
- Headroom remains a compression producer and continues working without Shared Display; proxy lifecycle is external, while health checks may run at session start or live config change and never start the proxy.
- Caveman injects the pinned skill, recovers session levels from branch entries, and publishes custom/native status independently.
- Prompt Border owns the prompt editor, Context Rail, attachment band, and spinner overrides; it does not publish Shared Display sources.
- Root settings detects Ponytail and OMP feature presence through `omp plugin list --json`; it never unloads or loads plugins.
- CodeGraph owns native project-data inspection, permitted runtime guidance, read-only status, and exclusive Shared Display/footer routing.
- Beads owns explicit consent-based initialization, native workspace/database inspection, on-demand runtime guidance, read-only status, and exclusive Shared Display/footer routing.

Ponytail and Caveman producers publish complete frame sequences and never create producer-side animation timers or fallback widgets. Native status visibility is independent from custom Shared Display visibility.

## Development

```sh
bun install
bun run typecheck
bun run test
bun run check
bun run pack:check
bun run verify
```

Package publication is dependency ordered:

```sh
bun run publish:shared-display
bun run publish:caveman
bun run publish:codegraph
bun run publish:beads
bun run publish:headroom
bun run publish:prompt-border-style
bun run publish:settings
bun run publish:theme-catppuccin
bun run publish:all
```

## Local OMP smoke loading

Load extension entries directly from a disposable home/session tree:

```sh
HOME="$TMP_HOME" XDG_CONFIG_HOME="$TMP_XDG" \
PI_CODING_AGENT_DIR="$TMP_AGENT" PI_CODING_AGENT_SESSION_DIR="$TMP_SESSIONS" \
omp --cwd "$TMP_WORK" --session-dir "$TMP_SESSIONS" \
  --extension "$PWD/packages/codesook-omp-plugin/index.ts" \
  --extension "$PWD/packages/shared-display/src/index.ts" \
  --extension "$PWD/packages/caveman/src/index.ts" \
  --extension "$PWD/packages/headroom/index.ts" \
  --extension "$PWD/packages/prompt-border-style/src/main.ts"
```

Use disposable homes only. The repository's focused tests use injected temporary paths for migration, staged Apply/Cancel, EventBus replay, and source lifecycle behavior.
