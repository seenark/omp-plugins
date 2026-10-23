# Ponytail mode

Ponytail lets a user set the "lazy senior developer" Mode Level for the current session, or save the default that new sessions start at. Both changes show in the status-line segment and in `/ponytail status`, and only the default is written to disk.

## Sub-features

- `ponytail-status` reports current and default mode without changing anything. Bare `/ponytail` does the same while a mode is on.
- `ponytail-session` sets `off`, `lite`, `full`, or `ultra` for this session only.
- `ponytail-off` removes the segment. Bare `/ponytail` while off turns the saved default back on (`full` if the default is `off`).
- `ponytail-phrase` turns Ponytail off when a whole message is `stop ponytail` or `normal mode`.
- `ponytail-default` saves `behavior.ponytail.defaultMode` in the root config.
- `ponytail-segment` shows the current mode in the status line.
- `ponytail-invalid` rejects an unknown mode with usage text.

## How to get to it (user POV)

- Type `/ponytail`, `/ponytail status`, `/ponytail <off|lite|full|ultra>`, or `/ponytail default <off|lite|full|ultra>` in the editor.
- Type `/ponytail` followed by a space to get argument completions.
- Send `stop ponytail` or `normal mode` as a message (case-insensitive, trailing `.`, `!` or `?` ignored).
- Use `/omp-plugins` → Ponytail section → `Default mode` to change the saved default from the settings menu.

## Driving it with omp-pty

Preconditions:

- A fresh `verify-omp launch` with `doctor` all `ok`.
- `PONYTAIL_DEFAULT_MODE` is unset in the launching shell.
- The status line shows `○ 🐴⚡ ponytail`. The segment has no Mode Level text, only the glyph: lite `🐴🌿`, full `🐴⚡`, ultra `🐴🔥`. The scratch HOME seeds these packaged glyphs into `$SCRATCH_HOME/.config/codesook-omp/ponytail/`, so every launch renders them.

- **Baseline.** Read the status. Run `$OMP_PTY submit $PTY "/ponytail status"`, then `$OMP_PTY wait $PTY 'Ponytail: current full • default full'`. Save the screen with `$OMP_PTY screen $PTY --out $EVID/ponytail/01-baseline.txt`. Copy the config with `cp $SCRATCH_HOME/.config/codesook-omp/config.json $EVID/ponytail/config-before.json`.
- **Session mode.** Switch to ultra. Run `$OMP_PTY submit $PTY "/ponytail ultra"`, then `$OMP_PTY wait $PTY 'Ponytail mode set to ultra\.'` and `$OMP_PTY wait $PTY '🐴🔥 ponytail'`. Save `02-ultra.txt`.
- **Session mode is not persisted.** Run `cmp $EVID/ponytail/config-before.json $SCRATCH_HOME/.config/codesook-omp/config.json`. It must exit 0, and `jq -r '.behavior.ponytail.defaultMode // "unset"'` on the file prints `unset`.
- **Save default.** Run `$OMP_PTY submit $PTY "/ponytail default lite"`, then `$OMP_PTY wait $PTY 'Default Ponytail mode set to lite\.'`. The segment still reads `🐴🔥 ponytail`, because the session mode is unchanged. Save `03-default-lite.txt`.
- **Second view.** Run `$OMP_PTY submit $PTY "/ponytail status"`, then `$OMP_PTY wait $PTY 'Ponytail: current ultra • default lite'`. Save `04-status.txt`. Then run `jq -r .behavior.ponytail.defaultMode $SCRATCH_HOME/.config/codesook-omp/config.json`, which prints `lite`. Copy the file to `$EVID/ponytail/config-after.json`.
- **Invalid mode.** Run `$OMP_PTY submit $PTY "/ponytail review"`, then `$OMP_PTY wait $PTY 'Unknown or unsupported /ponytail mode\. Usage: /ponytail'`. The segment is unchanged.
- **Off and back on.** Run `$OMP_PTY submit $PTY "/ponytail off"`, then `$OMP_PTY wait $PTY 'Ponytail mode set to off\.'` and `$OMP_PTY wait $PTY '[●○] \S+ ponytail' --absent`. Run `$OMP_PTY submit $PTY "/ponytail"`; the segment returns at the saved default (`$OMP_PTY wait $PTY '🐴🌿 ponytail'` after the default step above).
- **Phrase.** Run `$OMP_PTY submit $PTY "stop ponytail"`. The plugin answers `Ponytail mode set to off.` and the segment disappears before omp reports `Error: No model selected.` for the message itself.
- **Default applies to a new session.** Run `.omp/skills/verify-omp-plugins/scripts/verify-omp restart $RUN_ID`. The run keeps its scratch HOME and starts a new omp session. Then `$OMP_PTY submit $PTY "/ponytail status"` and `$OMP_PTY wait $PTY 'Ponytail: current lite • default lite'`. The segment reads `🐴🌿 ponytail`. Save `05-restart.txt`.

## Gotchas

- Without `esc` before Enter, autocomplete turns `/ponytail u` into whichever completion is highlighted. Use `submit`.
- `PONYTAIL_DEFAULT_MODE` in the launching shell overrides the saved default. `/ponytail default <mode>` then answers `Saved default <mode>, but env override keeps default at <env>.`
- `review` is never a settable or saveable mode. It appears only when a session already holds a `ponytail-mode` entry with `mode: review` from older Upstream Ponytail, which the scratch profile cannot produce. `/ponytail-review` sends a review prompt and does not change the mode.
- `verify-omp restart` keeps `transcript.raw` growing across both omp sessions. Each session starts with the omp logo banner.
- The instruction text Ponytail injects into the system prompt is only observable on an LLM turn. The scratch profile cannot prove it.
- When pstack is active, Ponytail switches off for the rest of the session. Run pstack journeys in a separate launch.
