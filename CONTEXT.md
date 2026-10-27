# OMP Plugin Integrations and Display

This context defines independent project integrations and plugin-owned display surfaces that complement OMP without changing OMP core. It also covers content vendored from other projects, the token-savings figures shown in the Shared Display, the Instruction Modes, and pstack's model roles and Activation.

## Language

**Native Context Gauge**:
The context-reactive gauge rendered by OMP's own status line settings.
_Avoid_: Native rail, core rail

**Context Rail**:
The plugin-owned visual row that communicates current context usage inside, above, or below the prompt box.
_Avoid_: Reactive line, plugin gauge

**Shared Display**:
The combined status surface that presents ordered Status Segments from multiple plugin features as one display.
_Avoid_: Combined widget, status strip

**Display Host**:
The single owner of a Shared Display's source composition, animation, and widget lifecycle.
_Avoid_: Widget owner, display renderer

**Display Producer**:
A feature that supplies one Status Segment to a Display Host while remaining independent of the surface's composition and animation.
_Avoid_: Widget producer, status renderer

**Status Segment**:
One named feature's current visual contribution to Shared Display, represented by a Frame Sequence or an intentional absence.
_Avoid_: Status line, widget

**Display Style**:
The shape of Shared Display around and between Status Segments: caps, separators, brackets, and padding. It never changes a segment's own icons or text, and it carries no colors.
_Avoid_: Theme, preset, skin

**Display Palette**:
The named set of colors a Display Style paints Status Segments with, chosen independently of the Display Style. It may follow the OMP theme or be a fixed named palette.
_Avoid_: Theme, color scheme

**Session Override**:
A session-only setting that takes precedence over persisted configuration until the session boundary resets it.
_Avoid_: Runtime default, temporary configuration

**Widget Placement**:
The OMP location of a widget relative to the editor: `aboveEditor` or `belowEditor`.
_Avoid_: Placement, rail placement

**Glyph Tile**:
One complete visual marker for a rail role. It may occupy multiple terminal columns; the agreed default custom tile is two columns, and its characters are not animated independently.
_Avoid_: Frame glyph, panel cell

**Block Frame**:
One animation state for a role, represented by one or more Glyph Tiles or rows, that advances as one unit.
_Avoid_: Individual glyph animation

**Frame Sequence**:
An ordered set of Block Frames for one role. One-frame sequences are static; multi-frame sequences animate at their configured Frame Rate, or show their first frame when no Frame Rate is configured. If its asset is unavailable, the role uses a static Default Glyph Tile.
_Avoid_: Glyph list

**Frame Rate**:
The target number of frame changes per second for an animated Frame Sequence.
_Avoid_: Update interval

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
The Native Context Gauge and Context Rail may be enabled simultaneously. Their visibility and configuration remain independent, but both represent the same current context usage.
_Avoid_: Mirrored gauge, replacement gauge

**Root Plugin Configuration**:
The versioned `~/.config/codesook-omp/config.json` envelope containing `display` and `behavior` groups for all Codesook OMP features.
_Avoid_: Package config, shared config file

**Display Configuration**:
Presentation settings owned by a display surface or producer, including layout, templates, visibility, and external asset paths. Glyph and frame bytes remain outside root JSON.
_Avoid_: Runtime behavior

**Behavior Configuration**:
Feature runtime settings such as enable gates, thresholds, proxy URL, and session defaults.
_Avoid_: Lifecycle state

**Plugin Lifecycle State**:
OMP plugin-manager enablement reported by `omp plugin list --json`; changes apply on next OMP start and are informational in root settings.
_Avoid_: Live unload, runtime toggle

**Project Integration**:
An independent association between a project and an external tool such as CodeGraph or Beads. A project may use neither integration, either integration, or both.
_Avoid_: Plugin lifecycle state, combined integration

**Initialized Integration**:
A Project Integration whose project data has been initialized by its external tool, whether directly by the user or through an OMP plugin. Initialization does not imply that the tool or its plugin is currently available.
_Avoid_: Installed tool, ready integration

**Integration Visibility**:
The user's presentation choice for a Project Integration's status. Visibility is independent of initialization and Plugin Lifecycle State.
_Avoid_: Integration enablement, tool availability

**Ready Integration**:
A Project Integration whose project data is usable and whose required tool interface is available. Readiness permits an attempt to use the tool; it does not promise continuously verified external-service health.
_Avoid_: Folder presence, installed plugin

**Project Integration Policy**:
The project's choice to allow automatic integration guidance or suppress it. Suppression preserves project data and independent tool access, without changing another integration.
_Avoid_: Data deletion, plugin unload

**Runtime Integration Instructions**:
Transient instructions for a permitted, ready Project Integration in an OMP session. They are not shared repository instructions and do not require changes to AGENTS.md.
_Avoid_: Generated agent file, persistent project instructions

**Shared Project Policy**:
A Project Integration Policy recorded with the project for collaborators to share. It does not imply that every collaborator has installed the associated OMP plugin.
_Avoid_: Personal preference, global default

**On-demand Beads Workflow**:
Issue tracking through Beads for work that the user explicitly asks to track. Availability alone does not authorize the agent to create or modify issues for unrelated work.
_Avoid_: Automatic issue tracking, mandatory task tracking

**Matt Pocock Workflow**:
A project set up for the `mattpocock/skills` engineering skills with a team Beads workspace as its issue tracker, the default triage labels, and the default single-context domain docs, all recorded in `AGENTS.md`. Setting it up does not authorize issue operations beyond the On-demand Beads Workflow.
_Avoid_: Skills setup, matt setup

**Ready Issue**:
A Beads issue that is open and has no open blocker. Distinct from a Ready Integration, which says the Beads tool is usable at all.
_Avoid_: Ready task, ready (unqualified)

**Integration Project**:
The repository working tree that owns shared Project Integration Policy and new tool initialization. Outside a Git repository, the active directory is the Integration Project.
_Avoid_: Tool Workspace, every subdirectory

**Tool Workspace**:
The initialized project data selected by an external tool for an Integration Project. Its location may differ from the Integration Project because tools have their own discovery and redirection rules.
_Avoid_: Policy root, plugin installation

**Suppressed Integration**:
A Project Integration whose policy disallows plugin-provided runtime instructions. Suppression leaves independently configured tool access and existing repository instructions unchanged.
_Avoid_: Tool prohibition, server disconnection

**Read-only Status Overlay**:
A focused TUI surface that starts with `Loading…`, renders async result or error, closes with Enter/Esc, and never captures prompt input or aborts active work.
_Avoid_: Notification, prompt dialog

**External Proxy**:
A Headroom service managed outside OMP, such as Docker or Cloudflare. Headroom performs health checks and requests but never starts or stops that service.
_Avoid_: Auto-start proxy

**Proxy Token**:
An optional credential used to authorize requests to an External Proxy. When absent, the proxy's own unauthenticated access policy applies.
_Avoid_: Headroom password

**Proxy Token File**:
A local secret source for a Proxy Token, separate from Root Plugin Configuration.
_Avoid_: Token configuration

**Skill Use**:
One occasion on which a skill's instructions were brought into an Agent Session, attributed to its source: the user, the agent on its own, or a subagent.
_Avoid_: Skill activation, skill invocation, skill load

**Project Skill**:
A skill whose instructions live inside an Integration Project. Its Skill Uses are counted with that project.
_Avoid_: Local skill, repo skill

**Global Skill**:
A skill available to every project, such as one in the user's home skill directories or one shipped with a plugin.
_Avoid_: User skill, shared skill

**Reset Point**:
The moment from which skill statistics are counted again, for all skills or for one skill. Earlier Skill Uses are kept but not counted.
_Avoid_: Clear, wipe, delete stats

**Leftover Process**:
A process started on behalf of an Agent Session that is still running after that Agent Session has ended.
_Avoid_: Orphan, zombie, stale server

### Vendoring

**Upstream**:
The external project a piece of Vendored Content comes from, such as `JuliusBrussee/caveman` or `DietrichGebert/ponytail`.
_Avoid_: original, the repo, source

**Pinned Revision**:
The exact Upstream commit that the installed Vendored Content comes from.
_Avoid_: version, latest

**Vendored Content**:
Upstream files kept byte-for-byte at the Pinned Revision so every update is a reviewable diff.
_Avoid_: port, copy, fork

**Adaptation**:
A recorded change that points Upstream wording or tooling at an OMP equivalent.
_Avoid_: patch, hack, override

**Excluded**:
Upstream parts deliberately not brought over, such as Upstream's own CLI, proxy or skills this setup does not use.
_Avoid_: unsupported, removed, TODO

**Fork Registry**:
The recorded list of Vendored Content paths this repo changes by hand on purpose, each with its reason. Sync keeps registered paths and fails on any other difference from Upstream.
_Avoid_: patch list, override list

### Token Savings

**Agent Session**:
One OMP conversation, from its start until the user starts or switches to another conversation; moving between branches stays in the same Agent Session.
_Avoid_: run, display session, process

**Headroom Savings**:
The share of conversation tokens that Headroom removed before they reached the model, summed over every compression attempt in one Agent Session, including attempts that removed nothing.
_Avoid_: saved%, compression ratio, last compression

**Compression Unavailable**:
The state in which the Headroom proxy is reachable but refuses or fails compression, so Headroom Savings cannot grow until it recovers.
_Avoid_: offline, online, idle

**RTK Savings**:
The share of shell command output that RTK removed before it reached the model during one Agent Session, kept separate from Headroom Savings.
_Avoid_: rtk gain, compaction savings, saved chars

### Instruction Modes

**Instruction Mode**:
A set of standing instructions, such as Ponytail or Caveman, added to every request in an Agent Session until the user turns it off.
_Avoid_: persona, style plugin, sticky mode

**Mode Level**:
The setting an Instruction Mode runs at in an Agent Session, named exactly as its Upstream names it (such as `ultracave` or `lite`), where `off` means its instructions are not sent at all.
_Avoid_: intensity, strength

### pstack

**Model Role**:
A named entry in OMP's `modelRoles` that a pstack Lane resolves its model through, such as `pstack-build` or `pstack-panel-a`. pstack owns only the `pstack-*` roles.
_Avoid_: model alias, agent model, lane config

**Panel Seat**:
One of up to five independent reviewer slots (`pstack-panel-a` to `pstack-panel-e`), each holding a different model. An unset seat is absent, not a failure.
_Avoid_: reviewer slot, vote, expert

**Lane**:
A task agent that pstack dispatches by name to do one kind of work on the Model Role it is bound to; read-only Lanes cannot write.
_Avoid_: subagent, worker, role

**Activation**:
The state of an Agent Session once the user starts pstack's poteto-mode (`/poteto` or `/skill:poteto-mode`). pstack's guards, Status Segment, warnings and Instruction Mode suspension apply while it is active. It is rebuilt from the session's own entries, so it survives compaction and resume.
_Avoid_: run, pstack mode, workflow run

**Dropout**:
A Panel Seat's Agent Session that fell back to a different model than the seat's own, recorded so a panel never reports diversity it did not have.
_Avoid_: failure, retry
