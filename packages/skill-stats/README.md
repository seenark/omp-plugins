# @codesook/omp-skill-stats

Records every **Skill Use** and shows `/skill-stats` dashboards, so you can delete skills you do not use with real data instead of a guess. It never deletes a skill or a record, and it makes no model calls.

## What counts as a use

| Source | Counted when |
| --- | --- |
| `user` | A `skill-prompt` message with user attribution (`/skill:name`), or a Ponytail helper command (`/ponytail-review`, `-audit`, `-debt`, `-gain`, `-help`) |
| `agent` | In the main agent, a `read` of `skill://<name>[/file]` (every listed path counts), a `bash` command containing `skill://<name>`, or a non-user `skill-prompt` message |
| `subagent` | The same reads, or an autoloaded `skill-prompt` message, inside a subagent session |

Every occurrence counts, including sub-file reads and uses on branches you later abandon. A `skill://` read is matched to a file through OMP's skill command list, so it needs `skills.enableSkillCommands` (on by default). The use is recorded against the `SKILL.md` that was actually loaded, so a Project Skill overriding a Global Skill of the same name counts where it came from.

## Project versus Global

A skill is a **Project Skill** when its file sits under `<root>/.omp/skills/`, `<root>/.agents/skills/` or `<root>/.claude/skills/` and `<root>` is not your home directory. `<root>` is its project. Everything else, including `~/.agents/skills`, managed skills and plugin skills, is a **Global Skill**.

| Store | Location |
| --- | --- |
| Global | `~/.local/share/codesook-omp/skill-stats/` |
| Project | `<project>/.omp/skill-stats/`, with its own `.gitignore` containing `*` |

Each store holds `uses.jsonl` (append-only, one record per use), `imported.jsonl` (written once by import) and `meta.json` (recording start, import time, Reset Points). A record is `{ at, name, path, source, session }`. Records are never deleted.

## Commands

| Command | Does |
| --- | --- |
| `/skill-stats` | Global dashboard: every installed Global Skill, zero uses included |
| `/skill-stats project` | The same for the current project's Project Skills |
| `/skill-stats reset [skill]` | After a confirmation, start counting again for all Global Skills, or for one skill in its own scope |
| `/skill-stats project reset [skill]` | The same in the current project's store |
| `/skill-stats import` | Read existing session history once |

Without a UI every subcommand prints the same text through a notification.

### Dashboard

Columns are `7d`, `30d` and `since reset`, each `total (user/agent/subagent)`, then the last use per source (`u`, `a`, `s`, UTC dates). Windows include their boundary: a use exactly 7 days ago is in the 7-day count. `since reset` counts uses after the later of the global Reset Point and the skill's own. Rows sort by `since reset` ascending, then oldest last use. A recorded skill whose `SKILL.md` is gone is hidden; one that still exists but is not discovered from the current project stays.

Origin is `npx-skills` (name in `~/.agents/.skill-lock.json`, or, for a Project Skill, under `<project>/.agents/skills/`), `managed` (`~/.omp/agent/managed-skills`), `plugin` (outside your home directory, or under a `plugins` or `node_modules` directory), `home`, or `project` (a Project Skill not in `.agents/skills`).

**Delete candidates** have no use in 60 days (reset points do not hide older uses) and were installed at least 60 days ago (lock file `installedAt`, else the `SKILL.md` modification time). The global dashboard prints one `npx skills remove -g <names>`, the project dashboard `npx skills remove <names>`. The command never includes `-y`, so `npx skills` still asks. Candidates that `npx skills` did not install are listed with their path instead. Press `c` in the overlay to copy the command: it sends OSC 52 to the terminal and also runs `pbcopy`, then reports which one worked.

### Import

Streams `~/.omp/agent/sessions/**/*.jsonl`, subagent transcripts included, one line at a time. It reads `skill-prompt` entries and `tool_execution_start` entries for `read` and `bash`, only for entries older than the store's `recordingStartedAt`, and deduplicates entries that a forked session copied. A `skill://` read is resolved to a file from a `skill-prompt` path in the same session, else from the session's working directory upward, else from the installed list; reads that resolve nowhere are counted and reported. Project Skill uses go to the project's store when the project folder still exists, and the store (with its `*` `.gitignore`) is created if the project never recorded live. Import is all-or-nothing and runs once: a second run reports when the first happened. The summary lists what it skipped, for example `2 skipped (project folder missing)`, `skipped (already imported)`, `skipped (after recording started)` and `unresolved`, so an import of 0 explains itself.

## Other features

`ponytail` publishes its helper commands on the `codesook/skill-use/v1` EventBus channel (`SKILL_USE_EVENT` from `@codesook/omp-shared-display/skill-use`). Without `skill-stats` loaded nothing listens and nothing is recorded.
