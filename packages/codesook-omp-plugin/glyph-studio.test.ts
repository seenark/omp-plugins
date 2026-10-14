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
const [ENTER, ESC, UP, DOWN, LEFT, SAVE] = ["\r", "\x1b", "\x1b[A", "\x1b[B", "\x1b[D", "\x13"];
const paste = (text: string): string => `\x1b[200~${text}\x1b[201~`;

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
	it("lists targets with a sample and status, and opens the selected one", () => {
		writeFileSync(caveman.path, "fps=5\nA B\n");
		open([caveman, prompt]);
		expect(view()).toContain("2 frames · 5 fps");
		expect(view()).toContain("missing file");
		send(DOWN, ENTER);
		expect(view()).toContain("Prompt Border › left");
		expect(view()).toContain("(new file)");
	});

	it("replaces all frames from a pasted whole file and saves", () => {
		open([caveman, prompt]);
		send(ENTER, paste("fps=8\nX\n\nY\n\nZ"), SAVE);
		expect(readFileSync(caveman.path, "utf8")).toBe("fps=8\nX\n\nY\n\nZ\n");
		expect(view()).toContain("/3 · 8 fps");
	});

	it("adds, deletes, reorders frames and steps FPS without typing it", () => {
		open([caveman]);
		send(ENTER, ENTER, "A", ESC, "a", "B", ESC, "a", "C", ESC);
		send("a", ESC); // an emptied new frame is dropped
		send(LEFT, "x", "[", UP, SAVE);
		expect(readFileSync(caveman.path, "utf8")).toBe("fps=1\nC\n\nA\n");
		send(DOWN, SAVE);
		expect(readFileSync(caveman.path, "utf8")).toBe("C\n\nA\n");
	});

	it("finishes a one-row frame on Enter and rejects multi-row frames there", () => {
		open([prompt]);
		send(ENTER, ENTER, "A", ENTER, "a", "B", ENTER, SAVE);
		expect(readFileSync(prompt.path, "utf8")).toBe("A\n\nB\n");
		send(paste("A\nB\n\nC"), SAVE);
		expect(readFileSync(prompt.path, "utf8")).toBe("A\n\nB\n");
		expect(view()).toContain("frames must be one row");
	});

	it("keeps the same height while stepping through frames of different heights", () => {
		writeFileSync(caveman.path, "fps=4\nA\n\nB\nB\nB\n\nC\nC\n");
		open([caveman]);
		send(ENTER);
		const heights = ["\x1b[C", "\x1b[C", " ", LEFT].map(key => {
			send(key);
			return studio.render(120).length;
		});
		expect(new Set(heights).size).toBe(1);
	});

	it("guards Esc when dirty, then returns to the list and closes from there", () => {
		open([caveman]);
		send(ENTER, ENTER, "A", ESC, ESC);
		expect(view()).toContain("Esc again to discard");
		send(ESC);
		expect(closed).toBe(0);
		expect(view()).toContain("pick a glyph to edit");
		send(ESC);
		expect(closed).toBe(1);
	});
});
