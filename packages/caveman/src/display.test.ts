import { describe, expect, it } from "bun:test";
import { loadPackageCavemanSequence, renderCavemanFrameSequence, replaceCavemanTemplate } from "./display.ts";
import { CAVEMAN_ACTIVE_MODES, DEFAULT_CAVEMAN_CONFIG } from "./types.ts";

describe("Caveman display", () => {
	it("replaces activity, glyph, and mode placeholders and leaves {level} alone", () => {
		expect(replaceCavemanTemplate("{activity} {glyph} {mode} {level}", { activity: "●", glyph: "g", mode: "ultracave" })).toBe(
			"● g ultracave {level}",
		);
	});

	it("ships one packaged glyph per active mode and renders the mode name", async () => {
		for (const mode of CAVEMAN_ACTIVE_MODES) {
			const asset = await loadPackageCavemanSequence(mode);
			const rendered = renderCavemanFrameSequence(mode, asset, DEFAULT_CAVEMAN_CONFIG, false);
			expect(rendered?.frames.length).toBeGreaterThan(0);
			expect(rendered?.frames[0]?.join("\n")).toEndWith(` ${mode}`);
		}
	});
});
