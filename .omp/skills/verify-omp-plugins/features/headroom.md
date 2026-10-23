# Headroom

Headroom shows whether context compression is on and whether its external proxy is reachable. A user can check health, inspect session stats, and switch compression on or off for the session. The plugin never starts a proxy itself.

## Sub-features

- `headroom-segment` shows proxy state in the status line, for example `⏹ Headroom not running` or `⦸ Headroom off`.
- `headroom-status` opens a status dialog with persisted state, proxy URL and reachability, thresholds, config path, and session stats.
- `headroom-health` checks the proxy and prints the manual start command when it is down.
- `headroom-off` disables compression for the session and leaves any proxy running.
- `headroom-on` re-enables compression and re-checks the proxy.

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

## Gotchas

- A real Headroom proxy on `127.0.0.1:8788` on this machine changes every expected string, because the scratch omp reaches it. Check with `curl` first. If one is running, report the journey as blocked rather than asserting `online`.
- An online journey needs a running proxy plus a token in `$SCRATCH_HOME/.config/codesook-omp/headroom/proxy-token` with mode `0600`. Use a throwaway local proxy, never the user's token.
- Compression happens only on LLM turns with large tool results. With no model, `Headroom Savings` stays at `0%`, so report compression as unverified.
- `/headroom token` is an interactive secret prompt. Never type a real token into a recorded PTY: `transcript.raw` keeps every byte.
