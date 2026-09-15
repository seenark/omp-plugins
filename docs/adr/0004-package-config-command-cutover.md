---
status: accepted
---
# Unified Root Configuration and Feature Commands

Codesook OMP Plugin owns one root slash command, `/codesook-omp-plugin`, and one canonical document at `~/.config/codesook-omp/config.json`. Document envelope is `{version: 1, display: {...}, behavior: {...}}`; unknown root keys survive writes. Shared Display owns presentation state, while Caveman, Headroom, and other feature packages own behavior state.

Settings dialog edits staged draft state. `Shift+Enter` applies immediately; bare `Enter` on `Apply` asks confirmation. Successful Apply validates all fields, atomically replaces root document, then emits a versioned EventBus event. Loaded project extensions consume that event and update live behavior; current provider request remains unchanged. `Reload` discards draft edits. `Cancel` changes neither disk nor runtime.

Feature commands retain behavior operations: `/caveman` status and level controls, `/headroom` status/toggle/health/stats/init, and `/prompt-border` style/layout/reset/rail/glyph operations. Package config dialogs, bare config commands, and `/shared-display` are removed. Status and health views are read-only focused overlays: they show loading/result/error, close on `Enter` or `Escape`, and never send prompt messages or abort active work.

Migration is section-aware. A valid root document imports only missing feature sections from valid legacy sources; an invalid root document is never supplemented or overwritten. Successful migration atomically writes missing sections and removes only valid legacy JSON sources consumed by migration; invalid sources remain for repair. Explicit non-root paths retain standalone package persistence for tests and integrations.

Plugin presence and next-start lifecycle state come from `omp plugin list --json`. Settings can report missing optional plugins and cannot unload or enable plugins during an active process. Ponytail configuration is read-only when absent; its native `/ponytail off|lite|full` command remains live. Headroom does not start or manage external proxy processes; it may read an optional token file and performs health checks against externally managed services.

## Considered Options

- **Keep split config commands and package-owned canonical files** — rejected; root settings need one discoverable command and one authoritative document.
- **Write configuration directly on every dialog change** — rejected; staged drafts make Cancel safe and validation visible before persistence.
- **Gate migration only on destination existence** — rejected; valid partial root documents must gain missing sections without losing existing settings, while invalid roots remain protected.
- **Let settings unload or enable plugins** — rejected; plugin lifecycle belongs to OMP and next process start.
