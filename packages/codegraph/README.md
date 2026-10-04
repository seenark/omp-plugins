# CodeGraph integration for OMP

`@codesook/omp-codegraph` detects existing CodeGraph project data and adds runtime exploration guidance. It works independently of the root settings extension and Shared Display host.

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

The configured exploration MCP tool must be active, not merely listed. The plugin does not install CodeGraph, initialize or index projects, configure MCP, register duplicate tools, or write repository agent instructions. Initialize a project explicitly with the CodeGraph CLI if needed.

## Commands

- `/codegraph` or `/codegraph status`: read-only status overlay, including the Integration Project, native Tool Workspace, data location, effective policy, and prerequisites. Enter/Esc closes the overlay.
- `/codegraph auto`: persist project permission for automatic guidance when ready.
- `/codegraph off`: persist project suppression of this plugin's guidance.

There is no plugin initializer in this package. Policy commands do not change plugin lifecycle, MCP activation, repository instructions, or tool data. Off affects only this plugin's guidance; other instructions can still request CodeGraph.

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
