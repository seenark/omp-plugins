import { describe, expect, test, vi } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth, type AutocompleteProvider, type EditorTheme } from "@oh-my-pi/pi-tui";

import promptBorderStyle, {
	DEFAULT_CONTEXT_RAIL_CONFIG,
	DEFAULT_PROMPT_BORDER_CONFIG,
	PromptBorderEditor,
	borderStyles,
	buildTimedSpinnerFrames,
	createSpinnerFrameDebugReport,
	ensurePromptBorderConfigFile,
	formatPromptLoadingGlyphDemoSummary,
	formatSpinnerFrameDebugReport,
	getContextRailArgumentCompletions,
	getPromptBorderArgumentCompletions,
	getPromptLoadingGlyphArgumentCompletions,
	installSpinnerGlyphFrames,
	normalizePromptBorderConfig,
	parseContextRailArgs,
	parseGlyphFrames,
	parsePromptBorderArgs,
	parsePromptLoadingGlyphArgs,
	readPromptBorderConfig,
	renderBottomBorderLine,
	renderPromptAttachmentRows,
	replaceBodyLeftGlyph,
	writeContextRailConfigSelection,
	writePromptBorderConfigSelection,
} from "./main";

const symbols: EditorTheme["symbols"] = {
	cursor: "█",
	inputCursor: "▌",
	boxRound: borderStyles.round,
	boxSharp: {
		topLeft: "┌",
		topRight: "┐",
		bottomLeft: "└",
		bottomRight: "┘",
		horizontal: "─",
		vertical: "│",
		teeDown: "┬",
		teeUp: "┴",
		teeLeft: "┤",
		teeRight: "├",
		cross: "┼",
	},
	table: {
		topLeft: "┌",
		topRight: "┐",
		bottomLeft: "└",
		bottomRight: "┘",
		horizontal: "─",
		vertical: "│",
		teeDown: "┬",
		teeUp: "┴",
		teeLeft: "┤",
		teeRight: "├",
		cross: "┼",
	},
	quoteBorder: "│",
	hrChar: "─",
	spinnerFrames: ["-"],
};

const theme: EditorTheme = {
	borderColor: value => value,
	selectList: {
		selectedPrefix: value => value,
		selectedText: value => value,
		description: value => value,
		scrollInfo: value => value,
		noMatch: value => value,
		symbols,
	},
	symbols,
};

const emptySpinnerGlyphs = () => ({
	status: { frameMs: 80, glyphs: "", frames: [] as string[] },
	activity: { frameMs: 80, glyphs: "", frames: [] as string[] },
});
const attachmentTheme = {
	symbol: (name: string): string =>
		({
			"boxRound.topLeft": "╭",
			"boxRound.topRight": "╮",
			"boxRound.bottomLeft": "╰",
			"boxRound.bottomRight": "╯",
			"boxRound.horizontal": "─",
			"boxRound.vertical": "│",
		})[name] ?? "",
	fg: (_name: string, value: string): string => value,
	bold: (value: string): string => value,
};

const slashAutocomplete: AutocompleteProvider = {
	getSuggestions: async () => ({
		prefix: "/",
		items: [{ value: "/prompt-border", label: "/prompt-border", description: "Change prompt border" }],
	}),
	applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
	trySyncSlashCompletion: () => ({
		prefix: "/",
		items: [{ value: "/prompt-border", label: "/prompt-border", description: "Change prompt border" }],
	}),
};

describe("parsePromptBorderArgs", () => {
	test("keeps the current layout when only a style is provided", () => {
		expect(parsePromptBorderArgs("heavy", { style: "double", layout: "sides" })).toEqual({
			kind: "apply",
			state: { style: "heavy", layout: "sides" },
		});
	});

	test("updates style and layout together", () => {
		expect(parsePromptBorderArgs("double bottom", { style: "round", layout: "full" })).toEqual({
			kind: "apply",
			state: { style: "double", layout: "bottom" },
		});
	});

	test("updates only layout with the layout subcommand", () => {
		expect(parsePromptBorderArgs("layout sides", { style: "double", layout: "full" })).toEqual({
			kind: "apply",
			state: { style: "double", layout: "sides" },
		});
	});

	test("accepts the top-bottom and default layouts", () => {
		expect(parsePromptBorderArgs("double top-bottom", { style: "round", layout: "full" })).toEqual({
			kind: "apply",
			state: { style: "double", layout: "top-bottom" },
		});
		expect(parsePromptBorderArgs("layout default", { style: "double", layout: "sides" })).toEqual({
			kind: "apply",
			state: { style: "double", layout: "default" },
		});
	});

	test("rejects unknown tokens", () => {
		expect(parsePromptBorderArgs("double neon", { style: "double", layout: "full" })).toEqual({ kind: "invalid" });
	});
});

test("parses glyph frames from space separated text", () => {
	expect(parseGlyphFrames("AA  BB\nCC")).toEqual(["AA", "BB", "CC"]);
});

test("builds timed spinner frames by repeating slow frames", () => {
	expect(buildTimedSpinnerFrames(["A0", "A1"], 240)).toEqual(["A0", "A0", "A0", "A1", "A1", "A1"]);
});

test("builds timed spinner frames by preserving 80ms frames", () => {
	expect(buildTimedSpinnerFrames(["A0", "A1"], 80)).toEqual(["A0", "A1"]);
});

test("builds timed spinner frames by skipping faster source frames", () => {
	expect(buildTimedSpinnerFrames(["A0", "A1", "A2", "A3"], 40)).toEqual(["A0", "A2"]);
});

describe("parsePromptLoadingGlyphArgs", () => {
	test("accepts the prompt-loading glyph debug actions", () => {
		expect(parsePromptLoadingGlyphArgs("debug frames")).toEqual({ kind: "frames" });
		expect(parsePromptLoadingGlyphArgs("debug demo")).toEqual({ kind: "demo" });
		expect(parsePromptLoadingGlyphArgs("debug on")).toEqual({ kind: "on" });
		expect(parsePromptLoadingGlyphArgs("debug off")).toEqual({ kind: "off" });
	});

	test("rejects unknown loading glyph commands", () => {
		expect(parsePromptLoadingGlyphArgs("debug wobble")).toEqual({ kind: "invalid" });
	});
});

describe("getPromptLoadingGlyphArgumentCompletions", () => {
	test("offers the debug subcommand at the root", () => {
		expect(getPromptLoadingGlyphArgumentCompletions("")).toEqual([{ value: "debug", label: "debug" }]);
	});

	test("offers all task-3 loading glyph actions after the subcommand", () => {
		expect(getPromptLoadingGlyphArgumentCompletions("debug ")).toEqual([
			{ value: "debug frames", label: "frames" },
			{ value: "debug demo", label: "demo" },
			{ value: "debug on", label: "on" },
			{ value: "debug off", label: "off" },
		]);
	});

	test("offers matching loading glyph actions for the exact debug token", () => {
		expect(getPromptLoadingGlyphArgumentCompletions("debug")).toEqual([
			{ value: "debug frames", label: "frames" },
			{ value: "debug demo", label: "demo" },
			{ value: "debug on", label: "on" },
			{ value: "debug off", label: "off" },
		]);
	});
});

test("reports skipped frames for a 20ms activity spinner", () => {
	const report = createSpinnerFrameDebugReport("activity", {
		frames: ["F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7"],
		frameMs: 20,
	});

	expect(report).toEqual({
		type: "activity",
		frameMs: 20,
		sourceFrames: ["F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7"],
		visibleFrames: ["F0", "F4"],
		mode: "skipped",
	});
});

test("formats a frame debug report with the visible subsequence note", () => {
	const formatted = formatSpinnerFrameDebugReport({
		type: "activity",
		frameMs: 20,
		sourceFrames: ["F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7"],
		visibleFrames: ["F0", "F4"],
		mode: "skipped",
	});

	expect(formatted).toContain("Prompt loading glyphs: activity");
	expect(formatted).toContain("visible (2): F0 F4");
	expect(formatted).toContain("mode: skips source frames to match 80ms host tick");
	expect(formatted).toContain("visible subsequence");
});

test("formats the loading glyph demo summary for every spinner group", () => {
	const summary = formatPromptLoadingGlyphDemoSummary({
		style: "double",
		layout: "full",
		leftGlyph: { frameMs: 70, glyphs: "", frames: [] },
		rightGlyph: { frameMs: 70, glyphs: "", frames: [] },
		spinnerGlyphs: {
			status: { frameMs: 80, glyphs: "S0 S1", frames: ["S0", "S1"] },
			activity: { frameMs: 20, glyphs: "F0 F1 F2 F3 F4 F5 F6 F7", frames: ["F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7"] },
		},
	});

	expect(summary).toContain("Prompt loading glyphs demo");
	expect(summary).toContain("status loading");
	expect(summary).toContain("visible (2): S0 S1");
	expect(summary).toContain("activity loading");
	expect(summary).toContain("visible (2): F0 F4");
});

describe("PromptBorderEditor", () => {
	test("renders a separate bottom border in bottom layout", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "bottom" });
		const lines = editor.render(8);
		expect(lines.at(-1)).toBe("╚══════╝");
		expect(renderBottomBorderLine(8, borderStyles.double, value => value)).toBe("╚══════╝");
	});
	test("renders full layout with side-only body row and separate bottom border", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "full" });
		const lines = editor.render(8);
		expect(lines[0]).toBe("╔══════╗");
		expect(lines[1]).toBe("║  ▌   ║");
		expect(lines.at(-1)).toBe("╚══════╝");
	});
	test("restores the multiline paste attachment box above the editor", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "full" });
		const pastedLines = ["Verification criteria", ...Array.from({ length: 41 }, (_, index) => `line ${index + 1}`)];
		editor.insertTextAttachment(pastedLines.join("\n"));

		const rows = renderPromptAttachmentRows(editor, 40, attachmentTheme);

		expect(rows).toHaveLength(6);
		expect(rows[0]).toContain("📄 #1");
		expect(rows[1]).toContain("Verificatio");
		expect(rows.at(-1)).toContain("+42 lines");
		expect(rows.some(row => row.includes("line 40"))).toBe(false);
	});
	test("matches OMP paste colors by attachment ordinal", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "full" });
		editor.insertTextAttachment("Marking file one\nline two");
		editor.insertTextAttachment("Marking file two\nline two");

		const rows = renderPromptAttachmentRows(editor, 40, attachmentTheme);

		expect(rows[0]).toContain("\x1b[38;2;105;220;158m╭");
		expect(rows[0]).toContain("\x1b[38;2;255;141;188m╭");
		expect(rows.at(-1)).toContain("\x1b[38;2;105;220;158m╰");
		expect(rows.at(-1)).toContain("\x1b[38;2;255;141;188m╰");
	});

	test("mounts the paste attachment widget with the custom editor", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		let sessionStart: ((event: unknown, ctx: unknown) => Promise<void>) | undefined;
		let editorFactory: ((tui: unknown, editorTheme: EditorTheme) => PromptBorderEditor) | undefined;
		const widgets = new Map<string, unknown>();
		const pi = {
			setLabel: () => {},
			on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<void> | void) => {
				if (event === "session_start") sessionStart = handler as typeof sessionStart;
			},
			registerCommand: () => {},
		} as unknown as ExtensionAPI;
		const agentTheme = {
			symbol: (name: string) => attachmentTheme.symbol(name),
			fg: attachmentTheme.fg,
			bold: attachmentTheme.bold,
			getSpinnerFrames: () => [] as string[],
			boxRound: borderStyles.round,
		};

		promptBorderStyle(pi, configPath);
		const ctx = {
			hasUI: true as const,
			ui: {
				theme: agentTheme,
				setEditorComponent: (value: unknown) => {
					if (typeof value === "function") editorFactory = value as typeof editorFactory;
				},
				setWidget: (key: string, value: unknown) => {
					if (value === undefined) widgets.delete(key);
					else widgets.set(key, value);
				},
				notify: () => {},
			},
		};
		await sessionStart?.({}, ctx);

		const editor = editorFactory?.({}, theme);
		editor?.insertTextAttachment("Verification criteria\nline two\nline three");
		const widgetFactory = widgets.get("prompt-border-attachments") as
			| ((tui: unknown, widgetTheme: unknown) => { render(width: number): readonly string[] })
			| undefined;
		const widget = widgetFactory?.({}, agentTheme);

		expect(widget?.render(40).some(row => row.includes("╭── 📄 #1 ───╮"))).toBe(true);
		expect(widget?.render(40).at(-1)).toContain("+3 lines");
	});
	test("keeps the upstream IME-safe tail inside the custom bottom layout", () => {
		const editor = new PromptBorderEditor(theme, { style: "round", layout: "full" });
		editor.setUseTerminalCursor(true);
		editor.setImeSafeCursorLayout(true);
		editor.focused = true;

		expect(editor.render(8)).toEqual(["╭──────╮", `│  ${CURSOR_MARKER}`, "╰──────╯"]);
	});

	test("reapplies selected border glyphs after a theme refresh", () => {
		const editor = new PromptBorderEditor(theme, { style: "round", layout: "full" });
		editor.setTheme(theme);
		editor.setUseTerminalCursor(true);
		editor.focused = true;

		expect(editor.render(8)).toEqual(["╭──────╮", `│  ${CURSOR_MARKER}    │`, "╰──────╯"]);
	});

	test("keeps unfocused blank body rows for space-horizontal styles", () => {
		for (const style of ["vertical", "double-vertical", "horizontal", "double-horizontal", "block"] as const) {
			const editor = new PromptBorderEditor(theme, { style, layout: "full" });
			editor.setUseTerminalCursor(true);
			editor.setImeSafeCursorLayout(true);
			editor.focused = false;

			expect(editor.render(8)).toHaveLength(3);
		}
	});

	test("preserves raw status gap glyphs from upstream top-border content", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "full" });
		editor.setTopBorder({ content: "left ───── right", width: 16 });
		const lines = editor.render(20);
		expect(lines[0]).toBe("╔══left ───── r…═══╗");
	});
	test("preserves upstream status content and ANSI styling", () => {
		const semanticStart = "\x1b[38;5;45m";
		const semanticReset = "\x1b[39m";
		const semanticStatus = `${semanticStart}⏱ status${semanticReset}`;
		const semanticModel = `${semanticStart}⬢ GPT-5.6${semanticReset}`;
		const content = `${semanticStatus} ──╎──┃ ${semanticModel}`;
		const topBorder = { content, width: 30 };
		let activeBorderAnsi = "\x1b[38;5;196m";
		const coloredTheme: EditorTheme = {
			...theme,
			borderColor: value => `${activeBorderAnsi}${value}\x1b[39m`,
		};
		const editor = new PromptBorderEditor(coloredTheme, { style: "round", layout: "full" });
		editor.setTopBorder(topBorder);

		const firstTopRow = editor.render(64)[0]!;
		expect(firstTopRow).toContain(content);
		expect(firstTopRow).toContain("─╎──┃");

		activeBorderAnsi = "\x1b[38;5;27m";
		const secondTopRow = editor.render(64)[0]!;
		expect(secondTopRow).toContain(content);
		expect(secondTopRow).toContain("─╎──┃");
	});



	test("uses lazy top-border providers in non-full layouts", () => {
		for (const layout of ["bottom", "sides"] as const) {
			const editor = new PromptBorderEditor(theme, { style: "double", layout });
			editor.setTopBorderProvider(() => ({ content: "left ───── right", width: 16 }));

			const lines = editor.render(20);

			expect(lines.some(line => line.includes("left"))).toBe(true);
		}
	});
	test("renders only side borders in sides layout", () => {
		const editor = new PromptBorderEditor(theme, { style: "sharp", layout: "sides" });
		const lines = editor.render(8);
		expect(lines.some(line => line.includes("┌") || line.includes("┐") || line.includes("└") || line.includes("┘"))).toBe(false);
		expect(lines.every(line => line.startsWith("│") && line.endsWith("│"))).toBe(true);
	});

	test("keeps status content when bottom layout hides the top border line", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "bottom" });
		editor.setTopBorder({ content: "left ───── right", width: 16 });
		const lines = editor.render(20);
		expect(lines[0]).toBe("   left ───── r…    ");
		expect(lines[1]).toBe("║  ▌               ║");
		expect(lines.at(-1)).toBe("╚══════════════════╝");
	});

	test("keeps status content when sides layout hides top and bottom border lines", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "sides" });
		editor.setTopBorder({ content: "left ───── right", width: 16 });
		const lines = editor.render(20);
		expect(lines).toEqual(["   left ───── r…    ", "║  ▌               ║"]);
	});

	test("preserves edge-aligned status glyphs when bottom layout hides top border chrome", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "bottom" });
		editor.setTopBorder({ content: "═ sync jobs ═", width: 12 });
		const lines = editor.render(24);
		expect(lines[0]).toBe("   ═ sync jobs ═         ");
	});

	test("preserves truncated status content when bottom layout hides top border chrome", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "bottom" });
		editor.setTopBorder({ content: "left status really long", width: 23 });
		const lines = editor.render(16);
		expect(lines[0]).toBe("   left sta…    ");
		expect(lines[1]).toBe("║  ▌           ║");
	});

	test("renders top-bottom layout with horizontal borders and an unbordered body row", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "top-bottom" });
		const lines = editor.render(8);
		expect(lines).toEqual(["╔══════╗", "   ▌    ", "╚══════╝"]);
	});

	test("renders default layout using upstream editor body chrome", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "default" });
		const lines = editor.render(8);
		expect(lines).toEqual(["╔══════╗", "╚═ ▌  ═╝"]);
	});

	test("replaces only the body-left glyph", () => {
		expect(replaceBodyLeftGlyph("╚═ ▌  ═╝", borderStyles.double, "AB")).toBe("╚AB▌  ═╝");
		expect(replaceBodyLeftGlyph("╔══════╗", borderStyles.double, "AB")).toBe("╔══════╗");
		expect(replaceBodyLeftGlyph("╚══════╝", borderStyles.double, "AB")).toBe("╚══════╝");
	});

	test("renders configured left glyph frame in default layout", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "default" }, {
			style: "double",
			layout: "default",
			leftGlyph: { frameMs: 70, glyphs: "AB", frames: ["AB"] },
			rightGlyph: { frameMs: 70, glyphs: "", frames: [] },
			spinnerGlyphs: emptySpinnerGlyphs(),
		});
		expect(editor.render(8)).toEqual(["╔══════╗", "╚AB▌  ═╝"]);
	});

	test("renders configured left glyph frame in full layout body row with input spacing", () => {
		const baselineEditor = new PromptBorderEditor(theme, { style: "double", layout: "full" });
		const baselineRow = baselineEditor.render(8)[1] ?? "";
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "full" }, {
			style: "double",
			layout: "full",
			leftGlyph: { frameMs: 70, glyphs: "AB", frames: ["AB"] },
			rightGlyph: { frameMs: 70, glyphs: "", frames: [] },
			spinnerGlyphs: emptySpinnerGlyphs(),
		});
		const lines = editor.render(8);
		const renderedRow = lines[1] ?? "";
		expect(lines).toEqual(["╔══════╗", "║AB▌   ║", "╚══════╝"]);
		expect(visibleWidth(renderedRow)).toBe(visibleWidth(baselineRow));
		expect(visibleWidth(renderedRow.slice(0, renderedRow.indexOf("▌")))).toBe(
			visibleWidth(baselineRow.slice(0, baselineRow.indexOf("▌"))),
		);
	});

	test("clips a left glyph frame to the two-cell side gutter", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "full" }, {
			style: "double",
			layout: "full",
			leftGlyph: { frameMs: 70, glyphs: "ABCD", frames: ["ABCD"] },
			rightGlyph: { frameMs: 70, glyphs: "", frames: [] },
			spinnerGlyphs: emptySpinnerGlyphs(),
		});
		expect(editor.render(8)).toEqual(["╔══════╗", "║AB▌   ║", "╚══════╝"]);
	});

	test("renders configured right glyph frame in full layout body row", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "full" }, {
			style: "double",
			layout: "full",
			leftGlyph: { frameMs: 70, glyphs: "", frames: [] },
			rightGlyph: { frameMs: 70, glyphs: "CD", frames: ["CD"] },
			spinnerGlyphs: emptySpinnerGlyphs(),
		});
		const lines = editor.render(8);
		expect(lines.filter(line => line.includes("CD"))).toHaveLength(1);
		expect(lines.find(line => line.includes("CD"))).toContain("▌");
		expect(lines[0]?.includes("CD")).toBe(false);
		expect(lines.at(-1)?.includes("CD")).toBe(false);
	});

	test("keeps right glyph placement when the left frame consumes the side gutter", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "full" }, {
			style: "double",
			layout: "full",
			leftGlyph: { frameMs: 70, glyphs: "AB", frames: ["AB"] },
			rightGlyph: { frameMs: 70, glyphs: "CD", frames: ["CD"] },
			spinnerGlyphs: emptySpinnerGlyphs(),
		});
		const row = editor.render(8)[1] ?? "";
		expect(row).toBe("║AB▌ CD║");
		expect(visibleWidth(row)).toBe(8);
		expect(row.indexOf("CD")).toBeGreaterThan(row.indexOf("▌"));
	});

	test("renders left and right glyphs only on cursor row in multiline full layout", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "full" }, {
			style: "double",
			layout: "full",
			leftGlyph: { frameMs: 70, glyphs: "AA", frames: ["AA"] },
			rightGlyph: { frameMs: 70, glyphs: "ZZ", frames: ["ZZ"] },
			spinnerGlyphs: emptySpinnerGlyphs(),
		});
		editor.setText("one\ntwo");
		const lines = editor.render(12);
		expect(lines.filter(line => line.includes("AA"))).toHaveLength(1);
		expect(lines.filter(line => line.includes("ZZ"))).toHaveLength(1);
		expect(lines.find(line => line.includes("AA"))).toBe(lines.find(line => line.includes("ZZ")));
		expect(lines.find(line => line.includes("AA"))).toContain("▌");
	});

	test("renders left and right glyphs only on cursor row in default layout", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "default" }, {
			style: "double",
			layout: "default",
			leftGlyph: { frameMs: 70, glyphs: "AA", frames: ["AA"] },
			rightGlyph: { frameMs: 70, glyphs: "ZZ", frames: ["ZZ"] },
			spinnerGlyphs: emptySpinnerGlyphs(),
		});
		editor.setText("one\ntwo");
		const lines = editor.render(12);
		const glyphRows = lines.slice(1).filter(line => line.includes("AA") || line.includes("ZZ"));
		expect(glyphRows).toHaveLength(1);
		expect(glyphRows[0]).toContain("▌");
	});

	test("ignores literal cursor glyphs in user text when locating the active row", () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "full" }, {
			style: "double",
			layout: "full",
			leftGlyph: { frameMs: 70, glyphs: "AA", frames: ["AA"] },
			rightGlyph: { frameMs: 70, glyphs: "ZZ", frames: ["ZZ"] },
			spinnerGlyphs: emptySpinnerGlyphs(),
		});
		editor.setText("one▌\ntwo");
		const lines = editor.render(14);
		expect(lines.find(line => line.includes("AA"))).toContain("two▌");
		expect(lines.find(line => line.includes("AA"))?.includes("one▌")).toBe(false);
	});

	test("keeps default-layout glyph fallback out of autocomplete rows", async () => {
		const mutableTheme: EditorTheme = {
			...theme,
			symbols: {
				...theme.symbols,
			},
			selectList: {
				...theme.selectList,
				symbols: {
					...theme.selectList.symbols,
				},
			},
		};
		const editor = new PromptBorderEditor(mutableTheme, { style: "double", layout: "default" }, {
			style: "double",
			layout: "default",
			leftGlyph: { frameMs: 70, glyphs: "AA", frames: ["AA"] },
			rightGlyph: { frameMs: 70, glyphs: "", frames: [] },
			spinnerGlyphs: emptySpinnerGlyphs(),
		});
		editor.setAutocompleteProvider({
			getSuggestions: async () => ({
				prefix: "/",
				items: [{ value: "/other-command", label: "/other-command", description: "Other command" }],
			}),
			applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
			trySyncSlashCompletion: () => ({
				prefix: "/",
				items: [{ value: "/other-command", label: "/other-command", description: "Other command" }],
			}),
		});
		editor.handleInput("/");
		await Promise.resolve();
		mutableTheme.symbols.inputCursor = "?";
		mutableTheme.symbols.cursor = "!";
		const lines = editor.render(20);
		const suggestionRow = lines.find(line => line.includes("/other-command"));
		const glyphRow = lines.find(line => line.includes("AA"));
		expect(suggestionRow?.includes("AA")).toBe(false);
		expect(glyphRow).toContain("▌");
	});

	test("advances the left glyph frame and requests repaint", () => {
		vi.useFakeTimers();
		try {
			const repaints: number[] = [];
			const editor = new PromptBorderEditor(theme, { style: "double", layout: "default" }, {
				style: "double",
				layout: "default",
				leftGlyph: { frameMs: 1, glyphs: "AB CD", frames: ["AB", "CD"] },
				rightGlyph: { frameMs: 70, glyphs: "", frames: [] },
				spinnerGlyphs: emptySpinnerGlyphs(),
			});
			editor.setShimmerRepaintHandler(() => repaints.push(1));
			expect(editor.render(8)[1]).toBe("╚AB▌  ═╝");
			vi.advanceTimersByTime(5);
			expect(repaints.length).toBeGreaterThan(0);
			expect(editor.render(8)[1]).toBe("╚CD▌  ═╝");
		} finally {
			vi.useRealTimers();
		}
	});

	test("advances the right glyph frame and requests repaint", () => {
		vi.useFakeTimers();
		try {
			const repaints: number[] = [];
			const editor = new PromptBorderEditor(theme, { style: "double", layout: "full" }, {
				style: "double",
				layout: "full",
				leftGlyph: { frameMs: 70, glyphs: "", frames: [] },
				rightGlyph: { frameMs: 1, glyphs: "RR SS", frames: ["RR", "SS"] },
				spinnerGlyphs: emptySpinnerGlyphs(),
			});
			editor.setShimmerRepaintHandler(() => repaints.push(1));
			expect(editor.render(8).find(line => line.includes("RR"))).toContain("▌");
			vi.advanceTimersByTime(5);
			expect(repaints.length).toBeGreaterThan(0);
			expect(editor.render(8).find(line => line.includes("SS"))).toContain("▌");
		} finally {
			vi.useRealTimers();
		}
	});

	test("keeps the bottom border above autocomplete rows", async () => {
		const editor = new PromptBorderEditor(theme, { style: "double", layout: "bottom" });
		editor.setAutocompleteProvider(slashAutocomplete);
		editor.handleInput("/");
		await Promise.resolve();
		const lines = editor.render(20);
		const borderIndex = lines.findIndex(line => line === "╚══════════════════╝");
		const autocompleteIndex = lines.findIndex(line => line.includes("/prompt-border"));
		expect(editor.isShowingAutocomplete()).toBe(true);
		expect(borderIndex).toBeGreaterThanOrEqual(0);
		expect(autocompleteIndex).toBeGreaterThan(borderIndex);
	});
});

describe("prompt border config", () => {
	test("normalizes prompt border config defaults without showing custom glyphs", () => {
		expect(normalizePromptBorderConfig({})).toEqual(DEFAULT_PROMPT_BORDER_CONFIG);
		expect(normalizePromptBorderConfig({ promptBorder: { leftGlyph: { frameMs: 10, glyphs: "" } } })).toEqual({
			style: "double",
			layout: "full",
			leftGlyph: { frameMs: 70, glyphs: "", frames: [] },
			rightGlyph: { frameMs: 70, glyphs: "", frames: [] },
			spinnerGlyphs: emptySpinnerGlyphs(),
			contextRail: { ...DEFAULT_CONTEXT_RAIL_CONFIG },
		});
		expect(
			normalizePromptBorderConfig({
				promptBorder: {
					style: "round",
					layout: "default",
					leftGlyph: { frameMs: 80, glyphs: "AA  BB" },
					rightGlyph: { frameMs: 90, glyphs: "RR  SS" },
					spinnerGlyphs: {
						status: { frameMs: 120, glyphs: "LL  MM" },
						activity: { frameMs: 140, glyphs: "QQ  WW" },
					},
				},
			}),
		).toEqual({
			style: "round",
			layout: "default",
			leftGlyph: { frameMs: 80, glyphs: "AA  BB", frames: ["AA", "BB"] },
			rightGlyph: { frameMs: 90, glyphs: "RR  SS", frames: ["RR", "SS"] },
			spinnerGlyphs: {
				status: { frameMs: 120, glyphs: "LL  MM", frames: ["LL", "MM"] },
				activity: { frameMs: 140, glyphs: "QQ  WW", frames: ["QQ", "WW"] },
			},
			contextRail: { ...DEFAULT_CONTEXT_RAIL_CONFIG },
		});
	});

	test("creates prompt border config json example when missing", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		const leftGlyphPath = path.join(dir, "prompt-border-left-glyphs.txt");
		const rightGlyphPath = path.join(dir, "prompt-border-right-glyphs.txt");
		const statusSpinnerGlyphPath = path.join(dir, "prompt-border-status-spinner-glyphs.txt");
		const activitySpinnerGlyphPath = path.join(dir, "prompt-border-activity-spinner-glyphs.txt");
		const config = await ensurePromptBorderConfigFile(configPath);
		expect(config.leftGlyph.frames.length).toBe(73);
		expect(config.rightGlyph.frames).toEqual([]);
		expect(config.spinnerGlyphs.status.frames).toEqual([]);
		expect(config.spinnerGlyphs.activity.frames).toEqual([]);
		const saved = JSON.parse(await Bun.file(configPath).text());
		expect(saved.promptBorder.style).toBe("double");
		expect(saved.promptBorder.layout).toBe("full");
		expect(saved.promptBorder.leftGlyph).toEqual({ frameMs: 70 });
		expect(saved.promptBorder.rightGlyph).toEqual({ frameMs: 70 });
		expect(saved.promptBorder.spinnerGlyphs).toEqual({
			status: { frameMs: 80 },
			activity: { frameMs: 80 },
		});
		expect(saved.promptBorder.leftGlyph.glyphs).toBeUndefined();
		expect(saved.promptBorder.rightGlyph.glyphs).toBeUndefined();
		expect(saved.promptBorder.spinnerGlyphs.status.glyphs).toBeUndefined();
		expect(saved.promptBorder.spinnerGlyphs.activity.glyphs).toBeUndefined();
		expect(saved.promptBorder.leftGlyph.frames).toBeUndefined();
		expect(saved.promptBorder.rightGlyph.frames).toBeUndefined();
		expect(saved.promptBorder.spinnerGlyphs.status.frames).toBeUndefined();
		expect(saved.promptBorder.spinnerGlyphs.activity.frames).toBeUndefined();
		expect((await Bun.file(leftGlyphPath).text()).trim()).toMatch(/^􁦘􁦙[\s\S]*􁨨􁨩$/u);
		expect(await Bun.file(rightGlyphPath).text()).toBe("");
		expect(await Bun.file(statusSpinnerGlyphPath).text()).toBe("");
		expect(await Bun.file(activitySpinnerGlyphPath).text()).toBe("");
	});

	test("reads cursor and spinner glyph frames from sibling text files", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		const contextRailGlyphDirectory = path.join(dir, "context-rail-glyphs");
		await Bun.write(
			configPath,
			JSON.stringify({
				promptBorder: {
					leftGlyph: { frameMs: 80 },
					rightGlyph: { frameMs: 90 },
					spinnerGlyphs: {
						status: { frameMs: 85 },
						activity: { frameMs: 95 },
					},
				},
				contextRail: { glyphDirectory: contextRailGlyphDirectory },
			}, null, 2),
		);
		await Bun.write(path.join(dir, "prompt-border-left-glyphs.txt"), "AA  BB");
		await Bun.write(path.join(dir, "prompt-border-right-glyphs.txt"), "RR  SS");
		await Bun.write(path.join(dir, "prompt-border-status-spinner-glyphs.txt"), "S0  S1");
		await Bun.write(path.join(dir, "prompt-border-activity-spinner-glyphs.txt"), "A0  A1");
		await expect(readPromptBorderConfig(configPath)).resolves.toEqual({
			style: "double",
			layout: "full",
			leftGlyph: { frameMs: 80, glyphs: "AA  BB", frames: ["AA", "BB"] },
			rightGlyph: { frameMs: 90, glyphs: "RR  SS", frames: ["RR", "SS"] },
			spinnerGlyphs: {
				status: { frameMs: 85, glyphs: "S0  S1", frames: ["S0", "S1"] },
				activity: { frameMs: 95, glyphs: "A0  A1", frames: ["A0", "A1"] },
			},
			contextRail: { ...DEFAULT_CONTEXT_RAIL_CONFIG, glyphDirectory: contextRailGlyphDirectory },
		});
	});
	test("loads Context Rail label frames and fps from its configured directory", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		const glyphDirectory = path.join(dir, "context-rail-glyphs");
		await Bun.write(
			configPath,
			JSON.stringify({
				welcomeScreen: { mainText: "Keep Me" },
				contextRail: { glyphDirectory, placement: "above", size: { width: 9, height: 9 }, showLabelGlyph: "invalid" },
			}, null, 2),
		);
		await mkdir(glyphDirectory, { recursive: true });
		await Bun.write(path.join(glyphDirectory, "label.txt"), "fps=16\nsize=2x2\nA\n\nB\n");

		const config = await readPromptBorderConfig(configPath);
		expect(config.contextRail.glyphDirectory).toBe(glyphDirectory);
		expect(config.contextRail.labelGlyph).toEqual({ frames: ["A", "B"], fps: 16, size: { width: 2, height: 2 } });
		await ensurePromptBorderConfigFile(configPath);
		const saved = JSON.parse(await Bun.file(configPath).text());
		expect(saved.welcomeScreen.mainText).toBe("Keep Me");
		expect(saved.contextRail.size).toBeUndefined();
		expect(saved.contextRail.showLabelGlyph).toBe(true);
		expect(saved.contextRail.labelGlyph).toBeUndefined();
	});
	test("loads pointer glyph frames from pointer.txt without serializing them", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		const glyphDirectory = path.join(dir, "context-rail-glyphs");
		await mkdir(glyphDirectory, { recursive: true });
		await Bun.write(configPath, JSON.stringify({ contextRail: { glyphDirectory } }));
		await Bun.write(path.join(glyphDirectory, "pointer.txt"), "fps=8\no\n\nO\n");

		const config = await readPromptBorderConfig(configPath);
		expect(config.contextRail.pointerGlyph).toEqual({ frames: ["o", "O"], fps: 8 });
		await ensurePromptBorderConfigFile(configPath);
		const saved = JSON.parse(await Bun.file(configPath).text());
		expect(saved.contextRail.pointerGlyph).toBeUndefined();
	});

	test("uses an empty Context Rail asset when label.txt is missing or empty", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		const glyphDirectory = path.join(dir, "context-rail-glyphs");
		await Bun.write(configPath, JSON.stringify({ contextRail: { glyphDirectory } }));

		await expect(readPromptBorderConfig(configPath)).resolves.toMatchObject({
			contextRail: { glyphDirectory, labelGlyph: { frames: [], fps: undefined } },
		});
		await mkdir(glyphDirectory, { recursive: true });
		await Bun.write(path.join(glyphDirectory, "label.txt"), " \n\t\n");
		await expect(readPromptBorderConfig(configPath)).resolves.toMatchObject({
			contextRail: { glyphDirectory, labelGlyph: { frames: [], fps: undefined } },
		});
	});

	test("migrates legacy inline glyphs to local text files", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		const leftGlyphPath = path.join(dir, "prompt-border-left-glyphs.txt");
		const rightGlyphPath = path.join(dir, "prompt-border-right-glyphs.txt");
		const statusSpinnerGlyphPath = path.join(dir, "prompt-border-status-spinner-glyphs.txt");
		const activitySpinnerGlyphPath = path.join(dir, "prompt-border-activity-spinner-glyphs.txt");
		await Bun.write(
			configPath,
			JSON.stringify({
				promptBorder: {
					leftGlyph: { frameMs: 80, glyphs: "AA  BB" },
					rightGlyph: { frameMs: 90, glyphs: "RR  SS" },
					spinnerGlyphs: {
						status: { frameMs: 85, glyphs: "S0  S1" },
						activity: { frameMs: 95, glyphs: "A0  A1" },
					},
				},
			}, null, 2),
		);
		const config = await ensurePromptBorderConfigFile(configPath);
		expect(config.leftGlyph).toEqual({ frameMs: 80, glyphs: "AA  BB", frames: ["AA", "BB"] });
		expect(config.rightGlyph).toEqual({ frameMs: 90, glyphs: "RR  SS", frames: ["RR", "SS"] });
		expect(config.spinnerGlyphs.status).toEqual({ frameMs: 85, glyphs: "S0  S1", frames: ["S0", "S1"] });
		expect(config.spinnerGlyphs.activity).toEqual({ frameMs: 95, glyphs: "A0  A1", frames: ["A0", "A1"] });
		expect(await Bun.file(leftGlyphPath).text()).toContain("AA  BB");
		expect(await Bun.file(rightGlyphPath).text()).toContain("RR  SS");
		expect(await Bun.file(statusSpinnerGlyphPath).text()).toContain("S0  S1");
		expect(await Bun.file(activitySpinnerGlyphPath).text()).toContain("A0  A1");
		const saved = JSON.parse(await Bun.file(configPath).text());
		expect(saved.promptBorder.leftGlyph.glyphs).toBeUndefined();
		expect(saved.promptBorder.rightGlyph.glyphs).toBeUndefined();
		expect(saved.promptBorder.spinnerGlyphs.status.glyphs).toBeUndefined();
		expect(saved.promptBorder.spinnerGlyphs.activity.glyphs).toBeUndefined();
	});

	test("removes obsolete inline loading glyph config without migrating it", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		const activitySpinnerGlyphPath = path.join(dir, "prompt-border-activity-spinner-glyphs.txt");
		await Bun.write(
			configPath,
			JSON.stringify({
				promptBorder: {
					loadingGlyph: { frameMs: 90, glyphs: "LL  MM" },
				},
			}, null, 2),
		);
		const config = await ensurePromptBorderConfigFile(configPath);
		const saved = JSON.parse(await Bun.file(configPath).text());
		expect(saved.promptBorder.loadingGlyph).toBeUndefined();
		expect(config.spinnerGlyphs.activity).toEqual({ frameMs: 80, glyphs: "", frames: [] });
		expect(await Bun.file(activitySpinnerGlyphPath).text()).toBe("");
	});

	test("writes prompt border style and layout while preserving glyph config", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		const contextRailGlyphDirectory = path.join(dir, "context-rail-glyphs");
		const leftGlyphPath = path.join(dir, "prompt-border-left-glyphs.txt");
		const rightGlyphPath = path.join(dir, "prompt-border-right-glyphs.txt");
		const statusSpinnerGlyphPath = path.join(dir, "prompt-border-status-spinner-glyphs.txt");
		const activitySpinnerGlyphPath = path.join(dir, "prompt-border-activity-spinner-glyphs.txt");
		await Bun.write(
			configPath,
			JSON.stringify({
				theme: "keep-me",
				promptBorder: {
					style: "double",
					layout: "full",
					custom: "preserved",
					leftGlyph: { frameMs: 80, glyphs: "" },
					rightGlyph: { frameMs: 90, glyphs: "" },
					spinnerGlyphs: {
						status: { frameMs: 85, glyphs: "" },
						activity: { frameMs: 95, glyphs: "" },
					},
				},
				contextRail: { glyphDirectory: contextRailGlyphDirectory },
			}, null, 2),
		);
		await Bun.write(leftGlyphPath, "AA  BB");
		await Bun.write(rightGlyphPath, "RR  SS");
		await Bun.write(statusSpinnerGlyphPath, "S0  S1");
		await Bun.write(activitySpinnerGlyphPath, "A0  A1");

		const config = await writePromptBorderConfigSelection({ style: "round", layout: "sides" }, configPath);
		const saved = JSON.parse(await Bun.file(configPath).text());

		expect(config).toEqual({
			style: "round",
			layout: "sides",
			leftGlyph: { frameMs: 80, glyphs: "AA  BB", frames: ["AA", "BB"] },
			rightGlyph: { frameMs: 90, glyphs: "RR  SS", frames: ["RR", "SS"] },
			spinnerGlyphs: {
				status: { frameMs: 85, glyphs: "S0  S1", frames: ["S0", "S1"] },
				activity: { frameMs: 95, glyphs: "A0  A1", frames: ["A0", "A1"] },
			},
			contextRail: { ...DEFAULT_CONTEXT_RAIL_CONFIG, glyphDirectory: contextRailGlyphDirectory },
		});
		expect(saved.theme).toBe("keep-me");
		expect(saved.promptBorder.style).toBe("round");
		expect(saved.promptBorder.layout).toBe("sides");
		expect(saved.promptBorder.custom).toBe("preserved");
		expect(saved.promptBorder.leftGlyph.frameMs).toBe(80);
		expect(saved.promptBorder.rightGlyph.frameMs).toBe(90);
		expect(saved.promptBorder.spinnerGlyphs.status.frameMs).toBe(85);
		expect(saved.promptBorder.spinnerGlyphs.activity.frameMs).toBe(95);
		expect(saved.promptBorder.leftGlyph.glyphs).toBeUndefined();
		expect(saved.promptBorder.rightGlyph.glyphs).toBeUndefined();
		expect(saved.promptBorder.spinnerGlyphs.status.glyphs).toBeUndefined();
		expect(saved.promptBorder.spinnerGlyphs.activity.glyphs).toBeUndefined();
		expect(await Bun.file(leftGlyphPath).text()).toBe("AA  BB");
		expect(await Bun.file(rightGlyphPath).text()).toBe("RR  SS");
		expect(await Bun.file(statusSpinnerGlyphPath).text()).toBe("S0  S1");
		expect(await Bun.file(activitySpinnerGlyphPath).text()).toBe("A0  A1");
	});

	test("preserves welcome screen config when writing prompt border selection", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		await Bun.write(configPath, JSON.stringify({
			welcomeScreen: { mainText: "Keep Me" },
			promptBorder: {
				style: "double",
				layout: "full",
				leftGlyph: { frameMs: 80, glyphs: "" },
			},
		}, null, 2));

		await writePromptBorderConfigSelection({ style: "round", layout: "sides" }, configPath);
		const saved = JSON.parse(await Bun.file(configPath).text());

		expect(saved.welcomeScreen.mainText).toBe("Keep Me");
		expect(saved.promptBorder.style).toBe("round");
		expect(saved.promptBorder.layout).toBe("sides");
	});
	test("writes Context Rail settings while preserving its asset directory and unrelated JSON", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		const glyphDirectory = path.join(dir, "context-rail-glyphs");
		await mkdir(glyphDirectory, { recursive: true });
		await Bun.write(path.join(glyphDirectory, "label.txt"), "A\n");
		await Bun.write(
			configPath,
			JSON.stringify({
				welcomeScreen: { mainText: "Keep Me" },
				customPlugin: { enabled: true },
				promptBorder: { style: "round", layout: "full", leftGlyph: { frameMs: 80 } },
				contextRail: { placement: "inside", visibility: "always", glyphDirectory },
			}),
		);

		const config = await writeContextRailConfigSelection(
			{ placement: "below", visibility: "toggle", pointer: "hidden", labelPosition: "right", showLabelGlyph: false },
			configPath,
		);
		const saved = JSON.parse(await Bun.file(configPath).text());

		expect(config.contextRail).toEqual({
			enabled: true,
			placement: "below",
			visibility: "toggle",
			pointer: "hidden",
			labels: "auto",
			labelPosition: "right",
			showLabelGlyph: false,
			glyphDirectory,
			labelGlyph: { frames: ["A"], fps: undefined },
			pointerGlyph: { frames: [], fps: undefined },
		});
		expect(saved.welcomeScreen.mainText).toBe("Keep Me");
		expect(saved.customPlugin.enabled).toBe(true);
		expect(saved.promptBorder.style).toBe("round");
		expect(saved.contextRail.glyphDirectory).toBe(glyphDirectory);
		expect(saved.contextRail.showLabelGlyph).toBe(false);
		expect(saved.contextRail.labelGlyph).toBeUndefined();
	});
});

test("spinner frame override preserves unconfigured groups and restores defaults", () => {
	const fakeTheme = {
		getSpinnerFrames(type = "status") {
			return type === "activity" ? ["a0", "a1"] : ["s0", "s1"];
		},
	};

	const restore = installSpinnerGlyphFrames(fakeTheme, { activity: { frames: ["x0", "x1"], frameMs: 80 } });

	expect(fakeTheme.getSpinnerFrames("activity")).toEqual(["x0", "x1"]);
	expect(fakeTheme.getSpinnerFrames("status")).toEqual(["s0", "s1"]);
	const leaked = fakeTheme.getSpinnerFrames("activity");
	leaked.push("leak");
	expect(fakeTheme.getSpinnerFrames("activity")).toEqual(["x0", "x1"]);
	restore?.();
	expect(fakeTheme.getSpinnerFrames("activity")).toEqual(["a0", "a1"]);
});

test("spinner frame override can replace both status and activity groups", () => {
	const fakeTheme = {
		getSpinnerFrames(type = "status") {
			return type === "activity" ? ["a0", "a1"] : ["s0", "s1"];
		},
	};

	const restore = installSpinnerGlyphFrames(fakeTheme, {
		status: { frames: ["S0", "S1"], frameMs: 80 },
		activity: { frames: ["A0", "A1"], frameMs: 80 },
	});

	expect(fakeTheme.getSpinnerFrames()).toEqual(["S0", "S1"]);
	expect(fakeTheme.getSpinnerFrames("status")).toEqual(["S0", "S1"]);
	expect(fakeTheme.getSpinnerFrames("activity")).toEqual(["A0", "A1"]);
	restore?.();
	expect(fakeTheme.getSpinnerFrames("status")).toEqual(["s0", "s1"]);
	expect(fakeTheme.getSpinnerFrames("activity")).toEqual(["a0", "a1"]);
});

test("empty spinner glyph frames leave theme untouched", () => {
	const fakeTheme = {
		getSpinnerFrames(type = "status") {
			return type === "activity" ? ["a0", "a1"] : ["s0", "s1"];
		},
	};

	const original = fakeTheme.getSpinnerFrames;
	expect(installSpinnerGlyphFrames(fakeTheme, { status: { frames: [], frameMs: 240 }, activity: { frames: [], frameMs: 240 } })).toBeUndefined();
	expect(fakeTheme.getSpinnerFrames).toBe(original);
});

test("spinner frame override expands slow activity frames", () => {
	const fakeTheme = {
		getSpinnerFrames(type = "status") {
			return type === "activity" ? ["a0", "a1"] : ["s0", "s1"];
		},
	};

	const restore = installSpinnerGlyphFrames(fakeTheme, {
		activity: { frames: ["A0", "A1"], frameMs: 240 },
	});

	expect(fakeTheme.getSpinnerFrames("activity")).toEqual(["A0", "A0", "A0", "A1", "A1", "A1"]);
	expect(fakeTheme.getSpinnerFrames("status")).toEqual(["s0", "s1"]);
	restore?.();
});

test("session start applies status and activity spinner frames to the UI theme", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
	const configPath = path.join(dir, "config.json");
	await Bun.write(configPath, JSON.stringify({
		promptBorder: {
			style: "double",
			layout: "full",
			spinnerGlyphs: {
				status: { frameMs: 80 },
				activity: { frameMs: 80 },
			},
		},
	}, null, 2));
	await Bun.write(path.join(dir, "prompt-border-left-glyphs.txt"), "");
	await Bun.write(path.join(dir, "prompt-border-right-glyphs.txt"), "");
	await Bun.write(path.join(dir, "prompt-border-status-spinner-glyphs.txt"), "S0  S1");
	await Bun.write(path.join(dir, "prompt-border-activity-spinner-glyphs.txt"), "A0  A1");

	let sessionStart:
		| ((event: unknown, ctx: {
			hasUI: true;
			ui: {
				theme: { getSpinnerFrames: (type?: string) => string[] };
				setEditorComponent: (value: unknown) => void;
				notify: (message: string, level?: string) => void;
			};
		}) => Promise<void>)
		| undefined;
	const pi = {
		setLabel: () => {},
		on: (event: string, handler: typeof sessionStart) => {
			if (event === "session_start") sessionStart = handler;
		},
		registerCommand: () => {},
	} as unknown as ExtensionAPI;
	const fakeTheme = {
		getSpinnerFrames(type = "status") {
			return type === "activity" ? ["a0", "a1"] : ["s0", "s1"];
		},
	};
	const ctx = {
		hasUI: true as const,
		ui: {
			theme: fakeTheme,
			setEditorComponent: () => {},
			notify: () => {},
		},
	};

	promptBorderStyle(pi, configPath);
	await sessionStart?.({}, ctx);
	expect(fakeTheme.getSpinnerFrames()).toEqual(["S0", "S1"]);
	expect(fakeTheme.getSpinnerFrames("status")).toEqual(["S0", "S1"]);
	expect(fakeTheme.getSpinnerFrames("activity")).toEqual(["A0", "A1"]);
});
test("session shutdown restores spinner frames only for its own theme", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
	const configPath = path.join(dir, "config.json");
	await Bun.write(configPath, JSON.stringify({
		promptBorder: {
			style: "double",
			layout: "full",
			spinnerGlyphs: {
				status: { frameMs: 80 },
				activity: { frameMs: 80 },
			},
		},
	}, null, 2));
	await Bun.write(path.join(dir, "prompt-border-left-glyphs.txt"), "");
	await Bun.write(path.join(dir, "prompt-border-right-glyphs.txt"), "");
	await Bun.write(path.join(dir, "prompt-border-status-spinner-glyphs.txt"), "S0  S1");
	await Bun.write(path.join(dir, "prompt-border-activity-spinner-glyphs.txt"), "A0  A1");

	let sessionStart:
		| ((event: unknown, ctx: {
			hasUI: true;
			ui: {
				theme: { getSpinnerFrames: (type?: string) => string[] };
				setEditorComponent: (value: unknown) => void;
				notify: (message: string, level?: string) => void;
			};
		}) => Promise<void>)
		| undefined;
	let sessionShutdown:
		| ((event: unknown, ctx: {
			hasUI: true;
			ui: {
				theme: { getSpinnerFrames: (type?: string) => string[] };
				setEditorComponent: (value: unknown) => void;
				notify: (message: string, level?: string) => void;
			};
		}) => void)
		| undefined;
	const pi = {
		setLabel: () => {},
		on: (event: string, handler: typeof sessionStart | typeof sessionShutdown) => {
			if (event === "session_start") sessionStart = handler as typeof sessionStart;
			if (event === "session_shutdown") sessionShutdown = handler as typeof sessionShutdown;
		},
		registerCommand: () => {},
	} as unknown as ExtensionAPI;
	const themeOne = {
		getSpinnerFrames(type = "status") {
			return type === "activity" ? ["a1-0", "a1-1"] : ["s1-0", "s1-1"];
		},
	};
	const themeTwo = {
		getSpinnerFrames(type = "status") {
			return type === "activity" ? ["a2-0", "a2-1"] : ["s2-0", "s2-1"];
		},
	};

	promptBorderStyle(pi, configPath);
	await sessionStart?.({}, {
		hasUI: true,
		ui: {
			theme: themeOne,
			setEditorComponent: () => {},
			notify: () => {},
		},
	});
	await sessionStart?.({}, {
		hasUI: true,
		ui: {
			theme: themeTwo,
			setEditorComponent: () => {},
			notify: () => {},
		},
	});

	expect(themeOne.getSpinnerFrames("status")).toEqual(["S0", "S1"]);
	expect(themeOne.getSpinnerFrames("activity")).toEqual(["A0", "A1"]);
	expect(themeTwo.getSpinnerFrames("status")).toEqual(["S0", "S1"]);
	expect(themeTwo.getSpinnerFrames("activity")).toEqual(["A0", "A1"]);

	sessionShutdown?.({}, {
		hasUI: true,
		ui: {
			theme: themeOne,
			setEditorComponent: () => {},
			notify: () => {},
		},
	});

	expect(themeOne.getSpinnerFrames("status")).toEqual(["s1-0", "s1-1"]);
	expect(themeOne.getSpinnerFrames("activity")).toEqual(["a1-0", "a1-1"]);
	expect(themeTwo.getSpinnerFrames("status")).toEqual(["S0", "S1"]);
	expect(themeTwo.getSpinnerFrames("activity")).toEqual(["A0", "A1"]);
});

test("prompt-loading-glyphs exposes debug frame reports from config", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-loading-glyphs-"));
	const configPath = path.join(dir, "config.json");
	await Bun.write(configPath, JSON.stringify({
		promptBorder: {
			style: "double",
			layout: "full",
			spinnerGlyphs: {
				status: { frameMs: 80 },
				activity: { frameMs: 20 },
			},
		},
	}, null, 2));
	await Bun.write(path.join(dir, "prompt-border-left-glyphs.txt"), "");
	await Bun.write(path.join(dir, "prompt-border-right-glyphs.txt"), "");
	await Bun.write(path.join(dir, "prompt-border-status-spinner-glyphs.txt"), "S0  S1");
	await Bun.write(path.join(dir, "prompt-border-activity-spinner-glyphs.txt"), "F0  F1  F2  F3  F4  F5  F6  F7");

	let commandHandler:
		| ((args: string, ctx: {
			hasUI: true;
			ui: {
				theme: { getSpinnerFrames: (type?: string) => string[] };
				notify: (message: string, level?: string) => void;
				setEditorComponent: (value: unknown) => void;
				setWidget: (key: string, value: unknown) => void;
				setWorkingMessage: (message?: string) => void;
			};
		}) => Promise<void>)
		| undefined;
	const notifications: Array<{ message: string; level?: string }> = [];
	const pi = {
		setLabel: () => {},
		on: () => {},
		registerCommand: (name: string, command: { handler: typeof commandHandler }) => {
			if (name === "prompt-loading-glyphs") commandHandler = command.handler;
		},
	} as unknown as ExtensionAPI;

	const ctx = {
		hasUI: true as const,
		ui: {
			theme: { getSpinnerFrames: () => ["unused"] },
			notify: (message: string, level?: string) => {
				notifications.push({ message, level });
			},
			setEditorComponent: () => {},
			setWidget: () => {},
			setWorkingMessage: () => {},
		},
	};

	promptBorderStyle(pi, configPath);
	await commandHandler?.("debug frames", ctx);
	expect(notifications.at(-1)?.message).toContain("Prompt loading glyphs: status");
	expect(notifications.at(-1)?.message).toContain("Prompt loading glyphs: activity");
	expect(notifications.at(-1)?.message).toContain("visible (2): F0 F4");
	expect(notifications.at(-1)?.level).toBe("info");
});

test("prompt-loading-glyphs debug demo mounts a widget without calling the model", async () => {
	let commandHandler: ((args: string, ctx: {
		hasUI: true;
		ui: {
			theme: { getSpinnerFrames: (type?: string) => string[] };
			notify: (message: string, level?: string) => void;
			setEditorComponent: (value: unknown) => void;
			setWidget: (key: string, value: unknown) => void;
			setWorkingMessage: (message?: string) => void;
		};
	}) => Promise<void>) | undefined;
	const widgetCalls: Array<{ key: string; value: unknown }> = [];
	const pi = {
		setLabel: () => {},
		on: () => {},
		registerCommand: (name: string, command: { handler: typeof commandHandler }) => {
			if (name === "prompt-loading-glyphs") commandHandler = command.handler;
		},
	} as unknown as ExtensionAPI;

	promptBorderStyle(pi);
	await commandHandler?.("debug demo", {
		hasUI: true,
		ui: {
			theme: { getSpinnerFrames: (type = "status") => type === "activity" ? ["A0", "A1"] : ["S0", "S1"] },
			notify: () => {},
			setEditorComponent: () => {},
			setWidget: (key, value) => widgetCalls.push({ key, value }),
			setWorkingMessage: () => {},
		},
	});

	const widget = widgetCalls.at(-1);
	expect(widget?.key).toBe("prompt-loading-glyphs-debug");
	expect(widget?.value).toBeTruthy();
	if (typeof widget?.value !== "function") return;

	vi.useFakeTimers();
	try {
		const repaints: unknown[] = [];
		const component = (widget.value as (tui: unknown, theme: unknown) => { dispose?(): void })(
			{
				requestComponentRender(value: unknown) {
					repaints.push(value);
				},
			},
			{},
		);
		const repaintCountBeforeDispose = repaints.length;
		component.dispose?.();
		vi.advanceTimersByTime(1000);
		expect(repaints).toHaveLength(repaintCountBeforeDispose);
	} finally {
		vi.useRealTimers();
	}
});

test("prompt-loading-glyphs debug on and off set and clear the working message", async () => {
	let commandHandler: ((args: string, ctx: {
		hasUI: true;
		ui: {
			theme: { getSpinnerFrames: (type?: string) => string[] };
			notify: (message: string, level?: string) => void;
			setEditorComponent: (value: unknown) => void;
			setWidget: (key: string, value: unknown) => void;
			setWorkingMessage: (message?: string) => void;
		};
	}) => Promise<void>) | undefined;
	const workingMessages: Array<string | undefined> = [];
	const pi = {
		setLabel: () => {},
		on: () => {},
		registerCommand: (name: string, command: { handler: typeof commandHandler }) => {
			if (name === "prompt-loading-glyphs") commandHandler = command.handler;
		},
	} as unknown as ExtensionAPI;

	promptBorderStyle(pi);
	const ui = {
		theme: { getSpinnerFrames: (type = "status") => type === "activity" ? ["A0", "A1"] : ["S0", "S1"] },
		notify: () => {},
		setEditorComponent: () => {},
		setWidget: () => {},
		setWorkingMessage: (message?: string) => workingMessages.push(message),
	};

	await commandHandler?.("debug on", { hasUI: true, ui });
	await commandHandler?.("debug off", { hasUI: true, ui });

	expect(workingMessages.at(0)).toContain("[");
	expect(workingMessages.at(-1)).toBeUndefined();
});

test("session shutdown clears prompt-loading glyph debug UI state", async () => {
	let commandHandler:
		| ((args: string, ctx: {
			hasUI: true;
			ui: {
				theme: { getSpinnerFrames: (type?: string) => string[] };
				notify: (message: string, level?: string) => void;
				setEditorComponent: (value: unknown) => void;
				setWidget: (key: string, value: unknown) => void;
				setWorkingMessage: (message?: string) => void;
			};
		}) => Promise<void>)
		| undefined;
	let shutdownHandler:
		| ((event: unknown, ctx: {
			hasUI: true;
			ui: {
				setEditorComponent: (value: unknown) => void;
				setWidget: (key: string, value: unknown) => void;
				setWorkingMessage: (message?: string) => void;
			};
		}) => void)
		| undefined;
	const widgetCalls: Array<{ key: string; value: unknown }> = [];
	const workingMessages: Array<string | undefined> = [];
	const pi = {
		setLabel: () => {},
		on: (event: string, handler: typeof shutdownHandler) => {
			if (event === "session_shutdown") shutdownHandler = handler;
		},
		registerCommand: (name: string, command: { handler: typeof commandHandler }) => {
			if (name === "prompt-loading-glyphs") commandHandler = command.handler;
		},
	} as unknown as ExtensionAPI;
	const ui = {
		theme: { getSpinnerFrames: (type = "status") => type === "activity" ? ["A0", "A1"] : ["S0", "S1"] },
		notify: () => {},
		setEditorComponent: () => {},
		setWidget: (key: string, value: unknown) => widgetCalls.push({ key, value }),
		setWorkingMessage: (message?: string) => workingMessages.push(message),
	};

	promptBorderStyle(pi);
	await commandHandler?.("debug demo", { hasUI: true, ui });
	await commandHandler?.("debug on", { hasUI: true, ui });
	shutdownHandler?.({}, { hasUI: true, ui });

	expect(widgetCalls.at(-1)).toEqual({ key: "prompt-loading-glyphs-debug", value: undefined });
	expect(workingMessages.at(-1)).toBeUndefined();
});

test("prompt-loading-glyphs debug off only clears the current session state", async () => {
	let commandHandler: ((args: string, ctx: {
		hasUI: true;
		ui: {
			theme: { getSpinnerFrames: (type?: string) => string[] };
			notify: (message: string, level?: string) => void;
			setEditorComponent: (value: unknown) => void;
			setWidget: (key: string, value: unknown) => void;
			setWorkingMessage: (message?: string) => void;
		};
	}) => Promise<void>) | undefined;
	const workingMessagesA: Array<string | undefined> = [];
	const workingMessagesB: Array<string | undefined> = [];
	const pi = {
		setLabel: () => {},
		on: () => {},
		registerCommand: (name: string, command: { handler: typeof commandHandler }) => {
			if (name === "prompt-loading-glyphs") commandHandler = command.handler;
		},
	} as unknown as ExtensionAPI;
	const createUi = (workingMessages: Array<string | undefined>) => ({
		theme: { getSpinnerFrames: (type = "status") => type === "activity" ? ["A0", "A1"] : ["S0", "S1"] },
		notify: () => {},
		setEditorComponent: () => {},
		setWidget: () => {},
		setWorkingMessage: (message?: string) => workingMessages.push(message),
	});
	const uiA = createUi(workingMessagesA);
	const uiB = createUi(workingMessagesB);

	promptBorderStyle(pi);
	await commandHandler?.("debug on", { hasUI: true, ui: uiA });
	await commandHandler?.("debug on", { hasUI: true, ui: uiB });
	await commandHandler?.("debug off", { hasUI: true, ui: uiA });
	await commandHandler?.("debug off", { hasUI: true, ui: uiB });

	expect(workingMessagesA.at(-1)).toBeUndefined();
	expect(workingMessagesB.at(0)).toContain("[");
	expect(workingMessagesB.at(-1)).toBeUndefined();
});

test("session shutdown only clears prompt-loading glyph debug UI for that session", async () => {
	let commandHandler:
		| ((args: string, ctx: {
			hasUI: true;
			ui: {
				theme: { getSpinnerFrames: (type?: string) => string[] };
				notify: (message: string, level?: string) => void;
				setEditorComponent: (value: unknown) => void;
				setWidget: (key: string, value: unknown) => void;
				setWorkingMessage: (message?: string) => void;
			};
		}) => Promise<void>)
		| undefined;
	let shutdownHandler:
		| ((event: unknown, ctx: {
			hasUI: true;
			ui: {
				setEditorComponent: (value: unknown) => void;
				setWidget: (key: string, value: unknown) => void;
				setWorkingMessage: (message?: string) => void;
			};
		}) => void)
		| undefined;
	const widgetCallsA: Array<{ key: string; value: unknown }> = [];
	const widgetCallsB: Array<{ key: string; value: unknown }> = [];
	const pi = {
		setLabel: () => {},
		on: (event: string, handler: typeof shutdownHandler) => {
			if (event === "session_shutdown") shutdownHandler = handler;
		},
		registerCommand: (name: string, command: { handler: typeof commandHandler }) => {
			if (name === "prompt-loading-glyphs") commandHandler = command.handler;
		},
	} as unknown as ExtensionAPI;
	const createUi = (widgetCalls: Array<{ key: string; value: unknown }>) => ({
		theme: { getSpinnerFrames: (type = "status") => type === "activity" ? ["A0", "A1"] : ["S0", "S1"] },
		notify: () => {},
		setEditorComponent: () => {},
		setWidget: (key: string, value: unknown) => widgetCalls.push({ key, value }),
		setWorkingMessage: () => {},
	});
	const uiA = createUi(widgetCallsA);
	const uiB = createUi(widgetCallsB);

	promptBorderStyle(pi);
	await commandHandler?.("debug demo", { hasUI: true, ui: uiA });
	await commandHandler?.("debug demo", { hasUI: true, ui: uiB });
	shutdownHandler?.({}, { hasUI: true, ui: uiA });
	shutdownHandler?.({}, { hasUI: true, ui: uiB });

	expect(widgetCallsA.at(-1)).toEqual({ key: "prompt-loading-glyphs-debug", value: undefined });
	expect(widgetCallsB.at(0)).toEqual({ key: "prompt-loading-glyphs-debug", value: expect.any(Function) });
	expect(widgetCallsB.at(-1)).toEqual({ key: "prompt-loading-glyphs-debug", value: undefined });
});

describe("promptBorderStyle", () => {
	test("reset restores the default full layout for later style-only commands", async () => {
		let handler: ((args: string, ctx: { hasUI: true; ui: { setEditorComponent: (value: unknown) => void; notify: (message: string) => void } }) => Promise<void>) | undefined;
		const notifications: string[] = [];
		const pi = {
			setLabel: () => {},
			on: () => {},
			registerCommand: (_name: string, command: { handler: typeof handler }) => {
				handler = command.handler;
			},
		} as unknown as ExtensionAPI;
		const ctx = {
			hasUI: true as const,
			ui: {
				setEditorComponent: () => {},
				notify: (message: string) => {
					notifications.push(message);
				},
			},
		};

		promptBorderStyle(pi);
		expect(handler).toBeDefined();
		await handler?.("double sides", ctx);
		await handler?.("reset", ctx);
		await handler?.("round", ctx);

		expect(notifications.at(-1)).toBe("Prompt border: round full");
	});

	test("command persists applied style and layout to the config file", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		const leftGlyphPath = path.join(dir, "prompt-border-left-glyphs.txt");
		const rightGlyphPath = path.join(dir, "prompt-border-right-glyphs.txt");
		const statusSpinnerGlyphPath = path.join(dir, "prompt-border-status-spinner-glyphs.txt");
		const activitySpinnerGlyphPath = path.join(dir, "prompt-border-activity-spinner-glyphs.txt");
		await Bun.write(configPath, JSON.stringify({
			promptBorder: {
				style: "double",
				layout: "full",
				leftGlyph: { frameMs: 80, glyphs: "AA  BB" },
				rightGlyph: { frameMs: 90, glyphs: "RR  SS" },
				spinnerGlyphs: {
					status: { frameMs: 85, glyphs: "S0  S1" },
					activity: { frameMs: 95, glyphs: "A0  A1" },
				},
			},
		}, null, 2));
		await Bun.write(leftGlyphPath, "AA  BB");
		await Bun.write(rightGlyphPath, "RR  SS");
		await Bun.write(statusSpinnerGlyphPath, "S0  S1");
		await Bun.write(activitySpinnerGlyphPath, "A0  A1");
		let handler: ((args: string, ctx: { hasUI: true; ui: { setEditorComponent: (value: unknown) => void; notify: (message: string, level?: string) => void } }) => Promise<void>) | undefined;
		const notifications: string[] = [];
		const pi = {
			setLabel: () => {},
			on: () => {},
			registerCommand: (_name: string, command: { handler: typeof handler }) => {
				handler = command.handler;
			},
		} as unknown as ExtensionAPI;
		const ctx = {
			hasUI: true as const,
			ui: {
				setEditorComponent: () => {},
				notify: (message: string) => {
					notifications.push(message);
				},
			},
		};

		promptBorderStyle(pi, configPath);
		await handler?.("round sides", ctx);
		const saved = JSON.parse(await Bun.file(configPath).text());

		expect(saved.promptBorder.style).toBe("round");
		expect(saved.promptBorder.layout).toBe("sides");
		expect(saved.promptBorder.leftGlyph).toEqual({ frameMs: 80 });
		expect(saved.promptBorder.rightGlyph).toEqual({ frameMs: 90 });
		expect(saved.promptBorder.spinnerGlyphs).toEqual({
			status: { frameMs: 85 },
			activity: { frameMs: 95 },
		});
		expect(await Bun.file(leftGlyphPath).text()).toBe("AA  BB");
		expect(await Bun.file(rightGlyphPath).text()).toBe("RR  SS");
		expect(await Bun.file(statusSpinnerGlyphPath).text()).toBe("S0  S1");
		expect(await Bun.file(activitySpinnerGlyphPath).text()).toBe("A0  A1");
		expect(notifications.at(-1)).toBe("Prompt border: round sides");
	});
});

describe("Context Rail command", () => {
	test("parses placement, visibility, and visual options", () => {
		expect(parseContextRailArgs("placement below")).toEqual({ kind: "set", update: { placement: "below" } });
		expect(parseContextRailArgs("visibility collapse-while-typing")).toEqual({
			kind: "set",
			update: { visibility: "collapse-while-typing" },
		});
		expect(parseContextRailArgs("pointer hidden")).toEqual({ kind: "set", update: { pointer: "hidden" } });
		expect(parseContextRailArgs("labels bar-only")).toEqual({ kind: "set", update: { labels: "bar-only" } });
		expect(parseContextRailArgs("position right")).toEqual({ kind: "set", update: { labelPosition: "right" } });
		expect(parseContextRailArgs("label-glyph on")).toEqual({ kind: "set", update: { showLabelGlyph: true } });
		expect(parseContextRailArgs("label-glyph off")).toEqual({ kind: "set", update: { showLabelGlyph: false } });
		expect(parseContextRailArgs("position diagonal")).toEqual({ kind: "invalid" });
		expect(parseContextRailArgs("label-glyph")).toEqual({ kind: "invalid" });
		expect(parseContextRailArgs("label-glyph toggle")).toEqual({ kind: "invalid" });
		expect(parseContextRailArgs("label-glyph maybe")).toEqual({ kind: "invalid" });
		expect(parseContextRailArgs("label-glyph off extra")).toEqual({ kind: "invalid" });
		expect(parseContextRailArgs("nope")).toEqual({ kind: "invalid" });
		expect(parseContextRailArgs("init")).toEqual({ kind: "init", target: "glyphs" });
		expect(parseContextRailArgs("init glyphs")).toEqual({ kind: "init", target: "glyphs" });
		expect(parseContextRailArgs("init config")).toEqual({ kind: "invalid" });
	});

	test("completes Context Rail subcommands without dropping their parent token", () => {
		expect(getContextRailArgumentCompletions("")?.map(item => item.value)).toEqual(
			expect.arrayContaining(["on", "off", "toggle", "status", "init", "placement", "visibility", "pointer", "labels", "label-glyph", "position"]),
		);
		expect(getContextRailArgumentCompletions("init ")?.map(item => item.value)).toEqual(["init glyphs"]);
		expect(getContextRailArgumentCompletions("init g")?.map(item => item.value)).toEqual(["init glyphs"]);
		expect(getContextRailArgumentCompletions("label-glyph ")?.map(item => item.value)).toEqual([
			"label-glyph on",
			"label-glyph off",
		]);
		expect(getContextRailArgumentCompletions("label-glyph o")?.map(item => item.value)).toEqual([
			"label-glyph on",
			"label-glyph off",
		]);
		expect(getContextRailArgumentCompletions("placement ")?.map(item => item.value)).toEqual([
			"placement inside",
			"placement above",
			"placement below",
		]);
		expect(getContextRailArgumentCompletions("pointer h")?.map(item => item.value)).toEqual(["pointer hidden"]);
		expect(getContextRailArgumentCompletions("position ")?.map(item => item.value)).toEqual([
			"position left",
			"position center",
			"position right",
		]);
		expect(getContextRailArgumentCompletions("position r")?.map(item => item.value)).toEqual(["position right"]);
	});
	test("includes the persisted label position in status", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		await Bun.write(configPath, JSON.stringify({ contextRail: { labelPosition: "right" } }));
		let contextRailHandler: ((args: string, ctx: { hasUI: true; ui: { theme: unknown; notify: (message: string, level?: string) => void } }) => Promise<void>) | undefined;
		const notifications: string[] = [];
		const pi = {
			setLabel: () => {},
			on: () => {},
			registerCommand: (name: string, command: { handler: typeof contextRailHandler }) => {
				if (name === "context-rail") contextRailHandler = command.handler;
			},
		} as unknown as ExtensionAPI;

		promptBorderStyle(pi, configPath);
		await contextRailHandler?.("status", {
			hasUI: true,
			ui: {
				theme: {
					symbol: () => "",
					fg: (_name: string, value: string) => value,
				},
				notify: (message: string) => notifications.push(message),
			},
		});

		expect(notifications.at(-1)).toContain("label-position right");
		expect(notifications.at(-1)).toContain("label-glyph on");
	});
	test("persists label-glyph off through the registered command", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		const glyphDirectory = path.join(dir, "context-rail-glyphs");
		await mkdir(glyphDirectory, { recursive: true });
		await Bun.write(path.join(glyphDirectory, "label.txt"), "A0\n\nA1\n");
		await Bun.write(path.join(glyphDirectory, "pointer.txt"), "o\n");
		await Bun.write(
			configPath,
			JSON.stringify({ welcomeScreen: { mainText: "Keep Me" }, contextRail: { glyphDirectory, showLabelGlyph: true } }),
		);

		type LifecycleHandler = (event: unknown, ctx: unknown) => Promise<void> | void;
		type ContextRailHandler = (args: string, ctx: unknown) => Promise<void>;
		let sessionStart: LifecycleHandler | undefined;
		let sessionShutdown: LifecycleHandler | undefined;
		let contextRailHandler: ContextRailHandler | undefined;
		const notifications: string[] = [];
		const pi = {
			setLabel: () => {},
			on: (event: string, handler: LifecycleHandler) => {
				if (event === "session_start") sessionStart = handler;
				if (event === "session_shutdown") sessionShutdown = handler;
			},
			registerCommand: (name: string, command: { handler: ContextRailHandler }) => {
				if (name === "context-rail") contextRailHandler = command.handler;
			},
		} as unknown as ExtensionAPI;
		const theme = {
			symbol: () => "",
			fg: (_name: string, value: string) => value,
			getSpinnerFrames: () => [] as string[],
			boxRound: borderStyles.round,
		};
		const ctx = {
			hasUI: true as const,
			getContextUsage: () => ({ tokens: 50_000, contextWindow: 100_000, percent: 50 }),
			ui: {
				theme,
				setEditorComponent: () => {},
				setWidget: () => {},
				setWorkingMessage: () => {},
				notify: (message: string) => notifications.push(message),
			},
		};

		promptBorderStyle(pi, configPath);
		await sessionStart?.({}, ctx);
		await contextRailHandler?.("label-glyph off", ctx);
		const saved = JSON.parse(await Bun.file(configPath).text());

		expect(saved.welcomeScreen.mainText).toBe("Keep Me");
		expect(saved.contextRail.showLabelGlyph).toBe(false);
		expect(notifications.at(-1)).toContain("label-glyph off");
		expect(await Bun.file(path.join(glyphDirectory, "label.txt")).text()).toBe("A0\n\nA1\n");
		sessionShutdown?.({}, ctx);
	});
	test("creates a default label asset without confirmation and reloads it", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		const glyphDirectory = path.join(dir, "context-rail-glyphs");
		await Bun.write(configPath, JSON.stringify({ contextRail: { glyphDirectory } }));
		type ContextRailHandler = (
			args: string,
			ctx: {
				hasUI: true;
				ui: {
					theme: unknown;
					confirm: (title: string, message: string) => Promise<boolean>;
					notify: (message: string, level?: string) => void;
				};
			},
		) => Promise<void>;
		let contextRailHandler: ContextRailHandler | undefined;
		const notifications: string[] = [];
		let confirmationCalls = 0;
		const pi = {
			setLabel: () => {},
			on: () => {},
			registerCommand: (name: string, command: { handler: ContextRailHandler }) => {
				if (name === "context-rail") contextRailHandler = command.handler;
			},
		} as unknown as ExtensionAPI;

		promptBorderStyle(pi, configPath);
		await contextRailHandler?.("init", {
			hasUI: true,
			ui: {
				theme: {
					symbol: (name: string) => (name === "status.success" ? "◆" : ""),
					fg: (_name: string, value: string) => value,
				},
				confirm: async () => {
					confirmationCalls += 1;
					return false;
				},
				notify: (message: string) => notifications.push(message),
			},
		});

		expect(confirmationCalls).toBe(0);
		expect(await Bun.file(path.join(glyphDirectory, "label.txt")).text()).toBe("◆\n");
		expect(await Bun.file(path.join(glyphDirectory, "pointer.txt")).text()).toBe("●\n");
		expect(notifications.at(-1)).toContain("Created");
		await expect(readPromptBorderConfig(configPath)).resolves.toMatchObject({
			contextRail: { glyphDirectory, labelGlyph: { frames: ["◆"], fps: undefined } },
		});
	});

	test("preserves declined overwrites and replaces confirmed label assets", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		const glyphDirectory = path.join(dir, "context-rail-glyphs");
		await mkdir(glyphDirectory, { recursive: true });
		const labelPath = path.join(glyphDirectory, "label.txt");
		await Bun.write(labelPath, "OLD\n");
		await Bun.write(configPath, JSON.stringify({ contextRail: { glyphDirectory } }));
		type ContextRailHandler = (
			args: string,
			ctx: {
				hasUI: true;
				ui: {
					theme: unknown;
					confirm: (title: string, message: string) => Promise<boolean>;
					notify: (message: string, level?: string) => void;
				};
			},
		) => Promise<void>;
		let contextRailHandler: ContextRailHandler | undefined;
		const notifications: string[] = [];
		let overwrite = false;
		const pi = {
			setLabel: () => {},
			on: () => {},
			registerCommand: (name: string, command: { handler: ContextRailHandler }) => {
				if (name === "context-rail") contextRailHandler = command.handler;
			},
		} as unknown as ExtensionAPI;

		promptBorderStyle(pi, configPath);
		const ctx = {
			hasUI: true as const,
			ui: {
				theme: {
					symbol: (name: string) => (name === "status.success" ? "◆" : ""),
					fg: (_name: string, value: string) => value,
				},
				confirm: async () => overwrite,
				notify: (message: string) => notifications.push(message),
			},
		};
		await contextRailHandler?.("init glyphs", ctx);
		expect(await Bun.file(labelPath).text()).toBe("OLD\n");
		expect(notifications.at(-1)).toContain("Skipped");
		overwrite = true;
		await contextRailHandler?.("init glyphs", ctx);
		expect(await Bun.file(labelPath).text()).toBe("◆\n");
		expect(notifications.at(-1)).toContain("Overwritten");
	});
	test("reports Context Rail label write failures", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		await Bun.write(configPath, JSON.stringify({ contextRail: { glyphDirectory: "/dev/null/context-rail" } }));
		let contextRailHandler:
			| ((args: string, ctx: unknown) => Promise<void>)
			| undefined;
		const notifications: string[] = [];
		const pi = {
			setLabel: () => {},
			on: () => {},
			registerCommand: (name: string, command: { handler: typeof contextRailHandler }) => {
				if (name === "context-rail") contextRailHandler = command.handler;
			},
		} as unknown as ExtensionAPI;

		promptBorderStyle(pi, configPath);
		await contextRailHandler?.("init glyphs", {
			hasUI: true,
			ui: {
				theme: {
					symbol: () => "◆",
					fg: (_name: string, value: string) => value,
				},
				confirm: async () => true,
				notify: (message: string) => notifications.push(message),
			},
		});

		expect(notifications.at(-1)).toContain("Failed");
	});
});

test("uses the theme success glyph or the hard fallback for missing label assets", async () => {
	for (const variant of [
		{ expected: "★", symbol: (name: string) => (name === "status.success" ? "★" : "") },
		{ expected: "✓", symbol: () => "" },
		{ expected: "✓", symbol: () => { throw new Error("theme symbol failure"); } },
		{ expected: "✓", symbol: "not callable" },
	] as const) {
		const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
		const configPath = path.join(dir, "config.json");
		const glyphDirectory = path.join(dir, "missing-context-rail-glyphs");
		await Bun.write(
			configPath,
			JSON.stringify({
				promptBorder: { style: "double", layout: "full" },
				contextRail: {
					pointer: "hidden",
					labels: "always",
					labelPosition: "left",
					glyphDirectory,
				},
			}),
		);
		for (const fileName of [
			"prompt-border-left-glyphs.txt",
			"prompt-border-right-glyphs.txt",
			"prompt-border-status-spinner-glyphs.txt",
			"prompt-border-activity-spinner-glyphs.txt",
		]) {
			await Bun.write(path.join(dir, fileName), "");
		}

		let sessionStart: ((event: unknown, ctx: unknown) => Promise<void>) | undefined;
		let sessionShutdown: ((event: unknown, ctx: unknown) => void) | undefined;
		let editorFactory: ((tui: { requestRender: () => void }, editorTheme: EditorTheme) => PromptBorderEditor) | undefined;
		const agentTheme = {
			symbol: variant.symbol,
			fg: (_name: string, value: string) => value,
			getSpinnerFrames: () => [] as string[],
		};
		const pi = {
			setLabel: () => {},
			on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<void> | void) => {
				if (event === "session_start") sessionStart = handler as typeof sessionStart;
				if (event === "session_shutdown") sessionShutdown = handler as typeof sessionShutdown;
			},
			registerCommand: () => {},
		} as unknown as ExtensionAPI;
		const ctx = {
			hasUI: true as const,
			getContextUsage: () => ({ tokens: 50_000, contextWindow: 100_000, percent: 50 }),
			ui: {
				theme: agentTheme,
				setEditorComponent: (value: unknown) => {
					if (typeof value === "function") {
						editorFactory = value as (tui: { requestRender: () => void }, editorTheme: EditorTheme) => PromptBorderEditor;
					}
				},
				setWidget: () => {},
				setWorkingMessage: () => {},
				notify: () => {},
			},
		};

		promptBorderStyle(pi, configPath);
		await sessionStart?.({}, ctx);
		const editor = editorFactory?.({ requestRender: () => {} }, theme);
		const line = editor?.render(20).find(value => value.includes("50%")) ?? "";
		expect(line).toContain(`${variant.expected}50%`);
		expect(visibleWidth(line)).toBe(20);
		sessionShutdown?.({}, ctx);
	}
});

test("animates Context Rail labels across inside, above, and below placements", async () => {
	vi.useFakeTimers();
	try {
		for (const placement of ["inside", "above", "below"] as const) {
			const dir = await mkdtemp(path.join(os.tmpdir(), "prompt-border-"));
			const configPath = path.join(dir, "config.json");
			const glyphDirectory = path.join(dir, "context-rail-glyphs");
			await mkdir(glyphDirectory, { recursive: true });
			await Bun.write(path.join(glyphDirectory, "label.txt"), "fps=16\nsize=2x2\nA0A1\nB0B1\n\nC0C1\nD0D1\n");
			await Bun.write(path.join(glyphDirectory, "pointer.txt"), "fps=16\no\n\nO\n");
			await Bun.write(
				configPath,
				JSON.stringify({
					promptBorder: { style: "double", layout: "full" },
					contextRail: {
						placement,
						pointer: "visible",
						labels: "always",
						labelPosition: "left",
						glyphDirectory,
					},
				}),
			);
			for (const fileName of [
				"prompt-border-left-glyphs.txt",
				"prompt-border-right-glyphs.txt",
				"prompt-border-status-spinner-glyphs.txt",
				"prompt-border-activity-spinner-glyphs.txt",
			]) {
				await Bun.write(path.join(dir, fileName), "");
			}

			type EditorFactory = (tui: { requestRender: () => void }, editorTheme: EditorTheme) => PromptBorderEditor;
			type Widget = { render: (width: number) => readonly string[] };
			type WidgetFactory = (tui: unknown, widgetTheme: EditorTheme) => Widget;
			type LifecycleHandler = (event: unknown, ctx: unknown) => Promise<void> | void;
			type CommandHandler = (args: string, ctx: unknown) => Promise<void>;
			let sessionStart: LifecycleHandler | undefined;
			let sessionShutdown: LifecycleHandler | undefined;
			let editorFactory: EditorFactory | undefined;
			let widgetFactory: WidgetFactory | undefined;
			let contextRailHandler: CommandHandler | undefined;
			const pi = {
				setLabel: () => {},
				on: (event: string, handler: LifecycleHandler) => {
					if (event === "session_start") sessionStart = handler;
					if (event === "session_shutdown") sessionShutdown = handler;
				},
				registerCommand: (name: string, command: { handler: CommandHandler }) => {
					if (name === "context-rail") contextRailHandler = command.handler;
				},
			} as unknown as ExtensionAPI;
			const agentTheme = {
				symbol: (name: string) => (name === "status.success" ? "✓" : ""),
				fg: (_name: string, value: string) => value,
				getSpinnerFrames: () => [] as string[],
				boxRound: borderStyles.round,
			};
			let repaints = 0;
			const setWorkingMessage = () => {};
			const ctx = {
				hasUI: true as const,
				getContextUsage: () => ({ tokens: 50_000, contextWindow: 100_000, percent: 50 }),
				ui: {
					theme: agentTheme,
					setEditorComponent: (value: unknown) => {
						if (typeof value === "function") editorFactory = value as EditorFactory;
					},
					setWidget: (_key: string, value: unknown) => {
						if (typeof value === "function") widgetFactory = value as WidgetFactory;
					},
					setWorkingMessage,
					notify: () => {},
				},
			};

			promptBorderStyle(pi, configPath);
			await sessionStart?.({}, ctx);
			const editor = editorFactory?.({ requestRender: () => (repaints += 1) }, theme);
			const widget = placement === "inside" ? undefined : widgetFactory?.({}, agentTheme as unknown as EditorTheme);
			const renderRail = (): readonly string[] => {
				const lines = placement === "inside" ? editor?.render(20) ?? [] : widget?.render(20) ?? [];
				const gaugeLine = lines.find(value => value.includes("50%")) ?? "";
				expect(visibleWidth(gaugeLine)).toBe(20);
				expect(lines.some(value => value.includes("A0A1") || value.includes("C0C1"))).toBe(true);
				expect(lines.some(value => value.includes("B0B1") || value.includes("D0D1"))).toBe(true);
				return lines;
			};

			let lines = renderRail();
			expect(lines.some(value => value.includes("A0A1"))).toBe(true);
			expect(lines.some(value => value.includes("B0B1"))).toBe(true);
			expect(lines.some(value => value.includes("o"))).toBe(true);
			vi.advanceTimersByTime(62);
			expect(repaints).toBe(0);
			vi.advanceTimersByTime(1);
			expect(repaints).toBe(2);
			lines = renderRail();
			expect(lines.some(value => value.includes("C0C1"))).toBe(true);
			expect(lines.some(value => value.includes("D0D1"))).toBe(true);
			expect(lines.some(value => value.includes("O"))).toBe(true);

			const beforeWrap = repaints;
			vi.advanceTimersByTime(63);
			expect(repaints).toBe(beforeWrap + 2);
			lines = renderRail();
			expect(lines.some(value => value.includes("A0A1"))).toBe(true);
			expect(lines.some(value => value.includes("o"))).toBe(true);

			const beforeReload = repaints;
			await contextRailHandler?.("labels always", ctx);
			const afterReload = repaints;
			expect(afterReload).toBeGreaterThanOrEqual(beforeReload);
			vi.advanceTimersByTime(63);
			expect(repaints).toBe(afterReload);
			const beforeHide = repaints;
			await contextRailHandler?.("label-glyph off", ctx);
			const afterHide = repaints;
			expect(afterHide).toBeGreaterThanOrEqual(beforeHide);
			let hiddenLines = placement === "inside" ? editor?.render(20) ?? [] : widget?.render(20) ?? [];
			const hiddenGaugeLine = hiddenLines.find(value => value.includes("50%")) ?? "";
			expect(visibleWidth(hiddenGaugeLine)).toBe(20);
			expect(hiddenLines.some(value => value.includes("A0A1") || value.includes("C0C1"))).toBe(false);
			expect(hiddenLines.some(value => value.includes("B0B1") || value.includes("D0D1"))).toBe(false);
			expect(hiddenLines.some(value => value.includes("o"))).toBe(true);
			const beforeHiddenTimer = repaints;
			vi.advanceTimersByTime(62);
			expect(repaints).toBe(beforeHiddenTimer);
			vi.advanceTimersByTime(1);
			expect(repaints).toBe(beforeHiddenTimer + 1);
			hiddenLines = placement === "inside" ? editor?.render(20) ?? [] : widget?.render(20) ?? [];
			expect(hiddenLines.some(value => value.includes("50%"))).toBe(true);
			expect(hiddenLines.some(value => value.includes("A0A1") || value.includes("C0C1"))).toBe(false);
			expect(hiddenLines.some(value => value.includes("B0B1") || value.includes("D0D1"))).toBe(false);
			expect(hiddenLines.some(value => value.includes("O"))).toBe(true);

			const beforeShutdown = repaints;
			sessionShutdown?.({}, ctx);
			vi.advanceTimersByTime(63);
			expect(repaints).toBe(beforeShutdown);
			vi.clearAllTimers();
		}
	} finally {
		vi.useRealTimers();
	}
});

describe("getPromptBorderArgumentCompletions", () => {
	test("shows primary options after an empty argument prefix", () => {
		expect(getPromptBorderArgumentCompletions("")?.map(item => item.value)).toEqual(
			expect.arrayContaining(["round", "double", "heavy", "layout", "reset"]),
		);
	});

	test("filters primary options by the current token", () => {
		expect(getPromptBorderArgumentCompletions("do")?.map(item => item.value)).toEqual([
			"double",
			"double-top",
			"double-side",
			"double-vertical",
			"double-horizontal",
		]);
	});

	test("preserves the completed style token when suggesting layouts", () => {
		expect(getPromptBorderArgumentCompletions("round ")?.map(item => item.value)).toEqual([
			"round full",
			"round bottom",
			"round sides",
			"round top-bottom",
			"round default",
		]);
		expect(getPromptBorderArgumentCompletions("round f")?.map(item => item.value)).toEqual(["round full"]);
	});

	test("shows layouts after the layout subcommand", () => {
		expect(getPromptBorderArgumentCompletions("layout ")?.map(item => item.label)).toEqual([
			"full",
			"bottom",
			"sides",
			"top-bottom",
			"default",
		]);
	});
	
	test("inserts layout subcommand values without dropping the layout token", () => {
		expect(getPromptBorderArgumentCompletions("layout")?.find(item => item.label === "full")).toEqual({
			value: "layout full",
			label: "full",
		});
		expect(getPromptBorderArgumentCompletions("layout ")?.map(item => item.value)).toEqual([
			"layout full",
			"layout bottom",
			"layout sides",
			"layout top-bottom",
			"layout default",
		]);
		expect(getPromptBorderArgumentCompletions("layout f")?.map(item => item.value)).toEqual(["layout full"]);
	});

	test("returns no options after a complete two-token command", () => {
		expect(getPromptBorderArgumentCompletions("double bottom ")).toBeNull();
	});
});
