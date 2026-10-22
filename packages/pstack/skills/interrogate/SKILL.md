---
name: interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Multiple LLM reviewers challenge changes from independent angles."
disable-model-invocation: true
---

# Interrogate

Spawn one reviewer per configured model to adversarially review code changes. The adversarial signal comes from model diversity, not assigned personas. The deliverable is a synthesized verdict. Do NOT auto-apply changes.

## Step 1, Scope

Identify what to review from context:

- If the user points at specific files or a diff, use that.
- If on a feature branch, run `git diff main...HEAD` (or the appropriate base branch) for the full changeset.
- If the user's message references recent work, gather the relevant files.

Package the diff or file contents with any surrounding context files the reviewers need to understand the code.

## Step 2, Intent

Before spawning reviewers, state the intent in one clear paragraph from the user's message, commit messages, the PR description if one exists, and the code. If you're unsure about the intent, ask the user before proceeding.

## Step 3, Spawn Reviewers

Launch all reviewers in a single `task` call, one critic per seat on the roster, labeled Reviewer A for seat A, Reviewer B for seat B, and so on. The roster is the hidden note of configured panel seats, already capped by `maxPanelSize` (see `../poteto-mode/references/panel-verdicts.md`). A seat with no model is skipped, not an error. With no seat configured, stop and tell the user to run `/pstack setup`.

| Subagent | Agent |
|----------|-------|
| Reviewer A | `pstack-panel-a-critic` |
| Reviewer B | `pstack-panel-b-critic` |
| Reviewer C | `pstack-panel-c-critic` |
| Reviewer D | `pstack-panel-d-critic` |
| Reviewer E | `pstack-panel-e-critic` |

Each critic is read-only and returns a structured verdict with findings. Report any seat whose run fell back to another model as a dropout. Never rerun a seat on another model to cover a gap.

Read `references/reviewer-prompt.md` and fill in the same template for every reviewer with the stated intent, the diff or file contents, the rubric from `references/rubric.md`, and the code-quality lens from `references/code-quality-review.md`. Pick each subagent's lane and `effort` for the job, per the Subagents section of the **poteto-mode** skill.

## Step 4, Synthesize

When every critic has settled, merge as `../poteto-mode/references/panel-verdicts.md` prescribes: findings that describe the same issue differently collapse into one, found with `judge_batch` over the candidate pairs, and each keeps the seats that raised it. Findings two or more seats raised independently are the highest signal. Read a lone seat's finding, but weight it accordingly. If one seat flags something and another explicitly says the opposite, that is context for the verdict.

## Step 5, Lead Judgment

Spawn one `pstack-judge` agent as the lead reviewer, a pragmatic senior engineer, not a neutral aggregator. Hand it the merged result, the intent, the diff, and `references/lead-judgment.md` for the full framework. It puts every finding in one of four buckets, with the seat(s) and model(s) that raised it and a one-line rationale. You present its judgment and check that it dropped no finding without a reason.

- **Act on**. Real issues affecting correctness, security, or maintainability given the actual goals. They would block a real PR.
- **Consider**. Legitimate, but you're not sure they outweigh the cost of addressing them now. Worth the user's attention.
- **Noted**. Technically valid but not actionable. Context-dependent, premature optimization, or low-impact at this stage.
- **Dismissed**. Wrong, nitpicky, or missing context, with a brief reason.

## Output Format

### Intent
> [The stated intent paragraph from Step 2]

### Reviewers
- Reviewer [label]: [model name, from the roster], [N findings], [verdict] (one bullet per reviewer; a seat with no verdict says so)

### Act On
[Each: description, which models raised it, why it matters.]

### Consider
[Each: description, which models raised it, the tradeoff.]

### Noted
[Brief list.]

### Dismissed
[Each with a brief rationale.]

### Agreement Map
[Where models agreed and diverged, and what that pattern tells us.]

### Notes
[Every note from the merge, word for word: seats without a verdict, fallbacks, seats that ran one model, and `diversity reduced: single vendor` when every reviewer is one vendor. Write nothing for a note the merge did not return, and never state that one does not apply.]
