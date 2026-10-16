import type { Group } from "../types.ts";

/** Ticket omp-plugins-4nv.5: session paths, goal mode, CLI/UI drivers, other cursor-team-kit skills. */
export const sessions: Group = {
	name: "sessions",
	rules: [],
	exclusions: [],
	forks: [],
	terms: [
		{
			id: "sessions",
			owner: "omp-plugins-4nv.5",
			patterns: {
				".cursor path": /\.cursor/,
				"agent-transcripts": /agent-transcripts/,
				"/goal": /\/goal\b/,
				"control-cli/control-ui": /control-(?:cli|ui)/,
				"cursor-team-kit": /cursor-team-kit/,
				"team-kit skill": /\b(?:verify-this|loop-on-ci|review-and-ship|new-branch-and-pr|run-smoke-tests|pr-review-canvas|workflow-from-chats|check-compiler-errors|weekly-review|get-pr-comments)\b/,
			},
		},
	],
};
