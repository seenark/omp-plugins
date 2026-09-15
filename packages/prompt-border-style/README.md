# @codesook/omp-prompt-border-style

Prompt editor border and Context Rail extension for [oh-my-pi](https://github.com/can1357/oh-my-pi).

It owns the prompt editor replacement, border styles, Context Rail, prompt attachment band, and optional spinner glyph overrides. It does not own the Shared Display widget.

## Requirements and install

- OMP 18.1.16 or newer;
- `@oh-my-pi/pi-coding-agent` and `@oh-my-pi/pi-tui` `>=18.1.16`.

```sh
omp plugin install @codesook/omp-prompt-border-style
omp plugin install "$PWD/packages/prompt-border-style"
```

One-off load:

```sh
omp --extension "$PWD/packages/prompt-border-style/src/main.ts"
```

## Commands

```text
/prompt-border status
/prompt-border <style> [layout]
/prompt-border layout <layout>
/prompt-border reset
/prompt-border rail toggle
/prompt-border glyphs debug <frames|demo|on|off>
```

`/prompt-border status` opens focused read-only overlay; Loading/result/error is async and Enter/Esc closes. Bare `/prompt-border` settings form and `/prompt-border config` are removed. Root `/codesook-omp-plugin` owns persisted settings; behavior commands remain session-scoped.

Styles:

```text
round sharp heavy dashed heavy-dashed heavy-top double double-top
 double-side ascii block vertical double-vertical horizontal double-horizontal
```

Layouts: `full`, `bottom`, `sides`, `top-bottom`, and `default`.

## Configuration


Prompt Border presentation persists in `display.promptBorder` and `display.contextRail` inside:

```text
~/.config/codesook-omp/config.json
```

Example:

```json
{
  "version": 1,
  "display": {
    "promptBorder": {
      "style": "double",
      "layout": "full",
      "frameMs": 70
    },
    "contextRail": {
      "enabled": true,
      "placement": "inside",
      "visibility": "always",
      "mode": "compact",
      "glyphDirectory": "~/.config/codesook-omp/context-rail"
    }
  },
  "behavior": {}
}
```

Root settings exposes border style/layout/frame timing plus Context Rail topology, visibility, mode, labels, role meanings, and asset paths. Full role configuration remains supported in root `display.contextRail`; glyph/frame bytes stay external.

Prompt Border glyph text files remain under:

```text
~/.config/codesook-omp/prompt-border/
```

Context Rail role assets remain under `contextRail.glyphDirectory`, default `~/.config/codesook-omp/context-rail/`.

## Migration

Legacy `~/.config/codesook-omp/prompt-border/config.json` migrates into missing root display sections. An old root-level Prompt Border object is recognized only when root envelope is invalid, then converted. Legacy glyph files copy byte-for-byte only when destination assets are missing. Successful package-config migration removes valid old JSON; invalid files remain for repair. Asset files remain external.

Root `/codesook-omp-plugin` edits persisted Context Rail settings. `/prompt-border rail toggle` changes configured toggle behavior or session-only enabled override; no standalone Context Rail command.

## Lifecycle and ownership

Session start, switch, and branch reload the destination and rebuild the editor/rail owner. Session shutdown clears the editor, attachment band, Context Rail, spinner overrides, and session-only overrides. Context Rail frame timers are disposed with the runtime.

Prompt Border owns its editor and rail surfaces. `@codesook/omp-shared-display` owns the separate `codesook-shared-display` widget and clock; this package neither mounts that widget nor publishes a Shared Display source.

## Development

```sh
bun install
bun run check:types
bun run test
bun run check
bun run pack:check
bun run verify
```
