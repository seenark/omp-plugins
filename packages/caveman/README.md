# @codesook/omp-caveman

Canonical Caveman communication mode for [oh-my-pi](https://github.com/can1357/oh-my-pi). The package injects the pinned `skills/caveman/SKILL.md` rules and publishes its status as a Shared Display source when that opt-in host is loaded.

## Install

From this workspace:

```sh
omp --extension ./packages/caveman/src/index.ts
```

As a published package:

```sh
omp plugin install npm:@codesook/omp-caveman
```

The package is opt-in in the repository feature manifest. It requires OMP and pi-tui `>=18.1.16`.

## Levels and commands

The canonical levels are `off`, `lite`, `full`, `ultra`, `wenyan-lite`, `wenyan-full`, and `wenyan-ultra`. `full` is the default for a new session.

```text
/caveman                         Open staged settings
/caveman config                  Open staged settings
/caveman status                  Report current and persisted settings
/caveman off|lite|full|ultra     Set current-session level
/caveman wenyan-lite             Set current-session level
/caveman wenyan-full             Set current-session level
/caveman wenyan-ultra            Set current-session level
```

`micro`, bare `wenyan`, `stop`, `quit`, and unknown arguments are rejected. Level commands append a `caveman-level` session entry, so resume and branch operations recover the newest valid entry by reverse branch scan. Changing `defaultLevel` in settings selects and records that level for the current session; display-only changes do not change the current level.

## Configuration

The package persists one normalized file at `~/.config/codesook-omp/caveman/config.json`:

```json
{
  "defaultLevel": "full",
  "nativeVisible": false,
  "display": {
    "visible": true,
    "template": "{activity} {glyph} caveman: {level}",
    "glyphDirectory": "~/.config/codesook-omp/caveman/glyphs"
  }
}
```

`defaultLevel` accepts only the six active canonical levels or `off`. A missing value uses `full`; an explicitly noncanonical destination value becomes `off` and raises one warning per extension activation. Boolean fields must be booleans. `template` and `glyphDirectory` must be nonempty single-line strings. Invalid individual fields use their defaults while an invalid JSON destination is never overwritten or supplemented from legacy data.

Before this file exists, the extension reads exactly one legacy `caveman.json`: `$PI_CODING_AGENT_DIR/caveman.json`, or `$XDG_CONFIG_HOME/pi/agent/caveman.json`, or `~/.pi/agent/caveman.json`. It maps legacy `wenyan` to `wenyan-full`, maps `micro` and other noncanonical levels to `off`, maps `showStatus` to `nativeVisible`, then atomically creates the unified file. Missing active-level glyph files are seeded without overwriting existing files. Later loads use the destination only.

The settings dialog edits a draft. Apply validates the whole draft and atomically renames a temporary sibling over `config.json`; failed writes, Escape, Cancel, and Reload leave live runtime unchanged. Initialize missing glyphs asks for confirmation and is intentionally not rolled back by Cancel.

## Assets

The package ships `assets/lite.txt`, `full.txt`, `ultra.txt`, `wenyan-lite.txt`, `wenyan-full.txt`, and `wenyan-ultra.txt`. There is no `off.txt` asset. Each asset has one optional FPS header followed by eight whitespace-separated one-row frames:

```text
fps=5
⠠⠄ ⠔⠂ ⠊⠑ ⠑⠊ ⠂⠔ ⠄⠠ ⠠⠄ ⠔⠂
```

Lite assets use `fps=3.3333333333333335`, full assets use `fps=5`, and ultra assets use `fps=10`. A user file named `<level>.txt` in `display.glyphDirectory` overrides its packaged asset only when the Shared Display parser accepts it. Missing or invalid user files fall back to the package asset. Explicit Initialize copies only missing files.

Templates replace `{activity}`, `{glyph}`, and `{level}` once. Multiline frame rows remain multiline in the published Block Frame. The glyph is rendered with the OMP accent theme. Native status uses only frame zero's first row (or the packaged one-row fallback), so it never receives CR/LF.

## Display behavior

When the Shared Display host is loaded, Caveman publishes complete frame sequences on `caveman`. `display.visible: false` publishes `null`; `nativeVisible` independently controls static `setStatus("caveman", ...)`. Native status is cleared whenever native visibility is off or the level is off. If Shared Display is absent or disabled, the publisher is a no-op and Caveman mounts no private widget or timer; native status still follows `nativeVisible`.

`agent_start` marks the source active. An `agent_end` with `willContinue: true` keeps it active. A terminal `agent_end` publishes idle text and leaves frame advancement to Shared Display. Session start, switch, branch, and shutdown rebuild or dispose the publisher without producer-side animation timers.

## Source attribution

The vendored skill is pinned to `JuliusBrussee/caveman@15581d14007fd01fb3f132016741962f34936ca2`. The Braille fire animation is adapted from `jonjonrankin/pi-caveman@8d326c4e562eeb0cdac41700348c6183efc05189`. Full MIT notices and the canonical skill are included in the package.
