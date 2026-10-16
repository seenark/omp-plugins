# @codesook/omp-pstack

[pstack](https://github.com/cursor/plugins/tree/main/pstack) workflows for [oh-my-pi](https://github.com/can1357/oh-my-pi). pstack does nothing until you start it.

Tracks Upstream pstack 0.15.25, Pinned Revision `f713f14203cd6420cec13cd7c55c32d598dbab68`. Vendored Content and its file list are recorded in `THIRD-PARTY-NOTICES.txt`.

## Install

From this workspace, link the package so OMP discovers its skills and agents as well as its extension:

```sh
omp plugin link ./packages/pstack
```

As a published package: `omp plugin install @codesook/omp-pstack`. Requires OMP `>=18.11.1`.

This package is not a root `omp.features` entry. Features gate extensions only, and listing it there as well as installing it would load the extension twice.

## Layout

OMP discovers `skills/`, `agents/` and `rules/` from the package root through its `omp-plugins` provider, and only for roots whose `package.json` has an `omp` key. The package must not ship an Agent Plugins `plugin.json`: that would move its skills to another provider.

| Path | Content |
| --- | --- |
| `skills/<name>/SKILL.md` | Skills, called with `/skill:<name>` |
| `agents/<name>.md` | Task agents, dispatched by name. `pstack-*` files are generated from the role table; the rest are vendored |
| `rules/pstack-<name>.md` | Rules, prefixed because rule names have no namespace |
| `src/index.ts` | Extension (`/pstack`) |

## Commands

```text
/pstack          Report the run state
/pstack status   Same
```

pstack is currently always inactive: activation arrives with later work.

## Model roles

Every lane resolves its model through `pstack-*` model roles in your OMP config. The table lives in `src/roles.ts` and generates the `agents/pstack-*.md` files; run `bun run generate:agents` after editing it. `bun test` fails when the files drift from the table.

| Role | Fallback when unset | Agent |
| --- | --- | --- |
| `pstack-explore` | `@smol` | `pstack-explore` (read-only) |
| `pstack-build` | `@task` | `pstack-build` |
| `pstack-mechanical` | `@tiny` | `pstack-mechanical` |
| `pstack-design` | `@designer` | `pstack-design` (read-only) |
| `pstack-judge` | `@slow` | `pstack-judge` (read-only) |
| `pstack-security` | `@slow` | `pstack-security` (read-only) |
| `pstack-panel-a` … `pstack-panel-e` | none: an unset seat is absent | `pstack-panel-<x>-critic` (read-only, structured verdict), `pstack-panel-<x>-builder` (write-capable, dispatch with task isolation) |

Work-role agents list the pstack role, then the built-in role, so OMP skips an unset pstack role. OMP does not skip an unset single role: that child fails on its first prompt. pstack therefore blocks the spawn of an unset seat's agents with a reason telling the agent to skip that seat. A model fallback during a seat's run is stored as a `dev.codesook.pstack.dropout` session entry.

## Behavior Configuration

`behavior.pstack` in `~/.config/codesook-omp/config.json`, updated live on the `/omp-plugins` Apply event. Each field falls back to its default on its own when missing or invalid.

| Field | Default | Values |
| --- | --- | --- |
| `suspendCaveman` | `true` | boolean |
| `suspendPonytail` | `true` | boolean |
| `maxPanelSize` | `5` | integer 1 to 5 |
| `guardStrictness` | `block-and-warn` | `block-and-warn`, `warn-only`, `off` |

## Vendored Content

Currently the `bro` skill and the `comment-sicko` agent, copied by hand from Upstream.

## Adaptations

None yet.
