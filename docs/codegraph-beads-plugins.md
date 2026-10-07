# CodeGraph and Beads Plugin Design

**Status:** Design confirmed on 2026-10-02. The user chose documentation only; plugin implementation has not started.

This design covers two independently installable OMP plugins. It does not change OMP core, install external tools, or initialize a project automatically. Terminology is defined in [CONTEXT.md](../CONTEXT.md); primary-source evidence and runtime limits are recorded in [the research note](research/codegraph-beads-omp-integration.md).

## Separate integrations

- **CodeGraph:** use the CodeGraph MCP integration configured by the user in OMP. Use the CodeGraph CLI for explicit initialization and project-data inspection. Do not configure MCP servers or register duplicate exploration tools.
- **Beads:** use the installed `bd` CLI. Do not install or require Beads MCP. Issue operations require an explicit user request; initialization alone does not authorize automatic task tracking.
- Installing or loading either plugin does not initialize either tool. Each project can use neither integration, either integration, or both.

## Project scope and settings

- The nearest Git repository working tree owns shared project settings and new initialization. Subdirectories use that project scope; nested repositories have separate scopes. Outside Git, use the directory in which OMP is operating.
- Existing Tool Workspaces follow each tool's native discovery rules, including ancestor lookup, environment overrides, Beads redirects, and worktree sharing. A Tool Workspace can differ from the Integration Project; detailed status must identify the resolved locations.
- Global defaults remain in `~/.config/codesook-omp/config.json` and the existing unified settings interface.
- Shared project overrides live in `<project>/.omp/codesook-omp.json`, using the existing `version: 1`, `display`, and `behavior` envelope. These overrides affect the CodeGraph and Beads integrations, not unrelated features.
- Project overrides take precedence over global defaults. Each integration has `auto` or `off` policy; without an override, automatic detection applies.
- `auto` allows runtime instructions when prerequisites are ready. It never performs automatic initialization.
- `off` suppresses this plugin's runtime instructions. It does not hide MCP tools, prohibit CLI use, disconnect servers, delete tool data, or remove instructions already present in AGENTS.md. Existing MCP or repository instructions may still request tool use.
- Explicit settings changes and policy commands may write the project file. Detection and initialization do not silently change project policy. Do not commit settings automatically.
- Preserve unrelated configuration fields and existing data. Invalid configuration must produce an actionable error rather than being overwritten or silently treated as permission to enable an integration.

## Commands and initialization

Each plugin owns its own slash command:

- `/codegraph init`, `/codegraph status`, `/codegraph auto`, `/codegraph off`.
- `/beads init`, `/beads status`, `/beads auto`, `/beads off`.

`status` is read-only. `auto` and `off` update shared project policy without changing OMP plugin-manager lifecycle state. An explicit `init` prepares tool data but preserves policy: an off project remains off.

Initialization must detect existing workspaces first. Do not force reinitialization, delete data, rebuild an existing CodeGraph index merely to initialize the integration, or discard Beads history. Preserve upstream safety refusals and report initialization failures accurately. Missing prerequisites require installation/configuration guidance, not automatic installation.

### CodeGraph initialization

Use native `codegraph init` against the project scope when no applicable initialized workspace exists. Initialization builds the initial graph. Do not run the agent installer, change MCP configuration, or generate AGENTS.md instructions.

Successful indexing is not sufficient for MCP readiness. If the exploration tool is missing or inactive in OMP, report that project data is initialized but the integration is not ready.

### Beads initialization

Before creating a new workspace, offer:

1. Standard/team mode or personal `--stealth` mode, with standard/team as the initial choice.
2. Optional Git-hook installation, off by default. Follow upstream restrictions for stealth mode rather than promising unsupported hook behavior.

Always pass `--skip-agents`. Do not set up Claude, Codex, or other agents. Use `--skip-hooks` unless the user approves supported hook installation.

Use native standard initialization defaults rather than introducing server provisioning or an advanced role wizard. Native initialization may modify Git metadata or adopt existing remote history; preserve upstream safeguards. The plugin does not add automatic remote push/sync operations or destructive reinitialization flags. Users may perform advanced setup directly with `bd`; the plugin must detect that setup afterward.

## Runtime instructions

Append instructions through `before_agent_start`, preserving all existing system-prompt entries. Inject only when the integration policy permits guidance and its prerequisites are ready. Neither plugin writes AGENTS.md, including for externally initialized workspaces.

CodeGraph instructions communicate:

- Use CodeGraph MCP first for code flow, relationships, callers, callees, and change impact.
- Pass the resolved CodeGraph project path explicitly.
- Use grep/read for missing coverage, missing details, or source reported stale by CodeGraph. Verbatim source already returned by CodeGraph does not need a redundant read solely to repeat exploration.

Beads instructions communicate:

- Availability does not authorize issue operations.
- Use Beads only when the user explicitly requests it, within the scope of that request.
- Use the `bd` CLI and machine-readable output where appropriate; respect its resolved workspace.
- Do not automatically create or update issues for unrelated work.

## Readiness and status

Do not treat a directory alone as successful initialization.

- **CodeGraph:** project-data inspection must succeed and the required CodeGraph MCP exploration tool must be configured and active in OMP. This is setup readiness, not verified MCP connection health. Detailed status must state that connection health was not tested; do not issue synthetic exploration queries on every turn.
- **Beads:** `bd` must be available and its resolved initialized workspace must be usable. Workspace discovery alone is not proof of database access. Respect native redirects and backend configuration rather than implementing a separate folder-only resolver.

Status must distinguish suppression, missing initialization, missing prerequisites, readiness, and inspection/configuration errors. A completed init must not be reported as a ready integration when invocation prerequisites are missing.

Visibility is independently configurable for each integration through the existing settings interface:

- `ready` — default; show permitted, ready integrations.
- `always` — show the integration's current state, including off, uninitialized, or error states.
- `never` — hide persistent display, without disabling instructions or read-only status commands.

Use Shared Display when its host is active; otherwise use the native OMP footer. Do not render duplicate copies. The existing Shared Display client has no host-availability signal, so this behavior requires an explicit host-availability contract rather than guessing from EventBus presence.

Refresh during session startup, before a user turn, and when plugin commands run. Resolve the current project again when the working directory changes. Do not add idle polling or background watchers; external initialization or settings edits become visible at the next refresh.

## Behavioral acceptance

Future implementation must demonstrate:

- Projects with neither, only CodeGraph, only Beads, and both tools initialized behave independently.
- External initialization is detected without modifying AGENTS.md or shared policy.
- Off projects receive no plugin instructions, retain independently configured tools/data, and remain off after init.
- CodeGraph data without an active MCP exploration tool is not reported ready. Readiness does not claim transport health.
- Beads does not create or update issues merely because it is available. Initialization honors mode/hook choices and skips agent files.
- Subdirectory, non-Git, redirected-workspace, and project-switch cases use the correct policy and workspace locations.
- Visibility modes and Shared Display/footer fallback produce the intended status without duplicate rendering or stale project instructions.
- Existing data and invalid configuration survive errors without forced replacement.

## Evidence and current delivery

Only documentation is delivered in this phase: this confirmed design, the glossary, and the research note. No plugin code or project initialization was performed.

Local checks observed CodeGraph `1.6.1` and its CLI help, including JSON status support. `bd` was not found in PATH, so Beads behavior is supported by upstream documentation, not local runtime verification. No plugin smoke run or test suite was executed because implementation was explicitly deferred.
