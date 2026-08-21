# Prompt Loading Glyphs Debug Design

## Goal

Add a dedicated `/prompt-loading-glyphs` slash command for debugging prompt loading glyph behavior without spending LLM tokens, and make the command explain why fast `frameMs` values such as `20` can visually jump.

## Problem

Oh My Pi advances spinner arrays on a fixed 80ms host tick. This plugin adapts configured source frames to that cadence in `buildTimedSpinnerFrames()`.

For `frameMs < 80`, the plugin skips source frames instead of repainting faster than the host. That means a spinner that loops smoothly across the full source sequence can still jump if the visible subsequence is not smooth.

Example:
- source frames: `F0 F1 F2 F3 F4 F5 F6 F7`
- `frameMs = 20`
- visible subsequence is approximately every fourth source frame: `F0 F4`

Repeating `F0` at the end of the full source list does not help if the kept subsequence still jumps at `F4 -> F0`.

## Requirements

### User-facing

Add a new slash command namespace:
- `/prompt-loading-glyphs debug frames`
- `/prompt-loading-glyphs debug demo`
- `/prompt-loading-glyphs debug on`
- `/prompt-loading-glyphs debug off`

The command name must not reuse `/prompt-border`, because the feature is about spinner/loading glyphs rather than border styling.

### Behavioral

1. `debug frames`
   - Reads the current prompt loading glyph configuration.
   - Resolves both spinner groups: `status` and `activity`.
   - Prints, for each group:
     - configured `frameMs`
     - source frames from the glyph text file
     - adapted visible frames returned at runtime
     - a short interpretation such as `repeats frames`, `keeps frames unchanged`, or `skips source frames`
   - Makes subsequence jumps obvious without requiring the user to prompt an LLM.

2. `debug demo`
   - Starts a local spinner demo in the UI for both `status` and `activity`.
   - Uses the same adapted frame arrays that real runtime spinners use.
   - Does not call the model or spend prompt tokens.
   - Can be stopped by `debug off`, by re-running the command, or on session shutdown.

3. `debug on`
   - Enables session-only debug mode.
   - Real spinner surfaces in that session may show compact debug labels/index info to help correlate visible glyphs with their adapted frame positions.
   - Must not persist to `config.json`.

4. `debug off`
   - Disables session-only debug mode.
   - Stops any running local demo.
   - Restores normal spinner rendering for the session.

## Recommended UX

### `debug frames`

Use a compact text report. Example shape:

```text
Prompt loading glyphs: activity
frameMs: 20
source (8): F0 F1 F2 F3 F4 F5 F6 F7
visible (2): F0 F4
mode: skips source frames to match 80ms host tick
note: smooth looping must hold on the visible subsequence, not only the full source list
```

Repeat for `status` below it.

### `debug demo`

Show a local UI element that cycles both groups side by side, for example:

```text
status: S0 Working…
activity: A0 Working…
```

The implementation should reuse the host loader cadence rather than inventing a second timing model.

### `debug on`

Keep the default debug signal small. Example options:
- append `[2/6]` to the spinner text
- or include `src:8 vis:2`

Recommendation: use frame index/count only, because it is easy to scan and avoids clutter.

## Architecture

### Command parsing

Extend the current single-command plugin surface with a second registered command:
- existing: `prompt-border`
- new: `prompt-loading-glyphs`

The new command should have its own usage string and argument completions. It should not overload `/prompt-border`.

### Shared runtime state

Add session-local debug state in `src/main.ts`:
- whether loading-glyph debug mode is enabled
- whether a demo component is currently mounted
- any restore/cleanup handles needed for UI teardown

This state must be cleared on `session_shutdown`.

### Frame inspection path

Extract or reuse one helper that produces a resolved spinner debug snapshot from a `PromptBorderConfig` spinner group:
- raw source frames
- adapted frames via `buildTimedSpinnerFrames()`
- interpretation string based on `frameMs` vs host `80ms`

This avoids duplicating frame adaptation logic between runtime patching and debug output.

### Demo path

Build the demo from the same adapted arrays used by `installSpinnerGlyphFrames()`.

Recommendation:
- create a lightweight UI component that renders two local loaders, one for `status` and one for `activity`
- mount it only while demo/debug is active
- keep it independent from prompt submission or model execution

### Debug-on path

When session debug mode is enabled, inject minimal labels into spinner-facing UI text using the resolved adapted frames already known at patch time.

The debug labels should be:
- session-only
- removable without touching persisted config
- narrow enough not to break layout badly

## Non-goals

- Do not change prompt border styling behavior.
- Do not add new persisted config fields for debugging.
- Do not change the spinner adaptation algorithm introduced for `frameMs`.
- Do not modify Oh My Pi host timing.

## Testing

### Automated

Add unit coverage for:
- parsing `/prompt-loading-glyphs` subcommands
- frame report generation for unchanged/repeated/skipped cases
- session-only debug state toggling
- demo cleanup on shutdown

Prefer deterministic tests over timing-heavy animation assertions.

### Manual

Verify in OMP that:
- `/prompt-loading-glyphs debug frames` reports the expected visible subsequence for `frameMs = 20`
- `/prompt-loading-glyphs debug demo` animates locally without sending a model prompt
- `/prompt-loading-glyphs debug on` shows debug info on real spinner usage in the active session
- `/prompt-loading-glyphs debug off` removes the debug affordances and stops the demo

## Risks and mitigations

### Risk: duplicated timing logic

If the debug command reimplements spinner adaptation separately from runtime patching, the report can drift from reality.

Mitigation:
- centralize resolved-frame computation in one helper and reuse it everywhere.

### Risk: UI clutter

Always-on heavy debug labels can make the prompt harder to read.

Mitigation:
- keep debug session-only and compact.
- keep `frames` as the main diagnostic path.

### Risk: demo interferes with normal editor UI

A mounted demo component could collide with the prompt editor if it reuses the same slot carelessly.

Mitigation:
- keep a single owned demo mount with explicit teardown on `debug off` and `session_shutdown`.

## Recommendation

Implement both debug surfaces under `/prompt-loading-glyphs`, with `debug frames` as the primary diagnostic and `debug demo` as the visual confirmation. Keep all debug state session-local and derive all visible-frame reports from the same helper used for runtime spinner adaptation.
