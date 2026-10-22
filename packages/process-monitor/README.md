# @codesook/omp-process-monitor

Lists the processes OMP started, with their listening ports, project and Agent Session, so a dev server or browser left behind by a finished session is easy to find and stop. Adds the `/procs` command, a `⚠ N ports` Status Segment for Shared Display, and a prompt when a session ends. See [ADR-0010](../../docs/adr/0010-session-marker-on-bash-commands.md) for the bash tag it relies on.

Requires macOS for full attribution (see Platforms). Needs `omp` and `lsof` on `PATH`. Opening `/procs` changes nothing; only a confirmed kill does.

## `/procs`

Opens a read-only overlay, or posts the same grouping as plain text when there is no UI.

| Group | Contents | Kill |
| --- | --- | --- |
| This project | Processes attributed to OMP whose project is the current one | yes |
| Other projects | The same for every other project, one group each | yes |
| OMP internals (collapsed) | `omp __omp_worker_*` processes, including the daemon broker | no |
| Unknown origin | Any other process listening on a TCP port | no |

Each row shows the PID, listening ports, the command (truncated), the session (`this session`, or the last 8 characters of its id) and `⚠ leftover` when that session has ended. Leftover processes that hold a port are highlighted.

Keys: `↑`/`↓` move, `Space` or `Tab` folds the group under the cursor, `k` or `Backspace` stops the selected process, `Enter`/`Esc` close. Prompt input is never captured. Stopping a row that is not killable only explains that it is view-only.

Stopping asks for confirmation naming the PID, command and ports, re-reads the process table to check that the PID still runs the same command, then runs `kill -TERM <pid>` for that one numeric PID, never a name. The list refreshes afterwards. A failure from `kill` (already exited, permission denied) is shown in the overlay and as an error notification.

## What counts as started by OMP

First match wins:

1. **Supervised.** A process in `omp ps --all --json` with a live PID. Its `owner` is the Agent Session. A daemon that is an OMP worker (`omp __omp_worker_*`) is internal instead: it has no session and stopping it breaks OMP. The daemon spec files are never read because they hold environment snapshots.
2. **Tagged.** A process whose environment carries `OMP_PLUGINS_SESSION`. Every bash tool command is prefixed with `export OMP_PLUGINS_SESSION='<session id>'; `, so servers started with `&` or `nohup` stay attributed after OMP exits. Only the value of this one variable is read; no other environment value is stored, shown or logged. Of the processes in one tagged tree, only the root and port holders are listed.
3. **OMP internal.** Worker processes and the daemon broker. View-only.
4. **Unknown origin.** Anything else with a listening TCP port. View-only. Processes started before this feature was installed land here.

Killability is a table keyed by that origin, in code, never a flag on a row.

### Session ended

OMP keeps `~/.omp/run/session-owners/<session id>.lock` open for every live Agent Session. The files are empty (no PID inside) and stay behind after exit. A session is live when it is the current session, or when its lock file exists and a process holds it open (`lsof -F pn +d ~/.omp/run/session-owners` lists the holders). Every other session is ended, including one with no lock file, and a home where no session ever created the directory has no live session but the current one. The monitor says the locks are unreadable, and marks nothing ended for a session that has a lock file, only when lsof cannot see the lock the current session holds, or lsof is missing while lock files exist. A supervised process with no owner (for example the browser tool's Chromium) counts as ended only when the broker of its project is no longer running.

A process whose session has ended is a Leftover Process.

## Segment

Source `process-monitor` shows the number of Leftover Processes holding at least one listening port, rendered from a template. Nothing is published at zero. It refreshes at the start of each turn and every 30 s while the agent is idle, and clears on shutdown. Without a Shared Display host it falls back to the native status entry `process-monitor`.

```json
{ "display": { "processMonitor": { "visible": true, "template": "⚠ {count} ports" } } }
```

Edit `~/.config/codesook-omp/config.json` directly; changes apply live. `{count}` is the only token and the template must be one line.

## Session end

- **Switching or starting another session with a UI.** If the previous session still has attributed processes running, a prompt lists them and offers `Close all` or `Keep`. `Close all` sends `kill -TERM <pid>` per process. Nothing is asked when the previous session left nothing running.
- **Quitting.** There is no UI to ask, so on `session_shutdown` the session id is recorded as an empty file under `~/.local/share/codesook-omp/process-monitor/ended/`. On the next session start the monitor posts a warning for any of those sessions' processes that are still running, then clears the records. No prompt is shown during shutdown.

## Platforms

macOS uses `/bin/ps -axwwE` to read the session tag from each process environment. Other platforms have no equivalent single `ps` call, so tagged processes are not attributed there; supervised processes, internals and ports still work, and `/procs` says what it could not tell. Processes of other users whose environment `ps` hides, and hardened system binaries, are shown as unknown when they hold a port.

## Tests

`src/index.test.ts` drives the extension's default export through a fake `pi` whose `exec` answers `omp ps`, `ps`, `lsof` and `kill` from fixtures, with a disposable home directory and injected timers. It never runs the real tools.
