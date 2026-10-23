# Process monitor

Process monitor lists the processes OMP started, with their listening ports and the Agent Session that started each one, and marks the ones whose session has ended as leftovers. A user can stop an attributed process from the list after a confirmation, and sees a `⚠ N ports` segment in the status line while leftovers hold ports.

## Sub-features

- `procs-overlay` opens a scrollable, read-only list grouped as this project, other projects, OMP internals (collapsed) and unknown origin.
- `procs-leftover` marks a process whose session has ended with `⚠ leftover`.
- `procs-view-only` refuses to stop unknown-origin and OMP-internal rows.
- `procs-kill` stops one attributed process after a confirmation that names its PID, command and ports, then refreshes the list.
- `procs-segment` shows `⚠ N ports` in the status line while leftover processes hold ports and hides it at zero.
- `procs-plain` prints the same grouping as plain text when there is no UI.
- `procs-session-prompt` offers `Close all` or `Keep` when another session starts, and a next-start notice covers a quit.

## How to get to it (user POV)

- Type `/procs` in the editor. Inside the overlay, `↑`/`↓` move, `Space` or `Tab` folds a group, `k` or `Backspace` stops the selected row, `Enter` or `Esc` closes.
- Look at the status line for `⚠ N ports`.
- Start a new session (`/new`) while the previous one left attributed processes running, to get the `Close all` / `Keep` prompt.

## Driving it with omp-pty

Preconditions:

- A fresh `verify-omp launch` with `doctor` all `ok`.
- Agent-started processes cannot be produced without a model, so start stand-ins from the driving shell. Launch each one like this, never inside `$(...)`, because a background job started there dies with the subshell, and never with a bare `cmd &` / `$!`, which can give a wrapper pid:
  `OMP_PLUGINS_SESSION=verify-demo nohup bun -e 'Bun.serve({port:0,fetch:()=>new Response("x")});setInterval(()=>{},1e6)' >/dev/null 2>&1 &`, then `sleep 2; D=$(pgrep -n -f 'Bun.serve\(\{port:0')`.
- `OMP_PLUGINS_SESSION` is the tag every bash tool command gets. No omp session holds the id `verify-demo`, so the stand-in counts as left over.
- The listening port is `lsof -nP -a -p $D -iTCP -sTCP:LISTEN -Fn | sed -n 's/^n.*://p'`. Note it as `$DPORT`.
- A second stand-in started without `OMP_PLUGINS_SESSION` carries no session tag, so the monitor lists it under `Unknown origin (view-only)`. Note its pid as `$U`.

- **One command.** `.omp/skills/verify-omp-plugins/features/process-monitor.sh <run-id>` runs every step below against a launched run. It saves screens to `$EVID/process-monitor/NN-step.txt`, prints `PASS <step>` lines, exits non-zero at the first failure, and kills only the stand-ins it started.
- **Overlay.** Run `$OMP_PTY submit $PTY "/procs"`, then `$OMP_PTY wait $PTY 'OMP processes'` and `$OMP_PTY wait $PTY 'Enter/Esc close'`. Save `$EVID/process-monitor/01-overlay.txt` with `$OMP_PTY screen $PTY --out …`.
- **Leftover row.** `$OMP_PTY wait $PTY "$D .*⚠ leftover$"`. The session column shows only the id tail (`…ify-demo`), so never match the full session id. A row reads `<pid>  :<port>  <command>  <session>  ⚠ leftover`, and the cursor row starts with `›`.
- **Unknown rows are view-only.** `$OMP_PTY scroll-until $PTY "^› +$U " --max 80` puts the cursor on the unknown stand-in. Then `$OMP_PTY key $PTY bspace` and `$OMP_PTY wait $PTY 'Not started by OMP as far as can be proven: view-only\.'`. No `Stop pid` dialog appears, and `kill -0 $U` still succeeds.
- **Close.** `$OMP_PTY key $PTY esc`, then `$OMP_PTY wait $PTY 'OMP processes' --absent`.
- **Segment.** The count refreshes after at most 30 s of idle: `$OMP_PTY wait $PTY '⚠ \d+ ports' --timeout 45`. Save the screen.
- **Stop with confirmation.** Reopen `/procs`, `$OMP_PTY scroll-until $PTY "^› +$D " --max 80`, `$OMP_PTY key $PTY bspace` (`char:k` also works), then `$OMP_PTY wait $PTY "Stop pid $D\?"`. The dialog shows `Ports: $DPORT` and the rows `❯ Yes` / `No`. Save the screen, press `$OMP_PTY key $PTY enter` (Yes is the default), and wait for `"Stop pid $D\?" --absent`. `kill -0 $D` then fails (poll briefly), and `$OMP_PTY wait $PTY "$D .*⚠ leftover$" --absent` shows the refreshed list without the row.
- **Declined stop.** With a fresh stand-in `$D2`, open the same dialog and press `$OMP_PTY key $PTY down enter` (No). The dialog closes, `$D2 .*⚠ leftover$` is still listed, and `kill -0 $D2` still succeeds.
- **Next-start notice.** With `$D2` still running, write an empty file named like its session: `mkdir -p $SCRATCH_HOME/.local/share/codesook-omp/process-monitor/ended && : > $SCRATCH_HOME/.local/share/codesook-omp/process-monitor/ended/verify-demo`. Then `verify-omp restart $RUN_ID` and `$OMP_PTY wait $PTY 'Warning: 1 process started by an earlier OMP session is still running:'`. Stop `$D2` afterwards.
- **Previous-session prompt.** Read the live session id: `$OMP_PTY submit $PTY "/session"`, `$OMP_PTY wait $PTY 'Session Info'`, then take the uuid from `$OMP_PTY screen $PTY`. Start a stand-in tagged `OMP_PLUGINS_SESSION=<that uuid>`, run `$OMP_PTY submit $PTY "/new"`, and `$OMP_PTY wait $PTY 'The previous session left 1 process running:'`. The select shows `❯ Close all` and `Keep`. `$OMP_PTY key $PTY enter` closes all, and the stand-in's pid is gone.

## Gotchas

- `lsof` is machine-wide, so the unknown-origin group also lists real listeners from the user's machine. Unknown rows offer no stop. Processes started by the user's real omp sessions also show, grouped under their own project paths and marked `⚠ leftover`, and those rows do offer a stop. Never confirm a stop on any row other than a stand-in.
- The segment count includes any other tagged process on the machine whose session has no lock file open under the scratch HOME, which is every tagged process from outside this run. Identify a stand-in by its row, not by the number.
- The tag is read from the process environment, so it only works for a process the current user owns and that `ps` shows an environment for. A stand-in launched through `/bin/sleep` or another hardened system binary shows no tag; use `bun`.
- The session column is truncated to the last 8 characters of the id. Match `"$PID .*⚠ leftover$"`, not the session text.
- A stand-in started with `cmd & D=$!` gives a wrapper pid, and one started inside `$(...)` dies with the subshell. Start it at the top level of the shell, wait 2 s, and look the pid up with `pgrep -n -f`.
- An agent-started process, and therefore the marker added to bash tool commands, needs a model turn and cannot be driven here. Report it as unverified, not as passing through the stand-in.
- The `OMP internals` group stays collapsed (`▸ OMP internals`) when the scratch omp has workers. The journey does not assert it because a fresh scratch omp may have none.
- Do not type `k` through `submit`, which closes dialogs first. Use `key bspace` or `key char:k`.
- If a step fails, stop the stand-ins yourself: `kill $D $U` (the journey script does this on exit through its trap).
- `procs-plain` runs only when omp has no UI. The PTY always has one, so report it as unreachable here and prove it with the unit tests.
