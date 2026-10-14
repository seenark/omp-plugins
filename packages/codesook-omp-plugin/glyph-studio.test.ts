import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createGlyphStudio, type GlyphTarget } from "./glyph-studio.ts";

let dir: string;
let caveman: GlyphTarget;
let prompt: GlyphTarget;
let closed = 0;
let studio: ReturnType<typeof createGlyphStudio>;

function open(targets: GlyphTarget[]): void {
	studio = createGlyphStudio({
		tui: { requestRender() {} },
		theme: { fg: (_c, s) => s, bold: s => s },
		targets,
		onSaved: () => undefined,
		onClose: () => {
			closed++;
		},
	});
}
const send = (...keys: string[]): void => keys.forEach(key => studio.handleInput?.(key));
const view = (): string => studio.render(120).join("\n");

beforeEach(() => {
	dir = mkdtempSync(path.join(os.tmpdir(), "glyph-studio-"));
	closed = 0;
	caveman = { group: "Caveman", name: "full", path: path.join(dir, "full.txt"), surface: "shared-display", fallback: "x" };
	prompt = { group: "Prompt Border", name: "left", path: path.join(dir, "left.txt"), surface: "prompt-glyph", fallback: "x" };
});
afterEach(() => {
	studio.dispose();
	rmSync(dir, { recursive: true, force: true });
});

describe("Glyph Studio", () => {
	it("lists targets with status and opens the selected one", () => {
		writeFileSync(caveman.path, "fps=5\nA B\n");
		open([caveman, prompt]);
		expect(view()).toContain("2 frames · 5 fps");
		expect(view()).toContain("missing file");
		send("\x1b[B", "\r");
		expect(view()).toContain("Prompt Border › left");
		expect(view()).toContain("(new file)");
	});

	it("loads, accepts a pasted whole file, and saves", () => {
		open([caveman, prompt]);
		send("\r");
		expect(view()).toContain("(new file)");
		send("\x1b[200~fps=8\nX\n\nY\n\nZ\x1b[201~");
		send("\x13");
		expect(readFileSync(caveman.path, "utf8")).toBe("fps=8\nX\n\nY\n\nZ\n");
		expect(view()).toContain("/3");
		expect(view()).toContain("8 fps");
	});

	it("blocks save on invalid FPS", () => {
		open([caveman]);
		send("\r", "\t", "0", "\t", "A", "\r", "\r", "B", "\x13");
		expect(existsSync(caveman.path)).toBe(false);
		expect(view()).toContain("FPS must be a number above 0 and at most 60.");
	});

	it("rejects multi-row frames on one-row surfaces", () => {
		open([caveman, prompt]);
		send("\x1b[B", "\r", "A", "\r", "B", "\r", "\r", "C", "\x13");
		expect(existsSync(prompt.path)).toBe(false);
		expect(view()).toContain("frames must be one row");
	});

	it("guards Esc when dirty, then returns to the list and closes from there", () => {
		open([caveman]);
		send("\r", "A", "\x1b");
		expect(view()).toContain("Esc again to discard");
		send("\x1b");
		expect(closed).toBe(0);
		expect(view()).toContain("choose a glyph file");
		send("\x1b");
		expect(closed).toBe(1);
	});
});
