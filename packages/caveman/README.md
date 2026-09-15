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

Canonical levels: `off`, `lite`, `full`, `ultra`, `wenyan-lite`, `wenyan-full`, and `wenyan-ultra`. `full` is default for new session.

```text
/caveman status                  Show focused read-only status overlay
/caveman off|lite|full|ultra     Set current-session level
/caveman wenyan-lite             Set current-session level
/caveman wenyan-full             Set current-session level
/caveman wenyan-ultra            Set current-session level
```

Bare `/caveman` settings form and `/caveman config` are removed; root `/codesook-omp-plugin` owns persisted settings. Status overlay closes with Enter/Esc. Level commands append `caveman-level` session entry, so resume and branch operations recover newest valid entry.

## Configuration

All feature settings persist in root envelope:

```text
~/.config/codesook-omp/config.json
```

Caveman uses `behavior.caveman.defaultLevel` and `display.caveman`:

```json
{
  "version": 1,
  "display": {
    "caveman": {
      "visible": true,
      "template": "{activity} {glyph} caveman: {level}",
      "glyphDirectory": "~/.config/codesook-omp/caveman/glyphs",
      "nativeVisible": false
    }
  },
  "behavior": {
    "caveman": { "defaultLevel": "full" }
  }
}
```

Legacy `~/.config/codesook-omp/caveman/config.json` and `.pi/agent/caveman.json` migrate into missing root sections, then valid legacy JSON files are removed after successful migration. Invalid root JSON wins and is never overwritten; invalid legacy files remain for repair. Glyph files remain external.

## Assets

The package ships `assets/lite.txt`, `full.txt`, `ultra.txt`, `wenyan-lite.txt`, `wenyan-full.txt`, and `wenyan-ultra.txt`. There is no `off.txt` asset. Each asset has one optional FPS header followed by eight whitespace-separated one-row frames:

```text
fps=5
⠠⠄ ⠔⠂ ⠊⠑ ⠑⠊ ⠂⠔ ⠄⠠ ⠠⠄ ⠔⠂
```

Lite assets use `fps=3.3333333333333335`, full assets use `fps=5`, and ultra assets use `fps=10`. A user file named `<level>.txt` in `display.glyphDirectory` overrides its packaged asset only when the Shared Display parser accepts it. Missing or invalid user files fall back to the package asset. Config load seeds only missing asset files.

Templates replace `{activity}`, `{glyph}`, and `{level}` once. Multiline frame rows remain multiline in the published Block Frame. The glyph is rendered with the OMP accent theme. Native status uses only frame zero's first row (or the packaged one-row fallback), so it never receives CR/LF.

## Display behavior

When the Shared Display host is loaded, Caveman publishes complete frame sequences on `caveman`. `display.visible: false` publishes `null`; `nativeVisible` independently controls static `setStatus("caveman", ...)`. Native status is cleared whenever native visibility is off or the level is off. If Shared Display is absent or disabled, the publisher is a no-op and Caveman mounts no private widget or timer; native status still follows `nativeVisible`.

`agent_start` marks the source active. An `agent_end` with `willContinue: true` keeps it active. A terminal `agent_end` publishes idle text and leaves frame advancement to Shared Display. Session start, switch, branch, and shutdown rebuild or dispose the publisher without producer-side animation timers.

## Source attribution

The vendored skill is pinned to `JuliusBrussee/caveman@15581d14007fd01fb3f132016741962f34936ca2`. The Braille fire animation is adapted from `jonjonrankin/pi-caveman@8d326c4e562eeb0cdac41700348c6183efc05189`. Full MIT notices and the canonical skill are included in the package.
