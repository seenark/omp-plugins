# omp-prompt-border-style

![Preview](assets/preview.png)

Prompt border styles for the oh-my-pi input editor.

## What this plugin does

This plugin registers a `/prompt-border` command that lets you switch the prompt editor border style and layout at runtime.

- the surrounding top status-line frame glyphs while preserving the upstream status content/context gauge, including its colors and boundary markers
- the editor side borders
- a synthetic bottom border for layouts that use one
- config-driven animated left/right cursor-row glyphs when glyph text is configured
- config-driven status and activity spinner glyphs that preserve Oh My Pi defaults for any unconfigured spinner group
- slash-command argument completions for the command itself
- the plugin-owned Context Rail, which renders independently from OMP's native context gauge
- a continuous proportional Context Rail bar with positioned role tiles and `compact` (default), `full`, and `custom` presentation modes
- configurable Context Rail placement (`inside`, `above`, or `below`), visibility mode, role glyph assets, meanings, templates, and pointer visibility
- multiline paste attachment cards above the prompt, alongside the host editor replacement

The default active state is:
- style: `double`
- layout: `full`

## Requirements

- `omp` with plugin support
- `@oh-my-pi/pi-coding-agent` `>=18.0.3`
- `@oh-my-pi/pi-tui` `>=18.0.3`

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

## Quick start

1. Install the plugin and start OMP:

   ```bash
   omp plugin install @codesook/omp-prompt-border-style
   omp
   ```

2. Create the Context Rail asset directory:

   ```bash
   mkdir -p ~/.config/codesook-omp/context-rail
   ```

3. Add one frame file for each semantic role. The default filenames are:

   ```text
   speculation.txt
   pointer.txt
   compaction.txt
   maximum.txt
   ```

4. Set `contextRail.mode` in `~/.config/codesook-omp/config.json` to `compact`, `full`, or `custom`. `compact` is the default.

5. Reload the configuration without restarting the session:

   ```text
   /context-rail status
   ```

The Context Rail is a plugin-owned row. It does not replace or reconfigure OMP's native context gauge, so both displays can be enabled at the same time.

## Command

```text
/prompt-border <style> [layout]
/prompt-border layout <layout>
/prompt-border reset
/context-rail [status|on|off|toggle]
/context-rail placement <inside|above|below>
/context-rail visibility <always|toggle|collapse-while-typing>
/context-rail pointer <auto|visible|hidden>
/context-rail labels <auto|bar-only|always>
/context-rail label-glyph <on|off>
/context-rail position <left|center|right>
/prompt-loading-glyphs debug <frames|demo|on|off>
```

If the arguments are invalid, the plugin shows the matching command usage string in the UI.

### Context Rail commands

The command handler reloads and normalizes the shared configuration before applying an update.

```text
/context-rail status
```

Shows enabled state, placement, visibility, pointer visibility, presentation mode, label compatibility settings, and the latest known usage. It does not change configuration.

```text
/context-rail on
/context-rail off
/context-rail toggle
```

`on` and `off` persist the enabled state. `toggle` switches the current display when `visibility` is `toggle`; otherwise it toggles the persisted enabled state.

```text
/context-rail placement inside
/context-rail placement above
/context-rail placement below
```

- `inside` inserts the rail inside the prompt editor border.
- `above` mounts it as a widget above the editor.
- `below` mounts it as a widget below the editor.

```text
/context-rail visibility always
/context-rail visibility toggle
/context-rail visibility collapse-while-typing
```

- `always` keeps the rail visible while enabled.
- `toggle` allows `/context-rail toggle` to hide or show it.
- `collapse-while-typing` temporarily reduces the legacy presentation while draft text is active. The selected mode still owns the visible bar and role content.

```text
/context-rail pointer auto
/context-rail pointer visible
/context-rail pointer hidden
```

These values control the `pointer` role. `auto` is the default; `visible` forces the current-usage marker on; `hidden` removes it. The old scalar form is accepted in JSON and is rewritten as `pointer.visibility`.

The `labels`, `label-glyph`, and `position` commands remain available for older configurations. Their values are still persisted, but they do not inject a legacy percentage label into `compact`, `full`, or `custom` bar output.

`/context-rail init glyphs` is an explicit legacy initializer. It creates or replaces `label.txt` and the configured pointer file after confirmation. It does not generate speculation, compaction, or maximum role files.

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
- `default` — uses the upstream editor layout with the selected surrounding border frame while preserving the upstream status content/context gauge

For non-`default` layouts, the plugin inserts the synthetic bottom border before autocomplete rows so slash-command suggestions stay below the editor body.

## Configuration

The plugin Context Rail is independent from OMP's `statusLine.contextLine` setting. OMP's native gauge may remain enabled, be reduced to its percentage mode, or be disabled separately. The plugin reads context usage through the extension API and renders a continuous proportional bar with role markers; predictive boundary markers are only rendered when OMP reports boundary data.

The plugin reads optional settings from `~/.config/codesook-omp/config.json` and writes normalized Context Rail settings there. `/context-rail` placement, visibility, pointer visibility, and legacy label settings remain supported. That JSON is safe to share across computers.

`style` and `layout` set the initial prompt border, while the `contextRail` settings set the initial rail behavior. The same shared file may also contain a `welcomeScreen` section managed by `codesook-omp`; this plugin preserves that section when it updates `promptBorder`. Local glyph frame text lives next to the JSON in `~/.config/codesook-omp/prompt-border-left-glyphs.txt`, `~/.config/codesook-omp/prompt-border-right-glyphs.txt`, `~/.config/codesook-omp/prompt-border-status-spinner-glyphs.txt`, and `~/.config/codesook-omp/prompt-border-activity-spinner-glyphs.txt`. Context Rail role frames live under `contextRail.glyphDirectory`, one file per role. Frames are whitespace-separated; `fps=` and `size=` directives remain supported. Missing role files use static theme-derived fallback tiles and are never created automatically.

```json
{
  "promptBorder": {
    "style": "double",
    "layout": "full"
  },
  "contextRail": {
    "enabled": true,
    "placement": "inside",
    "visibility": "always",
    "mode": "compact",
    "speculation": {
      "framesFile": "speculation.txt",
      "meaning": "spec"
    },
    "pointer": {
      "framesFile": "pointer.txt",
      "visibility": "auto",
      "meaning": "now"
    },
    "compaction": {
      "framesFile": "compaction.txt",
      "meaning": "compact"
    },
    "maximum": {
      "framesFile": "maximum.txt",
      "meaning": "max"
    },
    "custom": {
      "meaningPlacement": "beside",
      "items": [
        { "role": "speculation", "template": "{frame} {text-meaning}" },
        { "role": "pointer", "template": "{frame} {percent}" },
        { "role": "compaction", "template": "{frame} {text-meaning}" },
        { "role": "maximum", "template": "{frame} {window} {text-meaning}" }
      ]
    },
    "labels": "auto",
    "labelPosition": "center",
    "showLabelGlyph": true,
    "glyphDirectory": "~/.config/codesook-omp/context-rail"
  }
}
```

`compact` is the default and renders a continuous bar, the current percentage, and positioned role tiles. It omits Meaning Text, token counts, and window values. `full` adds Meaning Text beside feasible tiles and the context-window value. `custom` expands `{frame}`, `{text-meaning}`, `{percent}`, `{tokens}`, `{window}`, and `{role}` from one normalized item per role; `meaningPlacement` may be `beside`, `top`, or `below`. Unknown brace expressions stay literal.

`contextRail.labelPosition` and `showLabelGlyph` remain readable for compatibility with older configurations and the legacy renderer path. They do not add legacy label decoration to the bar-based presentation.

Role frames are read from `contextRail.glyphDirectory` using each role's `framesFile`. Whitespace separates one-row frames; contiguous glyph characters such as `􂹽􂹾` stay in one tile. Pointer visibility remains `auto`, `visible`, or `hidden`. Missing, empty, or unreadable role files use static theme-derived fallback tiles.

### Context Rail fields

The `contextRail` object has two groups of settings:

- **Rail topology:** `enabled`, `placement`, `visibility`, and `glyphDirectory`.
- **Presentation:** `mode`, the four semantic role objects, and `custom`.

| Field | Values | Description |
| --- | --- | --- |
| `enabled` | `true` / `false` | Enables or disables the plugin-owned row. |
| `placement` | `inside`, `above`, `below` | Chooses the row's position relative to the prompt editor. |
| `visibility` | `always`, `toggle`, `collapse-while-typing` | Controls whether the row is mounted and how draft activity affects legacy decoration. |
| `mode` | `compact`, `full`, `custom` | Selects the continuous-bar presentation. Defaults to `compact`. |
| `glyphDirectory` | path or `~` path | Directory containing role frame files. |
| `pointer.visibility` | `auto`, `visible`, `hidden` | Controls only the current-usage pointer tile. Defaults to `auto`. |
| `role.framesFile` | non-empty filename | Role asset filename, resolved relative to `glyphDirectory`. |
| `role.fps` | positive number | Optional JSON animation rate. It overrides a valid `fps=` directive in the role asset. |
| `role.meaning` | non-empty text | Meaning Text used by `full` and custom templates. |
| `custom.meaningPlacement` | `beside`, `top`, `below` | Places custom non-frame output beside the tile or in an aligned annotation row. |
| `custom.items` | one item per role | Custom templates. Every normalized item contains exactly one `{frame}` token. |

The four role keys are semantic and stable:

```text
speculation
pointer
compaction
maximum
```

Role names are independent of their displayed text. Change `meaning` when you want different wording without changing the role's boundary semantics.

### Role frame files

Each role is loaded independently:

```text
<glyphDirectory>/speculation.txt
<glyphDirectory>/pointer.txt
<glyphDirectory>/compaction.txt
<glyphDirectory>/maximum.txt
```

For a one-row frame sequence, separate complete frames with whitespace:

```text
S0 S1 S2
```

Here `S0`, `S1`, and `S2` are three frames. Characters inside one whitespace-separated item stay in the same Glyph Tile, so a two-column tile can be written as `╎0`, `╎1`, or `AB`, `CD`.

Put `fps=` on the first non-empty directive line to animate an asset:

```text
fps=8
╎0 ╎1 ╎2
```

The animation rate is selected in this order:

1. A valid positive `role.fps` in JSON.
2. A valid positive `fps=` directive in the asset file.
3. Static rendering when neither value is valid.

A one-frame asset is always static, even when an FPS is configured. Empty frames are ignored for animation and rendering. A missing, empty, unreadable, or unusable file produces one static theme-derived Default Glyph Tile; the plugin does not create missing role files during normal startup.

The existing `size=WxH` directive remains accepted for compatibility with legacy block-art assets. Inline role tiles are always flattened to one row before measuring terminal width; newline characters do not create extra rail rows. The old `label.txt` and `pointer.txt` files remain readable for legacy settings and explicit initialization.

### Marker placement and boundaries

The rail uses the entire requested width as a proportional scale:

- `pointer` is positioned at the current usage percentage.
- `speculation` is positioned at OMP's speculative-compaction boundary.
- `compaction` is positioned at OMP's automatic-compaction threshold.
- `maximum` is anchored to the final cells at the 100% context-window edge.

The plugin obtains the two compaction boundaries from OMP's shared boundary calculation. It never guesses a threshold. If OMP does not provide a boundary, only that boundary role is hidden; pointer and maximum can still render. If usage is unknown, the rail returns fixed-width blank rows without the bar, semantic markers, or numeric values.

When tiles collide, the fixed priority is:

```text
maximum > compaction > speculation > pointer
```

Higher-priority tiles keep their nominal positions. Lower-priority tiles move to the nearest valid non-overlapping cells while preserving anchor order. Tiles are never split or truncated. The continuous bar remains underneath feasible tiles and annotations. If the terminal is too narrow, lower-priority tiles—especially the pointer—are omitted before annotation text is sacrificed.

### Presentation modes

#### Compact mode

`compact` renders one inline row containing the continuous usage bar, the current percentage, and feasible Glyph Tiles. It does not render Meaning Text, token counts, or window values.

```json
{
  "contextRail": {
    "mode": "compact"
  }
}
```

#### Full mode

`full` renders the continuous bar, positioned tiles, Meaning Text beside each feasible tile, the current percentage on the left, and the context-window size on the right. Percentages use native-like formatting: `62%`, `0.5%` below one percent, and values such as `120%` are not clamped in text. Token and window counts use compact values such as `620K` and `1M`.

```json
{
  "contextRail": {
    "mode": "full"
  }
}
```

#### Custom mode

`custom` renders the continuous bar and uses one template item per role. The physical tiles are still sorted by their actual context anchors; changing `custom.items` order does not reorder the tiles.

```json
{
  "contextRail": {
    "mode": "custom",
    "custom": {
      "meaningPlacement": "below",
      "items": [
        { "role": "speculation", "template": "{frame} {role}" },
        { "role": "pointer", "template": "{frame} {percent} / {tokens}" },
        { "role": "compaction", "template": "{frame} {text-meaning}" },
        { "role": "maximum", "template": "{frame} {window} {text-meaning}" }
      ]
    }
  }
}
```

The supported tokens are:

| Token | Expansion |
| --- | --- |
| `{frame}` | The selected role Glyph Tile. Required exactly once per item. |
| `{text-meaning}` | The role's configured `meaning`. |
| `{percent}` | Current usage percentage. |
| `{tokens}` | Current used token count. |
| `{window}` | Current context-window size. |
| `{role}` | The semantic role key. |

With `meaningPlacement: "beside"`, non-frame text remains adjacent to its tile as far as the available cells allow, over the continuous bar. With `top` or `below`, `{frame}` remains in the inline bar row and all other expanded output is placed in an aligned annotation row. Annotation text can be truncated at narrow widths, but Glyph Tiles remain complete. Unknown brace expressions are kept literally so configuration mistakes are visible.

Template whitespace is preserved exactly. The renderer does not insert a separator between a frame and adjacent output:

```json
{ "role": "pointer", "template": "{frame}{percent}" }
```

renders as:

```text
􂻍􂻎2%
```

To add a gap, put it in the template explicitly:

```json
{ "role": "pointer", "template": "{frame} {percent}" }
```

which renders as:

```text
􂻍􂻎 2%
```

### Compatibility and migration

Older configurations can continue to use:

```json
{
  "contextRail": {
    "pointer": "hidden",
    "labels": "always",
    "labelPosition": "right",
    "showLabelGlyph": false
  }
}
```

On the next config read or write, the legacy pointer scalar becomes:

```json
{
  "pointer": {
    "framesFile": "pointer.txt",
    "visibility": "hidden",
    "meaning": "now"
  }
}
```

Legacy label fields and `label.txt`/`pointer.txt` assets remain readable and writable. In the bar-based presentation modes, the new role/mode presentation is authoritative, so legacy label decoration is not inserted into the rail row.

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
/context-rail status
/context-rail label-glyph off
/context-rail placement inside
/context-rail placement below
/context-rail visibility collapse-while-typing
/context-rail pointer hidden
/context-rail position left
/context-rail position center
/context-rail position right
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

```bash
bun test src/context-rail.test.ts src/main.test.ts
```

## Release

From the monorepo root, publish this package with:

```bash
bun run publish:prompt-border-style
```

## Repository contents

- `src/main.ts` — plugin implementation, border rendering, Context Rail, status/activity spinner glyph patching, and command registration
- `src/context-rail.ts` — pure Context Rail config normalization and ANSI-safe renderer
- `src/main.test.ts` — parser, renderer, config, command, and completion tests
- `src/context-rail.test.ts` — Context Rail rendering and edge-state tests
- `package.json` — package metadata, peer dependencies, scripts, and OMP extension entrypoint
- `tsconfig.json` — TypeScript configuration
