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
- Agent-started processes cannot be produced without a model, so start a stand-in from the driving shell. It carries the session tag that every bash tool command gets, and no omp session holds that id: `OMP_PLUGINS_SESSION=verify-demo bun -e 'Bun.serve({port:0,fetch:()=>new Response("x")});setInterval(()=>{},1e6)' & DECOY=$!`.
- `lsof -nP -a -p $DECOY -iTCP -sTCP:LISTEN` prints one listening port. Note it as `$DECOY_PORT`.

- **Overlay.** Run `$OMP_PTY submit $PTY "/procs"`, then `$OMP_PTY wait $PTY 'OMP processes'` and `$OMP_PTY wait $PTY 'Enter/Esc close'`. Save the screen with `$OMP_PTY screen $PTY --out $EVID/process-monitor/01-overlay.txt`.
- **Leftover row.** `$OMP_PTY wait $PTY "$DECOY.*:$DECOY_PORT.*verify-demo.*⚠ leftover"`. The row sits in a group titled with a project path or `No project`, never under `Unknown origin (view-only)`. The scratch omp creates no `~/.omp/run/session-owners/` directory, and the header still counts the stand-in as a leftover holding a port.
- **Internals stay collapsed.** The screen shows `▸ OMP internals` when the scratch omp has workers, and no `__omp_worker_` command text until the group is unfolded with `Tab` on its header.
- **Unknown rows are view-only.** Press `down` until the cursor (`›`) is on a row under `Unknown origin (view-only)`, then `$OMP_PTY key $PTY bspace`. Wait for `view-only`. No confirmation dialog appears and `kill -0 $DECOY` still succeeds.
- **Close.** `$OMP_PTY key $PTY esc` closes the overlay. The editor text is unchanged.
- **Segment.** After at most 30 s of idle, `$OMP_PTY wait $PTY '⚠ \d+ ports' --timeout 45`. Save `02-segment.txt`.
- **Stop with confirmation.** Reopen `/procs`, press `down` until the cursor is on the `$DECOY` row, press `bspace`, then `$OMP_PTY wait $PTY "Stop pid $DECOY"`. The dialog shows the command and `Ports: $DECOY_PORT`. Save `03-confirm.txt`, answer yes, and `$OMP_PTY wait $PTY "Stop pid $DECOY" --absent`. Then `kill -0 $DECOY` must fail, and the reopened list no longer has the row.
- **Declined stop.** Repeat with a fresh stand-in and answer no. `kill -0` still succeeds and no row changes.

## Gotchas

- `lsof` is machine-wide, so the unknown-origin group lists real listeners from the user's machine. Unknown rows offer no stop, which the recipe checks; never confirm a stop on any row other than the stand-in.
- The segment count includes any other tagged process on the machine whose session has no lock file open under the scratch HOME, which is every tagged process from outside this run. Identify the stand-in by its row, not by the number.
- The tag is read from the process environment, so it only works for a process the current user owns and that `ps` shows an environment for. A stand-in launched through `/bin/sleep` or another hardened system binary shows no tag; use `bun`.
- An agent-started process, and therefore the marker added to bash tool commands, needs a model turn and cannot be driven here. Report it as unverified, not as passing through the stand-in.
- The previous-session prompt and the next-start notice need a second session or a restart and are not part of this recipe unless a stand-in with the previous session's id is started first. Report them as unreachable when skipped.
- `omp-pty key` has no letter keys, so `k` cannot be sent; `bspace` is the equivalent. Do not type `k` through `submit`, which closes dialogs first.
- Stop the stand-in yourself if a step fails: `kill $DECOY`.
