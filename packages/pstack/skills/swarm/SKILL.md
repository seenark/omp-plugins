---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /skill:swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
4. Pick the worker lane: `pstack-build` when a worker writes or runs commands, `pstack-explore` when it only reads. Workers on one lane share one model, so race the roster's seats when a model race is the point: `pstack-panel-<seat>-builder` for writing arms, `pstack-panel-<seat>-critic` for read-only arms that return a structured verdict. The roster is the hidden note of configured panel seats, already capped by `maxPanelSize` (see `../poteto-mode/references/panel-verdicts.md`). A seat with no model is skipped, not an error. Name each arm's agent and seat model up front (see `../poteto-mode/references/provider-dispatch.md`). Pick each subagent's lane and `effort` for the job, per the Subagents section of the **poteto-mode** skill.
5. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Spawn all N workers in one `task` call, each with `agent` set to the step 4 lane and `isolated: true`, so each runs as a background task in its own worktree. Run a worker without isolation only when it needs state that lives in this checkout, such as uncommitted files or a service running here. If the `task` schema has no `isolated` field, isolation is off: read the Isolation section of `../poteto-mode/references/provider-dispatch.md` and do not fan out writers.

When a worker must start from a non-default branch, name the branch and its SHA in the brief and have the worker check it out inside its worktree.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. Drop a result that does not record the SHAs and method its brief names, and respawn that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used. A model race names the model each arm ran on, and states `diversity reduced: single vendor` when every arm's seat is one vendor.
