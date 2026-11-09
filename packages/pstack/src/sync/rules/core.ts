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
		{
			path: "skills/statechart/scripts/test/**",
			reason: "Upstream compiler tests users never run, about 3.7 MB of the skill's 3.9 MB. This repo's verify does not run them.",
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
		{
			id: "core/ketchup-video-reply-as-file-and-stills",
			reason:
				"OMP's chat cannot embed or play video but shows images. The agent writes the video to a file outside the repo and replies with its path plus one still per slide.",
			files: "skills/ketchup-video/SKILL.md",
			pattern:
				"The reply is ketchup's opening sentence, the embedded video, one line naming any work left that you can do yourself, and the action items.",
			replacement:
				"The reply is ketchup's opening sentence, the path of the rendered video file, one still per slide extracted from the video with ffmpeg and shown inline as an image, one line naming any work left that you can do yourself, and the action items. OMP's chat cannot embed or play video, so the file path and the stills stand in for it.",
		},
		{
			id: "core/ketchup-video-check-before-reply",
			reason: "There is no embed step in OMP. The check runs before the reply, on the stills the reply shows.",
			files: "skills/ketchup-video/SKILL.md",
			pattern:
				"Before you embed the video, check the rendered file. Look at one frame from each slide at chat size, and check that",
			replacement:
				"Before you reply, check the rendered file. Extract one still from each slide's hold with ffmpeg, look at it at chat size, and check that",
		},
		{
			id: "core/ketchup-video-stills-in-reply",
			reason: "The checked stills are what the reply shows in place of the embedded video.",
			files: "skills/ketchup-video/SKILL.md",
			pattern: "render again, and check again.",
			replacement:
				"render again, and check again. Show those stills in the reply, one per slide, as inline images, under the video's file path.",
		},
		{
			id: "core/statechart-drop-test-script",
			reason: "The statechart test subtree is Excluded, so its test script and the property-test dependency would point at files that do not ship.",
			files: "skills/statechart/scripts/package.json",
			pattern: /,\n {2}"scripts": \{\n {4}"test": "node [^\n]*test\/\*\.test\.ts"\n {2}\},\n {2}"devDependencies": \{\n {4}"fast-check": "[^"]+"\n {2}\}/,
			replacement: "",
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
