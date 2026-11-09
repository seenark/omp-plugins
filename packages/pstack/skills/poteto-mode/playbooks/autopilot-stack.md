### Autopilot-stack

Run the Autopilot-full playbook, but do not merge.

1. **In place of step 5, stop at verified.** Stop when each PR is verified and green at its current head, then hand the PRs to the operator. After the handoff, nobody pushes without the operator's go. Every loop tick prompt names this file, so each tick sees the no-merge rule.
2. **Stack a PR only when it builds on another PR.** This is the one exception to step 3. Base the PR on the other PR's branch in place of trunk, per **Size and stacks** in `playbooks/opening-a-pr.md`. In place of step 2's rebase onto trunk, each PR rebases onto its parent PR's branch, and the stack root rebases onto trunk. A new head on the lower PR restacks the PRs above it, and a PR whose `git patch-id` the restack leaves unchanged keeps its verdict.

**On OMP.** A stacked PR is a plain base-chained PR driven with `gh`. No stack-aware restack, submit, or merge command exists, so each rebase, retarget, and push in step 2 is a separate `git` or `gh` call that you make link by link, bottom-up, with `git push --force-with-lease`. Expect more calls and more room for a half-moved chain than with a stacking tool. After every move, confirm with `gh pr view <pr> --json baseRefName,headRefOid` that the link has the base and head you intended before you touch the next one.

**Reply:** list each PR with its verdict, in place of what merged.
