# Agent Instructions

`omp-plugins`: Bun monorepo of oh-my-pi plugins (`packages/*`). Vocabulary in `GLOSSARY.md` and `CONTEXT.md`. This file is a router: read the doc a task names before acting on it.

## Always

- Track work in Beads (`bd`); no markdown TODO lists, no `MEMORY.md` files. Persistent knowledge goes in `bd remember`.
- Bump `version` in the `package.json` of every `packages/*` package the change touches before committing (semver: patch fix, minor feature, major breaking). Include the bump in the same commit.
- Commit, push, and Dolt sync only on explicit user authority. Otherwise report changed files, validation, and proposed commands.
- Use non-interactive flags: `cp -f`, `mv -f`, `rm -f`, `rm -rf`, `apt-get -y`, `ssh -o BatchMode=yes`. Aliased `-i` prompts hang the shell.
- Verify with `bun run verify` (scripts in root `package.json`).

## Pointers

- **Issues, specs, tickets, `bd` commands, session close** → `docs/agents/issue-tracker.md`. Run `bd prime` when Beads context is missing.
- **Triage, role labels** → `docs/agents/triage-labels.md`.
- **Exploring the codebase, domain terms, ADRs** → `docs/agents/domain.md` first.
- **Updating Caveman, Ponytail, the Headroom server, or the RTK binary upstream** → `docs/agents/upstream-sync.md`.
- **Installing or setting up these plugins for a user** → `docs/agents/setup.md`. Ask before every install, removal, or Headroom provisioning step.
