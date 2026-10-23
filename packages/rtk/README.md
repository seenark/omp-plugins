# @codesook/omp-rtk

Rewrites OMP `bash` commands through [rtk](https://github.com/rtk-ai/rtk) so shell output is filtered before it reaches the model, and shows **RTK Savings** as its own Shared Display segment. It replaces the third-party `pi-rtk-optimizer` plugin.

Requires `rtk` 0.51.0 or newer on `PATH`. This package never installs or upgrades it.

## Behavior

For every `bash` tool call the extension runs `rtk rewrite <command>` (2 s timeout). Exit codes 0 and 3 are accepted when the output is one non-empty line that differs from the input; any other result leaves the command unchanged.

These commands are never rewritten:

| Reason | Matches |
| --- | --- |
| already-rtk | command already runs `rtk` |
| rtk-disabled | starts with `RTK_DISABLED=1` |
| pipe / multiline / heredoc | contains `\|`, a newline, or `<<` |
| env-assignment | starts with `NAME=...` |
| read-like | `cat`, `head`, `tail`, `less`, `more`, `bat`, `nl`, `sed -n` |
| git-diff | `git diff`, `git show` |
| js-test-runner | `vitest`, `jest` |
| test-detail | test commands with `-v`, `--verbose`, `--list`, `-fuzz` |
| long-lived | `ssh`, `top`, `htop`, `vim`, `nvim`, `bun/npm/pnpm run dev`, `--watch` |

A leading `export OMP_PLUGINS_SESSION='…'; ` added by the `process-monitor` feature is ignored when these rules are checked, so the rules apply to the command behind it whichever extension runs first.

The model sees one system prompt line (only when RTK is enabled and present): prefix a command with `RTK_DISABLED=1` for raw output, or run `rtk recall <hash>` (`--list` shows entries) for the full output behind a recovery hint.

### Per-session storage

Each Agent Session gets `~/.local/share/codesook-omp/rtk/sessions/<sessionId>/` (mode 0700) holding `history.db` and `recall.db`. A rewritten command is prefixed with

```sh
export RTK_DB_PATH='…/history.db'; export RTK_RECALL_DB='…/recall.db'; rtk …
```

OMP's `bash` tool has no per-call environment, and in-process subagents share the extension process, so the extension never mutates `process.env`. OMP runs each Agent Session in its own persistent shell, so the exports stay inside that session. Commands that already run `rtk` (for example `rtk recall`) get the same prefix so they read the session databases.

On every session start, session directories whose mtime is older than `behavior.rtk.retentionDays` (default 7) are deleted. The current directory is never deleted and is touched on each start and rewrite.

### RTK Savings

After a rewritten command finishes, the extension reads `history.db` (query-only) and publishes `saved / input` tokens for the Agent Session to Shared Display as source `rtk`. It publishes 0% at session start and `null` on shutdown or when `display.rtk.visible` is false. States: active, `off` (behavior disabled), `missing` (no `rtk` binary or version below 0.51.0).

Headroom Savings stay separate; Headroom never compresses RTK-processed results.

## Commands

`/rtk` or `/rtk status` opens a read-only overlay: rtk version, session directory, RTK Savings, rewrite count, and guard skips by reason.

## Configuration

Edited through `/omp-plugins` (RTK section) in `~/.config/codesook-omp/config.json`. Changes apply live.

```json
{
  "behavior": { "rtk": { "enabled": true, "retentionDays": 7 } },
  "display": {
    "rtk": {
      "visible": true,
      "glyphDirectory": "~/.config/codesook-omp/rtk",
      "template": "{glyph} rtk {tokensSaved} saved · {commands} cmds"
    }
  }
}
```

Template placeholders: `{glyph}`, `{percent}`, `{tokensSaved}`, `{tokensInput}`, `{commands}`. Numbers use compact form (950, 1.2k, 3.4M). The `off` and `missing` states use fixed templates (`{glyph} rtk off`, `{glyph} rtk missing`). Glyph frames load from `<glyphDirectory>/<state>.txt` (`active`, `off`, `missing`) and fall back to built-in glyphs.

`{commands}` counts commands that went through rtk in this Agent Session, so `0 cmds` means nothing was rewritten yet. Most piped commands are skipped by design (ADR-0007). `{percent}` and `{tokensInput}` remain available for custom templates.

## Install

```sh
omp plugin install 'github:seenark/omp-plugins[rtk]'
```
