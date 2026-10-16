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
/poteto <task>   Start poteto-mode on the task and mark pstack active for this Agent Session
/pstack          Show the run state
/pstack status   Same
/pstack setup    Choose models for the pstack roles
```

pstack does nothing until you start it. `/skill:poteto-mode` has the same effect as `/poteto`: the extension detects it from the `input` event (interactive and RPC modes) and from the session's user-invoked `skill-prompt` message (every mode). Activation is idempotent. On activation the session receives a hidden note listing the configured panel seats (capped by `maxPanelSize`) and the absent ones.

## Run state

The run state is the contract that suspension, guards, warnings and doctor read. It lives in `src/run-state.ts`.

```ts
interface RunState {
	active: boolean;
	task?: string;
	playbook?: string; // kebab-case title, e.g. "feature"
	progress?: { done: number; total: number; current?: string };
	seats: readonly PanelSeat[]; // seats that had a model at activation
	receipts: readonly PanelReceipt[]; // finished seat runs; only "completed" counts as attendance
	dropouts: readonly Dropout[]; // seat runs that fell back to another model
}
interface RunReader {
	state(): RunState;
	subscribe(listener: (state: RunState, change: "activated" | "restored" | "updated") => void): () => void;
}
```

Consumers take a `RunReader`. `panelAttendance(state)` gives attended seats out of configured seats. A listener sees `restored` after every rebuild, so a consumer that must act on an active session at resume (re-emitting the Instruction Mode suspension) reacts to `restored` as well as `activated`.

State is stored as custom session entries and rebuilt by folding the session branch (`rebuildRunState`) on `session_start`, `session_switch`, `session_branch` and `session_tree`. Compaction keeps custom entries, so it does not touch the state. Live updates and the rebuild share one reducer, `applyEntry`, so they cannot drift. Entries before activation and malformed entries are ignored.

| Entry type | Data | Written when |
| --- | --- | --- |
| `dev.codesook.pstack.run` | `{ kind: "activated", task?, seats }` | pstack starts |
| `dev.codesook.pstack.run` | `{ kind: "playbook", playbook }` | the model reads `poteto-mode/playbooks/<title>.md` (`opening-a-pr`, which every playbook ends with, never replaces the playbook) |
| `dev.codesook.pstack.run` | `{ kind: "progress", done, total, current? }` | a successful `todo` call; abandoned items count as done |
| `dev.codesook.pstack.receipt` | `{ seat, agent, id, status }` | a panel seat's run ends while pstack is active |
| `dev.codesook.pstack.dropout` | see Model roles | a seat's run falls back to another model, active or not |

After compaction the model gets a short hidden reminder of the playbook and step (`dev.codesook.pstack.reminder`, delivered with the next turn).

## Status Segment

pstack is a Shared Display producer (source `pstack`, needs `@codesook/omp-shared-display` 1.3.0 or newer). While active it publishes one segment, for example `pstack · feature · 3/7 · panel 3/4`: playbook, todo progress, panel attendance once a seat has run, and a dropout count when a seat fell back. It publishes a tombstone when the session is not active, and nothing is shown in a session that never started pstack.

## Setup

`/pstack setup` is interactive. It lists only models your OMP registry serves, offers the presets `claude-only`, `claude-codex` and `lean` (a preset appears only when the registry has the models it needs), then shows one menu per role with what the role is, when pstack uses it and what kind of model suits it. Edit the pstack roles by hand in your OMP config instead if you prefer: setup is a convenience.

On Save it:

- refuses two seats on the same model (the same model through another provider or thinking suffix counts as the same) and warns `diversity reduced: single vendor` when every seat shares a vendor;
- probes each selected model with one real turn, and writes nothing if any probe fails;
- asks before enabling `task.isolation.enabled` when it is off, and leaves it unchanged unless you confirm;
- writes only `pstack-*` model roles, plus an empty fallback chain for every configured seat, through OMP's in-process settings API, so `default`, `commit`, `vision`, `tiny`, `advisor` and every other role stay as they are;
- reads the config back and restores the previous one when it differs from what was written.

Running it again with the same choices changes nothing. Presets pick tiers from model-id keywords (`opus`, `sonnet`, `haiku`, `mini`, ...), because OMP exposes no capability tier: adjust a role by hand when a vendor names its models differently.

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

`skills/` and `agents/` are generated by `bun run sync` from Upstream at the Pinned Revision recorded in `upstream.json` and `THIRD-PARTY-NOTICES.txt`: every pstack skill except `make-bot-ui`, all playbooks and references, the `poteto-agent` and `comment-sicko` agents, and `deslop` from the cursor-team-kit component at the same pin. Do not edit these files by hand: sync overwrites them unless the path has a fork entry.

## Adaptations

Adaptations are code, in `src/sync/rules/`, one file per group so tickets add rules without touching each other:

| File | Owns |
| --- | --- |
| `collisions.ts` | Skill renames (`tdd` to `pstack-tdd`, `teach` to `pstack-teach`); the engine moves the skill and derives the rules that rewrite references to it |
| `core.ts` | Excluded parts (`make-bot-ui`; `automations` and `docs/guide` are never imported), the references they leave dangling, residual terms nobody owns |
| `dispatch.ts`, `pr.ts`, `sessions.ts` | Cursor primitives replaced by later tickets: subagent dispatch, PR workflows, session paths, goal mode, drivers, and the `/skill:<name>` form of slash commands (the skill list lives in `sessions.ts`; a test fails when `skills/` outgrows it) |

A group exports any of `rules`, `exclusions`, `forks`, `renames`, `moves`, `terms` and `allowances`. A move (`from`, `to`, `reason`) places a vendored file at another package-relative path before rules run, so rules and links use the new path; a move whose source is missing fails the sync. Removing or moving an entry makes the file an earlier sync wrote stale: `bun run sync` deletes it, `--check` fails naming it. Rules apply in table order (renames, then groups in `rules/index.ts` order) and each needs a `rationale`. A rule that matches text only because it comes too late (shadowed by an earlier rule) fails the sync. A fork entry (`path`, `kind`, `reason`, `since`) keeps a path from being overwritten: `patched` forks 3-way merge Upstream changes into our edits and leave conflict markers, `rewritten` forks keep ours and report any Upstream change as a conflict.

Fixed by the engine rather than by rules: principle skills get `hide: true` (still loadable with `/skill:principle-...`); the `icon` and `color` frontmatter of Cursor's mode UI is stripped; every skill and agent `name` is set to its directory or file name.

The dispatch group records three forks, each with its reason in `rules/dispatch.ts`. `skills/poteto-mode/references/provider-dispatch.md` is rewritten: Upstream's provider runner (other vendors' CLIs) is Excluded, Upstream at this pin has no such file, and every workflow skill points at this one for the real model roles, panel seats, dropout policy and isolation. `agents/poteto-agent.md` is patched to run on `pstack-build` with `@task` as fallback and to autoload the poteto-mode skill. `skills/setup-pstack/SKILL.md` is rewritten to point at the `/pstack setup` command. A rewritten fork that Upstream never had is not a conflict; one Upstream removed still is.

## Syncing

```sh
bun run sync                              # re-sync at the Pinned Revision (fetches it)
bun run sync --upstream /path/to/plugins  # take it from a local cursor/plugins checkout
bun run sync --rev <sha>                  # move the pin; forks are merged against the old pin
bun run sync --check                      # write nothing; exit 1 on drift or conflicts
bun run sync --skill-dir ~/.agents/skills # report vendored names another skill directory already owns
```

The report lists the Cursor-specific terms that remain, by category and file, the skills Upstream added (classify each) and the skills the sync removes.

`bun run verify` runs `bun run check:sync` (`sync --check` at the Pinned Revision, fetched from Upstream; set `PSTACK_UPSTREAM` to a local `cursor/plugins` checkout to run offline). It fails, naming each path or term, on:

- a vendored file that differs from the sync output and has no fork entry;
- a file under `skills/` or `agents/` that the sync does not produce and no fork entry covers (the generated `pstack-*` agents belong to `generate:agents` and are exempt);
- a conflict, or conflict markers left in a fork;
- any Cursor-specific term in the shipped files. A group tolerates a known leftover with an `allowances` entry (`category`, `file`, `term`, exact `count`, `ticket`, `reason`). An allowance that no longer matches fails the gate, so deleting the term forces deleting the entry. Allowances are the exception: leave none when the ticket that owns the category is closed.
