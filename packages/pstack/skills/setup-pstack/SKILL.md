---
name: setup-pstack
description: Configure which models pstack uses per role. The `/pstack setup` command does it, and this skill points the user there. Use for "setup-pstack", "configure pstack models", "set up pstack", or changing pstack's model choices.
---

# Setup pstack

pstack's model choices live in the `pstack-*` model roles of the user's OMP config. The `/pstack setup` command is the only thing that writes them. An agent cannot start an extension command, so tell the user to run it.

## What to do

1. Tell the user to run `/pstack setup`. Do not edit their model roles, config file or settings yourself.
2. If they ask what it does, say this:
   - It reads the model registry and offers presets (`claude-only`, `claude-codex`, `lean`). Then it shows a menu per role with what the role does, when pstack uses it and which kind of model suits it.
   - It probes each model it selects with a one-turn call.
   - It writes only `pstack-*` keys in the user's model roles, plus empty fallback chains for the panel seats. It reads the result back and restores the previous values on a mismatch. Running it again is safe.
   - It offers to turn on OMP task isolation, which arena and swarm writers need. Isolation is off by default. pstack never turns it on silently, and setup asks for explicit confirmation first.
3. For a read-only check, `/pstack doctor` reports role coverage, panel rules, skill-name ownership, Instruction Mode suspension wiring, Display Host availability and whether task isolation is on. `/pstack status` shows the run state.

## Roles

| Role | Used for | When unset |
| --- | --- | --- |
| `pstack-explore` | Mapping code | Falls back to `@smol` |
| `pstack-build` | Writing scoped changes | Falls back to `@task` |
| `pstack-mechanical` | Fully specified mechanical edits | Falls back to `@tiny` |
| `pstack-design` | Proposing and critiquing designs | Falls back to `@designer` |
| `pstack-judge` | Merging panel verdicts, judgment and prose | Falls back to `@slow` |
| `pstack-security` | Security review | Falls back to `@slow` |
| `pstack-panel-a` to `pstack-panel-e` | One independent reviewer per seat | The seat is absent and is skipped |

A role the user never set changes nothing for the work roles, because each falls back to a built-in role. A panel seat has no fallback, so a panel runs only on the seats the user configured. `../poteto-mode/references/provider-dispatch.md` explains seats, dropouts and isolation.

## Offer a verification skill (optional)

When setup is done, check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /skill:create-verification-skill." On yes, invoke `/skill:create-verification-skill`. On no, move on without pushing.
