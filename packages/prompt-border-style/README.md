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
/prompt-border
/prompt-border config
/prompt-border status
/prompt-border <style> [layout]
/prompt-border layout <layout>
/prompt-border reset
/prompt-border rail toggle
/prompt-border glyphs debug <frames|demo|on|off>
```

`/prompt-border` and `/prompt-border config` open the staged Settings dialog. The dialog edits a draft. `Apply` validates and atomically replaces the package destination; `Reload` discards the draft; `Cancel` leaves persisted and live state unchanged. Asset initialization creates only missing files after confirmation.

Unknown nested command paths are rejected. `micro`, old aliases, and split command names are not registered.

Styles:

```text
round sharp heavy dashed heavy-dashed heavy-top double double-top
 double-side ascii block vertical double-vertical horizontal double-horizontal
```

Layouts: `full`, `bottom`, `sides`, `top-bottom`, and `default`.

## Configuration

The package owns one normalized destination:

```text
~/.config/codesook-omp/prompt-border/config.json
```

The JSON contains `promptBorder` and `contextRail` sections. Example:

```json
{
  "promptBorder": {
    "style": "double",
    "layout": "full",
    "leftGlyph": { "frameMs": 70 },
    "rightGlyph": { "frameMs": 70 },
    "spinnerGlyphs": {
      "status": { "frameMs": 80 },
      "activity": { "frameMs": 80 }
    }
  },
  "contextRail": {
    "enabled": true,
    "placement": "inside",
    "visibility": "always",
    "mode": "compact",
    "glyphDirectory": "~/.config/codesook-omp/context-rail",
    "speculation": { "framesFile": "speculation.txt", "meaning": "spec" },
    "pointer": { "framesFile": "pointer.txt", "visibility": "auto", "meaning": "now" },
    "compaction": { "framesFile": "compaction.txt", "meaning": "compact" },
    "maximum": { "framesFile": "maximum.txt", "meaning": "max" },
    "custom": {
      "meaningPlacement": "beside",
      "items": [
        { "role": "speculation", "template": "{frame} {text-meaning}" },
        { "role": "pointer", "template": "{frame} {percent}" },
        { "role": "compaction", "template": "{frame} {text-meaning}" },
        { "role": "maximum", "template": "{frame} {window} {text-meaning}" }
      ]
    }
  }
}
```

Prompt Border glyph text files live beside the destination JSON:

```text
~/.config/codesook-omp/prompt-border/prompt-border-left-glyphs.txt
~/.config/codesook-omp/prompt-border/prompt-border-right-glyphs.txt
~/.config/codesook-omp/prompt-border/prompt-border-status-spinner-glyphs.txt
~/.config/codesook-omp/prompt-border/prompt-border-activity-spinner-glyphs.txt
```

Frames may be whitespace-separated one-row glyphs or blank-line-separated multiline frames. `fps=` and `size=` directives remain accepted for Context Rail assets. Context Rail role files live under `contextRail.glyphDirectory`; default files are `speculation.txt`, `pointer.txt`, `compaction.txt`, and `maximum.txt`.

## Migration

Migration is destination-gated:

- an existing `prompt-border/config.json` wins, including invalid JSON;
- an absent destination imports the old root configuration once and normalizes it into `promptBorder` and `contextRail`;
- adjacent legacy glyph files are copied byte-for-byte only when the corresponding destination file is missing;
- legacy files remain unchanged;
- later loads use the destination only.

The old root source is accepted only for migration:

```text
~/.config/codesook-omp/config.json
```

No shared root JSON is read or written after migration. No compatibility command aliases are registered.

## Context Rail

Context Rail can render inside the prompt editor or in a widget above/below it. It supports `compact`, `full`, and `custom` modes; pointer visibility; role meanings; custom templates; and animated role assets. It is independent from OMP's native context gauge, so both can remain enabled.

Use the `/prompt-border` dialog for persisted Context Rail settings. `/prompt-border rail toggle` changes the configured toggle behavior or the session-only enabled override; there is no standalone Context Rail command.

## Lifecycle and ownership

Session start, switch, and branch reload the destination and rebuild the editor/rail owner. Session shutdown clears the editor, attachment band, Context Rail, spinner overrides, and session-only overrides. Context Rail frame timers are disposed with the runtime.

Prompt Border owns its editor and rail surfaces. `@codesook/omp-shared-display` owns the separate `codesook-shared-display` widget and clock; this package neither mounts that widget nor publishes a Shared Display source.

## Development

```sh
bun install
bun run typecheck
bun run test
bun run check
bun run pack:check
bun run verify
```
