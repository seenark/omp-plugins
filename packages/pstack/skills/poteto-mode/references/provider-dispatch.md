# Dispatching subagents on OMP

Every skill and playbook that spawns work follows this file. It replaces the Upstream provider runner. pstack runs everything through OMP's own `task` tool, so a lane is an OMP agent and its model comes from a model role. There is no external CLI runner: pstack never shells out to another vendor's command-line agent, and a skill that asks for one is wrong.

## How a spawn works

- Call `task` with `agent`, `task` and `solutionSpace`. A `tasks[]` call spawns many at once and takes a shared `context`. Optional fields are `name`, `effort` (`lo`, `med`, `hi`) and, only when task isolation is on, `isolated`.
- There is no `model` field. The model comes from the agent: its frontmatter lists a model role first and, for work lanes, a built-in role second. Never try to pick a model per call, and never switch to a different agent to get a different model.
- `task` returns ids at once and the work runs in the background. Spawn every independent lane in one call, then collect the results with `wait`. Do not poll.
- Lane agents do not spawn agents, choose models or start workflows. Hand each one a self-contained brief with file pointers, not inlined context.
- Ask the user with `ask`, not free text, when a genuine product or preference call has options.

## Work roles

Each work role has a lane agent of the same name. When the user has not set the role, the agent falls back to the built-in role shown.

| Agent | Access | Built-in fallback | Use it to |
| --- | --- | --- | --- |
| `pstack-explore` | read-only | `@smol` | Map code, find files and call paths, investigate evidence |
| `pstack-build` | write | `@task` | Implement one scoped change and run its own checks |
| `pstack-mechanical` | write | `@tiny` | Apply a fully specified edit: rename, codemod, bulk update |
| `pstack-design` | read-only | `@designer` | Propose or critique a design |
| `pstack-judge` | read-only | `@slow` | Merge verdicts into one decision, write judgment and prose |
| `pstack-security` | read-only | `@slow` | Review a change for security flaws |

`poteto-agent` is the delegate for code-writing and helper tasks inside a playbook step. It runs on `pstack-build`, falling back to `@task`, and loads the poteto-mode skill before it works.

A read-only lane cannot write, and that is a hard boundary. A write lane that must run beside other writers needs isolation.

## Panel seats

A panel is the set of configured seats. Panel workflows (interrogate, arena, swarm, architect, how critics) run every configured seat in parallel. A hidden roster note tells the session which seats those are, with each seat's model and vendor. `panel-verdicts.md` in this directory says how to read the roster, dispatch the critics and merge their verdicts.

- There are five seats, `a` to `e`, with model roles `pstack-panel-a` to `pstack-panel-e`. A seat has no built-in fallback. A seat whose role is unset is absent: skip it, do not report an error.
- Each seat has two agents. `pstack-panel-<seat>-critic` is read-only and returns a structured verdict: `approve`, `concerns` or `reject`, with findings that carry severity (`blocker`, `major`, `minor`, `nit`), file, line, claim and evidence. `pstack-panel-<seat>-builder` writes, and runs only with `isolated: true`.
- At most five seats run, and the `maxPanelSize` setting caps it lower (default 5, which adds no cap). A cap keeps the first configured seats in seat order, and the roster is already capped.
- Seats are meant to hold distinct models, ideally from different vendors. `/pstack setup` aims for that and `/pstack doctor` checks it. If two seats resolve to the same model, their agreement is not independent evidence, so say that.
- If every seat that ran resolves to one vendor, the panel's verdict states `diversity reduced: single vendor`. A one-seat panel is single-vendor.
- With no seat configured, a panel workflow cannot run. Tell the user to run `/pstack setup`.

OMP does not skip an unset single-role agent: the child fails with "No model selected" on its first prompt. pstack therefore refuses to spawn the agent of an unset seat. The refusal names the seat and tells you to skip it and continue with the seats that have models. Do not retry the spawn, do not substitute another agent, and do not treat the refusal as a failed run.

## Dropouts

A dropout is a panel run that did not return a verdict from the model the seat names. There are two kinds.

- **Fallback.** OMP moved the seat's run to another model mid-run. pstack records it as a session entry with the seat, the agent, the model it left and the model it ran on. The seat's verdict is real, but it came from a different model than configured. Report the fallback beside the verdict. If the new model matches another seat's, treat the two as one opinion.
- **No output.** A seat's run failed or returned nothing. Proceed with the remaining seats, and name the seat and the reason in the report. A missing verdict is a gap, not an approval.

Never hide a dropout, and never rerun a seat on a different model to cover for it.

## Isolation

Write lanes that run in parallel, arena and swarm candidates and panel builders, each need their own worktree. Spawn them with `isolated: true`.

- `isolated` exists only when `task.isolation.enabled` is on. It is off by default. pstack never turns it on silently: `/pstack setup` offers to enable it and asks for explicit confirmation, and `/pstack doctor` reports whether it is on.
- If the `task` schema has no `isolated` field, do not fan out writers into the shared checkout. Tell the user isolation is off and name `/pstack setup`. Read-only lanes still run.
- One writer per worktree or branch. OMP captures an isolated run's changes as a patch or a task branch. While `task.isolation.apply` is on, which is the default, OMP lands them in this checkout when the run ends. That suits one writer. Candidates that must stay apart, such as arena's, need it off, so that each candidate stays an artifact to compare and graft from. Brief a writer whose result must outlive the session to commit and push it.

## Effort

Choose `effort` for the job, not the lane: raise it one step for the hardest or subtlest work, lower it for routine work. Leave it unset when the task schema offers no `effort` field. A lane's role fixes its model. A different model needs a different role, which only `/pstack setup` changes.
