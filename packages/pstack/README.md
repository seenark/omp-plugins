# @codesook/omp-pstack

[pstack](https://github.com/cursor/plugins/tree/main/pstack) workflows for [oh-my-pi](https://github.com/can1357/oh-my-pi). pstack does nothing until you start it.

Tracks Upstream pstack 0.15.25, Pinned Revision `f713f14203cd6420cec13cd7c55c32d598dbab68`. Vendored Content and its file list are recorded in `THIRD-PARTY-NOTICES.txt`.

## Install

From the dist repository [`seenark/omp-pstack`](https://github.com/seenark/omp-pstack), which holds only built releases:

```sh
omp plugin install github:seenark/omp-pstack             # latest release
omp plugin install 'github:seenark/omp-pstack#v<version>' # pinned release
```

Requires OMP `>=18.11.1`. Shared Display, Caveman and Ponytail come from the root `omp-plugins` install (`github:seenark/omp-plugins`); pstack works without them, but then shows no Status Segment and cannot suspend the modes.

Do not install pstack from `github:seenark/omp-plugins#<ref>`. OMP keeps one plugin per git repository, so that install evicts the root `omp-plugins` plugin, and reinstalling the root evicts pstack.

To upgrade, run `omp plugin install github:seenark/omp-pstack` again.

From this workspace, link the package so OMP discovers its skills and agents as well as its extension:

```sh
omp plugin link ./packages/pstack
```

## Releasing

Releasing follows the version-bump rule: bump `version` in `packages/pstack/package.json` and merge to `main`. The Release workflow then builds the plugin tree, commits it to `seenark/omp-pstack` and tags it `v<version>`. A version already tagged does nothing, so re-running is safe. Never edit `seenark/omp-pstack` by hand; the next release replaces its whole tree.

```sh
bun run build:release -- --decide          # would this version release? prints release, version, reason
bun run build:release -- --out <dir>       # build the plugin tree into <dir>
```

The tree is deterministic: the same commit gives byte-identical output. It holds `skills/`, `agents/`, `README.md`, `THIRD-PARTY-NOTICES.txt`, a `package.json` with no `dependencies` (the `@oh-my-pi/*` packages are peers) and an `omp` key, and `src/` with two files: `index.js`, the extension bundled with every `@codesook/*` import inlined, and `verdict.ts`, the panel verdict helper that `panel-verdicts.md` imports from `<skill dir>/../../src/verdict.ts`. The sync engine, tests and dev tooling stay out. The release build is `src/release/build.ts`.

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
/pstack          Open a menu of the subcommands below (Status without a UI)
/pstack status   Show the Activation state
/pstack setup    Choose models for the pstack roles
/pstack preset <name>  Apply claude-only, claude-codex or lean without the menus
/pstack doctor   Check that pstack is healthy
```

pstack does nothing until you start it. `/skill:poteto-mode` has the same effect as `/poteto`: the extension detects it from the `input` event (interactive and RPC modes) and from the session's user-invoked `skill-prompt` message (every mode). Activation is idempotent. On activation the session receives a hidden note listing the configured panel seats (capped by `maxPanelSize`) with their models, and the absent ones.

## Activation state

The activation state is the contract that suspension, guards, warnings and doctor read. It lives in `src/activation-state.ts`.

```ts
interface ActivationState {
	active: boolean;
	task?: string;
	playbook?: string; // kebab-case title, e.g. "feature"
	progress?: { done: number; total: number; current?: string };
	seats: readonly PanelSeat[]; // seats that had a model at activation
	receipts: readonly PanelReceipt[]; // finished seat runs; only "completed" counts as attendance
	dropouts: readonly Dropout[]; // seat runs that fell back to another model
}
interface ActivationReader {
	state(): ActivationState;
	subscribe(listener: (state: ActivationState, change: "activated" | "restored" | "updated") => void): () => void;
}
```

Consumers take an `ActivationReader`. `panelAttendance(state)` gives attended seats out of configured seats. A listener sees `restored` after every rebuild (resume, `/new`, branch or tree navigation). Suspension does not act on `restored`: it acts on `activated`, and once at `session_start` when the restored state is active.

State is stored as custom session entries and rebuilt by folding the session branch (`rebuildActivationState`) on `session_start`, `session_switch`, `session_branch` and `session_tree`. Compaction keeps custom entries, so it does not touch the state. Live updates and the rebuild share one reducer, `applyEntry`, so they cannot drift. Entries before activation and malformed entries are ignored.

| Entry type | Data | Written when |
| --- | --- | --- |
| `dev.codesook.pstack.activation` | `{ kind: "activated", task?, seats }` | pstack starts |
| `dev.codesook.pstack.activation` | `{ kind: "playbook", playbook }` | the model reads `poteto-mode/playbooks/<title>.md` (`opening-a-pr`, which every playbook ends with, never replaces the playbook) |
| `dev.codesook.pstack.activation` | `{ kind: "progress", done, total, current? }` | a successful `todo` call; abandoned items count as done |
| `dev.codesook.pstack.receipt` | `{ seat, agent, id, status }` | a panel seat's run ends while pstack is active |
| `dev.codesook.pstack.dropout` | see Model roles | a seat's run falls back to another model, active or not |

After compaction the model gets a short hidden reminder of the playbook and step (`dev.codesook.pstack.reminder`) and the seat roster again, because a summary can drop the models each panel verdict must name. Both are delivered with the next turn.

## Status Segment

pstack is a Shared Display producer (source `pstack`, needs `@codesook/omp-shared-display` 1.3.0 or newer). While active it publishes one segment, for example `pstack · feature · 3/7 · panel 3/4`: playbook, todo progress, panel attendance once a seat has run, and a dropout count when a seat fell back. It publishes a tombstone when the session is not active, and nothing is shown in a session that never started pstack.

## Instruction Mode suspension

When pstack activates, and again when a session is resumed at startup with pstack active, it emits one suspension message on `codesook/instruction-mode-suspension/v1` (`{ protocol: 1, source: "pstack", modes: ["caveman", "ponytail"] }`, helpers in `@codesook/omp-shared-display/instruction-mode`). Caveman and Ponytail react by applying a Session Override at Mode Level `off` for that Agent Session. The Root Plugin Configuration is never written, a parallel session keeps its Mode Levels, and the user's own `/caveman` and `/ponytail` commands still switch a mode back on. Navigating within a session (`/tree`, branch) never suspends again, and a resume skips a mode the user switched back on after activation. `suspendCaveman` and `suspendPonytail` (below) drop a mode from the message; both default to on.

## Setup

`/pstack setup` is interactive. It lists only models your OMP registry serves, offers the presets `claude-only`, `claude-codex` and `lean` (a preset appears only when the registry has the models it needs), then shows one menu per role with what the role is, when pstack uses it and what kind of model suits it. Picking a model that lists thinking levels opens a second menu for the level, preselected from the thinking rules below. Edit the pstack roles by hand in your OMP config instead if you prefer: setup is a convenience.

On Save it:

- refuses two seats on the same model (the same model through another provider or thinking suffix counts as the same) and warns `diversity reduced: single vendor` when every seat shares a vendor;
- probes each selected model with one real turn, and writes nothing if any probe fails. When the roles already match what would be written there is nothing to verify, so it makes no model call;
- asks before enabling `task.isolation.enabled` when it is off, and leaves it unchanged unless you confirm;
- writes only `pstack-*` model roles, plus an empty fallback chain for every configured seat, through OMP's in-process settings API, so `default`, `commit`, `vision`, `tiny`, `advisor` and every other role stay as they are;
- reads the config back and restores the previous one when it differs from what was written.

### Thinking levels

Every role a preset or setup writes carries an explicit thinking suffix (`anthropic/claude-opus-5-5:high`), so no role runs at whatever OMP defaults to. The base level is `behavior.pstack.defaultThinking` (`low`, `medium`, `high` or `xhigh`; `medium` when unset). Levels are ordered `low` < `medium` < `high` < `xhigh` < `max`:

| Profile | Work roles | Panel seats | `pstack-judge` |
| --- | --- | --- | --- |
| `claude-only`, `claude-codex`, or a hand-picked model | default | default | one above the default |
| `lean` | default | one below the default | default |

One above or below steps along that order and stops at its ends, then clamps to the levels the OMP registry lists for the model: the nearest listed level, the lower one on a tie. A model that lists no levels (a non-reasoning model) is written without a suffix. `claude-codex` on roles you already have still touches only the new Codex seat and the judge, and writes both with a suffix.

Running it again with the same choices changes nothing. Presets pick tiers from model-id keywords (`opus`, `sonnet`, `haiku`, `mini`, ...), because OMP exposes no capability tier: adjust a role by hand when a vendor names its models differently.

## Presets and doctor

`/pstack preset <name>` applies a preset (`claude-only`, `claude-codex` or `lean`) and then saves it exactly as setup's Save does: seat and single-vendor rules, one probe turn per model (nothing is written when one fails), the isolation question, a write limited to `pstack-*` roles and, if you agree, `task.isolation.enabled`, readback and restore. The presets fill only the seats they need: `claude-only` fills the work roles and seats A to C with the top, mid and cheap Claude models, `lean` fills seats A and B, and unfilled seats stay unset. `claude-codex` is `claude-only` plus one Codex seat (seat D) with `pstack-judge` on Codex. Every role is written at the thinking level described under Setup. A preset whose roles already match your config makes no model call, so rerunning it costs nothing. When you already have `pstack-*` roles, `claude-codex` is a delta: it verifies Codex first, adds one Codex seat in your first free seat (none when a seat already runs Codex), moves `pstack-judge` to Codex and keeps every other role. `claude-only` and `lean` replace the `pstack-*` roles with their own set.

`/pstack doctor` is read-only and prints one line per finding at the worst severity found:

| Check | Flags |
| --- | --- |
| `roles` | a pstack role set to a model the registry does not serve; no panel seat with a model |
| `panel` | two seats on one model (error); a single-vendor panel (warning). It also lists every configured seat with its model and vendor |
| `skills` | a workflow-called skill (`poteto-mode` and every skill its playbooks and references name) that OMP does not list, or resolves to another source's copy. Native user and project skills, skillshare and `skills.customDirectories` outrank this package. Needs OMP's skill commands (`skills.enableSkillCommands`) to see the resolved owner |
| `instruction-modes` | whether Caveman and Ponytail are loaded and whether the suspend settings switch them off while pstack is active. It reads the loaded commands: the event bus does not list subscribers, so it cannot prove a plugin listens |
| `display-host` | no Display Host running, so the Status Segment is not shown |
| `task-isolation` | `task.isolation.enabled` is off; panel builders and arena or swarm writers need it |

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

What each role is, when pstack uses it and what kind of model suits it (the text `/pstack setup` shows):

| Role | What | When | Recommended |
| --- | --- | --- | --- |
| `pstack-explore` | Read-only scouting: finds files, symbols and call paths and reports what it saw. | Playbook steps that map unfamiliar code before design or edits. | A fast, cheap model with a large context window. |
| `pstack-build` | Implements a scoped change end to end: edits, runs, and fixes its own failures. | Feature, fix and refactor steps that write code. | A strong coding model with reliable tool use; a mid-tier model is usually enough. |
| `pstack-mechanical` | Applies fully specified mechanical edits: renames, codemods, formatting and bulk updates. | Steps where the change is already decided and only needs doing. | The cheapest model that follows instructions exactly. |
| `pstack-design` | Proposes and critiques design: architecture, module boundaries, types and interfaces. | Architect and design steps, before code is written. | A model with strong design and visual judgment. |
| `pstack-judge` | Merges the panel's verdicts into one decision and breaks ties. | The end of a panel review (interrogate, arena, swarm, architect) and final reviews. | Your strongest reasoning model. |
| `pstack-security` | Reviews a change for security flaws. | Review steps that touch authentication, input handling, secrets or dependencies. | A strong reasoning model; a different vendor from your judge adds coverage. |
| `pstack-panel-a` … `pstack-panel-e` | Panel seat A to E: an independent reviewer whose verdict is compared with the other seats. | Panel workflows (interrogate, arena, swarm, architect, how critics) dispatch every configured seat in parallel. | A distinct model per seat, ideally from different vendors. Leave a seat unset to drop it: an unset seat is skipped, not an error. |

Work-role agents list the pstack role, then the built-in role, so OMP skips an unset pstack role. OMP does not skip an unset single role: that child fails on its first prompt. pstack therefore blocks the spawn of an unset seat's agents with a reason telling the agent to skip that seat. A fallback to another model during a seat's run is stored as a `dev.codesook.pstack.dropout` session entry. A fallback that keeps the model (a thinking level, a provider route, the Fast tier) is not a dropout.

## Panel workflows

`interrogate`, `arena`, `swarm`, `architect` and the critique step of `how` run on the configured seats. The session learns its seats from a hidden roster note: on activation, and when one of these skills is started outside a run. The note lists each seat that has a model, in seat order and capped by `maxPanelSize`, with its model and vendor (the models API's family token), and says so when every seat is one vendor. A panel of two or more vendors carries no vendor note in the roster or the merged verdict, not even a negated one. Critics return the structured verdict; their findings are deduplicated with `judge_batch`, then `pstack-judge` synthesizes. The helpers for the mechanical part are in `src/verdict.ts` (`duplicateCandidates`, `mergeVerdicts`, `reviewerLines`); the skills import them from an `eval` cell, and `skills/poteto-mode/references/panel-verdicts.md` is the procedure. The merged verdict names each seat's model and carries `diversity reduced: single vendor` when the seats that answered are one vendor. Arena builders run as isolated tasks, and arena asks the user to turn `task.isolation.apply` off first, so each candidate stays a patch or task branch to graft from.

## Behavior Configuration

`behavior.pstack` in `~/.config/codesook-omp/config.json`. The `/omp-plugins` pstack page edits it (and points at `/pstack setup` for models); Apply updates running sessions live, and the page reads `not installed` while this package is missing. Each field falls back to its default on its own when missing or invalid.

| Field | Default | Values |
| --- | --- | --- |
| `suspendCaveman` | `true` | boolean |
| `suspendPonytail` | `true` | boolean |
| `maxPanelSize` | `5` | integer 1 to 5 |
| `guardStrictness` | `block-and-warn` | `block-and-warn`, `warn-only`, `off` |
| `defaultThinking` | `medium` | `low`, `medium`, `high`, `xhigh` |

## Guards

A `tool_call` guard stops a damaging action before it runs and returns a reason that names the right tool; the agent continues its turn. Guards live in `src/guards/` and apply while pstack is active and, always, to pstack lanes.

| Guard | Stops |
| --- | --- |
| In-place edit | `sed -i` and `perl -i` (any spelling, inside `&&` chains, `bash -c`, `xargs`, `find -exec`) on repository files. Reads, `sed -n` and files outside the repository pass. |
| Read-only lane | Every mutating tool call from a read-only lane; `write` only to `local://`. |
| Lane spawn | A lane starting subagents, through the `task` tool or `before_subagent_spawn`. |

`guardStrictness` sets the response: `block-and-warn` blocks, `warn-only` lets the call run with a warning, `off` disables the guards.

## Warnings

Style signals that never block. They speak only in an Agent Session where pstack is active, or from a pstack lane, and `guardStrictness: off` silences all of them. `warn-only` keeps them.

| Signal | Channel | Trips when |
| --- | --- | --- |
| Narrating comment | `tool_result` context | an `edit` or `write` adds a comment to a code file that opens with what the next line does (`// loop over the items`) |
| Todo skips playbook steps | `tool_result` context | a todo `init` copies too few of the active playbook's numbered steps; the warning names each missing step. Steps are read from the vendored playbook file |
| Missing throughput checkpoint | `session_stop` continuation | the active playbook asks for one and the assistant never wrote it, in prose or as todo items |
| Done without runtime proof | `session_stop` continuation | the final reply claims the work is done, yet `edit`, `write` or `ast_edit` ran after the last `bash`, `eval` or `browser` call |

A stop continuation fires once per stop: it never answers a `stop_hook_active` turn, so OMP's cap of 8 continuations is never approached, and the checkpoint warning is given once per session. pstack ships no OMP rules: a rule cannot see whether pstack is active or read the strictness setting. The todo guard replaces Upstream's `check-plan` script (`src/sync/rules/guards.ts`).

## Vendored Content

`skills/` and `agents/` are generated by `bun run sync` from Upstream at the Pinned Revision recorded in `upstream.json` and `THIRD-PARTY-NOTICES.txt`: every pstack skill except `make-bot-ui`, all playbooks and references, the `poteto-agent` and `comment-sicko` agents, and `deslop` from the cursor-team-kit component at the same pin. Do not edit these files by hand: sync overwrites them unless the path has a fork entry.

## Adaptations

Adaptations are code, in `src/sync/rules/`, one file per group:

| File | Owns |
| --- | --- |
| `collisions.ts` | Skill renames (`tdd` to `pstack-tdd`, `teach` to `pstack-teach`); the engine moves the skill and derives the rules that rewrite references to it |
| `core.ts` | Excluded parts (`make-bot-ui`; `automations` and `docs/guide` are never imported), the references they leave dangling, residual terms nobody owns |
| `panel.ts` | Forks for the multi-model skills (`interrogate`, `arena`, `swarm`, `architect`, `how`) and the `panel-verdicts.md` reference, all hand-edited; their reasons live in the file |
| `guards.ts` | Upstream's `check-plan` script (Excluded; the todo guard replaces it) and the playbook text that called it |
| `frontmatter.ts` | Skill frontmatter: principle skills get `hide: true`, Cursor's `icon` and `color` keys are stripped |
| `dispatch.ts`, `pr.ts`, `sessions.ts` | Cursor primitives replaced by OMP ones: lane dispatch, PR workflows, session paths, goal mode, drivers, and the `/skill:<name>` form of slash commands (the skill set is the one the current sync run produces, so a skill Upstream adds is rewritten in the same run) |

A group exports any of `rules`, `exclusions`, `forks`, `renames`, `moves`, `terms` and `allowances`. A move (`from`, `to`, `reason`) places a vendored file at another package-relative path before rules run, so rules and links use the new path; a move whose source is missing fails the sync. Removing or moving an entry makes the file an earlier sync wrote stale: `bun run sync` deletes it, `--check` fails naming it. Rules apply in table order (renames, then groups in `rules/index.ts` order) and each needs a `reason`. A rule that matches text only because it comes too late (shadowed by an earlier rule) fails the sync. A fork entry (`path`, `kind`, `reason`, `since`) keeps a path from being overwritten: `patched` forks 3-way merge Upstream changes into our edits and leave conflict markers, `rewritten` forks keep ours and report any Upstream change as a conflict.

The engine only sets every skill and agent `name` to its directory or file name. The other frontmatter Adaptations are rules in `rules/frontmatter.ts`: principle skills get `hide: true` (still loadable with `/skill:principle-...`), and the `icon` and `color` keys of Cursor's mode UI are stripped from skills.

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
- any Cursor-specific term in the shipped files. A group tolerates a known leftover with an `allowances` entry (`category`, `file`, `term`, exact `count`, `reason`). An allowance that no longer matches fails the gate, so deleting the term forces deleting the entry. Allowances are the exception: leave none when the ticket that owns the category is closed.

## License and attribution

MIT. The vendored skills and agents are Lauren Tan's pstack, and `deslop` comes from Cursor's cursor-team-kit; both licenses are reproduced in `THIRD-PARTY-NOTICES.txt`. The sync tooling, the panel rules and the must-trip fixture rule borrow ideas from [michael-denyer/pstack-claude](https://github.com/michael-denyer/pstack-claude), and the native package layout from [hieusats/omp-pstack](https://github.com/hieusats/omp-pstack). No files or code were copied from either; `THIRD-PARTY-NOTICES.txt` lists what each contributed.
