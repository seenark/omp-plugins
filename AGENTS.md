# Agent Instructions

`omp-plugins`: Bun monorepo of oh-my-pi plugins (`packages/*`). Vocabulary in `CONTEXT.md`. This file is a router: read the doc a task names before acting on it.

## Always

- Beads (`bd`) is the only task list and memory store: track work in issues, keep persistent knowledge in `bd remember`.
- Commit, push, and Dolt sync only on explicit user authority. Otherwise report changed files, validation, and proposed commands.
- Use non-interactive flags: `cp -f`, `mv -f`, `rm -f`, `rm -rf`, `apt-get -y`, `ssh -o BatchMode=yes`. Aliased `-i` prompts hang the shell.

## Pointers

- **Committing, version bumps, PRs, releasing pstack** → `docs/agents/shipping.md` before the first `git commit`.
- **Issues, specs, tickets, `bd` commands, session close** → `docs/agents/issue-tracker.md`. Run `bd prime` when Beads context is missing.
- **Triage, role labels** → `docs/agents/triage-labels.md`.
- **Exploring the codebase, domain terms, ADRs, oh-my-pi API or source** → `docs/agents/domain.md` first.
- **Reviewing a diff** → `CODING_STANDARDS.md`.
- **Updating Caveman, Ponytail, pstack, the Headroom server, or the RTK binary upstream** → `docs/agents/upstream-sync.md`.
- **Installing or setting up these plugins for a user** → `docs/agents/setup.md`. Ask before every install, removal, or Headroom provisioning step.
