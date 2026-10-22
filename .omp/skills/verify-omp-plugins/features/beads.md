# Beads

Beads shows how much work is left in the status-line segment, for example `Beads: 5 ready · 12 open`, and opens a live, read-only list of open issues with `/beads tasks`. The segment and the list refresh when Beads writes data, including writes from another terminal, not only when a turn starts.

## Sub-features

- `beads-segment-state` shows `Beads: ready` while the project has no open issues, and the other state words (`uninitialized`, `error`, `suppressed`) when the integration is not usable.
- `beads-segment-counts` shows `Beads: <ready> ready · <open> open` once open issues exist. Open means not closed and not deferred.
- `beads-live-refresh` updates the segment shortly after an issue changes from another terminal, with no command or turn.
- `beads-tasks-view` opens `/beads tasks`, a scrollable overlay grouped as In progress, Ready, Blocked, sorted by priority then most recent update.
- `beads-tasks-live` updates that overlay in place when issues change while it is open.
- `beads-tasks-menu` offers `Show tasks` in the bare `/beads` menu and `tasks` in argument completion.
- `beads-tasks-states` shows `No open issues.` for an empty project and an explanatory message when Beads is uninitialized, suppressed, or failing.

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

- **Seed the project.** Run `(cd $PROJECT && HOME=$SCRATCH_HOME BD_NON_INTERACTIVE=1 bd init --non-interactive --stealth --skip-agents --skip-hooks -p vrf --quiet)`. Stealth mode makes no Git commit. Then create three issues from the shell: `cd $PROJECT && export HOME=$SCRATCH_HOME BD_NON_INTERACTIVE=1; A=$(bd create "Ready task" -p 1 -d "First line of the description" --json | jq -r .id); B=$(bd create "Active task" -p 0 --json | jq -r .id); C=$(bd create "Blocked task" -p 2 --json | jq -r .id); bd update $B --status in_progress; bd dep add $C $A`.
- **Refresh once.** An external initialization is picked up on the next refresh. Run `$OMP_PTY submit $PTY "/beads status"`, then `$OMP_PTY wait $PTY 'Beads: ready'`, press `esc`, and `$OMP_PTY wait $PTY 'Beads: 1 ready · 3 open'`. Save `$EVID/beads/01-counts.txt`.
- **Tasks overlay.** Run `$OMP_PTY submit $PTY "/beads tasks"`, then `$OMP_PTY wait $PTY 'In progress \(1\)'`. The screen also shows `Ready (1)`, `Blocked (1)`, `P0  Active task`, `P1  Ready task - First line of the description` and `P2  Blocked task`, in that order. Save `02-tasks.txt`.
- **Live update while open.** Leave the overlay open. In another shell run `cd $PROJECT && HOME=$SCRATCH_HOME bd create "Added from outside" -p 0`. Run `$OMP_PTY wait $PTY 'Added from outside'` and `$OMP_PTY wait $PTY 'Ready \(2\)'` with no key press. Save `03-live.txt`.
- **Close without touching the prompt.** Type `abc` while the overlay is open: the overlay stays and no text reaches the editor. `$OMP_PTY key $PTY enter` closes it, and `abc` is not in the editor box. Save `04-closed.txt`.
- **Segment tracks changes with no command.** The segment now reads `Beads: 2 ready · 4 open`. In another shell run `cd $PROJECT && HOME=$SCRATCH_HOME bd update $A --status deferred`, with `A` set to the id of "Ready task" (`bd list --json | jq -r '.[] | select(.title=="Ready task").id'`). Run `$OMP_PTY wait $PTY '· 3 open'` with no command: the deferred issue leaves the open count. Save `05-deferred.txt`.
- **Menu path.** Run `$OMP_PTY submit $PTY "/beads"`, choose `Show tasks` with `key down` then `key enter`, and wait for `Beads Tasks`. Close with `esc`.
- **Empty state.** Close the remaining open issues with `bd close <id>` (`bd list --json` names them; the deferred issue stays deferred). Run `$OMP_PTY submit $PTY "/beads tasks"` and wait for `No open issues\.`. The segment falls back to `Beads: ready`.

## Gotchas

- Run every seeding command with `HOME=$SCRATCH_HOME`. Without it `bd` writes machine defaults into the real home and the run is not isolated.
- The watch starts only once Beads is a Ready Integration, so the first sight of an externally initialized project needs a command (`/beads status`) or a turn. Later writes update on their own.
- Updates arrive after a short debounce (a fraction of a second). Wait on the text; do not sleep a fixed time.
- A Shared Display host moves the segment into its own row. Wait on the text, not on its position.
- Tests in `packages/beads` never spawn real `bd`. Only this journey exercises the real CLI.
- No `bd` command in this map may write on the plugin's behalf: every plugin query is read-only, and all writes in this journey come from the verifier's shell.
