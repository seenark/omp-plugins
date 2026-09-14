# Caveman, Ponytail, and OMP display research

**Research snapshot:** 2026-09-14 (UTC). GitHub `main` refs were resolved and then pinned to the commits listed in [Sources](#sources). Evidence below is limited to the upstream source files, this checkout, and the installed OMP 18.1.16 source/types.

## Findings

- **Canonical Caveman is a skill, not a Pi display extension.** The current `JuliusBrussee/caveman` `skills/caveman/SKILL.md` describes `lite`, `full`, `ultra`, and the three wenyan variants; it sets `full` as default and gives the switch syntax `/caveman lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra|off` ([current file, lines 5-15](https://github.com/JuliusBrussee/caveman/blob/15581d14007fd01fb3f132016741962f34936ca2/skills/caveman/SKILL.md#L5-L15)). Its intensity table has exactly those six active levels ([lines 40-49](https://github.com/JuliusBrussee/caveman/blob/15581d14007fd01fb3f132016741962f34936ca2/skills/caveman/SKILL.md#L40-L49)). **`micro` is not a canonical Caveman level in this current file.**
- **`pi-caveman` deliberately diverges.** Its extension-level `LEVELS` adds `wenyan` (instead of canonical `wenyan-full`) and `micro`, alongside `off`, and its command completion exposes `stop`, `quit`, and `config` aliases/actions ([`extensions/caveman.ts`, lines 28-43](https://github.com/jonjonrankin/pi-caveman/blob/8d326c4e562eeb0cdac41700348c6183efc05189/extensions/caveman.ts#L28-L43)). `micro` has a distinct prompt and animation entry ([lines 124-158](https://github.com/jonjonrankin/pi-caveman/blob/8d326c4e562eeb0cdac41700348c6183efc05189/extensions/caveman.ts#L124-L158)); the README labels it experimental and credits `kuba-guzik/caveman-micro` ([README lines 48, 81, 101](https://github.com/jonjonrankin/pi-caveman/blob/8d326c4e562eeb0cdac41700348c6183efc05189/README.md#L38-L85)). **Therefore `micro` belongs to pi-caveman, not the current canonical Caveman skill.**
- **Upstream Ponytail's Pi adapter is static-status only.** `pi-extension/index.js` calls `ctx.ui.setStatus("ponytail", ...)` from `syncStatus` ([lines 70-89](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/pi-extension/index.js#L70-L89)). Its command persists a default through `writeDefaultMode` and reports status; this path does not open a dialog ([lines 114-145](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/pi-extension/index.js#L114-L145)). The lifecycle hooks restore mode and inject instructions at `before_agent_start` ([lines 183-210](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/pi-extension/index.js#L183-L210)). **The current upstream Pi adapter does not implement a custom widget, animation loop, or settings dialog:** its UI call is `setStatus`; the inspected adapter has no `setWidget`, `custom`, timer, or `SettingsList` path. Its persisted default is a JSON config, not an interactive settings surface ([`hooks/ponytail-config.js`, lines 76-99, 119-145](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/hooks/ponytail-config.js#L76-L145)).
- **The custom Ponytail widget is Headroom-owned in this repository.** `packages/headroom/index.ts` monkey-patches `ctx.ui.setStatus` for key `ponytail`, parses/stores the native text, optionally forwards it, and refreshes Headroom ([`installPonytailStatusCapture`, lines 237-268](packages/headroom/index.ts#L237-L268)). `refreshStatus` then calls `ctx.ui.setWidget` with a component placed `belowEditor`, renders the Ponytail segment through `renderPonytailDisplay`, and advances glyph frames with `ctx.setInterval` ([lines 612-722](packages/headroom/index.ts#L612-L722)). Current defaults show the custom Ponytail segment and hide native Ponytail status (`nativeVisible: false`) ([`packages/headroom/display.ts`, lines 90-107](packages/headroom/display.ts#L90-L107)).

## Architecture Comparison

| Source/adapter | Prompt/instruction path | Status/display path | Config path |
|---|---|---|---|
| Canonical Caveman | `SKILL.md` instruction text; six active levels, `full` default ([lines 5-15, 40-49](https://github.com/JuliusBrussee/caveman/blob/15581d14007fd01fb3f132016741962f34936ca2/skills/caveman/SKILL.md#L5-L49)) | No Pi extension/UI implementation in the canonical skill file | No extension-owned config implementation in the skill file |
| `pi-caveman` | `before_agent_start` appends the selected level; `micro` uses its own `MICRO_PROMPT` ([`caveman.ts`, lines 432-447](https://github.com/jonjonrankin/pi-caveman/blob/8d326c4e562eeb0cdac41700348c6183efc05189/extensions/caveman.ts#L432-L447)) | `setStatus` plus a raw `setInterval` animation ([lines 227-263](https://github.com/jonjonrankin/pi-caveman/blob/8d326c4e562eeb0cdac41700348c6183efc05189/extensions/caveman.ts#L227-L263)) | `~/.pi/agent/caveman.json` (or the documented environment overrides); interactive `ctx.ui.custom` + `SettingsList` ([config path/defaults, lines 50-90](https://github.com/jonjonrankin/pi-caveman/blob/8d326c4e562eeb0cdac41700348c6183efc05189/extensions/caveman.ts#L50-L90); [dialog, lines 344-390](https://github.com/jonjonrankin/pi-caveman/blob/8d326c4e562eeb0cdac41700348c6183efc05189/extensions/caveman.ts#L344-L390)) |
| Upstream Ponytail Pi adapter | `before_agent_start` appends `getPonytailInstructions(currentMode)` ([`index.js`, lines 204-210](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/pi-extension/index.js#L204-L210)) | Static `setStatus("ponytail", ...)`; no custom widget or animation implementation ([lines 70-89](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/pi-extension/index.js#L70-L89)) | `/ponytail default <mode>` writes `~/.config/ponytail/config.json` (or XDG equivalent); runtime defaults are restricted to `off/lite/full/ultra` ([runtime list, lines 16-34](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/hooks/ponytail-config.js#L16-L34); [default loading, lines 76-99](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/hooks/ponytail-config.js#L76-L99); [write, lines 136-145](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/hooks/ponytail-config.js#L136-L145)) |
| Headroom in this checkout | Does not own Ponytail prompt injection; consumes Ponytail status/session entries | Captures native Ponytail status and owns the `setWidget` component, glyph templates, and optional frame timers ([capture, lines 237-268](packages/headroom/index.ts#L237-L268); [widget, lines 612-722](packages/headroom/index.ts#L612-L722)) | Bespoke `~/.config/codesook-omp/headroom/display-config.json`, glyph directories, visibility/template writers ([config, lines 43-69](packages/headroom/display.ts#L43-L69); [writers, lines 224-253](packages/headroom/display.ts#L224-L253)) |

## Mode Vocabulary

- **Canonical Caveman:** active levels are `lite`, `full`, `ultra`, `wenyan-lite`, `wenyan-full`, and `wenyan-ultra`; `full` is the default. `off` is present in the switch syntax as deactivation, not an intensity-table row ([`SKILL.md`, lines 15, 40-49](https://github.com/JuliusBrussee/caveman/blob/15581d14007fd01fb3f132016741962f34936ca2/skills/caveman/SKILL.md#L15-L49)).
- **`pi-caveman`:** the actual extension union is `off`, `lite`, `full`, `ultra`, `wenyan-lite`, `wenyan`, `wenyan-ultra`, `micro`; `stop` and `quit` normalize to `off`, and `config` opens the dialog ([levels/options, lines 28-43](https://github.com/jonjonrankin/pi-caveman/blob/8d326c4e562eeb0cdac41700348c6183efc05189/extensions/caveman.ts#L28-L43); [command handler, lines 307-342](https://github.com/jonjonrankin/pi-caveman/blob/8d326c4e562eeb0cdac41700348c6183efc05189/extensions/caveman.ts#L307-L342)). `wenyan` and `micro` are therefore adapter vocabulary, not canonical names.
- **Upstream Ponytail:** `RUNTIME_MODES` is `off`, `lite`, `full`, `ultra`; `review` is accepted as a persisted/session mode by `VALID_MODES` but is explicitly excluded from defaults ([runtime/config lists, lines 16-34](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/hooks/ponytail-config.js#L16-L34); [default restriction, lines 76-99](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/hooks/ponytail-config.js#L76-L99)). Its skill itself advertises only `lite`, `full`, and `ultra` as intensity levels ([`skills/ponytail/SKILL.md`, lines 8-16, 77-83](https://github.com/DietrichGebert/ponytail/blob/356918eba965ee1eac64bd3a7f0dd02108350de5/skills/ponytail/SKILL.md#L8-L16)).
- **Headroom's Ponytail parser:** local `PonytailMode` and its parser/session resolver accept only `off`, `lite`, `full`, `ultra`, and `review`; the mode-icon map has the same five values ([type, lines 16-22](packages/headroom/display.ts#L16-L22); [icons/parser/resolver, lines 342-371](packages/headroom/display.ts#L342-L371)). `wenyan`, `wenyan-full`, `wenyan-ultra`, and `micro` are not recognized by this renderer's Ponytail status parser.

## OMP-Native Building Blocks

- **Lifecycle and shared events:** installed OMP 18.1.16 exposes typed `ExtensionAPI.on(...)` lifecycle events including `session_start`, `session_shutdown`, `before_agent_start`, `agent_start`, and `agent_end` ([`src/extensibility/extensions/types.ts`, lines 1217-1273](node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts#L1217-L1273)). `ExtensionAPI.events` is a shared `EventBus` ([lines 1543-1544](node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts#L1543-L1544); implementation [`event-bus.ts`, lines 3-32](node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/utils/event-bus.ts#L3-L32)). `emit` synchronously visits channel listeners; `on` returns an unsubscribe function and contains/logs handler failures.
- **Native status and widgets:** `ExtensionUIContext.setStatus(key, text)` writes footer/status text, while `setWidget(key, content, options)` accepts strings or a component factory above/below the editor ([`types.ts`, lines 284-297](node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts#L284-L297)). `custom(...)` supplies a keyboard-focused component/dialog ([lines 302-311](node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts#L302-L311)). `ctx.hasUI` and `ctx.mode` are the guards for interactive UI ([lines 455-467](node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts#L455-L467)).
- **Native timer lifecycle:** `ExtensionContext.setInterval`, `setTimeout`, and `clearTimer` contain callback failures and automatically clear session timers; the type comments recommend these over raw `setInterval` ([`types.ts`, lines 501-517](node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts#L501-L517)). This is the primitive Headroom uses for glyph animation.
- **Core settings singleton:** OMP's public package exports `Settings` and `settings` ([`src/index.ts`, lines 16-17](node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/index.ts#L16-L17)). `Settings.get` merges global/project/overrides and defaults; `Settings.set` updates the global layer and queues a background save ([`src/config/settings.ts`, lines 634-680](node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/config/settings.ts#L634-L680)). The singleton requires `Settings.init()` first ([lines 3275-3298](node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/config/settings.ts#L3275-L3298)).
- **Plugin-native settings UI/storage:** OMP plugin manifests may declare `settings` with string/number/boolean/enum schemas, defaults, descriptions, secret masking, and environment fallbacks ([`src/extensibility/plugins/types.ts`, lines 27-93](node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/plugins/types.ts#L27-L93)). The built-in plugin settings component turns that schema into `SettingsList` rows ([schema rows, lines 84-147](node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/modes/components/plugin-settings.ts#L84-L147); [list wiring, lines 340-375](node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/modes/components/plugin-settings.ts#L340-L375)), and `PluginManager` persists per-plugin values with global/project merge behavior ([`manager.ts`, lines 889-912](node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/plugins/manager.ts#L889-L912)). The current Headroom manifest declares only its extension entry point and no `omp.settings` block ([`packages/headroom/package.json`, lines 35-36](packages/headroom/package.json#L35-L36)).

## Implications and Accepted Decisions

**Observed implications:**

1. These mode vocabularies cannot be silently treated as one shared enum. Canonical Caveman uses `wenyan-full` and has no `micro`; pi-caveman uses `wenyan` and `micro`; upstream Ponytail has four runtime modes plus session-only `review`; Headroom currently parses only the Ponytail five-value subset.
2. Status ownership is separate from prompt ownership. Upstream Ponytail writes a native `ponytail` status; Headroom currently intercepts that status and renders a replacement widget. pi-caveman's own `caveman` status/animation is a separate key and implementation.
3. Animation capability is host-native in OMP (`setWidget` + component factory + `ctx.setInterval`), but neither canonical Caveman nor upstream Ponytail Pi supplies that widget. The current custom Ponytail animation is local Headroom code and asset/config driven.

**Accepted decisions:**

- The one-widget Shared Display host, versioned EventBus snapshot/replay seam, and producer no-`setWidget` invariant are recorded in [ADR 0003](../adr/0003-shared-display-eventbus-host.md).
- The one root command/package JSON contract, staged Apply/Cancel flow, atomic writes, one-time destination-gated migration, and clean alias removal are recorded in [ADR 0004](../adr/0004-package-config-command-cutover.md).


## Sources

### Pinned GitHub primary sources

- **Canonical Caveman, `JuliusBrussee/caveman`** — `main` ref API resolved to `15581d14007fd01fb3f132016741962f34936ca2`: [ref API](https://api.github.com/repos/JuliusBrussee/caveman/git/ref/heads/main), [raw `skills/caveman/SKILL.md`](https://raw.githubusercontent.com/JuliusBrussee/caveman/15581d14007fd01fb3f132016741962f34936ca2/skills/caveman/SKILL.md), [line-addressable blob](https://github.com/JuliusBrussee/caveman/blob/15581d14007fd01fb3f132016741962f34936ca2/skills/caveman/SKILL.md).
- **`jonjonrankin/pi-caveman`** — `main` ref API resolved to `8d326c4e562eeb0cdac41700348c6183efc05189`: [ref API](https://api.github.com/repos/jonjonrankin/pi-caveman/git/ref/heads/main), [raw `extensions/caveman.ts`](https://raw.githubusercontent.com/jonjonrankin/pi-caveman/8d326c4e562eeb0cdac41700348c6183efc05189/extensions/caveman.ts), [raw `README.md`](https://raw.githubusercontent.com/jonjonrankin/pi-caveman/8d326c4e562eeb0cdac41700348c6183efc05189/README.md).
- **Upstream Ponytail, `DietrichGebert/ponytail`** — `main` ref API resolved to `356918eba965ee1eac64bd3a7f0dd02108350de5`: [ref API](https://api.github.com/repos/DietrichGebert/ponytail/git/ref/heads/main), [raw `pi-extension/index.js`](https://raw.githubusercontent.com/DietrichGebert/ponytail/356918eba965ee1eac64bd3a7f0dd02108350de5/pi-extension/index.js), [raw `hooks/ponytail-config.js`](https://raw.githubusercontent.com/DietrichGebert/ponytail/356918eba965ee1eac64bd3a7f0dd02108350de5/hooks/ponytail-config.js), [raw `skills/ponytail/SKILL.md`](https://raw.githubusercontent.com/DietrichGebert/ponytail/356918eba965ee1eac64bd3a7f0dd02108350de5/skills/ponytail/SKILL.md).

### Local primary sources

All paths below are under `/Volumes/HadesGodBlue/CodeSook/omp-plugins`:

- `packages/headroom/index.ts` — `installPonytailStatusCapture` L237-L268; `refreshStatus` L612-L722.
- `packages/headroom/display.ts` — `PonytailMode`/config/defaults L16-L107; config writers and glyph assets L224-L305; parser/rendering L342-L399.
- `packages/headroom/package.json` — OMP manifest L35-L36.
- `node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/package.json` — installed package identity/version L3-L15, main/types L28-L29.
- `node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts` — UI/context/API types L223-L311, L455-L517, L1217-L1273, L1543-L1544.
- `node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/utils/event-bus.ts` — `EventBus` L3-L32.
- `node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/index.ts` — public `Settings`/`settings` exports L16-L17.
- `node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/config/settings.ts` — `Settings.get/set` L634-L680; singleton L3275-L3298.
- `node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/plugins/types.ts` — plugin settings schema L27-L93.
- `node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/modes/components/plugin-settings.ts` — schema-to-`SettingsList` UI L84-L147, L340-L375.
- `node_modules/.bun/@oh-my-pi+pi-coding-agent@18.1.16+09a228d332b3c507/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/plugins/manager.ts` — plugin setting persistence L889-L912.

## License Evidence

### Canonical Caveman: scoped MIT

The pinned canonical repository's `LICENSE` includes this scope note:

> Scope note: this MIT license covers this repository except Engine-linked
> directories listed in LICENSING.md (engine/, proxy/, rewriter/,
> browse/, mcp/, shrink/, cavemem Go core, shared/platform/), which are licensed
> under Business Source License 1.1 — see LICENSE.BSL. New Engine-linked runtime
> modules default to BSL-1.1 unless explicitly classified as MIT.

The vendored `skills/caveman/SKILL.md` is within that MIT scope: `skills/` is not one of the listed Engine-linked exclusions. The same pinned license identifies `Copyright (c) 2026 Julius Brussee` and provides the standard MIT permission, notice, warranty, and liability terms ([`LICENSE`](https://raw.githubusercontent.com/JuliusBrussee/caveman/15581d14007fd01fb3f132016741962f34936ca2/LICENSE); [`LICENSING.md`](https://raw.githubusercontent.com/JuliusBrussee/caveman/15581d14007fd01fb3f132016741962f34936ca2/LICENSING.md)).

### pi-caveman: full MIT notice

The pinned `pi-caveman` repository's `LICENSE` contains this complete MIT notice ([`LICENSE`](https://raw.githubusercontent.com/jonjonrankin/pi-caveman/8d326c4e562eeb0cdac41700348c6183efc05189/LICENSE)):

```text
MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
