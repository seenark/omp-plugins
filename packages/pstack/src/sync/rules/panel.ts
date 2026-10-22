import type { Group } from "../types.ts";

/**
 * The multi-model skills run on the configured panel seats. The edits are
 * hand-written against the output of the dispatch rules, so each one is a patched fork: an Upstream change
 * near an edit surfaces as a merge conflict instead of silently dropping it.
 */
const SINCE = "0.15.25";

const patched = (path: string, reason: string) => ({ path, kind: "patched", reason, since: SINCE }) as const;

export const panel: Group = {
	name: "panel",
	forks: [
		patched(
			"skills/interrogate/SKILL.md",
			"Reviewers are the critics of the roster's panel seats. Their verdicts are merged as the panel-verdicts reference says (`judge_batch` dedupe, then a `pstack-judge` synthesis), and the verdict names every seat's model and carries the single-vendor note.",
		),
		patched(
			"skills/interrogate/references/reviewer-prompt.md",
			"A seat critic yields the structured verdict (`blocker`, `major`, `minor`, `nit`, with file, line, claim and evidence) instead of a prose findings list, so the merge can read it.",
		),
		patched(
			"skills/arena/SKILL.md",
			"Candidates are isolated builders of the roster's seats. OMP lands an isolated run in the checkout unless `task.isolation.apply` is off, so the skill checks it first and treats each captured patch or task branch as the candidate to compare and graft from.",
		),
		patched(
			"skills/swarm/SKILL.md",
			"A model race takes its arms from the roster's seats (builders to write, critics to read), skips unset seats, and names the single-vendor note.",
		),
		patched(
			"skills/architect/SKILL.md",
			"Runners are the roster's seat builders, so they can write sketch files; the read-only `pstack-design` lane screens candidates and takes no runner's place.",
		),
		patched(
			"skills/how/SKILL.md",
			"A complex explanation is checked by the roster's seat critics before it is presented, and the step is skipped when no seat is configured. Upstream's `how` has no critics.",
		),
		{
			path: "skills/poteto-mode/references/panel-verdicts.md",
			kind: "rewritten",
			reason:
				"Upstream has no panel and no verdict merge. This reference says how to read the seat roster, dispatch the critics and merge their structured verdicts on OMP: `judge_batch` dedupe through the package's verdict helper, `pstack-judge` synthesis, the single-vendor note and the dropout notes. Upstream at this pin has no such file, so it is ours alone.",
			since: SINCE,
		},
	],
};
