---
status: accepted
---
# Marker-Only Context Rail

The plugin Context Rail will use a marker-only proportional scale instead of a continuous horizontal bar. Four semantic roles—`speculation`, `pointer`, `compaction`, and `maximum`—remain positioned by their actual context coordinates; the maximum role is the fixed 100% edge, while the speculation and compaction roles follow OMP's active settings and model. The default mode is `compact`, showing only inline Glyph Tiles; `full` adds numeric values and beside Meaning Text; `custom` uses per-role templates with `{frame}`, `{text-meaning}`, `{percent}`, `{tokens}`, `{window}`, and `{role}` tokens and may place Meaning Text beside, above, or below the inline row.

Custom Frame Sequences live in one asset file per role. An unreadable or missing asset falls back to a static single Default Glyph Tile. Inline tiles are never split; boundary positions take priority over the moving pointer, and Meaning Text yields when terminal width is constrained. This keeps the native OMP gauge untouched while preserving its context semantics in a plugin-owned rail.

## Considered Options

- **Continuous bar** — rejected; the rail should communicate context boundaries through custom Glyph Tiles rather than a filled line.
- **Grouped, unpositioned legend** — rejected; it loses the proportional relationship between current usage, compaction, and the maximum edge.
- **Second editor-owning plugin** — rejected; the existing prompt-border plugin owns the custom-editor seam, so the rail remains within that plugin's renderer.
