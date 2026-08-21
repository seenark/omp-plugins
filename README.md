# omp-plugins

Standalone [oh-my-pi](https://github.com/can1357/oh-my-pi) plugins in one
repository. The TypeScript extensions can be installed directly from GitHub;
the Catppuccin theme package can be run with Bun and may be published later as
an npm package.

## Included plugins

```text
packages/
  headroom/             # context compression extension
  prompt-border-style/  # prompt editor border styles
  theme-catppuccin/     # Catppuccin theme installer
```

The repository root exposes the Headroom and Prompt Border Style extensions to
OMP's plugin manager.

## Requirements

- [mise](https://mise.jdx.dev/)
- Bun 1.4.0, installed from `mise.toml`
- OMP 16.1.7 or newer with plugin support

Install the pinned Bun version and confirm it:

```bash
mise install
mise exec -- bun --version
```

The version command must print `1.4.0`.

## Install the extensions from GitHub

Install this repository as one OMP plugin. The root manifest registers both
TypeScript extensions:

```bash
omp plugin install github:seenark/omp-plugins
```

For a project-scoped installation:

```bash
omp plugin install --scope project github:seenark/omp-plugins
```

Verify the installation:

```bash
omp plugin list
omp plugin doctor
```

## Install the Catppuccin themes

The current OMP runtime discovers custom themes from its theme directory, so
the theme package copies its JSON files there instead of registering them as
plugin extensions. From a checkout of this repository, run:

```bash
mise exec -- bun packages/theme-catppuccin/bin/install.js
```

For a non-destructive test, use a temporary OMP data directory:

```bash
tmp="$(mktemp -d)"
PI_CODING_AGENT_DIR="$tmp/agent" mise exec -- bun packages/theme-catppuccin/bin/install.js
rm -rf "$tmp"
```

Then open OMP, run `/settings`, and choose the Catppuccin light or dark theme.

## Workspace development

Install dependencies with the Bun version managed by mise:

```bash
mise install
mise exec -- bun install
```

Run the available checks:

```bash
mise exec -- bun run list
mise exec -- bun run check
mise exec -- bun run typecheck
mise exec -- bun run test
mise exec -- bun run pack:check
mise exec -- bun run verify
```

- `bun run check` validates package names, versions, publication state, and
  OMP entrypoint metadata.
- `bun run typecheck` runs package-local TypeScript checks.
- `bun run test` runs package-local Bun tests.
- `bun run pack:check` checks each package's contents with Bun's pack dry run.
- `bun run verify` runs all checks in order.

## Local plugin development

Link the TypeScript extensions directly from this checkout:

```bash
omp plugin link "$PWD/packages/headroom"
omp plugin link "$PWD/packages/prompt-border-style"
```

Run the theme installer locally:

```bash
mise exec -- bun packages/theme-catppuccin/bin/install.js
```

## Optional npm publication

Publishing is not required for GitHub installation. If these packages are
published later, the root scripts use Bun:

```bash
mise exec -- bun run publish:headroom
mise exec -- bun run publish:prompt-border-style
mise exec -- bun run publish:theme-catppuccin
mise exec -- bun run publish:all
```
