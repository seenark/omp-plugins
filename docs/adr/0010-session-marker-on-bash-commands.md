---
status: accepted
---
# Tag Bash Commands with the Agent Session for Leftover Process Attribution

The `process-monitor` feature puts `export OMP_PLUGINS_SESSION='<session id>'; ` in front of every bash tool command an Agent Session runs. Every process started by that command inherits the variable, so `/procs` can attribute a Leftover Process to its Agent Session after omp has exited and the process has been reparented. Only processes started after the feature is installed carry the marker. Older ones are shown as unknown and cannot be killed from `/procs`.

## Mechanism

The bash tool input has no environment field (its schema is `command`, `timeout`, `cwd`, `pty`, plus `async`, `name` and `ready` when enabled), so the marker travels in the command text. The `tool_call` handler reads the id from the calling agent's own session manager, so in-process subagents get their own ids, and never writes `process.env`. An existing marker is replaced, not stacked. A session id outside `[A-Za-z0-9._-]` is left untagged rather than quoted. `/procs` reads the value back from the process table; it keeps only this one variable and never stores or shows any other environment value.

omp records an `owner` session only for processes its daemon broker supervises (`hub` launches, the browser tool's Chromium, LSP). Servers the agent starts from bash with `&` or `nohup` leave no trace. omp sets no session variable on bash children, and process ancestry is lost once omp exits. Those servers are the ones that keep ports reserved.

## Considered Options

- **Broker records only** (`omp ps --all --json`, `~/.omp/run/daemons/**/meta.json`). Rejected as the only source: it misses bash-started servers.
- **Reuse RTK's `RTK_DB_PATH`**, which already carries the session directory. Rejected: RTK skips many commands, including long-running ones.
- **Process ancestry while omp is alive.** Rejected: ancestry is gone exactly when the process becomes a leftover.

## Consequences

- The marker is visible in the commands omp shows and in `omp ps`.
- Command rewriting must compose with RTK's rewrite in either handler order. If the marker runs second it ends up outermost. If it runs first, RTK's guards ignore the marker prefix when they judge the command, and `rtk rewrite` keeps the prefix in its output.
- The marker is a shell `export`, so it also stays set for later commands in the same persistent shell; those commands run under the same Agent Session, so the value is still correct.
- Stopping the feature does not remove the marker from processes that are already running.
