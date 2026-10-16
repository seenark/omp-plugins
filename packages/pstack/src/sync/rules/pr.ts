import type { Group } from "../types.ts";

/** Ticket omp-plugins-4nv.4: PR workflows without Graphite or Cursor /loop. */
export const pr: Group = {
	name: "pr",
	rules: [],
	exclusions: [],
	forks: [],
	terms: [
		{
			id: "pr",
			owner: "omp-plugins-4nv.4",
			patterns: {
				Graphite: /Graphite/,
				gt: /\bgt\b/,
				"/loop": /\/loop\b/,
				Bugbot: /[Bb]ugbot/,
				"watch-pr": /watch-pr/,
			},
		},
	],
};
