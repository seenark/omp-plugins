---
status: accepted
---
# Package-Owned Configuration and Root Commands

Each package owns one normalized JSON configuration file and one root slash command. The bare command and its `config` form open the same staged dialog; the dialog edits a draft only, and `Apply` or `Cancel` is the explicit boundary between a proposed configuration and live runtime state.

`Apply` validates the whole draft, writes canonical JSON to a uniquely named temporary sibling, and renames it over the destination. Runtime objects are updated only after the rename succeeds; a validation or write failure leaves both the existing file and live runtime unchanged. `Reload` discards the draft and rereads disk, while `Cancel` changes neither persisted configuration nor runtime. Asset initialization is the explicit exception: it may create missing assets immediately after its own confirmation and is not rolled back by a later Cancel.

Legacy migration is one-time and destination-wins. Destination `config.json` existence is the sole migration gate: when it exists, only that file is normalized, and an invalid destination falls back to runtime defaults without being overwritten or supplemented from legacy data. When it is absent, each applicable legacy source is read independently, a normalized destination is created atomically, and legacy files are never consulted again on later loads. Migration never rewrites the legacy sources, and package defaults are fallbacks rather than replacements for existing user bytes.

The cutover removes split commands, old aliases, and compatibility shims instead of forwarding them to the new root commands. This keeps command discovery and configuration ownership unambiguous across Shared Display, Caveman, Headroom, and Prompt Border.

## Considered Options

- **Keep split commands and configuration paths** — rejected; each package needs one discoverable command and one authoritative persisted document.
- **Write configuration directly on every dialog change** — rejected; staged drafts make Cancel safe and whole-draft validation visible before persistence.
- **Use a migration marker or keep consulting legacy files** — rejected; destination existence is deterministic, preserves destination-wins behavior, and prevents old state from reappearing after migration.
