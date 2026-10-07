# Issue tracker: Beads

Repository issues and specs live in Beads. Use the `bd` CLI, not GitHub Issues or local markdown tickets, for durable task tracking.

## Workspace and policy

- Run commands from this repository. `bd where --json` resolves the active workspace, including redirects; use full Beads issue IDs returned by the CLI.
- Run `bd prime` when workflow context is missing. Follow the repository's existing Beads instructions and conservative Git policy.
- The On-demand Beads Workflow glossary entry describes the planned optional OMP integration. It does not override this repository's Beads task-tracking policy.
- Dolt is the issue source of truth. JSONL is a passive export; use the CLI rather than editing database files or exports.
- Git commits, pushes, and Dolt remote sync require explicit authority. Setup does not authorize them or reinitialize the workspace.
- Tracker-specific examples in skills, including `gh` commands, must be translated to the Beads operations below.

## Issue operations

Use `--json` when parsing command output.

- **Find ready work:** `bd ready --json`. For agent-ready triaged work, use `bd ready --label ready-for-agent --unassigned --limit 0 --json`.
- **List open issues:** `bd list --status=open --json`; add `--label <label>` when the skill requests a label filter.
- **Read an issue:** `bd show <id> --json` and `bd comments <id> --json`.
- **Publish an issue or spec:** `bd create --title "..." --description "..." --type task --priority 2 --json`. Use `feature`, `bug`, or `epic` when appropriate; put the requested spec in the description. For a long body, use `--body-file <file>`.
- **Update issue text:** `bd update <id> --description "..."`; preserve unrelated existing content.
- **Comment or post an agent brief:** `bd comments add <id> "..."`.
- **Apply a label:** `bd label add <id> <label>`.
- **Remove a label:** `bd label remove <id> <label>`.
- **Claim atomically:** `bd update <id> --claim`. A failed claim is not permission to take another actor's work.
- **Close completed work:** `bd close <id> --reason "..."`.
- **Reject as out of scope:** apply `wontfix`, explain the reason in a comment, then close the issue. Preserve the issue record.

Triage role labels are defined in `triage-labels.md`. They are separate from native issue status and dependencies: a `ready-for-agent` label does not bypass active blockers. Remove superseded triage-state labels when changing the role.

## Wayfinding operations

Use native Beads hierarchy and dependencies rather than copying a GitHub issue model.

- **Map:** create an epic with the map body and `--labels wayfinder:map`.
- **Child ticket:** create a task with `--parent <map-id> --no-inherit-labels --labels wayfinder:<type>`. The type label is `research`, `prototype`, `grilling`, or `task`; keep `wayfinder:map` on the map only.
- **Read children:** `bd children <map-id> --json`, which includes closed children.
- **Blocking:** `bd dep add <blocked-id> <blocker-id>` means the first issue depends on the second. Use native blockers, not description-only dependency lists.
- **Frontier:** intersect direct children from `bd children <map-id> --json` with `bd ready --parent <map-id> --unassigned --limit 0 --json`. Choose the first eligible direct child in the map's recorded order, not CLI priority order.
- **Claim:** `bd update <child-id> --claim`.
- **Resolve:** comment with the answer, close the child, and update the map's Decisions-so-far text with the gist and full child ID. Preserve other map content.
