# omp-prompt-border-style

![Preview](assets/preview.png)

Prompt border styles for the oh-my-pi input editor.

## What this plugin does

This plugin registers a `/prompt-border` command that lets you switch the prompt editor border style and layout at runtime.

It customizes:
- the top status-line border glyphs
- the editor side borders
- a synthetic bottom border for layouts that use one
- config-driven animated left/right cursor-row glyphs when glyph text is configured
- config-driven status and activity spinner glyphs that preserve Oh My Pi defaults for any unconfigured spinner group
- slash-command argument completions for the command itself

The default active state is:
- style: `double`
- layout: `full`

## Requirements

- `omp` with plugin support
- `@oh-my-pi/pi-coding-agent` `>=18.0.1`
- `@oh-my-pi/pi-tui` `>=18.0.1`

This package declares the OMP packages as peer dependencies because it extends the host editor UI.

## Install

From a published package name:

```bash
omp plugin install @codesook/omp-prompt-border-style
```

From a local checkout during development:

```bash
omp plugin install "$PWD/packages/prompt-border-style"
```

This repo exposes the extension through `omp.extensions` in `package.json`, pointing at `./src/main.ts`.

## Command

```text
/prompt-border <style> [layout]
/prompt-border layout <layout>
/prompt-border reset
/prompt-loading-glyphs debug <frames|demo|on|off>
```

If the arguments are invalid, the plugin shows the matching command usage string in the UI.

## Styles

- `round`
- `sharp`
- `heavy`
- `dashed`
- `heavy-dashed`
- `heavy-top`
- `double`
- `double-top`
- `double-side`
- `ascii`
- `block`
- `vertical`
- `double-vertical`
- `horizontal`
- `double-horizontal`

## Layouts

- `full` — full top border, side borders, and a separate synthetic bottom border
- `bottom` — keeps the upstream top/status row and adds only the separate synthetic bottom border
- `sides` — keeps only the left and right editor borders around the body rows
- `top-bottom` — keeps the top border and separate synthetic bottom border, hides side borders in body rows
- `default` — uses the upstream editor layout, restyled with the selected border glyph set

For non-`default` layouts, the plugin inserts the synthetic bottom border before autocomplete rows so slash-command suggestions stay below the editor body.

## Configuration

The plugin reads optional settings from `~/.config/codesook-omp/config.json` and writes `style`/`layout` changes there when `/prompt-border` applies a new selection. That JSON is safe to share across computers.

`style` and `layout` set the initial prompt border. The same shared file may also contain a `welcomeScreen` section managed by `codesook-omp`; this plugin preserves that section when it updates `promptBorder`. Local glyph frame text lives next to the JSON in `~/.config/codesook-omp/prompt-border-left-glyphs.txt`, `~/.config/codesook-omp/prompt-border-right-glyphs.txt`, `~/.config/codesook-omp/prompt-border-status-spinner-glyphs.txt`, and `~/.config/codesook-omp/prompt-border-activity-spinner-glyphs.txt`. Frames are whitespace-separated in those text files. Oh My Pi currently has two spinner groups: status and activity. Status frames are used by theme.spinnerFrames/status UI spinners; activity frames are used by getSymbolTheme().spinnerFrames/loading activity spinners.

```json
{
  "promptBorder": {
    "style": "double",
    "layout": "full",
    "leftGlyph": {
      "frameMs": 70
    },
    "rightGlyph": {
      "frameMs": 70
    },
    "spinnerGlyphs": {
      "status": {
        "frameMs": 80
      },
      "activity": {
        "frameMs": 80
      }
    }
  }
}
```

`spinnerGlyphs.status.frameMs` and `spinnerGlyphs.activity.frameMs` set the desired source-frame duration in milliseconds for each spinner group.

```text
# ~/.config/codesook-omp/prompt-border-left-glyphs.txt
􁦘􁦙  􁦚􁦛
```

```text
# ~/.config/codesook-omp/prompt-border-right-glyphs.txt

```

```text
# ~/.config/codesook-omp/prompt-border-status-spinner-glyphs.txt
S0  S1  S2
```

```text
# ~/.config/codesook-omp/prompt-border-activity-spinner-glyphs.txt
􁦘􁦙  􁦚􁦛
```

```text
# With activity.frameMs = 240, each activity frame is repeated internally for about 240ms.
# With activity.frameMs = 40, the plugin skips source frames because Oh My Pi cannot repaint the spinner faster than 80ms.
```

Each spinner file may contain one or more whitespace-separated frames. The plugin adapts those configured frames to Oh My Pi's fixed 80ms host spinner tick by repeating frames for slower `frameMs` values and skipping source frames for faster ones. There is no plugin-imposed maximum frame count, but very high `frameMs` values duplicate frames internally, so huge source lists plus slow timings create larger in-memory spinner arrays. If a spinner file is empty or missing, that spinner group is not patched and Oh My Pi uses its built-in frames for that group.

The left and right glyph files affect only the cursor/input row. They do not change border style, layout, side borders, top borders, autocomplete rows, or synthetic bottom borders.

## Debugging loading glyphs

Use the dedicated loading-glyph debug command instead of spending model tokens:

```text
/prompt-loading-glyphs debug frames
/prompt-loading-glyphs debug demo
/prompt-loading-glyphs debug on
/prompt-loading-glyphs debug off
```

`debug frames` prints the source and visible frame sequence for each loading group after `frameMs` adaptation. `debug demo` renders a local no-token preview for every loading group listed by the plugin, currently `status loading` and `activity loading`.
After editing `~/.config/codesook-omp/prompt-border-status-spinner-glyphs.txt`, `~/.config/codesook-omp/prompt-border-activity-spinner-glyphs.txt`, or the matching `spinnerGlyphs.*.frameMs` values in `~/.config/codesook-omp/config.json`, run `/prompt-loading-glyphs debug frames` first and then `/prompt-loading-glyphs debug demo` to verify the actual visible sequence and animation.
For example, with `frameMs = 20` a source list such as `F0 F1 F2 F3 F4 F5 F6 F7` may render as `F0 F4`, so the loop must stay smooth on that visible subsequence rather than only on the full source list.

## Examples

```text
/prompt-border round
/prompt-border heavy
/prompt-border dashed
/prompt-border double bottom
/prompt-border sharp sides
/prompt-border double top-bottom
/prompt-border layout full
/prompt-border layout bottom
/prompt-border layout sides
/prompt-border layout default
/prompt-border reset
```

## Autocomplete behavior

Typing `/prompt-border ` and then pressing Space or Tab opens command completions.

- First position: all style names, plus `layout` and `reset`
- After a style: all layout names
- After `layout`: all layout names, returned as `layout <name>` completions

## Development

Install dependencies:

```bash
bun install
```

Run the typecheck:

```bash
bun run check
```

Run the tests:

```bash
bun test src/main.test.ts
```

## Release

From the monorepo root, publish this package with:

```bash
bun run publish:prompt-border-style
```

## Repository contents

- `src/main.ts` — plugin implementation, border rendering, status/activity spinner glyph patching, and command registration
- `src/main.test.ts` — parser, renderer, command, and completion tests
- `package.json` — package metadata, peer dependencies, scripts, and OMP extension entrypoint
- `tsconfig.json` — TypeScript configuration
