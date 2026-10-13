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
	it("loads, accepts a pasted whole file, and saves", () => {
		writeFileSync(caveman.path, "fps=5\nA B\n");
		open([caveman, prompt]);
		expect(view()).toContain("frame 1/2");
		expect(view()).toContain("5");
		send("\t", "\t");
		send(...Array(10).fill("\x7f"));
		send("\x1b[200~fps=8\nX\n\nY\n\nZ\x1b[201~");
		send("\x13");
		expect(readFileSync(caveman.path, "utf8")).toBe("fps=8\nX\n\nY\n\nZ\n");
		expect(view()).toContain("/3");
		expect(view()).toContain("8 fps");
	});

	it("blocks save on invalid FPS", () => {
		open([caveman]);
		send("\t", "0", "\t", "A", "\r", "\r", "B", "\x13");
		expect(existsSync(caveman.path)).toBe(false);
		expect(view()).toContain("FPS must be a number above 0 and at most 60.");
	});

	it("rejects multi-row frames on one-row surfaces", () => {
		open([caveman, prompt]);
		send("\x1b[C", "\t", "\t", "A", "\r", "B", "\r", "\r", "C", "\x13");
		expect(existsSync(prompt.path)).toBe(false);
		expect(view()).toContain("frames must be one row");
	});

	it("guards Esc when dirty", () => {
		open([caveman]);
		send("\t", "\t", "A", "\x1b");
		expect(closed).toBe(0);
		expect(view()).toContain("Esc again to discard");
		send("\x1b");
		expect(closed).toBe(1);
	});
});
