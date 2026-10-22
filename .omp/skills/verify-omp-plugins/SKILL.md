---
name: verify-omp-plugins
description: Drive the real omp TUI with this checkout's plugins (caveman, ponytail, headroom, pstack, /omp-plugins settings, status-line segments) in an isolated scratch HOME and capture rendered-screen evidence. Use to prove a plugin change works the way a user sees it, after unit tests pass and before claiming done.
---

# Verify omp-plugins in the real TUI

The product is a set of oh-my-pi extensions. Users touch them inside the `omp` terminal UI: slash commands (`/caveman`, `/ponytail`, `/headroom`, `/pstack`, `/omp-plugins`, …), dialogs, notifications above the editor, and segments in the status line under the editor. This skill launches a real `omp` in a background PTY, with plugins linked from this checkout and a throwaway `HOME`. You then type commands into it and read the rendered screen.

Other surfaces are not covered here. The `packages/theme-catppuccin` installer CLI is one. LLM turns are another, because the scratch profile has no credentials (see Gotchas).

Scripts (run from the repo root):

- `.omp/skills/verify-omp-plugins/scripts/verify-omp`: lifecycle (`launch`, `restart`, `doctor`, `env`, `cleanup`).
- `.omp/skills/verify-omp-plugins/scripts/omp-pty`: PTY driver (`submit`, `send`, `key`, `wait`, `scroll-until`, `screen`, `status`, `stop`). It runs through `uv run --with pyte==0.8.2`, and the first call downloads pyte into the uv cache.
- `.omp/skills/verify-omp-plugins/features/<feature>.sh`: one-command journeys for `process-monitor`, `skill-stats` and `beads` (see Journeys).

Requirements on `PATH`: `omp` (proved on 18.12.6), `uv`, `git`, `bash`. macOS `/bin/ps` is used to check the child's environment.

## Launch

```sh
.omp/skills/verify-omp-plugins/scripts/verify-omp launch r1      # r1 = any [A-Za-z0-9_-]+ run id
eval "$(.omp/skills/verify-omp-plugins/scripts/verify-omp env r1)" # exports RUN_ID PTY SCRATCH_HOME PROJECT EVID OMP_PTY
```

What `launch` does, from an empty directory, in about 7 s:

1. Creates `/tmp/omp-verify/r1/{home,project}` and writes `home/.omp/agent/config.yml` with `setupVersion: 2`. Without that line, omp opens its first-run onboarding wizard instead of the editor.
2. Runs `git init` in `project/`, which is the cwd omp starts in.
3. With `HOME=/tmp/omp-verify/r1/home`, runs the documented developer install (`docs/agents/setup.md` Phase 6):
   - `omp plugin link <repo>`
   - `omp plugin features omp-plugins --enable=headroom,prompt-border-style,shared-display,ponytail,caveman,codegraph,beads,rtk`
   - `omp plugin link <repo>/packages/pstack`
4. Starts `omp --no-session` in a 120x50 PTY. The child env drops `PI_CODING_AGENT_DIR`, `PI_SESSION_*`, `OMP_PROFILE` and `XDG_*`.
5. Ready in two steps. First the status line must show `ponytail: … caveman … Headroom … rtk`. Then `/ponytail status` is submitted and must answer `Ponytail: current <mode> • default <mode>`, which proves extension commands round-trip.
6. Writes `$EVID/run.txt` with the run id, checkout path, git rev, omp version and launch time. The rev gets `+dirty` when tracked files differ from HEAD. Untracked files do not count.

Plugins load from the checkout at omp start. After editing plugin source, or to check that persisted settings apply to a new session, run `verify-omp restart r1`. It stops omp and starts a new session on the same scratch HOME. Readiness is the editor plus a `/ponytail status` round-trip, because persisted modes can hide status-line segments. A running instance never picks up edits.

Isolation: each run id has its own HOME, PTY and project, and no ports are opened. Several runs can work side by side. Your real `~/.omp` and `~/.config/codesook-omp` are never read or written. `launch` refuses a run id whose PTY socket already exists. Never drive an instance you did not launch.

## Doctor

Run it first whenever anything looks off. It is read-only.

```sh
.omp/skills/verify-omp-plugins/scripts/verify-omp doctor r1
```

Every line must be `ok`, and the exit code must be 0. It checks:

- the scratch dir and PTY socket exist;
- the PTY server pid and omp child pid are alive;
- the child's environment has `HOME=$SCRATCH_HOME` and no `PI_SESSION_FILE`/`PI_SESSION_ID`;
- `omp-plugins` and `@codesook/omp-pstack` in the scratch HOME are symlinks to this checkout;
- all 8 features are enabled;
- the screen is past onboarding and shows the editor (`π >`).

It ends with an `info` line giving the omp version and the checkout rev. A dead or foreign run prints `FAIL` lines and exits 1.

## Drive

All driving goes through `$OMP_PTY` with `$PTY` from `verify-omp env`:

| Action | Command |
| --- | --- |
| Run a slash command like a user | `$OMP_PTY submit $PTY "/caveman status"` |
| Type without submitting | `$OMP_PTY send $PTY "/cav"` |
| Press keys (each is a separate write, 0.3 s apart) | `$OMP_PTY key $PTY down enter` (also `esc tab bspace up left right ctrl-c ctrl-d ctrl-u`, and `char:<c>` for one printable character, e.g. `key $PTY char:k`) |
| Wait for rendered text (regex, multiline) | `$OMP_PTY wait $PTY 'Caveman off\.' --timeout 10` |
| Wait for text to disappear | `$OMP_PTY wait $PTY '⠄⠠ caveman' --absent` |
| Scroll a dialog until a row shows | `$OMP_PTY scroll-until $PTY '^proj-skill ' [--key down\|up] [--max 40] [--timeout 60]` |
| Read or save the rendered screen | `$OMP_PTY screen $PTY [--out $EVID/<feature>/<step>.txt]` |

`submit` does this in order:

1. Presses Esc, which closes any open dialog.
2. Presses `ctrl-u`, which clears the editor.
3. Types the text and waits until it appears inside the editor box (`║`).
4. Presses Esc again, which dismisses the autocomplete popup.
5. Presses Enter.

A failed `wait` prints the full screen and exits 1. Treat that as a failed step. Do not retry with a looser regex.

Stable handles on screen:

- **Editor box:** `╔══ π > ⬢ no-model > 🗑 omp-verify/<run>/project > ⑂ main …`, then `║` rows, then `╚═…`.
- **Status line:** the row under `╚`. Segments show with the default config: `🐴 ponytail: ⚡ FULL`, a caveman spinner plus mode name (`caveman`, `ultracave` or `megacave`; gone when off), `⏹ Headroom not running` or `⦸ Headroom off`, and `✂ rtk 0% (0 saved)`.
- **Notifications:** single lines above the editor, for example `Caveman ultracave.`, `Ponytail mode set to ultra.` or `Error: Unknown Caveman command: …`.
- **Dialogs:** a title line plus `Enter/Esc close` (status views), or a `╭─ Title ─╮` select box with `❯` on the highlighted row and `↑/↓ navigate  ⏎ select  ⎋ cancel`.

Feature recipes live in [`features/README.md`](features/README.md). Read the index, then the matching feature file.

`scroll-until` presses the key once per write, 0.3 s apart, and checks the screen before every press. It exits 0 the moment the regex matches, even with no press. It exits 1 and prints the screen after `--max` presses or `--timeout` seconds. Use it for long dashboards and lists, where the row you need starts below the fold. Anchor the regex to the row (`^name `), because headers often repeat the name.

## Journeys

A feature file ends in a scripted journey when its flow is long enough to be worth replaying. Each one drives an already-launched run:

```sh
.omp/skills/verify-omp-plugins/scripts/verify-omp launch r1
.omp/skills/verify-omp-plugins/features/process-monitor.sh r1   # also skill-stats.sh, beads.sh
.omp/skills/verify-omp-plugins/scripts/verify-omp cleanup r1
```

Each script saves every screen to `$EVID/<feature>/NN-step.txt`, prints `PASS <step>` per step, and stops with a non-zero exit at the first failed step, printing `FAIL <step> (line N)` to stderr. The journeys write into one scratch HOME, so launch a fresh run per journey. `process-monitor.sh` starts stand-in processes and kills only those, by recorded PID, after checking with `/bin/ps -wwE` that each still carries the environment marker it was started with. `process-monitor.sh` and `skill-stats.sh` restart omp once each on the same scratch HOME. `beads.sh` needs `bd` on `PATH`.

## Evidence

Evidence goes in `/tmp/omp-verify-evidence/<run-id>/`, which is `$EVID`. `cleanup` never deletes it. Lay it out like this:

- `run.txt` (written by launch): checkout, rev, omp version.
- `<feature>/<NN>-<step>.txt`: `$OMP_PTY screen $PTY --out …` after each action. Capture the state before the action and after it, not only the final screen.
- `<feature>/<name>.json` or another copied file: side effects. Plugin config lives in `$SCRATCH_HOME/.config/codesook-omp/config.json`, glyph assets in `$SCRATCH_HOME/.config/codesook-omp/<plugin>/`, and RTK session data in `$SCRATCH_HOME/.local/share/codesook-omp/rtk/`.
- `transcript.raw`: every byte omp wrote to the PTY, copied in by `cleanup`.

Proof standards:

- Drive the real user path: a slash command typed into the editor, or a menu choice. Do not import a plugin module and call its handler. Unit tests in `packages/*/src/*.test.ts` already do that with a mocked `pi`.
- Prove a mutation twice. Check the visible result (notification or status-line segment), then check a second view: a `status` command and the file it persisted to.
- Prove session-only changes by their absence on disk. Examples: `/caveman <mode>`, `/ponytail <mode>`, `/headroom on|off`. Show that `config.json` did not change.
- Record what was not exercised and why, for example "needs an LLM turn" or "needs a Headroom proxy". Never report a skipped entry point as verified through a different one.
- Mocks are acceptable only at a boundary that already isolates the external system. The Headroom proxy is one: with none running, the plugin reports `not running`, and that is a real, assertable state.

## Cleanup

```sh
.omp/skills/verify-omp-plugins/scripts/verify-omp cleanup r1
```

`cleanup` does four things:

1. Stops the PTY server. The server sends SIGTERM to the omp child's process group, then SIGKILL after 5 s. pty.fork makes the child a session leader, so the group holds only what this run spawned.
2. Copies `transcript.raw` into `$EVID`.
3. Kills any leftover process whose argv or environment contains ` HOME=$SCRATCH_HOME`, printing each pid.
4. Deletes `/tmp/omp-verify/<run-id>`.

It never kills by process name. Run it after every attempt, including failed ones. Evidence stays in `/tmp/omp-verify-evidence/<run-id>/`. Delete that directory yourself once the proof is reported.

## Helpers

Both scripts are executable. `verify-omp` with no arguments prints its usage, and `omp-pty --help` lists its subcommands. Both files have a header comment that documents every operation.

## Gotchas

- **No model.** The scratch profile has no credentials. The banner reads `Warning: No default model selected`, and the editor shows `no-model`. Slash commands, dialogs and the status line all work. A prompt that needs an LLM turn does not. That covers system-prompt injection by caveman and ponytail, Headroom compression of real tool results, RTK rewriting of agent bash calls, and `/poteto`. Do not copy real credentials into the scratch HOME. Report those paths as unverified.
- **The screen keeps old notifications.** Earlier lines stay above the editor until they scroll off. Assert text that only the current step produces. Where wording repeats, assert the status-line segment or use `wait --absent` on the prior state first.
- **Autocomplete eats Enter.** Typing `/caveman ultra` and pressing Enter accepts the highlighted completion (`ultracave`). It does not submit. `submit` handles this. If you use `send` plus `key enter`, press `esc` before `enter`.
- **ESC chords.** ESC followed by another byte in the same write is read as Meta+key. `omp-pty key` sends each key separately. Do not build raw escape strings yourself.
- **`--enable` replaces the set.** `omp plugin features omp-plugins --enable=<list>` disables every feature not in the list, including the defaults headroom and prompt-border-style. `launch` names all eight.
- **Shell inheritance.** When run inside an omp session, the shell exports `PI_SESSION_FILE` and `PI_SESSION_ID` for the parent session. `launch` strips them. Doctor's `child has no parent session vars` line proves it.
- **Headroom target.** The default `behavior.headroom.baseUrl` is `http://127.0.0.1:8788`. If a real Headroom proxy listens there on this machine, the scratch omp will reach it, unauthenticated because there is no token file. Otherwise the segment reads `⏹ Headroom not running`.
- **Editor box style.** `submit` finds the editor by its `║` edges. If a journey changes `/prompt-border` style, the edges may change, and `submit` then fails with `editor never showed …`. Use `send` and `key` for steps after a style change.
- **Fresh config on first start.** Headroom writes its default block into `config.json` when omp starts. A `config.json` that exists before your action is normal. Diff it, do not just test for its presence.
- **`/tmp` is `/private/tmp` on macOS.** Paths derived from git (a project root, a dashboard title such as `Skill stats: Project Skills of …`) show the canonical `/private/tmp/...`, while `$PROJECT` and `$SCRATCH_HOME` are spelled `/tmp/...`. Match on the part after `/tmp/` or accept both.
- **Background jobs inside `$(...)` die with the subshell.** To keep a helper process alive across steps, start it at the top level of the driving shell (`nohup cmd >/dev/null 2>&1 &`), wait, and find its pid with `pgrep -n -f`. `cmd & D=$!` can give a wrapper pid instead of the process you want. `features/process-monitor.sh` shows the pattern.
