import type { Group } from "../types.ts";

/**
 * Ticket omp-plugins-4nv.12: Upstream's `check-plan` script is replaced by the todo guard, which checks a
 * todo list against the active playbook's steps (`src/warnings.ts`).
 */
export const guards: Group = {
	name: "guards",
	exclusions: [
		{
			path: "skills/poteto-mode/scripts/check-plan.{mjs,test.ts}",
			rationale:
				"The todo guard replaces the plan checker: the extension compares a todo list with the active playbook's steps, so the playbooks no longer call a bundled script.",
		},
	],
	rules: [
		{
			id: "guards/plan-skeleton-check",
			rationale:
				"The plan checker is Excluded, so the playbook names the skeleton properties the plan is checked against by hand instead of a script that does not exist.",
			files: "skills/poteto-mode/playbooks/multi-phase-plan.md",
			pattern: "Run `node pstack/skills/poteto-mode/scripts/check-plan.mjs <plan.md>` and fix every line it prints",
			replacement:
				"Check the plan against the skeleton: every heading and sub-block present in the order shown, each Verify block opening with the verification rule, ten lanes in each live block with a screenshot and a pass predicate, and no long dashes, curly quotes, or mid-sentence colons. Fix every gap",
		},
		{
			id: "guards/plan-handback",
			rationale: "The plan check has no script output to post, so the hand-back reports the gaps the manual check found.",
			files: "skills/poteto-mode/playbooks/multi-phase-plan.md",
			pattern: "Post the plan path and the script's output, then stop.",
			replacement: "Post the plan path and the gaps the skeleton check found and fixed, then stop.",
		},
		{
			id: "guards/plan-reply",
			rationale: "The plan check has no script output to post, so the reply reports the gaps the manual check found.",
			files: "skills/poteto-mode/playbooks/multi-phase-plan.md",
			pattern: "and the check script's output.",
			replacement: "and the gaps the skeleton check found and fixed.",
		},
	],
	terms: [
		{
			id: "guards",
			owner: "omp-plugins-4nv.12",
			patterns: {
				"check-plan": /check-plan/,
			},
		},
	],
};
