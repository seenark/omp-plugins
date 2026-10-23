# Beads

Beads shows how much work is left in the status-line segment, for example `Beads: 5 ready · 12 open`, and opens a live, read-only list of open issues with `/beads tasks`. The segment and the list refresh when Beads writes data, including writes from another terminal, not only when a turn starts.

## Sub-features

- `beads-segment-state` shows `Beads: ready` while the project has no open issues. Under the default `ready` visibility the segment is hidden in every other state. The other state words (`uninitialized`, `suppressed`, `error`, `missing-prerequisite`) show only with `display.beads.visibility` set to `always`.
- `beads-segment-counts` shows `Beads: <ready> ready · <open> open` once open issues exist. Open means not closed and not deferred.
- `beads-live-refresh` updates the segment shortly after an issue changes from another terminal, with no command or turn.
- `beads-tasks-view` opens `/beads tasks`, a scrollable overlay grouped as In progress, Ready, Blocked, sorted by priority then most recent update.
- `beads-tasks-live` updates that overlay in place when issues change while it is open.
- `beads-tasks-menu` offers `Show tasks` in the bare `/beads` menu and `tasks: Show tasks` in argument completion.
- `beads-tasks-states` shows `No open issues.` for an empty project, and `Beads is <state>; there is no task list to show.` plus a detail line when Beads is uninitialized, suppressed, or failing.

## How to get to it (user POV)

- Read the Beads segment in the status line.
- Type `/beads tasks` in the editor.
- Type `/beads` and press Enter, then choose `Show tasks`.
- Type `/beads t` to get the `tasks` completion.
- Close the overlay with Enter or Esc. Up and Down scroll it when it is longer than the screen.
- Change the segment wording with `display.beads.template` in the root config (tokens `{ready}`, `{open}`, `{inProgress}`).

## Driving it with omp-pty

Preconditions:

- A fresh `verify-omp launch` with `doctor` all `ok`, and the `bd` CLI on PATH.
- The scratch project is a plain Git repository with no `.beads` directory yet. Beads is not initialized, so the segment is hidden under the default `ready` visibility.
- Every `bd` command below runs as `(cd $PROJECT && HOME=$SCRATCH_HOME BD_NON_INTERACTIVE=1 bd …)`. Write that as `bd_p` in your shell.

- **One command.** `.omp/skills/verify-omp-plugins/features/beads.sh <run-id>` runs every step below except the Uninitialized and Suppressed notes against a launched run. It saves screens to `$EVID/beads/NN-step.txt`, prints `PASS <step>` lines, and exits non-zero at the first failure. Drive the Uninitialized note by hand before the journey seeds the project, and the Suppressed note after it finishes.
- **Uninitialized note.** Before seeding, run `$OMP_PTY submit $PTY "/beads tasks"`, then `$OMP_PTY wait $PTY 'Beads is uninitialized; there is no task list to show\.'`. Close with `esc`. Type `$OMP_PTY send $PTY "/beads t"` and `$OMP_PTY wait $PTY 'tasks: Show tasks'`, then `$OMP_PTY key $PTY esc ctrl-u`.
- **Seed the project.** `(cd $PROJECT && HOME=$SCRATCH_HOME BD_NON_INTERACTIVE=1 bd init --non-interactive --stealth --skip-agents --skip-hooks -p vrf --quiet)`. Stealth mode makes no Git commit. Then create three issues and read each id from the JSON: `A=$(bd_p create "Ready task" -p 1 -d "First line of the description" --json | jq -r .id)`, `B=$(bd_p create "Active task" -p 0 --json | jq -r .id)`, `C=$(bd_p create "Blocked task" -p 2 --json | jq -r .id)`. Then `bd_p update $B --status in_progress` and `bd_p dep add $C $A`.
- **Refresh once.** An external initialization is picked up on the next refresh. Run `$OMP_PTY submit $PTY "/beads status"`, then `$OMP_PTY wait $PTY 'Beads: ready'`, press `esc`, and `$OMP_PTY wait $PTY 'Beads: 1 ready · 3 open'`. Save `$EVID/beads/01-counts.txt`.
- **Tasks overlay.** Run `$OMP_PTY submit $PTY "/beads tasks"`, then `$OMP_PTY wait $PTY '(?s)In progress \(1\).*P0  Active task.*Ready \(1\).*P1  Ready task - First line of the description.*Blocked \(1\).*P2  Blocked task'`. The leading `(?s)` lets one regex check both the group headings and their order. Save `02-tasks.txt`.
- **Live update while open.** Leave the overlay open and create an issue from the shell: `ADDED=$(bd_p create "Added from outside" -p 0 --json | jq -r .id)`. `$OMP_PTY wait $PTY 'Added from outside'` and `$OMP_PTY wait $PTY 'Ready \(2\)'` succeed with no key press. Save `03-live.txt`.
- **Close without touching the prompt.** Type letters while the overlay is open with `$OMP_PTY key $PTY char:q char:z char:x`. The overlay stays, and `qzx` is nowhere on screen. `$OMP_PTY key $PTY enter` closes it (`wait 'In progress \(1\)' --absent`), and no `║` editor row contains `qzx`. Save `04-closed.txt`.
- **Segment tracks changes with no command.** The segment reads `Beads: 2 ready · 4 open`. Run `bd_p update $A --status deferred`, then `$OMP_PTY wait $PTY 'Beads: 1 ready · 3 open'` with no command: the deferred issue leaves the open count. Save `05-deferred.txt`.
- **Menu path.** Run `$OMP_PTY submit $PTY "/beads"`, wait for `Show tasks`, choose it with `$OMP_PTY key $PTY down enter`, and wait for `Beads Tasks`. Close with `esc`.
- **Empty state.** Close every open issue: `bd_p close --force $B`, `bd_p close --force $ADDED`, `bd_p close --force $C`. `--force` is required for the blocked one. The deferred issue stays deferred. Run `$OMP_PTY submit $PTY "/beads tasks"` and wait for `No open issues\.`, then `esc` and `$OMP_PTY wait $PTY 'Beads: ready'`.
- **Suppressed note.** Run `$OMP_PTY submit $PTY "/beads off"` and `$OMP_PTY wait $PTY 'Beads project policy: off\. '`. `jq -r .behavior.beads.policy $PROJECT/.omp/codesook-omp.json` prints `off`, and the segment is hidden. `/beads tasks` shows `Beads is suppressed; there is no task list to show.` Close with `esc`. Run `$OMP_PTY submit $PTY "/beads auto"`, then `$OMP_PTY wait $PTY 'Beads project policy: auto\. '` and `$OMP_PTY wait $PTY 'Beads: ready'`.

## Gotchas

- Run every seeding command with `HOME=$SCRATCH_HOME`. Without it `bd` writes machine defaults into the real home and the run is not isolated.
- The watch starts only once Beads is a Ready Integration, so the first sight of an externally initialized project needs a command (`/beads status`) or a turn. Later writes update on their own.
- Updates arrive after a short debounce (a fraction of a second). Wait on the text; do not sleep a fixed time.
- Closing an issue that another open issue blocks needs `bd close --force <id>`.
- Keys pressed in the overlay are swallowed, which is why the journey types them with `char:<c>` rather than `submit`, which presses Esc first and would close the overlay.
- A Shared Display host moves the segment into its own row. Wait on the text, not on its position.
- Tests in `packages/beads` never spawn real `bd`. Only this journey exercises the real CLI.
- No `bd` command in this map may write on the plugin's behalf: every plugin query is read-only, and all writes in this journey come from the verifier's shell.
