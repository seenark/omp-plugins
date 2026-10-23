# @codesook/omp-shared-display

Opt-in OMP extension that owns `codesook-shared-display` widget and versioned EventBus snapshot protocol for Ponytail, Caveman, Headroom, RTK, CodeGraph, Beads, pstack, and process-monitor producers. Default source order preserves that sequence. Beads source support requires version 1.2.0 or newer; pstack source support requires 1.3.0 or newer; process-monitor source support requires 1.4.0 or newer.

Side-effect-free client and root config helpers:

```ts
import { connectSharedDisplay } from "@codesook/omp-shared-display/client";
import { readCodesookOmpConfig } from "@codesook/omp-shared-display/config-store";
```

Shared Display presentation persists in `display.sharedDisplay` inside:

```text
~/.config/codesook-omp/config.json
```

Legacy `~/.config/codesook-omp/shared-display/config.json` migrates once when root section is missing. `/shared-display` command is removed; root `/omp-plugins` settings owns persisted presentation. Producers remain safe when host/EventBus is absent.

Effective source order appends every known source (`ponytail`, `caveman`, `headroom`, `rtk`, `codegraph`, `beads`, `pstack`, `process-monitor`) that a persisted order omits, including orders saved before a source existed. Sources present keep their configured relative order; unknown names and duplicates are dropped. Each integration's visibility controls whether its segment appears; removing it from source order does not hide it. The side-effect-free client never loads the display host or another integration.

## Style and Palette

`display.sharedDisplay.style` sets the shape and `display.sharedDisplay.palette` sets the colors. They are chosen independently, and every palette applies to every style.

`style` is `plain` (default), `bracketed`, `powerline`, or `rounded`. The table lists the Starship presets each shape covers.

| Style | Shape | Starship presets | Nerd Font |
| --- | --- | --- | --- |
| `plain` | Sources joined by `horizontalSeparator`. | Pure, Jetpack | No |
| `bracketed` | Each source wrapped as `[source]`, adjacent with no separator. Brackets stay uncolored and the palette colors only the inner text. | Bracketed Segments | No |
| `powerline` | A rounded cap (U+E0B6), then segments joined by arrows (U+E0B0), closed by a rounded end (U+E0B4). | Gruvbox Rainbow, Catppuccin Powerline, Pastel Powerline | Yes |
| `rounded` | A `░▒▓` gradient start in the first segment's color, segments joined by rounded joints (U+E0B4), closed by U+E0B4. | Tokyo Night | Yes |

`horizontalSeparator` applies only to `plain`; `bracketed`, `powerline`, and `rounded` ignore it. In vertical layout every source row renders as its own `[row]`, powerline segment, or rounded segment.

`palette` is one of:

- `theme` (default). Colors come from the active OMP theme at every render, so a theme switch applies immediately. Segment backgrounds cycle through `statusLineModel`, `statusLinePath`, `statusLineGitClean`, `statusLineContext`, `statusLineSpend`, and `statusLineDirty`; segment text uses the `statusLineBg` color; `plain` and `bracketed` text take the same six colors. If the theme does not resolve `#rrggbb` colors, the host renders uncolored `plain`, or `bracketed` without text color.
- `gruvbox`, `catppuccin` (Mocha), `pastel`, `tokyo-night`. Fixed colors from the Starship preset TOMLs. `powerline` and `rounded` paint each segment with the palette's background and foreground pair (`pastel` leaves the foreground at the terminal default). `plain` and `bracketed` color each source's text with the palette's text-only accents, which stay readable on a dark terminal. Segments and text cycle through the palette in source order.
- `none`. No color is added and the host renders the `plain` shape, even when `style` is `powerline` or `rounded`. `bracketed` keeps its brackets and leaves the text untouched.

Producer ANSI colors are replaced whenever a palette applies, so text stays readable on the segment background and the palette stays consistent. With `none`, or with `theme` falling back to uncolored `plain`, producer output is untouched. Change both settings in `/omp-plugins` → Shared Display → Style and Palette.

## Ponytail

Ponytail is a normal producer (package `@codesook/omp-ponytail`). It publishes through `connectSharedDisplay(events, "ponytail")` like every other source; the host renders only published snapshots and reads no Ponytail status, session entries, config, or assets.

## Host presence

`connectSharedDisplay(events, source)` returns a `SharedDisplayPublisher` with:

- `readonly hostAvailable: boolean` — true only while an enabled host has an interactive UI session. An empty display or a hidden source does not make the host unavailable.
- `onHostAvailabilityChange(handler: (active: boolean) => void): () => void` — subscribes to actual availability changes and returns an unsubscribe function. Subscription does not invoke the handler immediately; read `hostAvailable` for the current state.
- `publish(sequence: FrameSequence | null): void` — stores an immutable copy of the latest segment. Without an active host it emits no snapshot; the next host handshake replays the stored state. `null` removes the segment.
- `dispose(): void` — emits a removal tombstone while connected, then unsubscribes and stops further publication and callbacks.

The versioned channel adds `{ protocol: 1, kind: "host", epoch: string, active: boolean }` presence messages. Hosts announce session startup, enabled-state changes, shutdown, and reply to late producers. Snapshot requests alone never establish availability. Replay requests must match the announced active epoch; the host accepts only current-epoch snapshots with newer source revisions. No polling is involved.

Source revisions remain monotonic across publisher disposal and reconnection on the same EventBus. This lets a producer recreate its publisher after the host has already switched sessions without its new segment being rejected as stale. Revision storage is scoped to the bus lifetime and garbage-collected with it.

Producers needing a native footer fallback should subscribe to availability changes and read the getter after subscribing. Use Shared Display only while `hostAvailable` is true; clear the fallback when it becomes true to avoid duplicate status. Producers do not own Shared Display widgets or animation timers.

## Instruction Mode suspension

`@codesook/omp-shared-display/instruction-mode` holds the versioned channel (`INSTRUCTION_MODE_SUSPENSION_CHANNEL`, `codesook/instruction-mode-suspension/v1`) and payload (`InstructionModeSuspension`) pstack uses to switch Caveman and Ponytail off for one Agent Session. `suspendInstructionModes(events, modes)` emits it; `onInstructionModeSuspension(events, mode, handler)` subscribes for one mode and ignores other protocol versions.

## Skill Use event

`@codesook/omp-shared-display/skill-use` holds the versioned channel (`SKILL_USE_EVENT`, `codesook/skill-use/v1`) and payload (`SkillUseEvent`: `{ name, path, source: "user" }`) a feature emits when it sends a skill to the model as plain text, so OMP's own skill-prompt message never exists. `parseSkillUseEvent(data)` validates a payload. The `skill-stats` feature records each valid event as a user Skill Use; with it not loaded, nothing listens. Requires version 1.4.0 or newer.

## Frame assets

All plugin glyph files use shared `FrameSequence` text format. Optional first nonblank `fps=<positive number>` sets animation rate; blank-line-separated blocks form frames, and rows within each block stay together. One frame or missing/invalid FPS displays first frame statically. Context Rail also accepts `size=<width>x<height>` as layout metadata before frame rows.
