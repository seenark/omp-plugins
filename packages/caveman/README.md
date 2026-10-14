# @codesook/omp-caveman

Canonical Caveman communication mode for [oh-my-pi](https://github.com/can1357/oh-my-pi). The package injects the vendored Upstream `caveman`, `ultracave`, or `megacave` skill and publishes its status as a Shared Display source when that opt-in host is loaded.

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

## Modes and commands

Mode Levels follow Upstream's names exactly: `off`, `caveman`, `ultracave`, `megacave`. `caveman` is the default for new sessions. Each active mode injects the body of its own vendored skill (`skills/<mode>/SKILL.md`, frontmatter stripped) and nothing else; `off` sends no Caveman instructions.

```text
/caveman                              Choose status or a current-session mode
/caveman status                       Show focused read-only status overlay
/caveman off|caveman|ultracave|megacave   Set current-session mode
/caveman ultra                        Upstream alias for ultracave
/caveman wenyan                       Upstream alias for megacave
/ultracave                            Standalone, same as /caveman ultracave
/megacave                             Standalone, same as /caveman megacave
```

`caveman` is the terse voice (answer first, fluff gone, every technical fact kept), `ultracave` is maximum compression, and `megacave` answers in Classical Chinese with technical terms verbatim. All three keep the user's language rules from the vendored skill.

Cancelling the menu does not load or migrate config, seed glyphs, or append a session entry. Without interactive UI, bare `/caveman` prints explicit command help instead of choosing a mode. `/caveman status` still opens the read-only overlay, closed with Enter/Esc. Mode choices and explicit commands append a `caveman-mode` session entry (`{ mode }`), so resume and branch operations recover the newest valid entry on `session_start`, `session_switch`, and `session_branch`. They do not change the saved default. Entries with an unknown mode are ignored.

Typing exactly `stop caveman` or `normal mode` (case-insensitive, trailing punctuation ignored) as a user message turns Caveman off for the session, like `/caveman off`. Messages sent by extensions are ignored. `/caveman status` marks the default as overridden when an explicit session mode differs from it.

A subagent follows the session that spawned it (needs OMP 18.3.2+ for `ctx.agent`; older hosts skip inheritance): it starts at its parent's current mode, including `off`, and records that mode as its own `caveman-mode` entry. Children of different parents never mix, and a nested subagent follows its direct parent. A subagent whose parent is gone falls back to the saved default. `/new` and branching in the parent do not affect running children.

Ponytail's subagent default is not inherited: Ponytail reads its default at its own `session_start` and exposes no per-session hook, so Caveman cannot set it safely.

Breaking change (Upstream sync): the old levels `lite`, `full`, `ultra`, `wenyan-lite`, `wenyan-full`, and `wenyan-ultra` are removed, as are `behavior.caveman.defaultLevel`, the `{level}` template placeholder, the `caveman-level` session entry, and the `lite|full|wenyan-*` glyph files. There is no migration: an old `defaultLevel` or an unknown `defaultMode` fails closed to `off` with a warning, and old `caveman-level` entries are ignored. `/caveman config` remains removed; root `/omp-plugins` owns persisted settings.

## Configuration

All feature settings persist in root envelope:

```text
~/.config/codesook-omp/config.json
```

Caveman uses `behavior.caveman.defaultMode` (`off`, `caveman`, `ultracave`, or `megacave`) and `display.caveman`:

```json
{
  "version": 1,
  "display": {
    "caveman": {
      "visible": true,
      "template": "{activity} {glyph} {mode}",
      "glyphDirectory": "~/.config/codesook-omp/caveman/glyphs",
      "nativeVisible": false
    }
  },
  "behavior": {
    "caveman": { "defaultMode": "caveman" }
  }
}
```

A legacy file that still has `defaultLevel` also fails closed to `off`. Legacy `~/.config/codesook-omp/caveman/config.json` and `.pi/agent/caveman.json` migrate into missing root sections, then valid legacy JSON files are removed after successful migration. Invalid root JSON wins and is never overwritten; while it is invalid, Caveman warns and the default mode is `off` (fail closed). Invalid legacy files remain for repair. Glyph files remain external.

## Assets

The package ships `assets/caveman.txt`, `ultracave.txt`, and `megacave.txt`. There is no `off.txt` asset. Each asset has one optional FPS header followed by eight whitespace-separated one-row frames:

```text
fps=5
⠠⠄ ⠔⠂ ⠊⠑ ⠑⠊ ⠂⠔ ⠄⠠ ⠠⠄ ⠔⠂
```

`caveman.txt` and `megacave.txt` use `fps=5`; `ultracave.txt` uses `fps=10`. A user file named `<mode>.txt` in `display.glyphDirectory` overrides its packaged asset only when the Shared Display parser accepts it. Missing or invalid user files fall back to the package asset. Config load seeds only missing files, using the first packaged frame without FPS.

Templates replace `{activity}`, `{glyph}`, and `{mode}` (`caveman`, `ultracave`, or `megacave`) once. Multiline frame rows remain multiline in the published Block Frame. The glyph is rendered with the OMP accent theme. Native status uses only frame zero's first row (or the packaged one-row fallback), so it never receives CR/LF.

## Display behavior

When the Shared Display host is loaded, Caveman publishes complete frame sequences on `caveman`. `display.visible: false` publishes `null`; `nativeVisible` independently controls static `setStatus("caveman", ...)`. Native status is cleared whenever native visibility is off or the mode is off. If Shared Display is absent or disabled, the publisher is a no-op and Caveman mounts no private widget or timer; native status still follows `nativeVisible`.

`agent_start` marks the source active. An `agent_end` with `willContinue: true` keeps it active. A terminal `agent_end` publishes idle text and leaves frame advancement to Shared Display. Session start, switch, branch, and shutdown rebuild or dispose the publisher without producer-side animation timers.

## Vendored Content

Upstream: [`JuliusBrussee/caveman`](https://github.com/JuliusBrussee/caveman), Pinned Revision `d262ab3882952a59312ff3537cd86d894523c5ab`. Vendored Content, byte-identical to that revision:

- `skills/caveman/SKILL.md`
- `skills/ultracave/SKILL.md`
- `skills/megacave/SKILL.md`

Upstream's `skills/<name>/SKILL.md` is the canonical path: its `CLAUDE.md` names `skills/` the single source of truth, and its sync workflow copies those files to `plugins/caveman/skills/<name>/SKILL.md` (the copies are byte-identical at the Pinned Revision). Upstream is Apache-2.0 from 3.0.0; `THIRD-PARTY-NOTICES.txt` carries its `NOTICE`, `LICENSE`, and the pre-3.0.0 `LICENSE-MIT`.

Adaptation (the only one): at runtime the YAML frontmatter (`name`, `description`, `disable-model-invocation`) is stripped and the remaining body is appended to the system prompt unchanged. The vendored files are not edited. Upstream's skill text talks about a hook's `Caveman mode: <mode>` value for `/caveman status`; OMP has no such hook, so `/caveman status` is answered by this extension and not by the model.

Excluded: the rest of Upstream (`caveman-commit`, `caveman-review`, `caveman-compress`, `cavecrew`, Engine, Proxy, CLI, hooks, and the other skills).

The Braille fire animation is adapted from `jonjonrankin/pi-caveman@8d326c4e562eeb0cdac41700348c6183efc05189` (MIT notice in `THIRD-PARTY-NOTICES.txt`).
