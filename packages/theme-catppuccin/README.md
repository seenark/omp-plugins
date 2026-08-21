# @codesook/omp-theme-catppuccin

## What it does

This package installs four Catppuccin theme JSON files into OMP's custom theme directory so current OMP builds can discover them in `/settings`.

## Install themes

```sh
bunx -y @codesook/omp-theme-catppuccin
```

If you are working from the monorepo checkout, run `bun packages/theme-catppuccin/bin/install.js` instead of `bunx`; running the scoped `bunx` command from the package's own source directory can resolve against the local package context and fail with `sh: omp-theme-catppuccin: command not found`.
## Select themes in OMP

```sh
omp
```

Then type `/settings`, set Light Theme to `catppuccin-latte`, and set Dark Theme to `catppuccin-frappe`, `catppuccin-macchiato`, or `catppuccin-mocha`.

## Destination directory

- default: `~/.omp/agent/themes`
- if `PI_CODING_AGENT_DIR` is set: `$PI_CODING_AGENT_DIR/themes`
- running the installer overwrites only these four files: `catppuccin-latte.json`, `catppuccin-frappe.json`, `catppuccin-macchiato.json`, `catppuccin-mocha.json`

## Local development

```sh
bun packages/theme-catppuccin/bin/install.js
```

Non-destructive test:

```sh
tmp="$(mktemp -d)"
PI_CODING_AGENT_DIR="$tmp/agent" bun packages/theme-catppuccin/bin/install.js
[packages/theme-catppuccin/README.md#7FDA]

## Publish to npm

From the monorepo root:

```sh
bun run publish:theme-catppuccin
```

Publishing requires npm login and npm 2FA if your account is configured for it.

## Uninstall installed theme files

```sh
rm -f ~/.omp/agent/themes/catppuccin-latte.json
rm -f ~/.omp/agent/themes/catppuccin-frappe.json
rm -f ~/.omp/agent/themes/catppuccin-macchiato.json
rm -f ~/.omp/agent/themes/catppuccin-mocha.json
```

If `PI_CODING_AGENT_DIR` is set, remove the same four files from `$PI_CODING_AGENT_DIR/themes` instead.

## Included themes

- `catppuccin-latte`
- `catppuccin-frappe`
- `catppuccin-macchiato`
- `catppuccin-mocha`

## Runtime note

This package keeps `omp.themes` metadata for forward compatibility, but current observed OMP runtime discovers selectable custom themes from the custom themes directory, so the Bun installer copies JSON files there. Do not rely on `omp plugin link`, `omp plugin install`, or `omp.themes` alone to make these themes appear in the current runtime.
