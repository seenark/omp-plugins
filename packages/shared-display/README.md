# @codesook/omp-shared-display

Opt-in OMP extension that owns `codesook-shared-display` widget and versioned EventBus snapshot protocol for Ponytail, Caveman, Headroom, and CodeGraph producers. Default source order preserves that sequence.

Side-effect-free client and root config helpers:

```ts
import { connectSharedDisplay } from "@codesook/omp-shared-display/client";
import { readCodesookOmpConfig } from "@codesook/omp-shared-display/config-store";
```

Shared Display presentation persists in `display.sharedDisplay` inside:

```text
~/.config/codesook-omp/config.json
```

Legacy `~/.config/codesook-omp/shared-display/config.json` migrates once when root section is missing. `/shared-display` command is removed; root `/codesook-omp-plugin` settings owns persisted presentation. Producers remain safe when host/EventBus is absent.

Effective source order appends CodeGraph when a persisted order omits it, including orders saved before CodeGraph support. Existing producers keep their configured relative order and omissions. CodeGraph's integration visibility controls whether its segment appears; removing it from source order does not hide it.

## Host presence

`connectSharedDisplay(events, source)` returns a `SharedDisplayPublisher` with:

- `readonly hostAvailable: boolean` — true only while an enabled host has an interactive UI session. An empty display or a hidden source does not make the host unavailable.
- `onHostAvailabilityChange(handler: (active: boolean) => void): () => void` — subscribes to actual availability changes and returns an unsubscribe function. Subscription does not invoke the handler immediately; read `hostAvailable` for the current state.
- `publish(sequence: FrameSequence | null): void` — stores an immutable copy of the latest segment. Without an active host it emits no snapshot; the next host handshake replays the stored state. `null` removes the segment.
- `dispose(): void` — emits a removal tombstone while connected, then unsubscribes and stops further publication and callbacks.

The versioned channel adds `{ protocol: 1, kind: "host", epoch: string, active: boolean }` presence messages. Hosts announce session startup, enabled-state changes, shutdown, and reply to late producers. Snapshot requests alone never establish availability. Replay requests must match the announced active epoch; the host accepts only current-epoch snapshots with newer source revisions. No polling is involved.

Source revisions remain monotonic across publisher disposal and reconnection on the same EventBus. This lets a producer recreate its publisher after the host has already switched sessions without its new segment being rejected as stale. Revision storage is scoped to the bus lifetime and garbage-collected with it.

Producers needing a native footer fallback should subscribe to availability changes and read the getter after subscribing. Use Shared Display only while `hostAvailable` is true; clear the fallback when it becomes true to avoid duplicate status. Producers do not own Shared Display widgets or animation timers.

## Frame assets

All plugin glyph files use shared `FrameSequence` text format. Optional first nonblank `fps=<positive number>` sets animation rate; blank-line-separated blocks form frames, and rows within each block stay together. One frame or missing/invalid FPS displays first frame statically. Context Rail also accepts `size=<width>x<height>` as layout metadata before frame rows.
