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

The overlay body is an aligned table with a dimmed header row, `PID  PORTS  NAME  AGE  SESSION  STATE`.

| Column | Shows |
| --- | --- |
| `PID` | The process id |
| `PORTS` | Listening ports, in the number colour. A row with more ports than fit shows the first ones and `+N` |
| `NAME` | The name in bold, then the command dimmed when it says more than the name |
| `AGE` | How long the process has run, from `ps` elapsed time: `45s`, `12m`, `3h`, `2d`, or `-` when `ps` gave none |
| `SESSION` | The session's title, or the last 8 characters of its id when there is no title, or `-`. The current session shows its title too. A narrow terminal hides this column |
| `STATE` | `● this session` (success colour), `● live` (another session that is still running, accent colour), `⚠ stop?` (a Stop Candidate) or `📌 kept` (a Kept Process, accent colour) |

A Stop Candidate row is drawn whole in the warning colour. A Kept Process row has no tint, only its accent badge. Rows of unknown origin and OMP internals are drawn whole in the dim colour and have no badge. Only OMP theme colours are used. A tinted row is one colour, so its ports are not drawn in the number colour. The no-UI listing, the session-switch prompt and the next-start notice show the same badge text, uncoloured.

Within a group, Stop Candidates come first, then rows with more ports, then by PID. Under the title, a summary line reads `22 tracked · 2 suggested to stop · 1 holding a port`. The last number is the Stop Candidates holding a port, the same number the Status Segment shows. `/procs` only suggests: stopping stays one process at a time, with confirmation.

Each group header shows the project's folder name in bold, then the full path dimmed. The current project reads `▾ app (this project) (3)  /work/app`. `OMP internals` and `Unknown origin (view-only)` keep their titles. The NAME and the STATE badge are not cut while the row can fit, and the PID and AGE are never clipped. On a narrow terminal the parts give way in this order: the command, a long session title (cut to 40 columns at most, and down to the short-id width), multi-port rows (collapsed to `:3000,+12`), then the whole SESSION column. Only after all of that does the name shrink. The no-UI text listing uses the same table without colour or header row.

Below the table, after a dim rule, a detail pane describes the row under the cursor and follows it on `↑`/`↓`. Dim labels, plain values, each cut to the terminal width:

| Line | Shows |
| --- | --- |
| `command` | The full command, marker and wrapper removed |
| `cwd` | The working directory from `lsof`, or `-` |
| `session` | The full Agent Session id, then its title when known, or `-` |
| `origin` | `supervised (daemon <name>)`, `tagged (OMP session marker)`, `OMP internal (<role>)` or `unknown` |
| `stop` | `k stops it`, or `view-only: not started by OMP as far as can be proven` |
| `why` | Only for a Stop Candidate and a Kept Process. A Stop Candidate reads `session ended (last active 3d ago) · holds :3000 · not kept`. The `(last active …)` part is left out when the session file is not found, and `holds …` when the process holds no port. A Kept Process reads `started in persist or detached mode, so it is not suggested` |

A group header row keeps the pane's space, blank, so the overlay does not resize as the cursor moves. The body gets the rows left after the title, summary, table header, notes, notice and key hint, plus the pane's rows. When the terminal is too short for five body rows plus the pane, the pane is dropped instead of overflowing the screen. `last active` is the session file's modification time, written in the same units as `AGE` plus ` ago`.

Session titles come from the first line of OMP's session file, `~/.omp/agent/sessions/<project>/<timestamp>_<session id>.jsonl`, when that line is a `{"type":"title"}` record or a `{"type":"session"}` header with a non-empty `title`. The monitor reads at most the first 4 KiB of each session file, parses only the first line, and keeps only the title and the file's modification time, which is the session's last activity. Bytes after the first line that fall inside that 4 KiB read are discarded unparsed. A missing or unreadable file, a first line that is anything else, or one that does not end within 4 KiB falls back to the short id. A session id with no file is not looked for again for five minutes.

The name is the supervised daemon's own name from `omp ps` when there is one, and an OMP internal's role (`text-predict`, `daemon-broker`, `broker`). Otherwise the session marker and a leading `sh`/`bash`/`zsh` `-c` (or `-l -c`) wrapper are removed from the command. When that shell payload is compound (joined by `&&`, `||` or `;` outside quotes), the name comes from the last command, skipping `cd <dir>` steps, so `cd /work/app && bun run dev` is named `bun run dev`. The command column and the stop confirmation still show the whole payload. An executable inside a macOS bundle (`…/FigmaAgent.app/Contents/MacOS/figma_agent`) is named after the innermost bundle (`FigmaAgent`). Any other command is named after the executable's basename. `npm`, `pnpm` and `yarn` are named after the manager and its script: `npm run dev`, `pnpm dev` and `yarn dev` (`pnpm run dev` and `yarn run dev` drop `run`), also when launched as `node …/pnpm.cjs dev`. When the basename is an interpreter (`node`, `bun`, `deno`, `python`, `python3`), the name is the script (without its `.js`, `.ts`, `.mjs` or `.py` extension), the `-m` module, or for a package bin such as `node_modules/.bin/next dev` or `bunx vite` the bin plus its subcommand (`next dev`). Flags that take a value (`-r`/`--require`, `--import`, `--loader`, `--experimental-loader`, `--env-file`, `--cwd`, `-C`, `--config`, `--inspect-port`) are skipped together with their value, so `node --import tsx server.ts` is named `server`. For `bun` and `deno`, a script file is named after the file (`bun run server.ts` is `server`), and anything else is a subcommand or package script that keeps its program: `bun run dev`, `bun dev` and `deno task dev`. An interpreter with inline code (`bun -e …`) is named after the interpreter. The command shown beside the name, and in the stop confirmation, is the command with the marker and wrapper removed.

Keys: `↑`/`↓` move, `Space` or `Tab` folds the group under the cursor, `k` or `Backspace` stops the selected process, `Enter`/`Esc` close. Prompt input is never captured. Stopping a row that is not killable only explains that it is view-only.

Stopping asks for confirmation naming the PID, command (marker and wrapper removed) and ports, re-reads the process table to check that the PID still runs the same command, then runs `kill -TERM <pid>` for that one numeric PID, never a name. The list refreshes afterwards. A failure from `kill` (already exited, permission denied) is shown in the overlay and as an error notification.

## What counts as started by OMP

First match wins:

1. **Supervised.** A process in `omp ps --all --json` with a live PID whose daemon is not in a terminal state (`exited` or `failed`). Its `owner` is the Agent Session. A daemon in a terminal state no longer runs, so an unrelated process that now holds its recorded PID is never attributed to it. A daemon that is an OMP worker (`omp __omp_worker_*`) is internal instead: it has no session and stopping it breaks OMP. The daemon spec files are never read because they hold environment snapshots.
2. **Tagged.** A process whose environment carries `OMP_PLUGINS_SESSION`. Every bash tool command is prefixed with `export OMP_PLUGINS_SESSION='<session id>'; `, so servers started with `&` or `nohup` stay attributed after OMP exits. Only the value of this one variable is read; no other environment value is stored, shown or logged. Of the processes in one tagged tree, only the root and port holders are listed.
3. **OMP internal.** Worker processes and the daemon broker. View-only.
4. **Unknown origin.** Anything else with a listening TCP port. View-only. Processes started before this feature was installed land here.

Killability is a table keyed by that origin, in code, never a flag on a row.

### Session ended

OMP keeps `~/.omp/run/session-owners/<session id>.lock` open for every live Agent Session. The files are empty (no PID inside) and stay behind after exit. A session is live when it is the current session, or when its lock file exists and a process holds it open (`lsof -F pn +d ~/.omp/run/session-owners` lists the holders). Every other session is ended, including one with no lock file, and a home where no session ever created the directory has no live session but the current one. The monitor says the locks are unreadable, and marks nothing ended for a session that has a lock file, only when lsof cannot see the lock the current session holds, or lsof is missing while lock files exist. A supervised process with no owner (for example the browser tool's Chromium) counts as ended only when the broker of its project is no longer running.

A process whose session has ended is a Leftover Process.

### Kept Process and Stop Candidate

- **Kept Process.** A supervised process whose `omp ps` entry has `persist: true` or `detached: true`. It was started to outlive its session, so ending the session does not make it something to stop. A tagged process is never kept.
- **Stop Candidate.** A killable (supervised or tagged) Leftover Process that is not a Kept Process. It needs no port and no waiting period: the session has ended, so it qualifies. OMP internals and unknown-origin processes are view-only and are never Stop Candidates.

To keep a process, start it as a service in persist mode (or detached) so `omp ps` lists it that way. A plain `&` or `nohup` process from the bash tool is tagged, so it is a Stop Candidate once its session ends.

## Segment

Source `process-monitor` shows the number of Stop Candidates holding at least one listening port, rendered from a template. Kept Processes are not counted. Nothing is published at zero. It refreshes at the start of each turn and every 30 s while the agent is idle, and clears on shutdown. Without a Shared Display host it falls back to the native status entry `process-monitor`.

```json
{ "display": { "processMonitor": { "visible": true, "template": "⚠ {count} ports" } } }
```

Edit `~/.config/codesook-omp/config.json` directly; changes apply live. `{count}` is the only token and the template must be one line.

## Session end

- **Switching or starting another session with a UI.** If the previous session still has attributed processes running, a prompt lists them and offers `Close all` or `Keep`. Kept Processes are left out of the list and of `Close all`. After `Close all` is chosen the process list is read once more, and `kill -TERM <pid>` is sent only to a listed process that still runs the same command and is still not a Kept Process. One that has exited, changed its command or become a Kept Process is skipped and named in the error notice. Nothing is asked when the previous session left nothing running or only Kept Processes.
- **Quitting.** There is no UI to ask, so on `session_shutdown` the session id is recorded as an empty file under `~/.local/share/codesook-omp/process-monitor/ended/`. On the next session start the monitor posts a warning for those sessions' Stop Candidates that are still running, then clears the records. Kept Processes are left out of the warning. No prompt is shown during shutdown.

## Platforms

macOS uses `/bin/ps -axwwE` to read the session tag from each process environment. Other platforms have no equivalent single `ps` call, so tagged processes are not attributed there; supervised processes, internals and ports still work, and `/procs` says what it could not tell. Processes of other users whose environment `ps` hides, and hardened system binaries, are shown as unknown when they hold a port.

## Tests

`src/index.test.ts` drives the extension's default export through a fake `pi` whose `exec` answers `omp ps`, `ps`, `lsof` and `kill` from fixtures, with a disposable home directory and injected timers. It never runs the real tools.
