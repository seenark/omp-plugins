# Caveman mode

Caveman lets a user switch the terse-output Mode Level for the current session, from a menu or by argument, and see the active mode in the status line. Session changes never touch the saved default.

## Sub-features

- `caveman-menu` opens a select dialog with Show status, Off, Caveman, Ultracave, and Megacave.
- `caveman-status` opens a status dialog with mode, default, native status, shared display, and config path.
- `caveman-session` sets `caveman`, `ultracave`, or `megacave` for this session.
- `caveman-alias` maps `ultra` to `ultracave` and `wenyan` to `megacave`.
- `caveman-standalone` runs `/ultracave` and `/megacave` as their own commands.
- `caveman-off` stops Caveman for the session and removes its segment.
- `caveman-invalid` rejects unknown arguments with usage text.

## How to get to it (user POV)

- Type `/caveman` with no argument to get the menu.
- Type `/caveman <status|off|caveman|ultracave|megacave|ultra|wenyan>`.
- Type `/ultracave` or `/megacave`.
- Use `/omp-plugins` → Caveman section → `Default mode` to change the saved default.

## Driving it with omp-pty

Preconditions:

- A fresh `verify-omp launch` with `doctor` all `ok`.
- The status line shows the caveman spinner followed by `caveman`, for example `○ ⠄⠠ caveman`.

- **Status dialog.** Run `$OMP_PTY submit $PTY "/caveman status"`. Then `$OMP_PTY wait $PTY '^Caveman Status$'` and `$OMP_PTY wait $PTY "Config: $SCRATCH_HOME/.config/codesook-omp/config.json"`. The dialog also shows `Mode: caveman` and `Default: caveman`. Save `$EVID/caveman/01-status.txt`, then close with `$OMP_PTY key $PTY esc`.
- **Menu.** Run `$OMP_PTY submit $PTY "/caveman"`, then `$OMP_PTY wait $PTY '❯ Show status'`. Pick Ultracave with `$OMP_PTY key $PTY down down down enter`. Then `$OMP_PTY wait $PTY 'Caveman ultracave\.'` and `$OMP_PTY wait $PTY '○ \S+ ultracave'`. Save `02-menu-ultracave.txt`.
- **Alias.** Run `$OMP_PTY submit $PTY "/caveman wenyan"`, then `$OMP_PTY wait $PTY 'Caveman megacave\.'`. The segment ends in `megacave`.
- **Standalone.** Run `$OMP_PTY submit $PTY "/ultracave"`. The segment returns to `ultracave`. Assert it with `$OMP_PTY wait $PTY '○ \S+ ultracave'`.
- **Off.** Run `$OMP_PTY submit $PTY "/caveman off"`, then `$OMP_PTY wait $PTY 'Caveman off\.'`. The caveman segment is gone: `$OMP_PTY wait $PTY 'ultracave|megacave|○ \S+ caveman' --absent`. Save `03-off.txt`.
- **Invalid.** Run `$OMP_PTY submit $PTY "/caveman bogus"`, then `$OMP_PTY wait $PTY 'Error: Unknown Caveman command: bogus\. Usage: /caveman'`.
- **Default untouched.** Run `jq -r '.behavior.caveman.defaultMode // "unset"' $SCRATCH_HOME/.config/codesook-omp/config.json`. It prints `unset`. Reopen `/caveman status`; it shows `Default: caveman`.

## Gotchas

- The spinner glyph before the mode name animates. Match `\S+` for it, never a literal frame.
- Menu positions are Show status (0), Off (1), Caveman (2), Ultracave (3), Megacave (4). The cursor starts on Show status.
- `/caveman ultra` plus a bare Enter submits `ultracave` via autocomplete. It looks right but never exercises the alias path. Use `submit`, which dismisses autocomplete first.
- The status dialog stays open until Esc. `submit` presses Esc first, but a `wait` on text behind the dialog fails while it is open.
- Caveman switches off for the session once pstack is active.
- The rules Caveman injects reach only the model. The scratch profile cannot prove the output style.
