# Extend the Existing Prompt Border Plugin for Context Rail

**Status:** accepted

The Context Rail will extend `prompt-border-style` instead of introducing a second plugin that owns the custom editor. `prompt-border-style` already owns OMP's `setEditorComponent()` seam; a separate plugin would overwrite that editor and break the prompt-border/rail composition. The rail remains plugin-owned, uses separate configuration and commands, and leaves OMP core and native context-gauge settings untouched.

## Considered Options

- **Extend `prompt-border-style`** — selected; preserves one editor owner and reuses border, theme, cursor, IME, wrapping, and autocomplete behavior.
- **Create a separate context-rail editor plugin** — rejected; competing `setEditorComponent()` registrations are not composable.
- **Use only a widget** — rejected; `setWidget()` cannot place the rail inside the prompt box.
