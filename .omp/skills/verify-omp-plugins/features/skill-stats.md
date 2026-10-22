# Skill stats

Skill stats records every Skill Use (typed by the user, read by the agent, or loaded in a subagent) and shows how often each skill was used. `/skill-stats` opens a scrollable read-only table of Global Skills with 7-day, 30-day and since-reset counts split by source, last-used dates, and a delete-candidates section with a ready-to-copy `npx skills remove` command. Nothing is ever deleted: reset only moves a Reset Point.

## Sub-features

- `skill-stats-record` appends a record per use to the Global store (`~/.local/share/codesook-omp/skill-stats/`) or, for a Project Skill, to `<project>/.omp/skill-stats/`.
- `skill-stats-global` opens the Global Skills dashboard, including skills with zero uses.
- `skill-stats-project` opens the same dashboard for the current project's Project Skills.
- `skill-stats-candidates` lists skills unused for 60 days and installed 60+ days ago, and offers `c` to copy the removal command.
- `skill-stats-reset` moves the Reset Point for all skills or one skill after a confirmation.
- `skill-stats-import` fills in usage from existing session history, once.
- `skill-stats-ponytail` records `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain` and `/ponytail-help` as user uses.

## How to get to it (user POV)

- Type `/skill-stats`, then Up/Down/PgUp/PgDn to scroll, `c` to copy the removal command, Enter or Esc to close.
- Type `/skill-stats project` for the current project's Project Skills.
- Type `/skill-stats reset [skill]` or `/skill-stats project reset [skill]` and answer the confirmation.
- Type `/skill-stats import` once to read `~/.omp/agent/sessions`.
- Use a skill (`/skill:<name>`, an agent read of `skill://<name>`, or a Ponytail helper command) and run `/skill-stats` again.

## Driving it with omp-pty

Preconditions:

- A fresh `verify-omp launch` with `doctor` all `ok`.
- `ls $SCRATCH_HOME/.local/share/codesook-omp/skill-stats` fails: nothing has been recorded yet.

- **Baseline.** Run `$OMP_PTY submit $PTY "/skill-stats"`, then `$OMP_PTY wait $PTY 'Skill stats: Global Skills'` and `$OMP_PTY wait $PTY 'Counts are total \(user/agent/subagent\)'`. Save `$EVID/skill-stats/01-baseline.txt` and close with `$OMP_PTY key $PTY esc`.
- **Record a user use without a model.** Run `$OMP_PTY submit $PTY "/ponytail-review"`, then wait for the editor to settle. Run `jq -s '[.[] | {name, source}]' $SCRATCH_HOME/.local/share/codesook-omp/skill-stats/uses.jsonl`. It prints one record, `{"name":"ponytail-review","source":"user"}`. Copy `meta.json` from the same directory to `$EVID/skill-stats/meta-first.json`.
- **See it.** Run `$OMP_PTY submit $PTY "/skill-stats"`, then `$OMP_PTY wait $PTY 'ponytail-review +plugin +1 \(1/0/0\) +1 \(1/0/0\) +1 \(1/0/0\) +u:\d{4}-\d{2}-\d{2} a:- s:-'`. Save `02-recorded.txt` and close with `esc`.
- **Reset.** Run `$OMP_PTY submit $PTY "/skill-stats reset ponytail-review"`, confirm with `$OMP_PTY key $PTY enter`, then `$OMP_PTY wait $PTY 'Reset point set for ponytail-review\. No records were deleted\.'`. `jq .resetBySkill $SCRATCH_HOME/.local/share/codesook-omp/skill-stats/meta.json` shows one entry, and `uses.jsonl` still has one line.
- **Since-reset count drops.** Run `$OMP_PTY submit $PTY "/skill-stats"`. The `ponytail-review` row now reads `1 (1/0/0)` for 7d and 30d and `0 (0/0/0)` since reset. Save `03-reset.txt` and close with `esc`.
- **Project store is Git-ignored.** Create a Project Skill, `mkdir -p $PROJECT/.agents/skills/proj-skill && printf -- '---\nname: proj-skill\ndescription: verify\n---\n' > $PROJECT/.agents/skills/proj-skill/SKILL.md`, restart with `verify-omp restart $RUN_ID`, run `$OMP_PTY submit $PTY "/skill:proj-skill"`, then `cat $PROJECT/.omp/skill-stats/.gitignore` prints `*`. `$OMP_PTY submit $PTY "/skill-stats project"` lists `proj-skill`. `git -C $PROJECT status --short` does not mention `.omp/skill-stats`.
- **Import refuses a second run.** Run `$OMP_PTY submit $PTY "/skill-stats import"`, then `$OMP_PTY wait $PTY 'Imported \d+ Skill Uses from \d+ session files'`. The line after it starts with `Skipped:` and lists each non-zero skip reason with its count, or `none`. Run it again and wait for `already imported on`.

## Gotchas

- The scratch omp has no model, so `/skill:<name>` may be rejected before the skill message exists. A Ponytail helper command is the deterministic user path, because it records its use before it tries to send. If `/skill:proj-skill` records nothing, report the project-store step as unverified for this entry point rather than substituting another.
- `/skill-stats` lists installed skills from omp's skill commands. If `skills.enableSkillCommands` is turned off in omp settings (it is on by default), agent reads of `skill://<name>` cannot be matched to a file and are not recorded.
- Import reads `$SCRATCH_HOME/.omp/agent/sessions`, which is empty on a fresh launch. Expect `Imported 0 Skill Uses from 0 session files`.
- `c` writes OSC 52 to the terminal and runs `pbcopy`. Under `omp-pty` the status line reads `Copied with pbcopy.` on macOS. The PTY cannot prove the clipboard content, so check `pbpaste` only on a machine where the verifier owns the clipboard.
- A delete-candidates section needs a skill installed 60+ days ago. A fresh scratch HOME has none, so the section reads `Delete candidates: none`. Prove the rule with the unit tests, not the PTY.
