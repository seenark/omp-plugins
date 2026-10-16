---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /skill:arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

Open a todolist with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners from the roster, the hidden note of configured panel seats, already capped by `maxPanelSize` (see `../poteto-mode/references/panel-verdicts.md`). Each runner is the builder agent of one roster seat, `pstack-panel-a-builder` through `pstack-panel-e-builder`, so each candidate runs on its seat's model. A seat with no model is skipped, not an error. With no seat on the roster, stop and tell the user to run `/pstack setup`. Cover multiple design directions by running a seat's builder more than once. Run the same seat N times when the work is generation-bound rather than judgment-sensitive. Pick each subagent's lane and `effort` for the job, per the Subagents section of the **poteto-mode** skill.
4. Make each candidate isolated, per the **separate-before-serializing-shared-state** principle skill. Builders write, so each runs as an isolated `task` and its worktree is its own output location. If the `task` schema has no `isolated` field, isolation is off: tell the user to run `/pstack setup` and do not fan out. OMP lands a finished isolated run in this checkout when `task.isolation.apply` is on, which it is by default, so candidates would pile onto one another. Check it with `omp config get task.isolation.apply`. If it is on, use `ask` to have the user turn it off for the arena (`omp config set task.isolation.apply false`) and do not fan out until it is. With it off, OMP keeps each candidate's captured changes as artifacts and names them in the run's result: a patch file or a task branch. That artifact is the candidate.

## Phase B: Fan out

Spawn all N subagents in one `task` call with `isolated: true`, each with the task, the path to the shared grounding, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected. Tell each builder to report what it changed and how it checked it.

Label every candidate by its seat and the model on the roster (Candidate A, `anthropic/...`). Record where each candidate lives: the patch path or task branch OMP reported. A candidate with no captured changes produced nothing. If a candidate produces no output, proceed with N-1 and note the dropout. If a seat fell back to another model, name the model it ran on.

## Phase C: Cross-judge

After all Phase B candidates complete, spawn one `pstack-judge` lane as the cross-judge. It is read-only. It sees the rubric and the candidates by path label (the patch path or branch of each), scores each criterion, and recommends a base with rationale. It runs in parallel with your reading in Phase D. Don't spawn it while candidates are still writing.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Read it from its artifact (`git apply --check`, then `git apply --include=<path>` for a patch, `git show <branch>` or `git cherry-pick -n <commit>` for a branch), and fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically. Land the base first, graft onto it, and leave candidate artifacts untouched until the synthesis is verified.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict, each graft with its source candidate and the model that built it, what was rejected and why, any convergence or dropouts, and the verification result. When every seat that built a candidate is one vendor, the note states `diversity reduced: single vendor`: the candidates share one lineage's blind spots, so their convergence is weaker evidence.
