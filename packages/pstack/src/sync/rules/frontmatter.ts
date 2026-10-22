import { editFrontmatter } from "../frontmatter.ts";
import type { Group } from "../types.ts";

/** The leading `---` block of a Markdown file. One match, since the pattern is anchored to the start. */
const FRONTMATTER = /^---\n[\s\S]*?\n---/;

/** Skill frontmatter Adaptations: the Upstream keys OMP has no use for, and which skills OMP lists. */
export const frontmatter: Group = {
	name: "frontmatter",
	rules: [
		{
			id: "frontmatter/drop-cursor-mode-keys",
			reason: "Cursor's mode UI keys on a skill's icon and color; OMP has no sticky modes.",
			files: "skills/*/SKILL.md",
			pattern: FRONTMATTER,
			replacement: block => editFrontmatter(block, { remove: ["icon", "color"] }),
		},
		{
			id: "frontmatter/hide-principle-skills",
			reason: "Principle skills are hidden from the prompt list; `/skill:principle-...` still loads them.",
			files: "skills/principle-*/SKILL.md",
			pattern: FRONTMATTER,
			replacement: block => editFrontmatter(block, { add: { hide: "true" } }),
		},
	],
};
