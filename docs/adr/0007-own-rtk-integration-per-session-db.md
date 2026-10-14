---
status: accepted
---
# Own RTK Integration with Per-Session Databases

The `rtk` package owns the whole RTK integration: it rewrites bash commands through `rtk rewrite`, keeps RTK's history and recall databases in a separate directory for each Agent Session, and publishes RTK Savings to the Shared Display. It replaces the third-party `pi-rtk-optimizer` plugin.

RTK's own tracking database has no session column and no session tag, so per-session savings can only be exact if each Agent Session writes to its own database. The rewritten command carries `RTK_DB_PATH` and `RTK_RECALL_DB` for its session. Subagents run in the same process with their own session ids, so the plugin does not change `process.env`. Session directories older than the configured retention (default 7 days) are deleted when a session starts.

The plugin rewrites only commands where RTK's filtering is known to be safe. It skips pipes, multi-line commands, read-like commands, `git diff`/`git show`, test runners whose failures RTK is known to drop, and interactive or long-running commands (see `docs/research/coding-agent-output-compression-pitfalls.md`). Headroom never compresses a result that RTK already filtered, so no output is cut twice.

## Considered Options

- **Keep `pi-rtk-optimizer` and add a display-only producer** — rejected. The plugin writes its tracking database to a shared `TMPDIR` path the OS may delete. It also cuts output to 12,000 characters, which cannot be undone, before Headroom sees it. Per-session data would depend on one of its internal environment checks.
- **Fork `pi-rtk-optimizer`** — rejected. Most of its code is an output compactor this setup no longer wants; the parts needed are a rewrite call, a database path and a display.
- **One shared database with attribution by time window** — rejected. Two sessions in the same project that run commands at the same moment cannot be told apart.
