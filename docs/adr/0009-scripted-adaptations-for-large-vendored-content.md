---
status: accepted
---
# Scripted Adaptations for Large Vendored Content

This extends the Vendored Content process used for Caveman and Ponytail (copy Upstream files at a Pinned Revision, reapply Adaptations listed in the README, update the notices file by hand; see `docs/agents/upstream-sync.md`). That process does not scale to pstack: its Upstream has about a hundred files and moves often, and the Adaptations touch hundreds of lines.

For `packages/pstack`, `skills/` and `agents/` are generated. `bun run sync` fetches Upstream at the Pinned Revision in `upstream.json`, applies the Adaptation table in `src/sync/rules/*.ts` and writes the result. Nothing under those directories is edited by hand. Every rule carries a reason; Excluded paths, skill renames, forks and frontmatter edits are entries in the same table (the engine itself only sets each skill and agent `name` to its path).

A path changed by hand on purpose is a fork entry in the Fork Registry (`path`, `kind`, `reason`, `since`). Sync 3-way merges Upstream changes into `patched` forks, keeps `rewritten` forks and reports any Upstream change to them as a conflict. `bun run verify` runs `sync --check`, which fails on a vendored file that differs from the sync output without a fork entry, on stray files, on conflict markers, and on any remaining Cursor-specific term (a known leftover needs an `allowances` entry with an exact count, which fails once it stops matching). Silent drift from Upstream is impossible, and updating Upstream is a rerun of one command plus a review of its report, which an agent follows from `docs/agents/upstream-sync.md`.

The notices file keeps its role as the single source of truth for the Pinned Revision and the vendored file list: its generated block is rewritten by sync, and text around the block (credit for borrowed ideas) is preserved.

## Considered Options

- **Keep copy-and-reapply by hand** — rejected. Hundreds of edits per update cannot be reviewed reliably, and nothing detects an Adaptation that stopped applying.
- **Fork Upstream into this repo and merge** — rejected. A fork hides which differences are deliberate; the Fork Registry lists them with reasons.
- **Regex substitution table without drift checks** — rejected. A check that matches nothing looks like a pass; shadowed rules, unused allowances and undeclared drift all fail the sync.
- **Point skills at Upstream at install time** — rejected. Installed content must be reproducible at one Pinned Revision and readable offline.
