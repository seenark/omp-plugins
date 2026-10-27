# Headroom

Headroom shows whether context compression is on and whether its external proxy is reachable. A user can check health, inspect session stats, and switch compression on or off for the session. The plugin never starts a proxy itself.

## Sub-features

- `headroom-segment` shows proxy state in the status line, for example `⏹ Headroom not running` or `⦸ Headroom off`.
- `headroom-status` opens a status dialog with persisted state, proxy URL and reachability, thresholds, config path, and session stats.
- `headroom-health` checks the proxy and prints the manual start command when it is down.
- `headroom-off` disables compression for the session and leaves any proxy running.
- `headroom-on` re-enables compression and re-checks the proxy.
- `headroom-menu` opens a `Headroom` select with Show status, Enable compression, Disable compression, Check proxy health, Show proxy statistics, Set proxy token, and Choose files to initialize.
- `headroom-stats` fetches proxy statistics into a read-only overlay. With no proxy, it shows the connection error.
- `headroom-token` opens a visible input for the proxy token. Esc cancels without writing a file.
- `headroom-usage` answers an unknown argument with usage text.

## How to get to it (user POV)

- Look at the status line.
- Type `/headroom` for the menu, or `/headroom <status|on|off|health|stats|token|init [config|glyphs|all]>`.

## Driving it with omp-pty

Preconditions:

- A fresh `verify-omp launch` with `doctor` all `ok`.
- Nothing listens on `127.0.0.1:8788`. `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8788/health` prints `000`. The plugin probes `/health`.
- The status line shows `⏹ Headroom not running`.

- **Health.** Run `$OMP_PTY submit $PTY "/headroom health"`. Then `$OMP_PTY wait $PTY 'Headroom proxy is not running: http://127\.0\.0\.1:8788'` and `$OMP_PTY wait $PTY 'headroom proxy --host 127\.0\.0\.1 --port 8788'`. Save `$EVID/headroom/01-health.txt` and close with `$OMP_PTY key $PTY esc`.
- **Status.** Run `$OMP_PTY submit $PTY "/headroom status"`. Then `$OMP_PTY wait $PTY 'Proxy: +http://127\.0\.0\.1:8788 \(not running\)'` and `$OMP_PTY wait $PTY 'Headroom Savings: 0%'`. The dialog also shows `Remote: +local-only` and `Config: $SCRATCH_HOME/.config/codesook-omp/config.json`. Labels are padded (`Proxy:   `, `Remote:  `), so match the gap with ` +`. Save `02-status.txt` and close with `esc`.
- **Off.** Copy `config.json` to `$EVID/headroom/config-before.json`. Run `$OMP_PTY submit $PTY "/headroom off"`. Then `$OMP_PTY wait $PTY 'Headroom compression disabled for this Pi session\. The proxy process is left running\.'` and `$OMP_PTY wait $PTY '⦸ Headroom off'`. Save `03-off.txt`. `cmp` against the copy exits 0, because the change is session-only.
- **On.** Run `$OMP_PTY submit $PTY "/headroom on"`. Then `$OMP_PTY wait $PTY 'Warning: Headroom proxy is not running'` and `$OMP_PTY wait $PTY '⏹ Headroom not running'`. Save `04-on.txt`.
- **Menu.** Run `$OMP_PTY submit $PTY "/headroom"`. Then `$OMP_PTY wait $PTY '❯ Show status'`. The `╭─ Headroom ─╮` box lists the seven rows above, each with a one-line description. Save `05-menu.txt` and close with `esc`.
- **Stats.** Run `$OMP_PTY submit $PTY "/headroom stats"`. Then `$OMP_PTY wait $PTY 'Headroom proxy stats'` and `$OMP_PTY wait $PTY 'Error: ECONNREFUSED'`. Save `06-stats.txt` and close with `esc`.
- **Token, cancelled.** Run `$OMP_PTY submit $PTY "/headroom token"`. Then `$OMP_PTY wait $PTY 'Headroom proxy token \(visible\)'`. Press `esc` and `$OMP_PTY wait $PTY 'Headroom token setup cancelled\.'`. `$SCRATCH_HOME/.config/codesook-omp/headroom/proxy-token` does not exist.
- **Usage.** Run `$OMP_PTY submit $PTY "/headroom bogus"`, then `$OMP_PTY wait $PTY 'Usage: /headroom \[status\|on\|off\|health\|stats\|token\|init \[config\|glyphs\|all\]\]'`. Across the menu, stats, token and usage steps, `cmp` shows `config.json` unchanged.

## Gotchas

- A real Headroom proxy on `127.0.0.1:8788` on this machine changes every expected string, because the scratch omp reaches it. Check with `curl` first. If one is running, report the journey as blocked rather than asserting `online`.
- An online journey needs a running proxy plus a token in `$SCRATCH_HOME/.config/codesook-omp/headroom/proxy-token` with mode `0600`. Use a throwaway local proxy, never the user's token.
- Compression happens only on LLM turns with large tool results. With no model, `Headroom Savings` stays at `0%`, so report compression as unverified.
- `/headroom token` opens a visible text input. Never type a real token into a recorded PTY: the screen shows it, and `transcript.raw` keeps every byte.
- The segment's `online` (`✓ Headroom`) and `compressed` (`✓ Headroom <n> saved`) states need a reachable proxy, and the token count appears only after a turn saves tokens. A no-model scratch run cannot reach `compressed`.
