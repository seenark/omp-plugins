---
status: accepted
---
# Shared Display EventBus Host

Shared Display has one Display Host that owns the `codesook-shared-display` OMP widget, source ordering and layout, animation clock, lifecycle, and widget placement. Display Producers publish complete snapshots for their own Status Segment over the versioned `codesook/shared-display/v1` EventBus channel; producers never call `ctx.ui.setWidget` for shared statuses and never own a producer-side display timer.

The protocol uses plain-data `ready`, `request`, and `snapshot` messages with protocol version `1`. A snapshot carries a producer source, a session epoch, a source-local revision, and either a complete `FrameSequence` or `null` as a tombstone. The host requests snapshots after subscribing, accepts only valid messages for the current epoch and newer revisions, and answers late `ready` messages with a targeted request. This snapshot/replay handshake makes the final display state independent of package load order, supports late producers, and lets disposal remove a producer without leaving stale state.

## Considered Options

- **One widget per producer** — rejected; independent widgets cannot provide one ordered, consistently placed composition or one animation clock.
- **Direct producer-to-host calls** — rejected; they lose state when a producer or host loads later and create coupling between package lifecycles.
- **Producer-owned widgets or animation loops** — rejected; the host must be the sole owner of shared rendering and timing so sources remain composable and teardown is deterministic.

With no enabled or listening host, the client publication path is a no-op rather than a private fallback. Producer domain behavior therefore remains usable without activating Shared Display.
