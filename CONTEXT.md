# OMP Context Rail

This context defines the plugin-owned context usage rail that complements OMP's native context display without changing OMP core.

## Language

**Native Context Gauge**:
The context-reactive gauge rendered by OMP's own status line settings.
_Avoid_: Native rail, core rail

**Context Rail**:
The plugin-owned visual row that communicates current context usage inside, above, or below the prompt box.
_Avoid_: Reactive line, plugin gauge


**Glyph Tile**:
One complete visual marker for a rail role. It may occupy multiple terminal columns; the agreed default custom tile is two columns, and its characters are not animated independently.
_Avoid_: Frame glyph, panel cell

**Block Frame**:
One animation state for a role, represented by one or more Glyph Tiles or rows, that advances as one unit.
_Avoid_: Individual glyph animation

**Frame Sequence**:
An ordered set of Block Frames for one role. A sequence may be static when it contains one frame or animated when it contains several; when its asset is unavailable, the role uses a static Default Glyph Tile.
_Avoid_: Glyph list

**Default Glyph Tile**:
The built-in single-frame visual used when a role has no readable custom asset; it never animates.
_Avoid_: Missing-frame placeholder

**Art Panel**:
The block-frame presentation shown beside the Context Rail's usage gauge; its rows are aligned using the rail's label position.
_Avoid_: Decorative strip

**Placement**:
The rail's fixed topology: `inside`, `above`, or `below` the prompt box.
_Avoid_: Position mode, location mode

**Visibility Mode**:
The rail presentation policy: `always`, `toggle`, or `collapse-while-typing`.
_Avoid_: Display state

**Usage Pointer**:
The marker showing the current context usage position on the rail.
_Avoid_: Cursor, progress cursor

**Pointer Frame**:
One glyph state of the Usage Pointer animation; pointer frames do not change the Usage Pointer's position.
_Avoid_: Pointer position

**Compaction Boundary**:
A marker for a context-maintenance boundary reported by OMP, including speculative and actual auto-compaction points.
_Avoid_: Warning threshold

**Speculation Boundary**:
The point where background speculative compaction begins before the automatic compaction threshold.
_Avoid_: Speculation icon

**Compaction Threshold**:
The point where OMP's automatic context compaction fires.
_Avoid_: Maximum context edge

**Maximum Context Edge**:
The fixed 100% endpoint of the active context window, distinct from the compaction threshold.
_Avoid_: Compaction boundary

**Compact Rail**:
A still-visible rail with reduced labels and decoration while draft activity is occurring or terminal width is constrained.
_Avoid_: Hidden rail, collapsed gauge

**Marker-only Rail**:
A Context Rail whose inline Glyph Tiles are positioned on the context scale with blank cells between them instead of a continuous horizontal bar.
_Avoid_: Empty bar, unpositioned legend

**Full Mode**:
A presentation showing every role's Glyph Tile, its Meaning Text beside the tile on the same inline row, and numeric context values such as current usage and window size. It is opt-in; Compact Mode is the default.

**Compact Mode**:
The default presentation showing only the inline Glyph Tiles; Meaning Text and numeric context values are omitted.

**Custom Mode**:
A presentation whose role templates and Meaning Text arrangement are defined by the user's configuration. Inline Glyph Tiles remain sorted by their actual context positions, while Meaning Text may be placed beside, above, or below the tiles. Templates may also place current percentage, token count, window size, and role name values.

**Template Token**:
A stable Custom Mode substitution for a role's Glyph Tile, Meaning Text, current percentage, token count, window size, or role name.

**Meaning Text**:
The human-readable explanation associated with a role's Glyph Tile.

**Meaning Placement**:
The configured relation of Meaning Text to inline Glyph Tiles: above, below, or beside. Full Mode defaults to beside; Compact Mode omits Meaning Text; Custom Mode may override the placement.

**Independent Gauges**:
The native context gauge and plugin Context Rail may be enabled simultaneously; neither one changes the other's settings or visibility.
_Avoid_: Mirrored gauge, replacement gauge
