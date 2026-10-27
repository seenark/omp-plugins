# Plugin settings

`/omp-plugins` is the single settings entry for every Codesook plugin. A user can open a read-only status overlay, create missing config and glyph files without overwriting existing ones, or edit settings in a menu and apply them to the root config.

## Sub-features

- `settings-status` shows the root config path and validity, install state, and each feature's enabled state.
- `settings-init` creates missing config and glyph files, keeps existing ones, and lists both groups.
- `settings-init-menu` runs the same init through a confirmation select dialog.
- `settings-menu` opens the full settings editor: section rows (Presence (read-only), CodeGraph Integration, Beads Integration, Shared Display, Ponytail, Caveman, pstack, Headroom, RTK, Prompt Border, Context Rail) and actions Edit glyph frames, Show status, Create missing files, Reload from disk, Apply changes, Cancel.
- `settings-apply` writes an edited draft to the root config after a confirmation and notifies loaded plugins, which pick the change up in the running session.
- `settings-shared-style` sets the Shared Display `Style` (`plain`, `bracketed`, `powerline`, `rounded`) and `Palette` (`none`, `theme`, `gruvbox`, `catppuccin`, `pastel`, `tokyo-night`). After Apply, the status line redraws at once in the new style.
- `settings-usage` answers an unknown argument with usage text.

## How to get to it (user POV)

- Type `/omp-plugins status`, `/omp-plugins init config`, or `/omp-plugins init`.
- Type `/omp-plugins` with no argument to open the settings editor.

## Driving it with omp-pty

Preconditions:

- A fresh `verify-omp launch` with `doctor` all `ok`.
- `$SCRATCH_HOME/.config/codesook-omp/` holds only `config.json`. Check with `ls $SCRATCH_HOME/.config/codesook-omp`.

- **Status.** Run `$OMP_PTY submit $PTY "/omp-plugins status"`. Then `$OMP_PTY wait $PTY '^Codesook OMP Plugin Status$'` and `$OMP_PTY wait $PTY "Root config: $SCRATCH_HOME/.config/codesook-omp/config.json \(valid\)"`. The overlay lists `omp-plugins: installed, enabled` and 11 `<feature>: enabled for next start` lines, one per root feature plus `pstack` (`$OMP_PTY wait $PTY '^ *pstack: enabled for next start'`). Save `$EVID/settings/01-status.txt` and close with `$OMP_PTY key $PTY esc`.
- **Init creates files.** Save the tree with `find $SCRATCH_HOME/.config/codesook-omp -type f | sort > $EVID/settings/files-before.txt`. Run `$OMP_PTY submit $PTY "/omp-plugins init config"`, then `$OMP_PTY wait $PTY 'Already existed \(1\):'`. The notification begins `Created (N):` and lists glyph files under `caveman/glyphs/`, `headroom/`, `ponytail/`, `prompt-border/` and `context-rail/`. Save `02-init.txt`, then the tree again to `files-after.txt`. The diff must equal the created list.
- **Init is idempotent.** Run `cp $SCRATCH_HOME/.config/codesook-omp/config.json $EVID/settings/config-before-reinit.json`. Run `$OMP_PTY submit $PTY "/omp-plugins init config"` again, then `$OMP_PTY wait $PTY 'Created \(0\):'`. `cmp` of the config against the copy exits 0.
- **Init via menu.** The previous output fills the screen, so make this run produce something new: `rm $SCRATCH_HOME/.config/codesook-omp/ponytail/review.txt`. Run `$OMP_PTY submit $PTY "/omp-plugins init"`, then `$OMP_PTY wait $PTY 'Initialize Codesook OMP configuration'`. Confirm `❯ Create missing files` with `$OMP_PTY key $PTY enter`, then `$OMP_PTY wait $PTY 'Created \(1\):'`. `ponytail/review.txt` exists again.
- **Unknown argument.** Run `$OMP_PTY submit $PTY "/omp-plugins bogus"`, then `$OMP_PTY wait $PTY 'Usage: /omp-plugins \[status\|init config\]'`.
- **Settings editor.** Run `$OMP_PTY submit $PTY "/omp-plugins"`. Then `$OMP_PTY wait $PTY 'Codesook OMP Plugin Settings'` and `$OMP_PTY wait $PTY 'Apply changes'`. Save `03-editor.txt`. With no edits, `$OMP_PTY key $PTY esc` closes it (`wait 'Codesook OMP Plugin Settings' --absent`), and `cmp` shows `config.json` unchanged.
- **Apply.** Copy `config.json` to `$EVID/settings/config-before-apply.json`. Open `/omp-plugins`, move to the section with `$OMP_PTY key $PTY down down down down` (`wait '^> Ponytail'`), and press `enter`. The cursor is on `❯ Default mode`. Press `enter` once: the value cycles to the next mode and the title shows `1 unsaved`. Press `esc` to return to the menu, then `$OMP_PTY scroll-until $PTY '^> Apply changes' --max 20` and `enter`. Wait for `Apply Codesook OMP settings\?` and confirm with `enter`. The editor closes. `jq -r .behavior.ponytail.defaultMode` on `config.json` prints the new mode. If no session mode was set, the Ponytail segment follows it at once. `/ponytail status` answers `default <new mode>`.
- **Display Style.** Copy `config.json` to `$EVID/settings/config-before-style.json`. Open `/omp-plugins`, run `$OMP_PTY key $PTY down down down` (`wait '^> Shared Display'`), and press `enter`. The section lists `Style         plain` and `Palette       theme`. Run `$OMP_PTY key $PTY down down enter` and wait for `❯ Style +bracketed`. Then run `$OMP_PTY key $PTY down enter` and wait for `❯ Palette +gruvbox` and `2 unsaved`. Press `esc`, `scroll-until '^> Apply changes'`, `enter`, and confirm `Apply Codesook OMP settings\?` with `enter`. The status line now reads `[○ 🐴⚡ ponytail][○ \S+ caveman][⏹ Headroom not running]…`, with every segment in brackets and no separator. `jq -c '.display.sharedDisplay | {style,palette}'` prints `{"style":"bracketed","palette":"gruvbox"}`.

## Gotchas

- The status overlay lists `pstack` as a feature even though pstack is a separate plugin. It reads the plugin list, not the omp-plugins feature set.
- Init output is longer than one screen at 50 rows, so the `Created (N):` header may scroll off. Assert the `Already existed` or `Created (0)` tail, and count files with `find`, not on screen.
- Headroom writes its default block into `config.json` at omp start, so `config.json` already exists before init. That is why the first init reports `Already existed (1)`.
- Apply does not need Shift+Enter. The `Apply changes` row plus `Enter` at the `Apply Codesook OMP settings?` prompt does the same thing. Inside a section, `Enter` on an enum row cycles its value in the draft, and `Esc` returns to the menu. With unsaved edits, `Esc` on the menu asks to discard them instead of closing.
- Feature toggles show `enabled for next start`. They take effect only after relaunching omp.
- Display Style applies to every segment for the rest of the session and after restarts. Regexes inside one segment still match. A regex that spans two segments must allow `][` between them. `powerline` and `rounded` need a Nerd Font, and pyte shows their separators as opaque glyphs.
