import type { Group } from "../types.ts";

/**
 * Skills renamed because the user's other skill libraries already own the Upstream name. The engine moves
 * the directory and derives the reference-rewriting rules from these entries.
 */
export const collisions: Group = {
	name: "collisions",
	renames: [
		{ from: "tdd", to: "pstack-tdd", reason: "A `tdd` skill from another discovered source outranks ours on this machine; the bare name resolves to it." },
		{ from: "teach", to: "pstack-teach", reason: "A `teach` skill from another discovered source outranks ours on this machine; the bare name resolves to it." },
	],
};
