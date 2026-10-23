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
- `ls $SCRATCH_HOME/.local/share/codesook-omp/skill-stats` fails: nothing has been recorded yet. Do not run `/skill-stats import` before the fixture below exists, because import runs once.

- **One command.** `.omp/skills/verify-omp-plugins/features/skill-stats.sh <run-id>` runs every step below against a launched run. It saves screens to `$EVID/skill-stats/NN-step.txt`, prints `PASS <step>` lines, and exits non-zero at the first failure.
- **Baseline.** Run `$OMP_PTY submit $PTY "/skill-stats"`, then `$OMP_PTY wait $PTY 'Skill stats: Global Skills'` and `$OMP_PTY wait $PTY 'Counts are total \(user/agent/subagent\)'`. Save `$EVID/skill-stats/01-baseline.txt` and close with `$OMP_PTY key $PTY esc`.
- **Record a user use without a model.** Run `$OMP_PTY submit $PTY "/ponytail-review"`. `jq -sc '[.[] | {name, source}]' $SCRATCH_HOME/.local/share/codesook-omp/skill-stats/uses.jsonl` prints `[{"name":"ponytail-review","source":"user"}]`. Poll for the file: it appears a moment after the command.
- **See it.** The dashboard is sorted least-used first, so a used row sits below the fold. Run `$OMP_PTY submit $PTY "/skill-stats"`, then `$OMP_PTY scroll-until $PTY '^ponytail-review .*1 \(1/0/0\)' --max 60`. Anchor on the line start: the header line `Reset points: <name> …` also contains the skill name. Save the screen and close with `esc`.
- **Reset.** Run `$OMP_PTY submit $PTY "/skill-stats reset ponytail-review"`, wait for `Reset skill stats\?`, confirm with `$OMP_PTY key $PTY enter`, then `$OMP_PTY wait $PTY 'Reset point set for ponytail-review\. No records were deleted\.'`. `jq '.resetBySkill | length' $SCRATCH_HOME/.local/share/codesook-omp/skill-stats/meta.json` prints `1`, and `uses.jsonl` still has one line.
- **Since-reset count drops.** Reopen `/skill-stats` and `$OMP_PTY scroll-until $PTY '^ponytail-review .*0 \(0/0/0\)' --max 60`. Save the screen and close with `esc`.
- **Reset all, cancel, and errors.** Not part of the journey; run them after it on the same launch. `$OMP_PTY submit $PTY "/skill-stats foo"` answers `Usage: /skill-stats [project] | [project] reset [skill] | import`. `/skill-stats reset nope` answers `No Global Skill named "nope" is installed or recorded`. Copy `meta.json`, run `/skill-stats reset`, wait for `Start counting all Global Skills again from now`, press `esc`, and wait for `Reset cancelled\.`; `cmp` shows `meta.json` unchanged. Run `/skill-stats reset` again and confirm with `enter`: `Reset point set for all Global Skills\. No records were deleted\.`, `jq -r '.resetAll | type'` prints `string`, and the dashboard header reads `Reset points: all <YYYY-MM-DD>, …`.
- **Project store via import.** `/skill:<name>` records nothing without a model, because omp rejects it before the skill message exists, so prove the project store through import of a fixture session:
  1. Create the Project Skill: `mkdir -p $PROJECT/.agents/skills/proj-skill && printf -- '---\nname: proj-skill\ndescription: verify\n---\n' > $PROJECT/.agents/skills/proj-skill/SKILL.md`.
  2. Write `$SCRATCH_HOME/.omp/agent/sessions/--tmp-omp-verify-$RUN_ID-project--/<date>T10-00-00-000Z_fixture-sess.jsonl` with four lines: `{"type":"title"}`; `{"type":"session","version":3,"id":"fixture-sess","timestamp":"<date>T10:00:00.000Z","cwd":"$PROJECT"}`; a `custom_message` with `customType:"skill-prompt"`, `attribution:"user"`, `timestamp` 10:01, `id:"e1"` and `details:{name:"proj-skill",path:"$PROJECT/.agents/skills/proj-skill/SKILL.md",lineCount:4}`; and a `custom` entry with `customType:"tool_execution_start"`, `timestamp` 10:02, `id:"e2"` and `data:{toolCallId:"t1",toolName:"read",startedAt:<timestamp>,args:{path:"skill://proj-skill"}}`. Pick `<date>` inside the 30 day window and before the global store started recording; the script uses 10 days ago.
  3. `verify-omp restart $RUN_ID`, so omp discovers the new skill.
  4. `$OMP_PTY submit $PTY "/skill-stats import"`, then wait for `Imported 2 Skill Uses from 1 session files \(0 global, 2 project\)\.` and `Skipped: none\.`.
  5. `$OMP_PTY submit $PTY "/skill-stats project"` and `$OMP_PTY scroll-until $PTY '^proj-skill .*2 \(1/1/0\)' --max 60`. The 30 day column shows one user and one agent use.
  6. `cat $PROJECT/.omp/skill-stats/.gitignore` prints `*`, and `git -C $PROJECT status --short` does not mention `.omp/skill-stats`.
- **Import refuses a second run.** `$OMP_PTY submit $PTY "/skill-stats import"` again, then `$OMP_PTY wait $PTY 'already imported on'`.

## Gotchas

- The scratch omp has no model, so `/skill:<name>` records nothing: omp rejects it first. A Ponytail helper command is the deterministic user path, because the plugin records its use before it tries to send. Use `/ponytail-review` for the live user path, and report `/skill:<name>` as unverified.
- Scroll until the row's own line: `^<name> `. The dashboard is sorted least-used first, and the header line `Reset points: <name> …` also contains the name, so a bare name regex matches before the row is on screen.
- The dashboard title shows the canonical project path. On macOS that is `/private/tmp/...` even though `$PROJECT` is under `/tmp/...`.
- `/skill-stats` lists installed skills from omp's skill commands. If `skills.enableSkillCommands` is turned off in omp settings (it is on by default), agent reads of `skill://<name>` cannot be matched to a file and are not recorded.
- Import reads `$SCRATCH_HOME/.omp/agent/sessions`, which is empty on a fresh launch. An import with no session files prints `Imported 0 Skill Uses from 0 session files` and still spends the one allowed import, so write the fixture first.
- Import skips uses newer than the store's recording start (`skipped (after recording started)`). Fixture timestamps must be in the past.
- `c` writes OSC 52 to the terminal and runs `pbcopy`. Under `omp-pty` the status line reads `Copied with pbcopy.` on macOS. The PTY cannot prove the clipboard content, so check `pbpaste` only on a machine where the verifier owns the clipboard. The journey does not press `c`.
- A delete-candidates section needs a skill installed 60+ days ago. A fresh scratch HOME has none, so the section reads `Delete candidates: none`. Prove the rule with the unit tests, not the PTY.
