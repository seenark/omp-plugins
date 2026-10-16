---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
disable-model-invocation: true
---

# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

Every spawn is a read-only `task`. Explorers are `pstack-explore` agents, every explainer is a `pstack-judge` agent, and critics are the `pstack-panel-<seat>-critic` agents of the configured panel seats. The lane's model role sets the model, so there is no `model` to set (see `../poteto-mode/references/provider-dispatch.md`). Pick each subagent's `effort` for the job, per the Subagents section of the **poteto-mode** skill.

## 1. Assess complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. Spawn one explainer that explores and explains in one pass, built from `references/explainer-prompt.md` without the explorer-findings section. Go to step 5.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): go to step 2.

When in doubt, take the simple path.

## 2. Explore (complex only)

Decompose the question into 2 to 4 angles, each a distinct slice of the subsystem. Spawn all explorers in a single message, each with `references/explorer-prompt.md` and its angle filled in.

## 3. Synthesize (complex only)

Once all explorers have returned, spawn one explainer with `references/explainer-prompt.md` and every explorer's findings filled in.

## 4. Critique (complex only, when a panel exists)

Run this step only when the roster, the hidden note of configured panel seats, lists at least one seat. With none, skip it without comment: **how** needs no panel. Spawn one critic per roster seat in a single `task` call (the roster is already capped by `maxPanelSize`; see `../poteto-mode/references/panel-verdicts.md`). Each gets the explainer's output, the question and the explorers' findings by path, and one job: check every claim of the explanation against the code and report each one that is wrong, unsupported or missing something a reader needs. Each critic yields a structured verdict, with a finding's `claim` quoting the faulty statement and its `evidence` naming the code that contradicts it.

Merge the verdicts as `panel-verdicts.md` prescribes. Findings that two or more seats raised independently, and any `blocker` or `major` finding, go back to one `pstack-judge` explainer to fix. It checks each against the code first and rejects a finding the code does not bear out. Skip the revision when the panel found nothing. Never rerun a seat that dropped out.

## 5. Present

Present the explainer's output, revised after the critique if there was one. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it. When the explanation went through a critique, add one line naming the seats' models and carrying the merge's notes word for word, such as `diversity reduced: single vendor`.

## Output format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
