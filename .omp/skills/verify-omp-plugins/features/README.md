# omp-plugins verification map

This directory is the maintained source for verifying what users see from the omp-plugins extensions inside the omp TUI. Read this index before driving, then follow the matching feature file.

## Baseline preconditions

- Launch with `.omp/skills/verify-omp-plugins/scripts/verify-omp launch <run-id>`, then `eval "$(.omp/skills/verify-omp-plugins/scripts/verify-omp env <run-id>)"`.
- `verify-omp doctor <run-id>` prints only `ok` lines and exits 0.
- The scratch HOME starts empty. Every plugin uses its shipped defaults: Ponytail `full`, Caveman `caveman`, Headroom enabled at `http://127.0.0.1:8788` with no proxy running, all 9 omp-plugins features enabled, and pstack linked.
- No model is configured. The editor header shows `no-model`.
- Never drive an instance that this verification run did not launch.

## Driving conventions

- Start each recipe from a fresh launch unless its preconditions say otherwise. Mode changes persist for the rest of the omp session.
- Run slash commands with `$OMP_PTY submit $PTY "<command>"`. Use `key` only for menu navigation (`down`, `up`, `enter`, `esc`).
- Assert with `$OMP_PTY wait $PTY '<regex>'`. Pick text only the current step produces, because old notifications stay on screen.
- Treat every quoted command and string as literal.
- Read persisted state from `$SCRATCH_HOME/.config/codesook-omp/config.json` with `jq`, never from memory of an earlier step.

## Proof and skip reporting

- Save a screen before and after each action: `$OMP_PTY screen $PTY --out $EVID/<feature>/<NN>-<step>.txt`.
- Prove a mutation twice. Check the visible notification or status segment, then the second view (a `status` command or a `jq` read of the persisted file). Copy that file into `$EVID/<feature>/`.
- For session-only changes, record that `config.json` did not change (`cmp` against a copy taken before the action).
- Record the feature file and entry point used with every artifact.
- Report an unreachable path with the command attempted and the unmet precondition. Examples: no model, no Headroom proxy.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then has exactly four H2 sections, in this order:

1. `Sub-features`: short IDs, one line per behavior.
2. `How to get to it (user POV)`: every user entry point.
3. `Driving it with omp-pty`: starts with `Preconditions:`, then labeled bullets. Each bullet pairs a user action with an exact command and an observable result.
4. `Gotchas`: traps that can waste or invalidate a run.

Keep implementation details out of the map. Name only user paths, stable on-screen text, required state, commands, and observable proof.

## Features

- [Ponytail mode](./ponytail-mode.md): `/ponytail` session modes, the persisted default, status, and the status-line segment.
- [Caveman mode](./caveman-mode.md): `/caveman` menu and arguments, aliases, standalone `/ultracave` and `/megacave`, off, errors, and the segment.
- [Plugin settings](./plugin-settings.md): `/omp-plugins` status, `init config` file creation, and the settings menu.
- [Headroom](./headroom.md): `/headroom` status, health, on and off against a missing proxy, and the segment.
- [pstack](./pstack.md): `/pstack` status and doctor.
- [Process monitor](./process-monitor.md): `/procs` overlay, leftover rows, view-only unknown rows, confirmed stop, and the `⚠ N ports` segment, driven with a tagged stand-in process.

Not mapped yet: `/prompt-border`, `/context-rail`, `/rtk`, `/beads`, `/codegraph`, `/pstack setup`, `/pstack preset`, `/poteto`, and the `/ponytail-review`, `/ponytail-audit` and `/ponytail-debt` helpers. The last three send an LLM prompt.
