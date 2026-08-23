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

The root plugin uses OMP feature selection. A normal install enables both
TypeScript extensions; a feature selector enables only the requested one.

## Requirements

- Bun 1.4.0
- OMP 16.1.7 or newer with plugin support

Any Bun installation method is supported. Confirm the active version:

```bash
bun --version
```

This repository includes `mise.toml` for contributors who use mise, but mise
is optional.

## Install extensions from GitHub

Install both current TypeScript extensions using the default feature set:

```bash
omp plugin install github:seenark/omp-plugins
```

Select multiple extensions explicitly:

```bash
omp plugin install 'github:seenark/omp-plugins[headroom,prompt-border-style]'
```

Install every feature declared by the repository, including future features:

```bash
omp plugin install 'github:seenark/omp-plugins[*]'
```

Install only one extension:

```bash
omp plugin install 'github:seenark/omp-plugins[headroom]'
omp plugin install 'github:seenark/omp-plugins[prompt-border-style]'
```

For a future feature named `new-package`, add it to the selector:

```bash
omp plugin install 'github:seenark/omp-plugins[headroom,prompt-border-style,new-package]'
```

Keep targets containing `[` and `]` quoted because those characters have
special meaning in many shells. The bracketed names are OMP feature names, not
GitHub subdirectories. Re-run the install command to change the selected
features of an existing installation.

Verify the installation:

```bash
omp plugin list
omp plugin doctor
```

## Install one extension from a local checkout

```bash
git clone https://github.com/seenark/omp-plugins.git
cd omp-plugins
bun install

# Headroom only
omp plugin install "$PWD/packages/headroom"

# Prompt Border Style only
omp plugin install "$PWD/packages/prompt-border-style"
```

## Install the Catppuccin themes

The current OMP runtime discovers custom themes from its theme directory, so
the theme package copies its JSON files there instead of registering them as
plugin extensions. From a checkout of this repository, run:

```bash
bun packages/theme-catppuccin/bin/install.js
```

For a non-destructive test, use a temporary OMP data directory:

```bash
tmp="$(mktemp -d)"
PI_CODING_AGENT_DIR="$tmp/agent" bun packages/theme-catppuccin/bin/install.js
rm -rf "$tmp"
```

Then open OMP, run `/settings`, and choose the Catppuccin light or dark theme.

## Workspace development

Install dependencies:

```bash
bun install
```

Run the available checks:

```bash
bun run list
bun run check
bun run typecheck
bun run test
bun run pack:check
bun run verify
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
bun packages/theme-catppuccin/bin/install.js
```

## Optional npm publication

Publishing is not required for GitHub installation. If these packages are
published later, the root scripts use Bun:

```bash
bun run publish:headroom
bun run publish:prompt-border-style
bun run publish:theme-catppuccin
bun run publish:all
```
