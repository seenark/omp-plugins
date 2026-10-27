# Shipping a change

Runs only under explicit user authority to commit (`AGENTS.md`). `main` is protected: every change lands through a merged pull request.

## Steps

1. **Bump versions** in the same commit as the change. Semver: patch fix, minor feature, major breaking.
   - Root `package.json` `version`: every commit, whichever package changed.
   - `packages/<name>/package.json` `version`: every package the commit touches.

   `check:versions` enforces only the `packages/*` bumps and exempts test-only changes; the root bump is on you. Done when the root and every touched `package.json` show a higher `version` than `main`.
2. **Verify.** `bun run verify` passes locally. It is the one gate: the lefthook pre-push hook runs it after the Beads hook, and CI runs it as the `verify` check.
3. **Push a branch.** Commit on a feature branch. A fresh clone needs `bun run hooks:install` once. Every push runs the pre-push hook; `--no-verify` is off-limits.
4. **Open the PR** with `gh pr create`, using the `pr` skill for the body.
5. **Merge** once `gh pr checks <number> --watch` shows `verify` passing: `gh pr merge <number> --merge --delete-branch`. The repo keeps merge commits.

Done when the PR is merged and local `main` is pulled to the merge commit.

## Releasing pstack

The `packages/pstack/package.json` bump is the release. After merge the Release workflow pushes the built plugin to `github:seenark/omp-pstack` and tags it `v<version>`.
