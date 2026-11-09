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
			"Adversaries are the builder agents of the roster's panel seats, one per seat, each run as an isolated `task` under arena's isolation checks that receives the scope's uncommitted changes. Upstream's `interrogate reviewers` line and `generalPurpose` map to the roster. With no seat configured the skill stops and points to `/pstack setup`. The report adds the single-vendor note and every named Dropout to Upstream's Intent, Findings and Dropped.",
		),
		patched(
			"skills/arena/SKILL.md",
			"Candidates are isolated builders of the roster's seats. OMP lands an isolated run in the checkout unless `task.isolation.apply` is off, so the skill checks it first and treats each captured patch or task branch as the candidate to compare and graft from. The cross-judge is the critic of the first roster seat whose vendor differs from the session model's vendor, and Phase C skips the judge when no seat qualifies.",
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
