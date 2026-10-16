import type { Group } from "../types.ts";

/**
 * Adaptations that belong to no single Cursor primitive: Excluded parts, the references they leave
 * dangling, and terms nobody owns yet. Adaptation groups for later tickets live in sibling files.
 */
export const core: Group = {
	name: "core",
	exclusions: [
		{
			path: "skills/make-bot-ui/**",
			reason: "Wakes a Grok Bot over a webhook, a Cursor product. Out of scope for OMP.",
		},
	],
	rules: [
		{
			id: "core/drop-make-bot-ui-row",
			reason: "make-bot-ui is Excluded; its row in the poteto-help skill table would point at a missing skill.",
			files: "skills/poteto-help/SKILL.md",
			pattern: /^\| Build a page whose buttons wake a Grok Bot[^\n]*\n/m,
			replacement: "",
		},
		{
			id: "core/drop-readme-and-guide-pointer",
			reason: "The Upstream guide is Excluded and the Upstream README is not vendored, so their links would dangle.",
			files: "skills/poteto-help/SKILL.md",
			pattern: "The [README](../../README.md) and [guide page 1](../../docs/guide/01-setup.md) have the details. ",
			replacement: "",
		},
		{
			id: "core/drop-guide-closing-line",
			reason: "The Upstream guide is Excluded; this line only pointed at guide page 9.",
			files: "skills/poteto-help/SKILL.md",
			pattern: "\n\n[Guide page 9](../../docs/guide/09-make-it-yours.md) covers each of these.\n",
			replacement: "\n",
		},
		{
			id: "core/drop-guide-links",
			reason: "The Upstream guide is Excluded; remove the trailing sentence that links one of its pages.",
			files: "skills/poteto-help/SKILL.md",
			pattern: / (?:See )?\[[Gg]uide page \d+\]\(\.\.\/\.\.\/docs\/guide\/[^)]*\)(?: [^.\n]*)?\./g,
			replacement: "",
		},
		{
			id: "core/drop-guide-mention",
			reason: "The Upstream guide is Excluded; the router sentence must not promise guide pages.",
			files: "skills/poteto-help/SKILL.md",
			pattern: "the skills and guide pages that hold",
			replacement: "the skills that hold",
		},
	],
	terms: [
		{
			id: "excluded-references",
			patterns: {
				"make-bot-ui": /make-bot-ui/,
				"guide page": /[Gg]uide page|docs\/guide/,
				"Upstream README link": /\.\.\/\.\.\/README\.md/,
			},
		},
	],
};
