import type { Group, Rule } from "../types.ts";

/** PR workflows without Graphite or Cursor /loop. */

const TRIAGE = "skills/poteto-mode/references/review-bot-triage.md";

/** Each Upstream Bugbot mention in the triage reference, by the words around it, so the grammar survives. */
const TRIAGE_WORDING: Record<string, string> = {
	"# Bugbot triage": "# Review bot triage",
	"handles Bugbot or review-automation comments": "handles review bot or other review-automation comments",
	"ignore Bugbot by default": "ignore review bots by default",
	"each Bugbot thread": "each review bot thread",
	"the Bugbot comment is only": "the review bot comment is only",
	"usage Bugbot cannot see": "usage a review bot cannot see",
	"Skip when: Bugbot flags": "Skip when: A review bot flags",
	"a later Bugbot reply": "a later review bot reply",
	"Bugbot's logic-bug findings": "the review bot's logic-bug findings",
	"six Bugbot passes": "six review bot passes",
	"and Bugbot claims": "and a review bot claims",
	"eight Bugbot passes": "eight review bot passes",
};

const HEARTBEAT = "an async `bash` job running `sleep 3600` that wakes you when it ends";

function literal(id: string, reason: string, pattern: string, replacement: string, files?: string): Rule {
	return { id: `pr/${id}`, reason, pattern, replacement, ...(files === undefined ? {} : { files }) };
}

export const pr: Group = {
	name: "pr",
	exclusions: [
		{
			path: "skills/poteto-mode/scripts/watch-pr/**",
			reason: "The OMP GitHub tool's run watch and `gh` replace the watcher, so the playbooks no longer call a bundled script.",
		},
	],
	moves: [
		{
			from: "skills/poteto-mode/references/bugbot-triage.md",
			to: TRIAGE,
			reason: "The rubric applies to any review bot, and the Bugbot product name would be a Cursor-only term in its path.",
		},
	],
	rules: [
		{
			id: "pr/scripts-package",
			reason:
				"watch-pr is Excluded and no other script test remains, so the test and typecheck entries would point at missing files and the whole scripts block goes.",
			files: "skills/poteto-mode/scripts/package.json",
			pattern: /\n\s*"scripts": \{\n\s*"test": "bun test watch-pr",\n\s*"typecheck": "tsc --project watch-pr\/tsconfig\.json[^"]*"\n\s*\},/,
			replacement: "",
		},
		{
			id: "pr/drop-graphite-requirement",
			reason: "Graphite is Excluded; `gh` is the forge, so the playbooks stop mentioning the tool they refuse to require.",
			pattern: / Never require (?:Graphite \(`gt`\)|`gt`)\./g,
			replacement: "",
		},
		literal(
			"shipping-merge-match-head",
			"`gh pr merge` takes the head commit the verdict covers, so a push after the verdict makes the merge refuse instead of landing unverified code.",
			"`gh pr merge <pr> --squash`",
			"`gh pr merge <pr> --squash --match-head-commit <verdict-sha>`",
			"skills/poteto-mode/playbooks/shipping.md",
		),
		literal(
			"shipping-auto-match-head",
			"GitHub auto-merge lands whatever head is ready; the head-commit match pins it to the verified head.",
			"because it lands whatever head is ready.",
			"because it lands whatever head is ready. On GitHub also pass `--match-head-commit <verdict-sha>` to `gh pr merge --auto`, so a push after the verdict stops the merge.",
			"skills/poteto-mode/playbooks/shipping.md",
		),
		{
			id: "pr/shipping-watch-run",
			reason: "The queued watcher script and Cursor's `/loop` are replaced by the OMP GitHub tool's run watch or an async bash job, so shipping re-reads the PR whenever a watch returns.",
			files: "skills/poteto-mode/playbooks/shipping.md",
			pattern: /On GitHub, watch the run with `scripts\/watch-pr\/watch-pr --queued-stack` under `\/loop` until it reports `COMPLETE` at the ceiling\. Pass the run's PR numbers, bottom-to-top, in `--stack-prs`, and pass the same list each time you restart the watcher\./,
			replacement:
				"On GitHub, watch the run's checks with the OMP GitHub tool's `run_watch` op or an async `bash` job running `gh pr checks <pr> --watch`, and re-read the current PR with `gh pr view <pr> --json state,mergedAt,baseRefName` each time a watch returns, until the ceiling reads merged.",
		},
		literal(
			"skill-routes-past-other-babysit",
			"OMP has no built-in babysit skill; the routing warning is about any separately installed skill with the same trigger words.",
			"not Cursor's built-in babysit skill.",
			"not a separately installed babysit skill.",
			"skills/poteto-mode/SKILL.md",
		),
		literal(
			"help-other-babysit",
			"OMP has no built-in babysit skill; the failure is a separately installed skill answering the same phrase.",
			"can start Cursor's own skill for the same job instead",
			"can start a separately installed babysit skill for the same job instead",
			"skills/poteto-help/SKILL.md",
		),
		{
			id: "pr/babysit-status",
			reason:
				"The watch-pr script is replaced by `gh`, the OMP GitHub tool's run watch and async bash plus wait, so status and waiting are restated in those terms.",
			files: "skills/poteto-mode/playbooks/babysit.md",
			pattern:
				"On GitHub, status comes from the mode's watcher at `scripts/watch-pr/watch-pr`. In `check` mode pass `--status-only`. The watcher covers GitHub only.",
			replacement:
				"On GitHub, read status with `gh pr view <pr> --json state,isDraft,headRefOid,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup` and the review threads with `gh api graphql` (`reviewThreads`, each with `isResolved` and `isOutdated`). In `check` mode that one read is the whole job. To wait on CI in `drive`, watch the head commit's checks with the OMP GitHub tool's `run_watch` op, or run `gh pr checks <pr> --watch` as an async `bash` job and `wait` on it.",
		},
		literal(
			"babysit-bot-heading",
			"Bugbot is one review bot; the skeptical posture applies to every bot.",
			"- Triage Bugbot skeptically:",
			"- Triage review bots skeptically:",
			"skills/poteto-mode/playbooks/babysit.md",
		),
		literal(
			"triage-reference-path",
			"The triage reference moved to a vendor-neutral path, so every link to it follows.",
			"bugbot-triage.md",
			"review-bot-triage.md",
		),
		{
			id: "pr/triage-reference-wording",
			reason: "The triage reference is kept as the rubric for any review bot; each Bugbot mention is reworded for a generic bot.",
			files: TRIAGE,
			pattern: new RegExp(Object.keys(TRIAGE_WORDING).map(phrase => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g"),
			replacement: phrase => TRIAGE_WORDING[phrase]!,
		},
		literal(
			"autopilot-heartbeat",
			"`/loop` is a Cursor command; an async bash sleep wakes the agent when it ends, which is the hourly audit tick on OMP.",
			"arm `/loop 1h` to audit until no delegated work is left",
			`arm an hourly heartbeat, ${HEARTBEAT} and is re-armed at the end of every tick, to audit until no delegated work is left`,
			"skills/poteto-mode/playbooks/autopilot-full.md",
		),
	],
	forks: [
		{
			path: "skills/poteto-mode/playbooks/autopilot-stack.md",
			kind: "patched",
			reason:
				"Graphite stacks are Excluded, so OMP has no stack-aware restack, submit or merge command. The playbook states that every rebase, retarget and push of the base-chained PRs is a separate git or gh call the root makes link by link, instead of pretending a stacking tool exists.",
			since: "0.15.25",
		},
	],
	terms: [
		{
			id: "pr",
			patterns: {
				Graphite: /Graphite/,
				gt: /`gt`/,
				"/loop": /(?<![\w.])\/loop(?![\w-])/,
				Bugbot: /[Bb]ugbot/,
				"watch-pr": /watch-pr/,
			},
		},
	],
};
