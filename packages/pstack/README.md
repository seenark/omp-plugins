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
| `agents/<name>.md` | Task agents, dispatched by name |
| `rules/pstack-<name>.md` | Rules, prefixed because rule names have no namespace |
| `src/index.ts` | Extension (`/pstack`) |

## Commands

```text
/pstack          Report the run state
/pstack status   Same
```

pstack is currently always inactive: activation arrives with later work.

## Vendored Content

Currently the `bro` skill and the `comment-sicko` agent, copied by hand from Upstream.

## Adaptations

None yet.
