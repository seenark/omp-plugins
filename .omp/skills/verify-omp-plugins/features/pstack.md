# pstack

pstack is linked as its own plugin. A user can check whether pstack is active in the session and run a doctor that reports model-role, skill, instruction-mode, display-host, and task-isolation problems, each with the fix.

## Sub-features

- `pstack-status` reports the Activation state of the session.
- `pstack-doctor` lists `ok` or `warning` per check, with a problem count.
- `pstack-menu` offers Status, Setup, Preset and Doctor from `/pstack` with no argument.

## How to get to it (user POV)

- Type `/pstack status`, `/pstack doctor`, or `/pstack` for the menu.
- `/pstack setup` and `/pstack preset <name>` write omp model-role settings. They are out of scope for a no-model scratch run.

## Driving it with omp-pty

Preconditions:

- A fresh `verify-omp launch` with `doctor` all `ok`. Doctor's `pstack linked to this checkout` line confirms the link.
- No model roles are configured.

- **Status.** Run `$OMP_PTY submit $PTY "/pstack status"`, then `$OMP_PTY wait $PTY 'pstack: inactive'`. Save `$EVID/pstack/01-status.txt`.
- **Doctor.** Run `$OMP_PTY submit $PTY "/pstack doctor"`, then `$OMP_PTY wait $PTY 'pstack doctor: 2 problem\(s\)'`. Then:
  - `$OMP_PTY wait $PTY 'ok +skills: All \d+ workflow-called skills resolve to pstack.s own copy\.'`
  - `$OMP_PTY wait $PTY 'ok +instruction-modes: caveman is loaded'`
  - `$OMP_PTY wait $PTY 'ok +display-host: A Display Host is running\.'`

  The two warnings are `roles:` (no panel seat has a model) and `task-isolation:` (`task.isolation.enabled is off`). Save `02-doctor.txt`.
- **No side effects.** Run `ls $SCRATCH_HOME/.omp/agent` and diff it against a listing taken before doctor. `config.yml` is unchanged (`setupVersion: 2` only).

## Gotchas

- The `skills` check counts skills shipped in `packages/pstack/skills`. Assert `\d+`, not a fixed number, unless the change under test is that count.
- The doctor's two warnings are expected in a scratch HOME. A third problem is a regression.
- The `instruction-modes` lines appear only because caveman and ponytail are enabled. A launch with a reduced feature set changes the output.
- `/poteto <task>` activates pstack. Activation switches Caveman and Ponytail off for the rest of the session and needs a model to do anything useful, so keep it out of shared runs.
