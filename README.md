<p align="center">
  <img src="docs/assets/cover.jpg" alt="omp-plugins cover: a layered paper-cut Japanese landscape in Catppuccin Mocha colors" width="100%">
</p>

# omp-plugins

Plugins for [oh-my-pi (OMP)](https://github.com/can1357/oh-my-pi), the terminal coding agent. They cut token spend, show what the agent is doing, and add engineering workflows:

- **Spend fewer tokens.** Large tool results go through a [Headroom](https://github.com/headroomlabs-ai/headroom) proxy and shell output goes through [rtk](https://github.com/rtk-ai/rtk) before the model reads them. Both show how many tokens they saved.
- **Steer the agent.** Caveman makes answers terse. Ponytail makes the agent write the smallest complete change.
- **See it at a glance.** One shared status line carries every plugin's state, and the prompt box gets border styles and a context-usage rail.
- **Use your tools.** CodeGraph and Beads integrations tell the agent when a project has a code graph or an issue tracker it can use.
- **Work in playbooks.** pstack adds `/poteto` mode, playbooks, guards and a multi-model review panel.

Every feature except pstack and the themes lives in one plugin, `omp-plugins`. You choose which features it loads; the rest stay off.

## Features

| Feature | What it does | Default | Needs |
| --- | --- | --- | --- |
| Settings | `/omp-plugins` dialog that edits every plugin's settings in `~/.config/codesook-omp/config.json` | always on | — |
| `headroom` | Compresses large tool results before provider requests without breaking the provider prompt cache; shows Headroom Savings | on | A running Headroom proxy |
| `prompt-border-style` | Prompt editor border styles, the Context Rail (context usage beside the prompt), the attachment band and spinner glyphs | on | — |
| `shared-display` | One animated status line that the other features publish their Status Segments into | off | — |
| `caveman` | Caveman Instruction Mode: terse answers in `caveman`, `ultracave` or `megacave` level | off | — |
| `ponytail` | Ponytail Instruction Mode: a "lazy senior developer" who writes the smallest complete change | off | — |
| `rtk` | Rewrites `bash` commands through rtk so shell output is filtered before the model reads it; shows RTK Savings | off | `rtk` 0.51.0 or newer |
| `codegraph` | Tells the agent to explore code through [CodeGraph](https://github.com/colbymchenry/codegraph) in initialized projects | off | `codegraph` CLI and its MCP server |
| `beads` | On-demand [Beads](https://github.com/gastownhall/beads) issue-tracker guidance, ready/open issue counts in the status line, and a live `/beads tasks` list in initialized workspaces | off | `bd` CLI |
| `process-monitor` | `/procs` lists the processes OMP started with their ports and sessions, stops leftovers after a confirmation, and shows a `⚠ N ports` segment | off | `lsof` (macOS for full attribution) |
| `skill-stats` | Records every skill use (yours, the agent's, a subagent's) and shows `/skill-stats` dashboards with delete candidates | off | — |
| pstack | [pstack](https://github.com/cursor/plugins/tree/main/pstack) workflows: `/poteto` mode, playbooks, guards, a review panel on `pstack-*` model roles | separate plugin | OMP 18.11.1 or newer |
| Catppuccin themes | Latte, Frappé, Macchiato and Mocha themes for OMP `/settings` | separate installer | A checkout of this repository |

Each package documents its own behavior in `packages/<name>/README.md`.

## Quick start

Install every feature and pstack, then restart OMP:

```sh
omp plugin install 'github:seenark/omp-plugins[headroom,prompt-border-style,shared-display,ponytail,caveman,codegraph,beads,rtk,process-monitor,skill-stats]'
omp plugin install github:seenark/omp-pstack
omp plugin list
```

`omp plugin list` should show both `omp-plugins` and `@codesook/omp-pstack`. In OMP, run `/omp-plugins` to review settings and `/pstack setup` to choose pstack's models. A feature whose CLI or proxy is missing loads anyway and reports the missing prerequisite in its status; install it from [Prerequisites](#prerequisites).

Prefer a guided install? Ask your OMP agent to follow [`docs/agents/setup.md`](docs/agents/setup.md). It asks which features you want, checks conflicts and prerequisites, and confirms every step before it runs.

## Requirements

- OMP 18.3.1 or newer; pstack needs 18.11.1 or newer.
- Bun 1.4.0 or newer.

```sh
omp --version
bun --version
```

## Install

### The `omp-plugins` plugin

The default install loads Settings, `headroom` and `prompt-border-style`:

```sh
omp plugin install github:seenark/omp-plugins
```

Choose features with a selector. Keep the quotes: `[` and `]` are special in most shells. Selectors are feature names, not directories.

```sh
omp plugin install 'github:seenark/omp-plugins[headroom,prompt-border-style]'
omp plugin install 'github:seenark/omp-plugins[shared-display,ponytail,caveman]'
omp plugin install 'github:seenark/omp-plugins[rtk]'
omp plugin install 'github:seenark/omp-plugins[*]'   # every feature
```

Turn features on or off later without reinstalling:

```sh
omp plugin features omp-plugins --enable=codegraph,beads
omp plugin features omp-plugins --disable=headroom
```

Settings is always loaded. `shared-display` is recommended with any other status-producing feature; without it each one falls back to its own native status entry.

### pstack

pstack is its own plugin, published as built releases in [`seenark/omp-pstack`](https://github.com/seenark/omp-pstack):

```sh
omp plugin install github:seenark/omp-pstack              # latest release
omp plugin install 'github:seenark/omp-pstack#v<version>' # pinned release
```

Run the same command again to upgrade. Shared Display, Caveman and Ponytail come from `omp-plugins`; pstack works without them, but then shows no Status Segment and cannot suspend Caveman and Ponytail while it runs.

Do not install pstack from `github:seenark/omp-plugins#<ref>`. OMP keeps one plugin per git repository, so that install evicts the root `omp-plugins` plugin.

After installing, run `/pstack setup` to pick the models for each `pstack-*` role, then start a task with `/poteto <task>`. See the [pstack README](packages/pstack/README.md) for commands, presets and the review panel.

### Catppuccin themes

The themes install from a checkout. The installer copies four JSON files into OMP's custom theme directory:

```sh
git clone https://github.com/seenark/omp-plugins.git
cd omp-plugins
bun packages/theme-catppuccin/bin/install.js
```

In OMP, open `/settings` and pick `catppuccin-latte` as the light theme and `catppuccin-mocha`, `catppuccin-macchiato` or `catppuccin-frappe` as the dark theme.

### Prerequisites

| Feature | Check | Install |
| --- | --- | --- |
| `rtk` | `rtk --version` (0.51.0 or newer) | `brew install rtk`, or see [rtk](https://github.com/rtk-ai/rtk) |
| `codegraph` | `codegraph status --json .` | `npm install -g @colbymchenry/codegraph` |
| `beads` | `bd --version` | See [Beads releases](https://github.com/gastownhall/beads) |
| `headroom` | `/headroom health` in OMP | Run the proxy with this repository's [`compose.yaml`](compose.yaml); steps in [`docs/agents/setup.md`](docs/agents/setup.md#phase-3-headroom-only-if-headroom-was-selected) |

CodeGraph also needs its MCP server in `~/.omp/agent/mcp.json`. Merge this entry into the file; do not replace it:

```json
{ "mcpServers": { "codegraph": { "type": "stdio", "command": "codegraph", "args": ["serve", "--mcp"] } } }
```

Then run `/codegraph init` or `/beads init` in a project to create its data. Detection alone never initializes anything.

Headroom never starts the proxy itself. After the proxy is up, save its token with `/headroom token` and check it with `/headroom health`.

### Replacing third-party plugins

`ponytail`, `rtk` and pstack replace `@dietrichgebert/ponytail`, `pi-rtk-optimizer` and the marketplace `pstack@omp-pstack`. Remove those first, so instructions and command rewrites are not applied twice:

```sh
omp plugin uninstall @dietrichgebert/ponytail
omp plugin uninstall pi-rtk-optimizer
omp plugin uninstall pstack@omp-pstack
```

### Update and uninstall

Update by running the install commands again. Uninstall with:

```sh
omp plugin uninstall omp-plugins
omp plugin uninstall @codesook/omp-pstack
```

`omp plugin uninstall` reinstalls the remaining plugins from `~/.omp/plugins/package.json`.

### From a local checkout

Link the checkout so edits load on the next OMP start:

```sh
bun install
omp plugin link "$PWD"
omp plugin features omp-plugins --enable=headroom,prompt-border-style,shared-display,ponytail,caveman,codegraph,beads,rtk,process-monitor,skill-stats
omp plugin link ./packages/pstack
readlink ~/.omp/plugins/node_modules/omp-plugins   # should print this checkout's path
```

Uninstalling any other plugin replaces the link with the GitHub copy and resets enabled features. Run the link commands again afterwards.

Install a single package from a checkout:

```sh
bun install
omp plugin install "$PWD/packages/headroom"
omp plugin install "$PWD/packages/prompt-border-style"
omp plugin install "$PWD/packages/shared-display"
omp plugin install "$PWD/packages/ponytail"
omp plugin install "$PWD/packages/caveman"
omp plugin install "$PWD/packages/codegraph"
omp plugin install "$PWD/packages/beads"
omp plugin install "$PWD/packages/rtk"
omp plugin install "$PWD/packages/process-monitor"
omp plugin install "$PWD/packages/skill-stats"
```

### Packages

| Package | Feature | Entry |
| --- | --- | --- |
| `@codesook/omp-plugin-settings` | Settings | `packages/codesook-omp-plugin/index.ts` |
| `@codesook/omp-headroom` | `headroom` | `packages/headroom/index.ts` |
| `@codesook/omp-prompt-border-style` | `prompt-border-style` | `packages/prompt-border-style/src/main.ts` |
| `@codesook/omp-shared-display` | `shared-display` | `packages/shared-display/src/index.ts` |
| `@codesook/omp-caveman` | `caveman` | `packages/caveman/src/index.ts` |
| `@codesook/omp-ponytail` | `ponytail` | `packages/ponytail/src/index.ts` |
| `@codesook/omp-codegraph` | `codegraph` | `packages/codegraph/src/index.ts` |
| `@codesook/omp-beads` | `beads` | `packages/beads/src/index.ts` |
| `@codesook/omp-rtk` | `rtk` | `packages/rtk/src/index.ts` |
| `@codesook/omp-process-monitor` | `process-monitor` | `packages/process-monitor/src/index.ts` |
| `@codesook/omp-skill-stats` | `skill-stats` | `packages/skill-stats/src/index.ts` |
| `@codesook/omp-pstack` | separate plugin | `packages/pstack/src/index.ts` |
| `@codesook/omp-theme-catppuccin` | theme installer | `packages/theme-catppuccin/bin/install.js` |

## Command tree

```text
/omp-plugins
/omp-plugins status
/omp-plugins init config
/headroom [status|on|off|health|stats|token|init [config|glyphs|all]]
/ponytail [status|off|lite|full|ultra|review]
/caveman [status|off|caveman|ultracave|megacave]
/poteto <task>
/pstack [status|setup|preset <name>|doctor]
/ultracave
/megacave
/codegraph [init|status|auto|off]
/beads [init|status|tasks|auto|off]
/procs
/skill-stats [project|reset [skill]|project reset [skill]|import]
/prompt-border [status|<style> [layout]|layout <layout>|reset|rail toggle|glyphs debug [frames|demo|on|off]]
```

In interactive OMP, accept bare `/codegraph` or `/beads` with Tab to insert a trailing space and show existing action suggestions. Choose an action to insert command text only; press Enter to execute it. Press Enter on the bare command to open the native description-bearing action menu. Esc dismisses that menu without action. `/headroom`, `/caveman`, and `/prompt-border` without arguments also open action choices. Native selectors show a description of each choice; longer menus show the selected choice's description. **Choose…** items open further choices rather than applying a setting. Use the terminal's normal navigation and confirmation keys; Esc cancels a menu without running its action.

Incomplete `/prompt-border style`, `layout`, `rail`, `glyphs`, and `glyphs debug` routes open the matching choices. Border style first offers **Choose uniform borders** or **Choose mixed and line borders**, then the styles in that group, keeping descriptions visible in short terminals. A style choice keeps the current layout; a layout choice keeps the current style. Complete commands, including `<style> <layout>`, still run directly. Context Rail offers only the existing session toggle here; saved rail settings remain in root settings. There is no standalone `/context-rail` command.

The Headroom menu's **Choose files to initialize** opens configuration, glyph, or combined choices. Explicit `/headroom init` still initializes **all** files directly. Existing files retain per-file overwrite prompts: declining an overwrite skips that file, not the whole operation. **Set proxy token** opens visible token input; saving replaces the configured token and checks proxy health.

Beads initialization reuses ready data without setup choices. A new workspace opens a mode choice, then a Git-hook choice; their descriptions explain the continuation and native Git effects. Esc at either choice cancels initialization. CodeGraph initialization starts its existing native operation immediately. Neither operation changes project policy.

Without an interactive selector, bare commands and incomplete menu routes show the available explicit commands and their outcomes. Explicit status routes remain accessible even when persistent status is hidden.

Root settings owns persisted configuration. Feature commands own session behavior; CodeGraph and Beads policy commands explicitly write shared project policy. Feature `config` commands and `/shared-display` are removed. Status commands open focused read-only overlays; Enter/Esc closes. `/omp-plugins init config` creates the v1 global config only when absent and seeds only missing glyph files.

`/omp-plugins` opens a two-level overlay that edits a draft. The first screen lists one entry per section (Presence, CodeGraph, Beads, Shared Display, Ponytail, Caveman, pstack, Headroom, RTK, Prompt Border, Context Rail), each showing its count of changed values and a `not loaded` badge when that feature is not enabled in omp-plugins (pstack, which installs only as its own package, reads `not installed`), followed by the actions. ↑↓ moves, Enter opens a section and edits values there, Esc returns from a section to the list. The header shows the total unsaved count.

Shift+Enter applies directly from any screen. Bare Enter on Apply opens confirmation inside the same focused overlay without saving. Enter confirms; Esc declines and returns to the unchanged draft without writes or live-change events. Esc on the section list, or the Cancel action, closes at once when nothing changed. With unsaved changes it asks first: Enter discards the draft, Esc keeps editing, Shift+Enter applies instead. Reload discards the draft without asking and leaves persisted and live state unchanged.

The root settings **Create missing files** action runs immediately from **saved settings**, independently of the draft and Apply. It creates missing configuration and glyphs, preserves existing files, and keeps the draft open. Results appear in the same focused overlay; use ↑↓ to scroll and Enter/Esc to return to editing. Cancel afterward does not undo files created by this explicit action. `/omp-plugins init` exposes the same initialization choice; the complete `init config` command still runs directly.

### Command menu update

All existing feature command families now provide described native choices. Root settings keeps its staged editing surface and exposes its previously command-only initialization action. No tools, servers, plugins, or new operations are installed or started by opening a menu.

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
~/.config/codesook-omp/ponytail/
~/.config/codesook-omp/headroom/
~/.config/codesook-omp/prompt-border/
~/.config/codesook-omp/context-rail/
```

Missing valid legacy package/settings files migrate into missing root sections. Invalid root JSON wins and is never overwritten. Successful migration removes only valid imported legacy JSON; invalid files remain for repair. Asset files remain external.

### CodeGraph project integration

CodeGraph detects existing native Tool Workspaces without automatically initializing, indexing, installing tools, changing MCP setup, or writing agent instructions. `/codegraph init` explicitly prepares new project data and its initial graph, reuses valid existing workspaces, and leaves project policy unchanged, including off. Ready requires successful CLI project-data inspection and an active configured exploration MCP tool. Status distinguishes suppression, missing data/prerequisites, readiness, and errors; MCP connection health was not tested.

Global defaults use `behavior.codegraph.policy` (`auto`/`off`) and `display.codegraph.visibility` (`ready`/`always`/`never`). Shared project overrides use the same v1 envelope in `<Integration Project>/.omp/codesook-omp.json`; project values win. The nearest Git working tree owns policy, or the operating directory outside Git. Native CodeGraph ancestor discovery and overrides can resolve a different Tool Workspace. Detailed status identifies both.

The unified dialog stages global values and project overrides; inherit removes an override. Invalid policy is reported, preserved, and fails closed. Unknown fields survive writes. Detection, Reload, and Cancel create no project settings; explicit Apply or policy commands may write them, never commit them.

Both integrations fail closed when Git cannot inspect the Integration Project, including missing Git, permission errors, and unsafe repository ownership. Repair the reported Git error before enabling guidance or saving project settings. The operating-directory fallback applies only when Git confirms that the directory is outside a repository; inspection errors never select a child directory as a new policy root.

When either integration cannot resolve project scope, valid global visibility still controls persistent error display: `always` shows the error, while `never` keeps it hidden. This display-only fallback never permits guidance or reads a guessed project settings file; read-only status remains available.

Permitted ready integrations append CodeGraph-first guidance with an explicit resolved `projectPath`, preserving prior prompt entries and allowing grep/read for missing or stale source. Off suppresses only this plugin's instructions. Visibility defaults to ready; always shows all states, never hides persistent status only. CodeGraph uses Shared Display when its host is active, otherwise the native footer, never both. Refresh runs on startup, before turns, commands, settings changes, and session switches; no idle polling.

See [CodeGraph package documentation](packages/codegraph/README.md) for installation, native MCP configuration, and the shared policy/client interfaces.

### Beads project integration

Beads detects a usable existing native Tool Workspace through the installed `bd` CLI. Discovery respects ancestor lookup, environment overrides, redirects, and worktree sharing; a folder or location result alone is not readiness. Status identifies the Integration Project, Tool Workspace, database, policy, and errors. `/beads init` reuses existing usable workspaces first. New initialization offers standard/team or personal stealth mode, with supported Git hooks opt-in and off by default; Esc in either choice cancels the entire operation. Agent generation is always skipped. Initialization preserves policy, including off, and does not authorize issue operations, install tools, provision servers, or add automatic remote push/sync.

New data belongs to the Integration Project. Linked-worktree initialization uses a one-command native `BEADS_DIR` target, then verifies ordinary discovery without the override; existing native shared/redirected/environment-selected workspaces remain unchanged. Partial data, native backend failures, invalid settings, and remote-history refusals are never bypassed. Native Beads 1.3.1 standard init makes a Git commit, including staged or auto-staged user files. The plugin refuses unsafe staged entries and dirty setup/root Markdown files before invoking it; explicit stealth preserves the index. See the package documentation for the safety boundary and native hook behavior.

Global `behavior.beads.policy` (`auto`/`off`) and `display.beads.visibility` (`ready`/`always`/`never`) use the same settings envelope and staged project overrides as CodeGraph, independently. Invalid configuration fails closed and remains unchanged. Beads depends on Shared Display's 1.2.0 client/settings contracts, not on an active host or the CodeGraph plugin.

Ready, permitted Beads guidance authorizes issue operations only after an explicit user request and within its scope. Availability alone never enables automatic issue tracking for unrelated work. Off removes only plugin guidance, not CLI access, data, or existing repository obligations. Status remains a read-only overlay even with hidden persistent display. Host-active display uses one shared segment; otherwise it uses the native footer. With open issues the segment shows `Beads: <ready> ready · <open> open` (template `display.beads.template`, tokens `{ready}`, `{open}`, `{inProgress}`), and `/beads tasks` opens a live read-only list grouped by status. Refresh follows startup, turns, commands, settings changes, project switches, and Beads writes to the workspace (a debounced directory watch, never timer polling).

See [Beads package documentation](packages/beads/README.md) for independent installation and operation.

## Implemented ownership

- Shared Display owns the single `codesook-shared-display` widget, source composition, and animation clock.
- Headroom remains a compression producer and continues working without Shared Display; proxy lifecycle is external, while health checks may run at session start or live config change and never start the proxy.
- Caveman injects the pinned skill, recovers session Mode Levels from branch entries, and publishes custom/native status independently.
- Ponytail injects its pinned skill, recovers session Mode Levels from branch entries, and publishes custom/native status independently.
- Prompt Border owns the prompt editor, Context Rail, attachment band, and spinner overrides; it does not publish Shared Display sources.
- Root settings detects OMP feature presence through `omp plugin list --json`; it never unloads or loads plugins.
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

## Releasing pstack

Users install pstack from the dist repository [`seenark/omp-pstack`](https://github.com/seenark/omp-pstack) (see [pstack](#pstack) above). That repository holds only built releases.

To cut a release, bump `version` in `packages/pstack/package.json` and merge to `main`. The Release workflow (`.github/workflows/release.yml`) builds the plugin tree, commits it to `main` of `seenark/omp-pstack`, and tags it `v<version>`. It pushes with the `PSTACK_DIST_DEPLOY_KEY` repository secret, the private half of a write deploy key on `seenark/omp-pstack`. A version already tagged there does nothing. Preview the decision and build the tree locally:

```sh
bun run build:release -- --decide
bun run build:release -- --out /tmp/pstack-release
```

The CI workflow runs `bun run verify` on every pull request and push to `main`.

## Local OMP smoke loading

Load extension entries directly from a disposable home/session tree:

```sh
HOME="$TMP_HOME" XDG_CONFIG_HOME="$TMP_XDG" \
PI_CODING_AGENT_DIR="$TMP_AGENT" PI_CODING_AGENT_SESSION_DIR="$TMP_SESSIONS" \
omp --cwd "$TMP_WORK" --session-dir "$TMP_SESSIONS" \
  --extension "$PWD/packages/codesook-omp-plugin/index.ts" \
  --extension "$PWD/packages/shared-display/src/index.ts" \
  --extension "$PWD/packages/ponytail/src/index.ts" \
  --extension "$PWD/packages/caveman/src/index.ts" \
  --extension "$PWD/packages/headroom/index.ts" \
  --extension "$PWD/packages/prompt-border-style/src/main.ts"
```

Use disposable homes only. The repository's focused tests use injected temporary paths for migration, staged Apply/Cancel, EventBus replay, and source lifecycle behavior.
