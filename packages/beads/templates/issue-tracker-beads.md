# Issue tracker: Beads

Issues and specs for this repo live in Beads. Use the `bd` CLI for all operations, not GitHub Issues or local markdown tickets.

## Conventions

Run commands from this repository. `bd where --json` resolves the active workspace, including redirects. Use the full issue IDs the CLI returns, and add `--json` when parsing output. Run `bd prime` when workflow context is missing.

- **Create an issue**: `bd create --title "..." --description "..." --type task --priority 2 --json`. Use `feature`, `bug`, or `epic` when appropriate. For a long body, use `--body-file <file>`.
- **Read an issue**: `bd show <id> --json` and `bd comments <id> --json`.
- **List issues**: `bd list --status=open --json`, adding `--label <label>` for a label filter. `bd ready --json` lists issues with no open blockers.
- **Make an issue a child of a parent**: `bd create ... --parent <parent-id>`. Add `--no-inherit-labels` when the child must not copy the parent's labels. Read a parent's children, closed ones included, with `bd children <parent-id> --json`.
- **Update issue text**: `bd update <id> --description "..."`. Preserve unrelated existing content.
- **Comment on an issue**: `bd comments add <id> "..."`
- **Apply / remove labels**: `bd label add <id> <label>` / `bd label remove <id> <label>`
- **Claim**: `bd update <id> --claim`. A failed claim is not permission to take another actor's work.
- **Close**: `bd close <id> --reason "..."`
- **Reject as out of scope**: apply the `wontfix` label, explain the reason in a comment, then close the issue. Preserve the issue record.

Dolt is the issue source of truth and JSONL is a passive export. Use the CLI, not edits to database files or exports. Git commits, pushes, and Dolt remote sync need explicit authority from the user or repository policy. Setup does not grant it and does not reinitialize the workspace.

Tracker-specific examples in skills, including `gh` commands, translate to the operations above. Triage role labels are separate from native issue status and dependencies: a `ready-for-agent` label does not bypass active blockers.

## When a skill says "publish to the issue tracker"

Create a Beads issue with **Create an issue** above. Put the requested spec in the description.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above, comments included.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets. Use native Beads hierarchy and dependencies.

- **Map**: an epic labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `bd create --type epic --labels wayfinder:map ...`.
- **Child ticket**: a task linked to the map with `--parent <map-id> --no-inherit-labels --labels wayfinder:<type>`, where `<type>` is `research`, `prototype`, `grilling`, or `task`. Keep `wayfinder:map` on the map only.
- **Blocking**: `bd dep add <blocked-id> <blocker-id>`, meaning the first issue depends on the second. Use native blockers, not description-only lists. A ticket is unblocked when every blocker is closed.
- **Frontier query**: intersect the direct children from `bd children <map-id> --json` with `bd ready --parent <map-id> --unassigned --limit 0 --json`. Choose the first eligible child in the map's recorded order, not CLI priority order.
- **Claim**: `bd update <child-id> --claim`, the session's first write.
- **Resolve**: `bd comments add <child-id> "<answer>"`, then `bd close <child-id> --reason "..."`, then update the map's Decisions-so-far text with the gist and the full child ID. Preserve other map content.
