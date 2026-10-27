# Beads for OMP

Optional, independently installable Beads integration for [oh-my-pi](https://github.com/can1357/oh-my-pi). Requires the installed `bd` CLI. Detects usable existing Beads databases, shows how many issues are ready and open, lists them live with `/beads tasks`, supports explicit initialization, and sets up the Matt Pocock Workflow with `/use-matt-pocock-workflow`. It does not require CodeGraph or an active Shared Display host.

## Install

```sh
omp plugin install 'github:seenark/omp-plugins[beads]'
# Or install from a checkout after bun install:
omp plugin install "$PWD/packages/beads"
```

The package depends on `@codesook/omp-shared-display` 1.5.1 or newer for its client and settings contracts. Installing that dependency does not activate its display host. Beads is off by default in the root package's optional feature selection; standalone installation loads only the Beads extension.

## Commands

```text
/beads [init|status|tasks|auto|off]
/use-matt-pocock-workflow
```

`/use-matt-pocock-workflow` is a separate command; see [Matt Pocock Workflow](#matt-pocock-workflow).

Bare `/beads`: Tab after the command name inserts a trailing space and shows existing action suggestions. Choosing an action inserts command text only; press Enter to execute it. Enter on the bare command opens the native description-bearing action menu. Esc dismisses that menu without action. Each description explains whether the choice acts immediately or leads to initialization choices. Actions are Show status, Show tasks, Initialize project workspace, Enable project guidance, and Disable project guidance. Without interactive UI, bare `/beads` prints explicit command help and performs no action. Complete explicit commands keep their existing behavior.

`status` is read-only. Its focused overlay opens with `Loading…`, shows the inspection result or error, and closes with Enter/Esc. It works even when persistent status is hidden. Without interactive UI, status is reported as text.

`tasks` is read-only. Its focused overlay lists open issues in three groups: **In progress**, **Ready** (open with no open blocker, as `bd ready` reports), and **Blocked** (every other open issue, including those with status `blocked`). Rows are sorted by priority, then most recently updated, and show the id, `P<priority>`, the title, and the first non-empty line of the description, truncated to the terminal width. Up and Down scroll a list longer than the screen. Enter or Esc closes it without capturing prompt input. The list re-queries `bd` whenever Beads writes data while it is open. An empty project shows `No open issues.`; an uninitialized, missing, suppressed, or failing Beads shows why there is no list. Without interactive UI, `/beads tasks` prints the same grouped list as plain text.

`auto` and `off` explicitly write only Beads project policy. They do not change OMP plugin lifecycle state. Initialization never changes global or project policy: an off project remains off.

### Explicit initialization

`/beads init` first asks native Beads discovery and a read-only database query whether a usable Tool Workspace already exists. It reuses that workspace without reinitializing data, replacing history, changing hooks, or asking setup choices. Existing partial data or a backend/inspection/configuration error is not permission to initialize over it; repair the reported problem with `bd` first.

For a new workspace, interactive OMP offers **Standard/team** first, then **Stealth (personal, no Git hooks)**. Both descriptions say that another hooks choice follows; standard mode warns that native initialization may make a Git commit. The next selector starts with **No hooks**; standard mode also offers explicit installation of supported Git hooks. Each hook description explains that selection approves initialization now, with or without native hooks. Stealth follows native restrictions and offers only no hooks. Esc in either selector cancels the entire operation without initialization or data, hook, policy, or agent-file writes. Ready workspaces are reused without these selectors. Non-interactive hosts must use the native CLI directly rather than silently approving choices.

The plugin invokes native initialization with `--skip-agents --non-interactive --sandbox --init-if-missing`, adds `--stealth` only when chosen, and uses `--skip-hooks` unless supported hooks were explicitly approved. It never sets up Claude, Codex, Cursor, or other agents. Native standard defaults apply; there is no role wizard, prerequisite installer, server provisioning, MCP setup, destructive reinitialization, or automatic remote push/sync.

New data belongs to the nearest Git working tree, or the operating directory outside Git. Native Beads normally initializes a linked worktree's main tree instead. For new linked-worktree initialization only, the plugin scopes `BEADS_DIR` to the Integration Project's `.beads` for that one child command. It never changes the parent environment. Readiness afterward requires ordinary native discovery and a successful database query without that override. Usable existing shared, ancestor, redirected, or environment-selected workspaces remain native and are reused first. An unresolved `BEADS_DIR` or `BEADS_DB` override must be repaired or unset; it is never ignored or overwritten.

Project comparisons use physical directory identity. Directory aliases such as macOS `/var` and `/private/var` remain the same project when native initialization creates a Git repository.

**Git safety:** Beads 1.3.1 standard initialization creates a native Git commit. Even with `--skip-agents`, it stages existing agent/setup files and commits the entire index. No supported generic Git-commit opt-out was found. Standard initialization therefore refuses preexisting staged entries or dirty/untracked setup files (`.claude/settings.json`, `.agents`, `.codex`, `.cursor`, `.gitignore`, and root Markdown). Root Markdown is a conservative guard for globally configured `agents.file`, which cannot be queried natively before a database exists. Git inspection treats those filenames literally and does not refresh the index. Commit or unstage the reported changes as appropriate, or explicitly choose personal stealth mode; the plugin never manipulates your index to bypass this guard. In non-Git directories, existing setup/Markdown files require explicit Git preparation before standard init, because native Beads otherwise creates Git and commits them.

Approved hooks use native installation and migration, which may set `core.hooksPath` to `.beads/hooks`. Default no-hooks initialization leaves existing hooks unchanged. Native remote-history safeguards and adoption remain intact; refusals are reported without force/discard flags. After native completion, the plugin refreshes and reports actual workspace/database readiness and policy, not just exit code zero, and retains native failure diagnostics. Native `bd` startup can create its own machine/config defaults even for read-only inspection; the plugin does not write Codesook configuration during discovery or initialization.

## Matt Pocock Workflow

```text
/use-matt-pocock-workflow
```

The command prepares the project for the [Matt Pocock engineering skills](https://github.com/mattpocock/skills) with Beads as the issue tracker. It needs the `setup-matt-pocock-skills` skill. Install it with:

```sh
npx skills@latest add mattpocock/skills
```

The command looks for the skill before it changes anything. OMP skill discovery roots are searched: the project's `.omp/skills`, `.agents/skills`, `.agent/skills` and `.claude/skills` at every ancestor of the working directory below your home, then the same user-level roots under your home, plus `PI_CODING_AGENT_DIR/skills` and `CLAUDE_CONFIG_DIR/skills` when set. Without the skill the command reports the install command and stops.

With the skill present, the command runs the same initialization as `/beads init`, fixed to a team (standard) workspace:

- A ready workspace, team or stealth, is reused. Data and hooks stay unchanged and no choice is shown.
- When no usable workspace exists, the mode choice is skipped and only the hooks choice is offered, with the same Git-commit warnings and safety refusals as `/beads init`. Esc at the hooks choice stops the command without changes.
- Partial data, backend errors and unsafe Git state stop the command with the same message `/beads init` shows. Nothing is handed to the agent.

When the workspace is ready, the command sends the agent one message that points at the setup skill and answers its questions in advance:

- Issue tracker: Other, Beads (`bd`). The agent seeds `docs/agents/issue-tracker.md` from the template shipped in this package and adapts it only where the repository requires.
- Triage labels: the five defaults, unchanged.
- Domain docs: single-context.
- Instructions file: `AGENTS.md` always, created when missing. `CLAUDE.md` is never edited.

The setup skill keeps its draft step. The agent shows one draft and waits for one confirmation before it writes files. The message also tells it not to create or modify Beads issues.

The seed template is `templates/issue-tracker-beads.md`. It tells the other engineering skills how to use Beads as the tracker:

- The `bd` command for each operation: create, read, list, parent and child issues, update, comment, label, claim, close, and reject as out of scope.
- What "publish to the issue tracker" and "fetch the relevant ticket" mean in Beads terms.
- Wayfinding operations for `/wayfinder`: a map epic with child tickets, native blockers, the frontier query, claim and resolve.
- Dolt as the source of truth, JSONL as a passive export, and the rule that Git commits, pushes and Dolt remote sync need explicit authority.

The command changes no Beads policy. Initialization still preserves `auto` or `off`, the project guidance in [Policy and visibility](#policy-and-visibility) applies unchanged, and availability still does not authorize issue operations. The command never runs a write-capable `bd` command other than the native initialization it shares with `/beads init`.

## Discovery and readiness

The **Integration Project** is the nearest Git working tree, or the current directory outside Git. It owns shared policy. The **Tool Workspace** is selected by native Beads discovery and may differ: ancestor lookup, environment overrides, redirects, and shared worktree databases remain native CLI behavior. Detailed status identifies both scopes and the database location.

Git must successfully inspect project scope. Missing Git, permission failures, and unsafe ownership produce actionable errors and disable plugin guidance rather than bypassing shared policy. Only Git's confirmed non-repository result permits the current-directory fallback.

If project scope cannot be resolved, valid global visibility still applies to error display. `always` shows the error; `never` hides persistent display but keeps read-only status available. Invalid global configuration is preserved and uses the display default without granting permission. No guessed project settings are read.

Detailed scope-error status reports the Integration Project and policy as unresolved, with guidance disabled, and identifies the operating directory separately. It does not misclassify valid global configuration as invalid or present the operating directory as a resolved project root.

Readiness requires the CLI, successful workspace discovery, and successful database access. A `.beads` directory or location result alone is insufficient. Status distinguishes uninitialized workspaces, missing prerequisites, database/inspection/configuration errors, readiness, and policy suppression. External initialization becomes visible on the next refresh without setup or generated project files.

## Policy and visibility

The unified `/omp-plugins` settings dialog stages both global defaults and project overrides:

- `behavior.beads.policy`: `auto` (default) or `off`.
- `display.beads.visibility`: `ready` (default), `always`, or `never`.

Global settings live in `~/.config/codesook-omp/config.json`. Project overrides use `<Integration Project>/.omp/codesook-omp.json` with the same `version: 1`, `display`, and `behavior` envelope. Project values win; selecting `inherit` removes an override. Apply saves staged changes; Cancel and Reload do not write them. Invalid configuration reports an actionable error, preserves its bytes, and disables plugin guidance. Unrelated configuration and CodeGraph settings remain unchanged.

`ready` displays only permitted ready status. `always` displays all states, including suppression and errors. `never` hides persistent status only; it does not disable guidance or read-only inspection. When Shared Display is active, Beads publishes one Status Segment and clears its native footer. Otherwise it uses the native footer, never both. Persisted legacy source orders retain their order and append the Beads source.

## On-demand workflow

Permitted ready workspaces append runtime instructions while preserving prior system-prompt entries. Availability is **not consent** to create, update, claim, close, or otherwise operate on issues. Use Beads only after an explicit user request, within that request's scope, through the installed CLI and machine-readable output where appropriate. Ordinary unrelated work does not gain automatic task tracking.

`off` suppresses only this plugin's guidance. It does not remove data, prohibit independent CLI access, modify existing repository instructions, or affect CodeGraph. Existing repository Beads obligations still apply independently.

Refresh occurs on startup, before turns, plugin commands, settings changes, session/project switches, and when Beads writes data (below). There is no timer polling; old workspace guidance is not retained when the project changes.

## Issue counts and live refresh

For a Ready Integration with at least one open issue, the Status Segment shows counts instead of the state word, for example `Beads: 5 ready · 12 open`. Here `ready` counts Ready Issues only. **Open** means every status that is not `closed` and not `deferred`, so in-progress and blocked issues count and deliberately postponed ones do not. With no open issues, and in every non-ready state, the segment keeps the integration state text (`Beads: ready`, `Beads: uninitialized`, `Beads: suppressed`, and so on). Visibility and project overrides apply to both forms unchanged.

Change the wording with `display.beads.template` in the root config. Tokens are `{ready}`, `{open}` and `{inProgress}`; the default is `Beads: {ready} ready · {open} open`. A template that is empty, not a string, or spans several lines falls back to the default. The key is global only and is edited in the config file. `/omp-plugins` Apply keeps it untouched.

Counts come from one read-only `bd status --json --no-activity --readonly --sandbox` per refresh (after `bd where`), the same two spawns inspection already made. `open` is `total_issues - closed_issues - deferred_issues`, `ready` is `ready_issues`, and `inProgress` is `in_progress_issues`. Pinned issues are counted as open by `bd status` but hidden from `bd list`, so a project that uses pinned issues can show a segment count one higher per pinned issue than the task list.

For a Ready Integration the extension watches the Tool Workspace directory (the path `bd where` reports) and reacts only to events for `last-touched` and `export-state.json`. Beads replaces those files on every write and never on a read, so an idle session costs nothing. Events are debounced into one refresh that keeps showing the previous counts while `bd` answers. The watch is dropped on session shutdown, on project switch, and whenever the integration is not ready. The plugin never issues a write-capable `bd` command.
