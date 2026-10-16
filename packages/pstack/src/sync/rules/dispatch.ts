import type { Group } from "../types.ts";

/** Ticket omp-plugins-4nv.3: subagent dispatch, ask, cloud agents, the provider runner. */
export const dispatch: Group = {
	name: "dispatch",
	rules: [],
	exclusions: [],
	forks: [],
	terms: [
		{
			id: "dispatch",
			owner: "omp-plugins-4nv.3",
			patterns: {
				"Task tool": /`Task`|\bTask(?: tool| subagent| call| spawn| `)/,
				subagent_type: /subagent_type/,
				generalPurpose: /generalPurpose/,
				AskQuestion: /AskQuestion/,
				"cloud agent": /cloud[- ](?:agent|VM)s?|environment: "cloud"/i,
				"external provider CLI": /\b[Gg]rok\b/,
			},
		},
	],
};
