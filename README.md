# omp-plugins

Standalone [oh-my-pi](https://github.com/can1357/oh-my-pi) extensions in one Bun workspace.

## Packages and features

| Package | Feature | Default | Entry |
| --- | --- | --- | --- |
| `@codesook/omp-headroom` | `headroom` | yes | `packages/headroom/index.ts` |
| `@codesook/omp-prompt-border-style` | `prompt-border-style` | yes | `packages/prompt-border-style/src/main.ts` |
| `@codesook/omp-shared-display` | `shared-display` | no | `packages/shared-display/src/index.ts` |
| `@codesook/omp-caveman` | `caveman` | no | `packages/caveman/src/index.ts` |
| `@codesook/omp-theme-catppuccin` | theme package | — | `packages/theme-catppuccin/bin/install.js` |

A normal root install enables only the two default features. Opt-in packages are intentionally side-effect free unless selected; importing `@codesook/omp-shared-display/client` never activates its extension entry.

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
```

Install Catppuccin themes:

```sh
bun packages/theme-catppuccin/bin/install.js
```

## Command tree

- `/headroom [config|status|on|off|health|stats|init [config|glyphs|all]]`
- `/shared-display [config|status]`
- `/caveman [config|status|off|lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra]`
- `/prompt-border [config|status|<style> [layout]|layout <layout>|reset|rail toggle|glyphs debug [frames|demo|on|off]]`

Bare package commands and `config` open the same staged Settings Dialog. Dialog edits are drafts: `Apply` validates and atomically replaces the package JSON; `Reload` discards the draft; `Cancel` leaves persisted and live state unchanged. Initialize actions create only missing assets after confirmation.

## Configuration and migration

Each package owns one destination JSON file:

- Shared Display: `~/.config/codesook-omp/shared-display/config.json`
- Caveman: `~/.config/codesook-omp/caveman/config.json`
- Headroom: `~/.config/codesook-omp/headroom/config.json`
- Prompt Border: `~/.config/codesook-omp/prompt-border/config.json`

Migration is destination-gated and runs once. An existing destination wins, including an invalid destination (which falls back to runtime defaults without importing legacy values). A missing destination is created from independently normalized legacy sources without modifying legacy files. Legacy aliases and split command paths are not retained.

## Implemented ownership

- Shared Display owns the single `codesook-shared-display` widget, source composition, and animation clock.
- Headroom remains a compression/proxy producer and continues working without Shared Display; it publishes no private widget or native status.
- Caveman injects the pinned skill, recovers session levels from branch entries, and publishes custom/native status independently.
- Prompt Border owns the prompt editor, Context Rail, attachment band, and spinner overrides; it does not publish Shared Display sources.

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
bun run publish:headroom
bun run publish:prompt-border-style
bun run publish:theme-catppuccin
bun run publish:all
```

## Local OMP smoke loading

Load extension entries directly from a disposable home/session tree:

```sh
HOME="$TMP_HOME" XDG_CONFIG_HOME="$TMP_XDG" \
PI_CODING_AGENT_DIR="$TMP_AGENT" PI_CODING_AGENT_SESSION_DIR="$TMP_SESSIONS" \
omp --cwd "$TMP_WORK" --session-dir "$TMP_SESSIONS" \
  --extension "$PWD/packages/shared-display/src/index.ts" \
  --extension "$PWD/packages/caveman/src/index.ts" \
  --extension "$PWD/packages/headroom/index.ts" \
  --extension "$PWD/packages/prompt-border-style/src/main.ts"
```

Use disposable homes only. The repository's focused tests use injected temporary paths for migration, staged Apply/Cancel, EventBus replay, and source lifecycle behavior.
