# Plugin settings

`/omp-plugins` is the single settings entry for every Codesook plugin. A user can open a read-only status overlay, create missing config and glyph files without overwriting existing ones, or edit settings in a menu and apply them to the root config.

## Sub-features

- `settings-status` shows the root config path and validity, install state, and each feature's enabled state.
- `settings-init` creates missing config and glyph files, keeps existing ones, and lists both groups.
- `settings-init-menu` runs the same init through a confirmation select dialog.
- `settings-menu` opens the full settings editor with Apply, Cancel, Reload, Show status, Create missing files, and Edit glyph frames.
- `settings-usage` answers an unknown argument with usage text.

## How to get to it (user POV)

- Type `/omp-plugins status`, `/omp-plugins init config`, or `/omp-plugins init`.
- Type `/omp-plugins` with no argument to open the settings editor.

## Driving it with omp-pty

Preconditions:

- A fresh `verify-omp launch` with `doctor` all `ok`.
- `$SCRATCH_HOME/.config/codesook-omp/` holds only `config.json`. Check with `ls $SCRATCH_HOME/.config/codesook-omp`.

- **Status.** Run `$OMP_PTY submit $PTY "/omp-plugins status"`. Then `$OMP_PTY wait $PTY '^Codesook OMP Plugin Status$'` and `$OMP_PTY wait $PTY "Root config: $SCRATCH_HOME/.config/codesook-omp/config.json \(valid\)"`. The overlay lists `omp-plugins: installed, enabled` and one `<feature>: enabled for next start` line per feature, including `pstack`. Save `$EVID/settings/01-status.txt` and close with `$OMP_PTY key $PTY esc`.
- **Init creates files.** Save the tree with `find $SCRATCH_HOME/.config/codesook-omp -type f | sort > $EVID/settings/files-before.txt`. Run `$OMP_PTY submit $PTY "/omp-plugins init config"`, then `$OMP_PTY wait $PTY 'Already existed \(1\):'`. The notification begins `Created (N):` and lists glyph files under `caveman/glyphs/`, `headroom/`, `ponytail/`, `prompt-border/` and `context-rail/`. Save `02-init.txt`, then the tree again to `files-after.txt`. The diff must equal the created list.
- **Init is idempotent.** Run `cp $SCRATCH_HOME/.config/codesook-omp/config.json $EVID/settings/config-before-reinit.json`. Run `$OMP_PTY submit $PTY "/omp-plugins init config"` again, then `$OMP_PTY wait $PTY 'Created \(0\):'`. `cmp` of the config against the copy exits 0.
- **Init via menu.** Run `$OMP_PTY submit $PTY "/omp-plugins init"`, then `$OMP_PTY wait $PTY 'Initialize Codesook OMP configuration'`. Confirm with `$OMP_PTY key $PTY enter`, then `$OMP_PTY wait $PTY 'Created \(0\):'`.
- **Unknown argument.** Run `$OMP_PTY submit $PTY "/omp-plugins bogus"`, then `$OMP_PTY wait $PTY 'Usage: /omp-plugins \[status\|init config\]'`.
- **Settings editor.** Run `$OMP_PTY submit $PTY "/omp-plugins"`. Wait for a section heading such as `$OMP_PTY wait $PTY 'Ponytail'` and the `Cancel` action. Save `03-editor.txt`. Leave with `$OMP_PTY key $PTY esc`, and confirm `config.json` is unchanged with `cmp`.

## Gotchas

- The status overlay lists `pstack` as a feature even though pstack is a separate plugin. It reads the plugin list, not the omp-plugins feature set.
- Init output is longer than one screen at 50 rows, so the `Created (N):` header may scroll off. Assert the `Already existed` or `Created (0)` tail, and count files with `find`, not on screen.
- Headroom writes its default block into `config.json` at omp start, so `config.json` already exists before init. That is why the first init reports `Already existed (1)`.
- Applying a draft in the editor needs Shift+Enter or a confirmation. `omp-pty` has no Shift+Enter key. Drive Apply through its menu row and the confirmation, and record it as unverified if the row cannot be reached.
- Feature toggles show `enabled for next start`. They take effect only after relaunching omp.
