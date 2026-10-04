# CodeGraph integration for OMP

`@codesook/omp-codegraph` detects existing CodeGraph project data, supports explicit native initialization, and adds runtime exploration guidance. It works independently of the root settings extension and Shared Display host.

## Installation

```sh
omp plugin install /path/to/omp-plugins/packages/codegraph
# Or enable the optional feature in the workspace package:
omp plugin install 'github:seenark/omp-plugins[codegraph]'
```

Requires OMP 18.3.1 or newer and an installed `codegraph` CLI. Configure CodeGraph's MCP server in OMP yourself. A typical native `mcp.json` entry is:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "codegraph",
      "args": ["serve", "--mcp"]
    }
  }
}
```

The configured exploration MCP tool must be active, not merely listed. The plugin does not install CodeGraph or missing prerequisites, configure MCP, run the agent installer, register duplicate tools, or write repository agent instructions. Loading the plugin and normal detection never initialize projects.

## Commands

- `/codegraph` or `/codegraph status`: read-only status overlay, including the Integration Project, native Tool Workspace, data location, effective policy, and prerequisites. Enter/Esc closes the overlay.
- `/codegraph init`: explicitly prepare native project data and its initial graph, or reuse an existing native Tool Workspace without rebuilding it. Initialization preserves project policy.
- `/codegraph auto`: persist project permission for automatic guidance when ready.
- `/codegraph off`: persist project suppression of this plugin's guidance.

Policy commands do not change plugin lifecycle, MCP activation, repository instructions, or tool data. Off affects only this plugin's guidance; other instructions can still request CodeGraph.

### Explicit initialization

`/codegraph init` inspects CodeGraph's native workspace selection first. An applicable existing Tool Workspace is reused, even when an ancestor or `CODEGRAPH_DIR` places it outside the Integration Project. No existing workspace is reinitialized, deleted, or rebuilt merely to initialize the integration.

Before creating data in a different Integration Project scope, the plugin inspects that target with the native CLI too. This prevents initialization from a Git subdirectory from rebuilding partial database data at the working-tree root. Valid data found at the target is reused.

When no initialized workspace applies, the plugin runs native `codegraph init <Integration Project> --yes`. Native initialization builds the initial graph; there is no second `index` call or forced rebuild. The CLI retains its target-safety checks. The plugin never passes force flags, repairs or removes partial data, installs prerequisites, or performs Git commits, pushes, or remote synchronization.

If native inspection reports uninitialized data but the resolved workspace already contains a `codegraph.db` entry, initialization refuses rather than allowing native in-place rebuilding of a partial or schemaless database. This also preserves dangling database symlinks. Errors inspecting the database entry fail closed; inspect permissions and existing data manually. The plugin does not parse, migrate, repair, or delete the database.

Initialization never writes global or project configuration. An off project remains a Suppressed Integration and the result explains that plugin runtime instructions remain suppressed. Missing or inactive MCP is not an indexing failure: usable data is reported as initialized but not ready. Detailed status also reports the underlying project inspection independently of policy suppression.

The command refreshes status before and after the operation. Invalid configuration or failed inspection blocks initialization with an actionable error. Native refusals and initialization failures retain their error output; inspect the existing data or target permissions with the native CLI before retrying. An exit-success result without usable data is not reported as verified initialization. Configure and enable the CodeGraph MCP exploration tool yourself when project data is initialized but not ready.

## Scope and configuration

The nearest Git working tree owns project policy, including when OMP operates in a subdirectory. Nested Git working trees have separate policy. Outside Git, the operating directory is the Integration Project. CodeGraph's native CLI selects its Tool Workspace, including ancestor discovery and `CODEGRAPH_DIR`; that location can differ from the policy scope.

Global defaults: `~/.config/codesook-omp/config.json`. Project overrides: `<Integration Project>/.omp/codesook-omp.json`. Both use this envelope:

```json
{
  "version": 1,
  "display": { "codegraph": { "visibility": "ready" } },
  "behavior": { "codegraph": { "policy": "auto" } }
}
```

Project values override global defaults. Omitted values inherit; defaults are `auto` and `ready`. Policy values are `auto` and `off`. Visibility values are `ready`, `always`, and `never`. Invalid configuration is reported and preserved, and does not permit guidance. Unknown fields survive settings and policy writes. Settings are never committed automatically.

When installed, `/codesook-omp-plugin` provides global defaults and project overrides in its existing staged dialog. Apply validates both scopes before writing, Reload discards staged edits, and Cancel does not write. Plugin lifecycle rows remain informational.

## Readiness and display

Ready requires successful native project-data inspection and an active configured CodeGraph exploration MCP tool. A `.codegraph` directory alone is insufficient. Detailed status always says **MCP connection health was not tested**: readiness permits use, but does not certify transport health or perform a synthetic query.

Permitted ready integrations append guidance to existing system-prompt entries. Guidance requests CodeGraph-first exploration, passes the resolved `projectPath` explicitly, and allows grep/read for missing coverage, missing details, or stale source.

- `ready`: show only permitted ready integrations.
- `always`: show the current state, including suppression, uninitialized data, missing prerequisites, and errors.
- `never`: hide persistent status without disabling guidance or status inspection.

An enabled Shared Display host with a UI session receives the status segment. Otherwise, CodeGraph uses OMP's native footer. It never uses both at once. Depending on the shared client/policy package does not load the host extension.

Detection refreshes at session startup and switches, before each user turn, on commands, and on settings changes. External initialization and configuration edits appear at the next refresh. There is no plugin polling timer or background watcher.

## Development

```sh
bun test packages/codegraph/src
bun run --cwd packages/codegraph check:types
```

The shared project-policy seam is `@codesook/omp-shared-display/project-integrations`; the presence-aware producer seam is `@codesook/omp-shared-display/client`.
