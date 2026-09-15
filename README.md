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
| `@codesook/omp-theme-catppuccin` | theme package | — | `packages/theme-catppuccin/bin/install.js` |

Root install loads unified settings plus default Headroom and Prompt Border features. Shared Display and Caveman remain opt-in.

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

```text
/codesook-omp-plugin
/codesook-omp-plugin status
/headroom [status|on|off|health|stats|init [config|glyphs|all]]
/caveman [status|off|lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra]
/prompt-border [status|<style> [layout]|layout <layout>|reset|rail toggle|glyphs debug [frames|demo|on|off]]
```

Root settings owns persisted configuration. Feature commands own session behavior only; feature `config` commands and `/shared-display` are removed. Status commands open focused read-only overlays; Enter/Esc closes.

`/codesook-omp-plugin` edits a draft. Shift+Enter applies directly. Bare Enter on Apply asks confirmation. Reload discards draft; Cancel leaves persisted and live state unchanged.

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

## Implemented ownership

- Shared Display owns the single `codesook-shared-display` widget, source composition, and animation clock.
- Headroom remains a compression producer and continues working without Shared Display; proxy lifecycle is external, while health checks may run at session start or live config change and never start the proxy.
- Caveman injects the pinned skill, recovers session levels from branch entries, and publishes custom/native status independently.
- Prompt Border owns the prompt editor, Context Rail, attachment band, and spinner overrides; it does not publish Shared Display sources.
- Root settings detects Ponytail and OMP feature presence through `omp plugin list --json`; it never unloads or loads plugins.

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
