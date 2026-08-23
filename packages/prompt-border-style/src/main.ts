import { CustomEditor, type ExtensionAPI, type ExtensionUIContext, type SpinnerType, type Theme } from "@oh-my-pi/pi-coding-agent";
import { mkdir } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	Box,
	CURSOR_MARKER,
	Loader,
	sliceByColumn,
	Text,
	truncateToWidth,
	visibleWidth,
	type AutocompleteItem,
	type EditorTheme,
	type EditorTopBorder,
} from "@oh-my-pi/pi-tui";

export type BorderStyleName =
	| "round"
	| "sharp"
	| "heavy"
	| "dashed"
	| "heavy-dashed"
	| "heavy-top"
	| "double"
	| "double-top"
	| "double-side"
	| "ascii"
	| "block"
	| "vertical"
	| "double-vertical"
	| "horizontal"
	| "double-horizontal";

export type BorderLayoutName = "full" | "bottom" | "sides" | "top-bottom" | "default";

export type PromptBorderState = {
	style: BorderStyleName;
	layout: BorderLayoutName;
};

export type PromptBorderGlyphConfig = {
	frameMs: number;
	glyphs: string;
	frames: string[];
};

export type PromptBorderGlyphSide = "left" | "right";
type PromptBorderSpinnerGlyphSlot = SpinnerType;
type PromptBorderGlyphSlot = PromptBorderGlyphSide | PromptBorderSpinnerGlyphSlot;
type PromptBorderSpinnerGlyphConfig = Record<PromptBorderSpinnerGlyphSlot, PromptBorderGlyphConfig>;

export type PromptBorderConfig = {
	style: BorderStyleName;
	layout: BorderLayoutName;
	leftGlyph: PromptBorderGlyphConfig;
	rightGlyph: PromptBorderGlyphConfig;
	spinnerGlyphs: PromptBorderSpinnerGlyphConfig;
};

export type PromptBorderGlyphs = Pick<
	EditorTheme["symbols"]["boxRound"],
	"topLeft" | "topRight" | "bottomLeft" | "bottomRight" | "horizontal" | "vertical"
>;

export const borderStyles: Record<BorderStyleName, PromptBorderGlyphs> = {
	round: { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│" },
	sharp: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "─", vertical: "│" },
	heavy: { topLeft: "┏", topRight: "┓", bottomLeft: "┗", bottomRight: "┛", horizontal: "━", vertical: "┃" },
	dashed: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "╌", vertical: "╎" },
	"heavy-dashed": { topLeft: "┏", topRight: "┓", bottomLeft: "┗", bottomRight: "┛", horizontal: "╍", vertical: "╏" },
	"heavy-top": { topLeft: "┍", topRight: "┑", bottomLeft: "┕", bottomRight: "┙", horizontal: "━", vertical: "│" },
	double: { topLeft: "╔", topRight: "╗", bottomLeft: "╚", bottomRight: "╝", horizontal: "═", vertical: "║" },
	"double-top": { topLeft: "╒", topRight: "╕", bottomLeft: "╘", bottomRight: "╛", horizontal: "═", vertical: "│" },
	"double-side": { topLeft: "╓", topRight: "╖", bottomLeft: "╙", bottomRight: "╜", horizontal: "─", vertical: "║" },
	ascii: { topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+", horizontal: "-", vertical: "|" },
	block: { topLeft: "▲", topRight: "▲", bottomLeft: "▼", bottomRight: "▼", horizontal: " ", vertical: "█" },
	vertical: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: " ", vertical: "│" },
	"double-vertical": { topLeft: "╓", topRight: "╖", bottomLeft: "╙", bottomRight: "╜", horizontal: " ", vertical: "║" },
	horizontal: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "─", vertical: " " },
	"double-horizontal": { topLeft: "╒", topRight: "╕", bottomLeft: "╘", bottomRight: "╛", horizontal: "═", vertical: " " },
};

const STYLE_NAMES = Object.keys(borderStyles) as BorderStyleName[];
const LAYOUT_NAMES = ["full", "bottom", "sides", "top-bottom", "default"] as const;
const PRIMARY_COMMAND_OPTIONS = [...STYLE_NAMES, "layout", "reset"] as const;
const USAGE = `Usage: /prompt-border <${STYLE_NAMES.join("|")}> [full|bottom|sides|top-bottom|default] | /prompt-border layout <full|bottom|sides|top-bottom|default> | /prompt-border reset`;
const PROMPT_LOADING_GLYPHS_USAGE = "Usage: /prompt-loading-glyphs debug <frames|demo|on|off>";
const DEFAULT_GLYPH_FRAME_MS = 70;
const DEFAULT_SPINNER_GLYPH_FRAME_MS = 80;
const HOST_SPINNER_FRAME_MS = 80;
const LOADING_GLYPH_DEBUG_ROOT_OPTIONS = ["debug"] as const;
const LOADING_GLYPH_DEBUG_ACTIONS = ["frames", "demo", "on", "off"] as const;
const SPINNER_GLYPH_SLOTS = ["status", "activity"] as const satisfies readonly SpinnerType[];
const GLYPH_TEXT_FILE_NAMES: Record<PromptBorderGlyphSlot, string> = {
	left: "prompt-border-left-glyphs.txt",
	right: "prompt-border-right-glyphs.txt",
	status: "prompt-border-status-spinner-glyphs.txt",
	activity: "prompt-border-activity-spinner-glyphs.txt",
};
export const DEFAULT_LEFT_GLYPH_TEXT_PATH = path.join(
	os.homedir(),
	".config",
	"codesook-omp",
	GLYPH_TEXT_FILE_NAMES.left,
);
export const DEFAULT_RIGHT_GLYPH_TEXT_PATH = path.join(
	os.homedir(),
	".config",
	"codesook-omp",
	GLYPH_TEXT_FILE_NAMES.right,
);
export const DEFAULT_STATUS_SPINNER_GLYPH_TEXT_PATH = path.join(
	os.homedir(),
	".config",
	"codesook-omp",
	GLYPH_TEXT_FILE_NAMES.status,
);
export const DEFAULT_ACTIVITY_SPINNER_GLYPH_TEXT_PATH = path.join(
	os.homedir(),
	".config",
	"codesook-omp",
	GLYPH_TEXT_FILE_NAMES.activity,
);

export const CONFIG_PATH = path.join(os.homedir(), ".config", "codesook-omp", "config.json");

export const DEFAULT_LEFT_GLYPH_TEXT =
	"􁦘􁦙  􁦚􁦛  􁦜􁦝  􁦞􁦟  􁦠􁦡  􁦢􁦣  􁦤􁦥  􁦦􁦧  􁦨􁦩  􁦪􁦫  􁦬􁦭  􁦮􁦯  􁦰􁦱  􁦲􁦳  􁦴􁦵  􁦶􁦷  􁦸􁦹  􁦺􁦻  􁦼􁦽  􁦾􁦿  􁧀􁧁  􁧂􁧃  􁧄􁧅  􁧆􁧇  􁧈􁧉  􁧊􁧋  􁧌􁧍  􁧎􁧏  􁧐􁧑  􁧒􁧓  􁧔􁧕  􁧖􁧗  􁧘􁧙  􁧚􁧛  􁧜􁧝  􁧞􁧟  􁧠􁧡  􁧢􁧣  􁧤􁧥  􁧦􁧧  􁧨􁧩  􁧪􁧫  􁧬􁧭  􁧮􁧯  􁧰􁧱  􁧲􁧳  􁧴􁧵  􁧶􁧷  􁧸􁧹  􁧺􁧻  􁧼􁧽  􁧾􁧿  􁨀􁨁  􁨂􁨃  􁨄􁨅  􁨆􁨇  􁨈􁨉  􁨊􁨋  􁨌􁨍  􁨎􁨏  􁨐􁨑  􁨒􁨓  􁨔􁨕  􁨖􁨗  􁨘􁨙  􁨚􁨛  􁨜􁨝  􁨞􁨟  􁨠􁨡  􁨢􁨣  􁨤􁨥  􁨦􁨧  􁨨􁨩";

export function parseGlyphFrames(glyphs: string): string[] {
	return glyphs.trim().split(/\s+/u).filter(Boolean);
}

export function buildTimedSpinnerFrames(
	frames: readonly string[],
	frameMs: number,
	hostFrameMs = HOST_SPINNER_FRAME_MS,
): string[] {
	if (frames.length === 0) return [];
	const safeHostFrameMs = Number.isFinite(hostFrameMs) && hostFrameMs > 0 ? hostFrameMs : HOST_SPINNER_FRAME_MS;
	const safeFrameMs =
		Number.isFinite(frameMs) && frameMs >= 16 && frameMs <= 1000 ? frameMs : DEFAULT_SPINNER_GLYPH_FRAME_MS;
	const hostFrameCount = Math.max(1, Math.round((frames.length * safeFrameMs) / safeHostFrameMs));
	return Array.from({ length: hostFrameCount }, (_unused, hostFrameIndex) => {
		const sourceFrameIndex = Math.floor((hostFrameIndex * safeHostFrameMs) / safeFrameMs) % frames.length;
		return frames[sourceFrameIndex];
	});
}

export type PromptLoadingGlyphDebugAction =
	| { kind: "frames" }
	| { kind: "demo" }
	| { kind: "on" }
	| { kind: "off" }
	| { kind: "invalid" };

export type SpinnerFrameDebugMode = "empty" | "unchanged" | "repeated" | "skipped";

export type SpinnerFrameDebugReport = {
	type: SpinnerType;
	frameMs: number;
	sourceFrames: readonly string[];
	visibleFrames: readonly string[];
	mode: SpinnerFrameDebugMode;
};

export function createSpinnerFrameDebugReport(type: SpinnerType, config: SpinnerGlyphFrameOverride): SpinnerFrameDebugReport {
	const visibleFrames = buildTimedSpinnerFrames(config.frames, config.frameMs);
	const mode: SpinnerFrameDebugMode =
		config.frames.length === 0
			? "empty"
			: visibleFrames.length === 0 || (visibleFrames.length === config.frames.length && visibleFrames.every((frame, index) => frame === config.frames[index]))
				? "unchanged"
				: visibleFrames.length > config.frames.length
					? "repeated"
					: "skipped";
	return {
		type,
		frameMs: config.frameMs,
		sourceFrames: Array.from(config.frames),
		visibleFrames,
		mode,
	};
}

export function formatSpinnerFrameDebugReport(report: SpinnerFrameDebugReport): string {
	const modeLine =
		report.mode === "repeated"
			? "mode: repeats frames to match 80ms host tick"
			: report.mode === "skipped"
				? "mode: skips source frames to match 80ms host tick"
				: report.mode === "empty"
					? "mode: no configured frames; host defaults will render"
					: "mode: keeps frames unchanged at 80ms host tick";
	const note =
		report.mode === "skipped"
			? "note: smooth looping must hold on the visible subsequence, not only the full source list"
			: undefined;
	return [
		`Prompt loading glyphs: ${report.type}`,
		`frameMs: ${report.frameMs}`,
		`source (${report.sourceFrames.length}): ${report.sourceFrames.join(" ") || "<empty>"}`,
		`visible (${report.visibleFrames.length}): ${report.visibleFrames.join(" ") || "<host defaults>"}`,
		modeLine,
		note,
	]
		.filter(Boolean)
		.join("\n");
}

function formatAllSpinnerFrameDebugReports(config: PromptBorderConfig): string {
	return [
		formatSpinnerFrameDebugReport(createSpinnerFrameDebugReport("status", config.spinnerGlyphs.status)),
		formatSpinnerFrameDebugReport(createSpinnerFrameDebugReport("activity", config.spinnerGlyphs.activity)),
	].join("\n\n");
}

export function formatPromptLoadingGlyphDemoSummary(config: PromptBorderConfig): string {
	return [
		"Prompt loading glyphs demo",
		...SPINNER_GLYPH_SLOTS.map(slot => {
			const report = createSpinnerFrameDebugReport(slot, config.spinnerGlyphs[slot]);
			return `${slot} loading — visible (${report.visibleFrames.length}): ${report.visibleFrames.join(" ") || "<host defaults>"}`;
		}),
	].join("\n");
}

const emptySpinnerGlyphConfig = (): PromptBorderSpinnerGlyphConfig => ({
	status: { frameMs: DEFAULT_SPINNER_GLYPH_FRAME_MS, glyphs: "", frames: [] },
	activity: { frameMs: DEFAULT_SPINNER_GLYPH_FRAME_MS, glyphs: "", frames: [] },
});

export const DEFAULT_PROMPT_BORDER_CONFIG: PromptBorderConfig = {
	style: "double",
	layout: "full",
	leftGlyph: { frameMs: DEFAULT_GLYPH_FRAME_MS, glyphs: "", frames: [] },
	rightGlyph: { frameMs: DEFAULT_GLYPH_FRAME_MS, glyphs: "", frames: [] },
	spinnerGlyphs: emptySpinnerGlyphConfig(),
};

export const EXAMPLE_PROMPT_BORDER_CONFIG: PromptBorderConfig = {
	style: "double",
	layout: "full",
	leftGlyph: {
		frameMs: DEFAULT_GLYPH_FRAME_MS,
		glyphs: DEFAULT_LEFT_GLYPH_TEXT,
		frames: parseGlyphFrames(DEFAULT_LEFT_GLYPH_TEXT),
	},
	rightGlyph: {
		frameMs: DEFAULT_GLYPH_FRAME_MS,
		glyphs: "",
		frames: [],
	},
	spinnerGlyphs: emptySpinnerGlyphConfig(),
};

export type PromptBorderAction =
	| { kind: "reset" }
	| { kind: "apply"; state: PromptBorderState }
	| { kind: "invalid" };

let activeBorder: PromptBorderState = { style: "double", layout: "full" };
let activeConfig: PromptBorderConfig = DEFAULT_PROMPT_BORDER_CONFIG;
let didReadInvalidConfig = false;
const promptLoadingGlyphDebugEnabledSessions = new WeakSet<ExtensionUIContext["setWorkingMessage"]>();
const promptLoadingGlyphDebugMountedSessions = new WeakSet<ExtensionUIContext["setWidget"]>();
const CONFIG_PARSE_WARNING = `Prompt border config at ${CONFIG_PATH} is invalid JSON; using defaults without overwriting the file.`;

function notifyInvalidConfig(ctx: { ui: { notify: (message: string, level?: "info" | "warning" | "error") => void } }): void {
	if (!didReadInvalidConfig) return;
	ctx.ui.notify(CONFIG_PARSE_WARNING, "warning");
}
function buildPromptLoadingGlyphDebugMessage(config: PromptBorderConfig): string {
	const statusReport = createSpinnerFrameDebugReport("status", config.spinnerGlyphs.status);
	const activityReport = createSpinnerFrameDebugReport("activity", config.spinnerGlyphs.activity);
	return `[status ${statusReport.visibleFrames.length}/${statusReport.sourceFrames.length}] [activity ${activityReport.visibleFrames.length}/${activityReport.sourceFrames.length}] Working…`;
}

function clearPromptLoadingGlyphDebugUi(ctx: { ui: Pick<ExtensionUIContext, "setWidget" | "setWorkingMessage"> }): void {
	const { setWidget, setWorkingMessage } = ctx.ui;
	if (promptLoadingGlyphDebugMountedSessions.has(setWidget)) {
		setWidget("prompt-loading-glyphs-debug", undefined);
		promptLoadingGlyphDebugMountedSessions.delete(setWidget);
	}
	if (promptLoadingGlyphDebugEnabledSessions.has(setWorkingMessage)) {
		setWorkingMessage();
		promptLoadingGlyphDebugEnabledSessions.delete(setWorkingMessage);
	}
}

function mountPromptLoadingGlyphDebugWidget(
	ctx: { ui: Pick<ExtensionUIContext, "setWidget"> },
	config: PromptBorderConfig,
): void {
	const { setWidget } = ctx.ui;
	setWidget("prompt-loading-glyphs-debug", (tui: unknown) => {
		const box = new Box(1, 0);
		const loaders: Loader[] = [];
		const tuiInstance = tui as ConstructorParameters<typeof Loader>[0];
		box.addChild(new Text(formatPromptLoadingGlyphDemoSummary(config), 0, 0));
		for (const slot of SPINNER_GLYPH_SLOTS) {
			const glyphConfig = config.spinnerGlyphs[slot];
			const loader = new Loader(
				tuiInstance,
				value => value,
				value => value,
				`${slot} loading`,
				buildTimedSpinnerFrames(glyphConfig.frames, glyphConfig.frameMs),
			);
			loaders.push(loader);
			box.addChild(loader);
		}
		return {
			render(width: number): readonly string[] {
				return box.render(width);
			},
			invalidate(): void {
				box.invalidate();
			},
			dispose(): void {
				for (const loader of loaders) loader.dispose();
			},
		};
	});
	promptLoadingGlyphDebugMountedSessions.add(setWidget);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getGlyphTextPath(configPath: string, slot: PromptBorderGlyphSlot): string {
	return path.join(path.dirname(configPath), GLYPH_TEXT_FILE_NAMES[slot]);
}

function toPromptBorderJson(config: PromptBorderConfig): Record<string, unknown> {
	return {
		style: config.style,
		layout: config.layout,
		leftGlyph: {
			frameMs: config.leftGlyph.frameMs,
		},
		rightGlyph: {
			frameMs: config.rightGlyph.frameMs,
		},
		spinnerGlyphs: {
			status: {
				frameMs: config.spinnerGlyphs.status.frameMs,
			},
			activity: {
				frameMs: config.spinnerGlyphs.activity.frameMs,
			},
		},
	};
}

function mergePromptBorderJson(raw: Record<string, unknown>): Record<string, unknown> {
	const merged = { ...raw };
	const promptBorder = isRecord(raw.promptBorder) ? { ...raw.promptBorder } : {};
	const leftGlyph = isRecord(promptBorder.leftGlyph) ? { ...promptBorder.leftGlyph } : {};
	const rightGlyph = isRecord(promptBorder.rightGlyph) ? { ...promptBorder.rightGlyph } : {};
	const spinnerGlyphs = isRecord(promptBorder.spinnerGlyphs) ? { ...promptBorder.spinnerGlyphs } : {};
	const examplePromptBorder = toPromptBorderJson(EXAMPLE_PROMPT_BORDER_CONFIG);
	const exampleLeftGlyph = isRecord(examplePromptBorder.leftGlyph) ? examplePromptBorder.leftGlyph : {};
	const exampleRightGlyph = isRecord(examplePromptBorder.rightGlyph) ? examplePromptBorder.rightGlyph : {};
	const exampleSpinnerGlyphs = isRecord(examplePromptBorder.spinnerGlyphs) ? examplePromptBorder.spinnerGlyphs : {};

	if (typeof promptBorder.style !== "string") promptBorder.style = examplePromptBorder.style;
	if (typeof promptBorder.layout !== "string") promptBorder.layout = examplePromptBorder.layout;
	if (typeof leftGlyph.frameMs !== "number") leftGlyph.frameMs = exampleLeftGlyph.frameMs;
	if (typeof rightGlyph.frameMs !== "number") rightGlyph.frameMs = exampleRightGlyph.frameMs;

	delete leftGlyph.glyphs;
	delete leftGlyph.frames;
	delete rightGlyph.glyphs;
	delete rightGlyph.frames;

	for (const slot of SPINNER_GLYPH_SLOTS) {
		const spinnerGlyph = isRecord(spinnerGlyphs[slot]) ? { ...spinnerGlyphs[slot] } : {};
		const exampleSpinnerGlyph = isRecord(exampleSpinnerGlyphs[slot]) ? exampleSpinnerGlyphs[slot] : {};
		if (typeof spinnerGlyph.frameMs !== "number") spinnerGlyph.frameMs = exampleSpinnerGlyph.frameMs;
		delete spinnerGlyph.glyphs;
		delete spinnerGlyph.frames;
		spinnerGlyphs[slot] = spinnerGlyph;
	}

	delete promptBorder.loadingGlyph;
	promptBorder.leftGlyph = leftGlyph;
	promptBorder.rightGlyph = rightGlyph;
	promptBorder.spinnerGlyphs = spinnerGlyphs;
	merged.promptBorder = promptBorder;
	return merged;
}

function parsePromptBorderConfigJson(rawText: string): { json: unknown; invalid: boolean } {
	try {
		return { json: JSON.parse(rawText), invalid: false };
	} catch {
		return { json: null, invalid: true };
	}
}

async function readGlyphTextFile(configPath: string, slot: PromptBorderGlyphSlot): Promise<string | undefined> {
	const file = Bun.file(getGlyphTextPath(configPath, slot));
	if (!(await file.exists())) return undefined;
	return await file.text();
}

async function ensureGlyphTextFile(configPath: string, slot: PromptBorderGlyphSlot, seedText: string): Promise<string> {
	const glyphPath = getGlyphTextPath(configPath, slot);
	await mkdir(path.dirname(glyphPath), { recursive: true });
	const file = Bun.file(glyphPath);
	if (await file.exists()) return await file.text();
	await Bun.write(glyphPath, seedText.length > 0 && !seedText.endsWith("\n") ? `${seedText}\n` : seedText);
	return seedText;
}

export function normalizePromptBorderConfig(
	raw: unknown,
	glyphTexts: Partial<Record<PromptBorderGlyphSlot, string>> = {},
): PromptBorderConfig {
	const promptBorder = isRecord(raw) && isRecord(raw.promptBorder) ? raw.promptBorder : {};
	const leftGlyph = isRecord(promptBorder.leftGlyph) ? promptBorder.leftGlyph : {};
	const rightGlyph = isRecord(promptBorder.rightGlyph) ? promptBorder.rightGlyph : {};
	const spinnerGlyphs = isRecord(promptBorder.spinnerGlyphs) ? promptBorder.spinnerGlyphs : {};
	const style =
		typeof promptBorder.style === "string" && isBorderStyleName(promptBorder.style)
			? promptBorder.style
			: DEFAULT_PROMPT_BORDER_CONFIG.style;
	const layout =
		typeof promptBorder.layout === "string" && isBorderLayoutName(promptBorder.layout)
			? promptBorder.layout
			: DEFAULT_PROMPT_BORDER_CONFIG.layout;
	const normalizeGlyph = (
		glyph: Record<string, unknown>,
		slot: PromptBorderGlyphSlot,
		defaultFrameMs: number,
	): PromptBorderGlyphConfig => {
		const frameMs =
			typeof glyph.frameMs === "number" &&
			Number.isFinite(glyph.frameMs) &&
			glyph.frameMs >= 16 &&
			glyph.frameMs <= 1000
				? glyph.frameMs
				: defaultFrameMs;
		const glyphText =
			typeof glyphTexts[slot] === "string"
				? glyphTexts[slot]
				: typeof glyph.glyphs === "string"
					? glyph.glyphs
					: "";
		const frames = glyphText.trim().length > 0 ? parseGlyphFrames(glyphText) : [];
		return {
			frameMs,
			glyphs: frames.length > 0 ? glyphText : "",
			frames,
		};
	};
	return {
		style,
		layout,
		leftGlyph: normalizeGlyph(leftGlyph, "left", DEFAULT_GLYPH_FRAME_MS),
		rightGlyph: normalizeGlyph(rightGlyph, "right", DEFAULT_GLYPH_FRAME_MS),
		spinnerGlyphs: {
			status: normalizeGlyph(
				isRecord(spinnerGlyphs.status) ? spinnerGlyphs.status : {},
				"status",
				DEFAULT_SPINNER_GLYPH_FRAME_MS,
			),
			activity: normalizeGlyph(
				isRecord(spinnerGlyphs.activity) ? spinnerGlyphs.activity : {},
				"activity",
				DEFAULT_SPINNER_GLYPH_FRAME_MS,
			),
		},
	};
}

async function ensurePersistedPromptBorderConfig(
	configPath: string,
): Promise<{ merged: Record<string, unknown>; glyphTexts: Record<PromptBorderGlyphSlot, string> } | undefined> {
	await mkdir(path.dirname(configPath), { recursive: true });
	const file = Bun.file(configPath);
	if (!(await file.exists())) {
		const created = { promptBorder: toPromptBorderJson(EXAMPLE_PROMPT_BORDER_CONFIG) };
		const leftText = await ensureGlyphTextFile(configPath, "left", DEFAULT_LEFT_GLYPH_TEXT);
		const rightText = await ensureGlyphTextFile(configPath, "right", "");
		const statusText = await ensureGlyphTextFile(configPath, "status", "");
		const activityText = await ensureGlyphTextFile(configPath, "activity", "");
		await Bun.write(configPath, `${JSON.stringify(created, null, 2)}\n`);
		return { merged: created, glyphTexts: { left: leftText, right: rightText, status: statusText, activity: activityText } };
	}
	const parsed = parsePromptBorderConfigJson(await file.text());
	if (parsed.invalid || !isRecord(parsed.json)) return undefined;
	const promptBorder = isRecord(parsed.json.promptBorder) ? parsed.json.promptBorder : {};
	const leftGlyph = isRecord(promptBorder.leftGlyph) ? promptBorder.leftGlyph : {};
	const rightGlyph = isRecord(promptBorder.rightGlyph) ? promptBorder.rightGlyph : {};
	const spinnerGlyphs = isRecord(promptBorder.spinnerGlyphs) ? promptBorder.spinnerGlyphs : {};
	const statusGlyph = isRecord(spinnerGlyphs.status) ? spinnerGlyphs.status : {};
	const activityGlyph = isRecord(spinnerGlyphs.activity) ? spinnerGlyphs.activity : {};
	const leftSeed = typeof leftGlyph.glyphs === "string" && leftGlyph.glyphs.trim().length > 0 ? leftGlyph.glyphs : DEFAULT_LEFT_GLYPH_TEXT;
	const rightSeed = typeof rightGlyph.glyphs === "string" && rightGlyph.glyphs.trim().length > 0 ? rightGlyph.glyphs : "";
	const statusSeed = typeof statusGlyph.glyphs === "string" && statusGlyph.glyphs.trim().length > 0 ? statusGlyph.glyphs : "";
	const activitySeed = typeof activityGlyph.glyphs === "string" && activityGlyph.glyphs.trim().length > 0 ? activityGlyph.glyphs : "";
	const leftText = await ensureGlyphTextFile(configPath, "left", leftSeed);
	const rightText = await ensureGlyphTextFile(configPath, "right", rightSeed);
	const statusText = await ensureGlyphTextFile(configPath, "status", statusSeed);
	const activityText = await ensureGlyphTextFile(configPath, "activity", activitySeed);
	const merged = mergePromptBorderJson(parsed.json);
	await Bun.write(configPath, `${JSON.stringify(merged, null, 2)}\n`);
	return { merged, glyphTexts: { left: leftText, right: rightText, status: statusText, activity: activityText } };
}

export async function readPromptBorderConfig(configPath = CONFIG_PATH): Promise<PromptBorderConfig> {
	const [leftText, rightText, statusText, activityText] = await Promise.all([
		readGlyphTextFile(configPath, "left"),
		readGlyphTextFile(configPath, "right"),
		readGlyphTextFile(configPath, "status"),
		readGlyphTextFile(configPath, "activity"),
	]);
	const file = Bun.file(configPath);
	if (!(await file.exists())) {
		didReadInvalidConfig = false;
		return DEFAULT_PROMPT_BORDER_CONFIG;
	}
	const parsed = parsePromptBorderConfigJson(await file.text());
	if (parsed.invalid) {
		didReadInvalidConfig = true;
		return DEFAULT_PROMPT_BORDER_CONFIG;
	}
	const glyphTexts: Partial<Record<PromptBorderGlyphSlot, string>> = {};
	if (leftText !== undefined) glyphTexts.left = leftText;
	if (rightText !== undefined) glyphTexts.right = rightText;
	if (statusText !== undefined) glyphTexts.status = statusText;
	if (activityText !== undefined) glyphTexts.activity = activityText;
	didReadInvalidConfig = false;
	return normalizePromptBorderConfig(parsed.json, glyphTexts);
}

export async function ensurePromptBorderConfigFile(configPath = CONFIG_PATH): Promise<PromptBorderConfig> {
	const persisted = await ensurePersistedPromptBorderConfig(configPath);
	if (persisted === undefined) {
		didReadInvalidConfig = true;
		return DEFAULT_PROMPT_BORDER_CONFIG;
	}
	didReadInvalidConfig = false;
	return normalizePromptBorderConfig(persisted.merged, persisted.glyphTexts);
}

export async function writePromptBorderConfigSelection(
	state: PromptBorderState,
	configPath = CONFIG_PATH,
): Promise<PromptBorderConfig> {
	const persisted = await ensurePersistedPromptBorderConfig(configPath);
	if (persisted === undefined) {
		didReadInvalidConfig = true;
		return DEFAULT_PROMPT_BORDER_CONFIG;
	}
	const promptBorder = isRecord(persisted.merged.promptBorder) ? { ...persisted.merged.promptBorder } : {};
	promptBorder.style = state.style;
	promptBorder.layout = state.layout;
	persisted.merged.promptBorder = promptBorder;
	didReadInvalidConfig = false;
	await Bun.write(configPath, `${JSON.stringify(persisted.merged, null, 2)}\n`);
	return normalizePromptBorderConfig(persisted.merged, persisted.glyphTexts);
}

export type SpinnerGlyphFrameOverride = {
	frames: readonly string[];
	frameMs: number;
};
export type SpinnerGlyphFrameOverrides = Partial<Record<SpinnerType, SpinnerGlyphFrameOverride>>;

export function installSpinnerGlyphFrames(
	themeInstance: Pick<Theme, "getSpinnerFrames">,
	frameOverrides: SpinnerGlyphFrameOverrides,
): (() => void) | undefined {
	const statusFrames =
		frameOverrides.status === undefined
			? undefined
			: buildTimedSpinnerFrames(frameOverrides.status.frames, frameOverrides.status.frameMs);
	const activityFrames =
		frameOverrides.activity === undefined
			? undefined
			: buildTimedSpinnerFrames(frameOverrides.activity.frames, frameOverrides.activity.frameMs);
	const overrideFrames = (type: SpinnerType): readonly string[] | undefined => {
		if (type === "status") {
			return statusFrames !== undefined && statusFrames.length > 0 ? statusFrames : undefined;
		}
		return activityFrames !== undefined && activityFrames.length > 0 ? activityFrames : undefined;
	};
	if (overrideFrames("status") === undefined && overrideFrames("activity") === undefined) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(themeInstance, "getSpinnerFrames");
	const original = themeInstance.getSpinnerFrames.bind(themeInstance);
	Object.defineProperty(themeInstance, "getSpinnerFrames", {
		configurable: true,
		value(type: SpinnerType = "status"): string[] {
			const frames = overrideFrames(type);
			return frames === undefined ? original(type) : Array.from(frames);
		},
	});
	return () => {
		if (descriptor) {
			Object.defineProperty(themeInstance, "getSpinnerFrames", descriptor);
			return;
		}
		Reflect.deleteProperty(themeInstance, "getSpinnerFrames");
	};
}

export function isBorderStyleName(value: string): value is BorderStyleName {
	return (STYLE_NAMES as readonly string[]).includes(value);
}

export function isBorderLayoutName(value: string): value is BorderLayoutName {
	return (LAYOUT_NAMES as readonly string[]).includes(value);
}

const spinnerGlyphFrameRestores = new WeakMap<Pick<Theme, "getSpinnerFrames">, () => void>();

function restoreSpinnerGlyphFrames(themeInstance: Pick<Theme, "getSpinnerFrames"> | undefined): void {
	if (themeInstance === undefined) return;
	const restore = spinnerGlyphFrameRestores.get(themeInstance);
	if (restore === undefined) return;
	spinnerGlyphFrameRestores.delete(themeInstance);
	restore();
}

function applySpinnerGlyphFrames(
	themeInstance: Pick<Theme, "getSpinnerFrames"> | undefined,
	config: PromptBorderConfig,
): void {
	restoreSpinnerGlyphFrames(themeInstance);
	if (themeInstance === undefined) return;
	const restore = installSpinnerGlyphFrames(themeInstance, {
		status: config.spinnerGlyphs.status,
		activity: config.spinnerGlyphs.activity,
	});
	if (restore === undefined) {
		spinnerGlyphFrameRestores.delete(themeInstance);
		return;
	}
	spinnerGlyphFrameRestores.set(themeInstance, restore);
}

export function getPromptBorderArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
	const normalized = argumentPrefix.toLowerCase();
	const hasTrailingSpace = /\s$/.test(normalized);
	const parts = normalized.trim().split(/\s+/).filter(Boolean);
	const tokenPrefix = hasTrailingSpace ? "" : (parts.at(-1) ?? "");
	const complete = (value: string): AutocompleteItem => ({ value, label: value });
	const completeLayoutSubcommand = (layout: BorderLayoutName): AutocompleteItem => ({ value: `layout ${layout}`, label: layout });
	if (parts.length === 0) {
		return PRIMARY_COMMAND_OPTIONS.map(complete);
	}
	const first = parts[0]!;
	if (parts.length === 1 && first === "layout" && !hasTrailingSpace) {
		return LAYOUT_NAMES.map(completeLayoutSubcommand);
	}
	if (parts.length === 1 && !hasTrailingSpace) {
		return PRIMARY_COMMAND_OPTIONS.filter(option => option.startsWith(tokenPrefix)).map(complete);
	}
	if (first === "layout" && (parts.length === 1 || (parts.length === 2 && !hasTrailingSpace))) {
		return LAYOUT_NAMES.filter(layout => layout.startsWith(tokenPrefix)).map(completeLayoutSubcommand);
	}
	if (isBorderStyleName(first) && (parts.length === 1 || (parts.length === 2 && !hasTrailingSpace))) {
		return LAYOUT_NAMES.filter(layout => layout.startsWith(tokenPrefix)).map(complete);
	}
	return null;
}

export function getPromptLoadingGlyphArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
	const normalized = argumentPrefix.toLowerCase();
	const hasTrailingSpace = /\s$/.test(normalized);
	const parts = normalized.trim().split(/\s+/u).filter(Boolean);
	const tokenPrefix = hasTrailingSpace ? "" : (parts.at(-1) ?? "");
	if (parts.length === 0) return [{ value: "debug", label: "debug" }];
	if (parts.length === 1) {
		if (parts[0] === "debug") {
			return LOADING_GLYPH_DEBUG_ACTIONS.map(action => ({ value: `debug ${action}`, label: action }));
		}
		if (!hasTrailingSpace) {
			return LOADING_GLYPH_DEBUG_ROOT_OPTIONS
				.filter(option => option.startsWith(tokenPrefix))
				.map(option => ({ value: option, label: option }));
		}
	}
	if (parts[0] === "debug" && parts.length === 2 && !hasTrailingSpace) {
		return LOADING_GLYPH_DEBUG_ACTIONS
			.filter(action => action.startsWith(tokenPrefix))
			.map(action => ({ value: `debug ${action}`, label: action }));
	}
	return null;
}

export function parsePromptLoadingGlyphArgs(args: string): PromptLoadingGlyphDebugAction {
	const parts = args.trim().toLowerCase().split(/\s+/u).filter(Boolean);
	if (parts.length === 2 && parts[0] === "debug" && parts[1] === "frames") return { kind: "frames" };
	if (parts.length === 2 && parts[0] === "debug" && parts[1] === "demo") return { kind: "demo" };
	if (parts.length === 2 && parts[0] === "debug" && parts[1] === "on") return { kind: "on" };
	if (parts.length === 2 && parts[0] === "debug" && parts[1] === "off") return { kind: "off" };
	return { kind: "invalid" };
}

export function parsePromptBorderArgs(args: string, current: PromptBorderState): PromptBorderAction {
	const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return { kind: "invalid" };
	if (parts.length === 1 && parts[0] === "reset") return { kind: "reset" };
	if (parts[0] === "layout") {
		if (parts.length !== 2 || !isBorderLayoutName(parts[1]!)) return { kind: "invalid" };
		return { kind: "apply", state: { ...current, layout: parts[1]! } };
	}
	if (!isBorderStyleName(parts[0]!)) return { kind: "invalid" };
	if (parts.length === 1) return { kind: "apply", state: { ...current, style: parts[0]! } };
	if (parts.length === 2 && isBorderLayoutName(parts[1]!)) {
		return { kind: "apply", state: { style: parts[0]!, layout: parts[1]! } };
	}
	return { kind: "invalid" };
}

export function withPromptBorder(theme: EditorTheme, state: PromptBorderState, glyphOverride?: PromptBorderGlyphs): EditorTheme {
	return {
		...theme,
		symbols: {
			...theme.symbols,
			boxRound: {
				...theme.symbols.boxRound,
				...(glyphOverride ?? borderStyles[state.style]),
			},
		},
	};
}


function withSeparateBottomGlyphs(glyphs: PromptBorderGlyphs): PromptBorderGlyphs {
	return {
		...glyphs,
		bottomLeft: glyphs.vertical,
		bottomRight: glyphs.vertical,
	};
}

const ANSI_SGR_PATTERN = /\x1b\[[0-9;:]*m/g;

function stripSideRowHorizontalPadding(line: string, glyphs: PromptBorderGlyphs): string {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const chars = [...plain];
	if (chars.length < 4 || chars[0] !== glyphs.vertical || chars.at(-1) !== glyphs.vertical) return line;
	const leftPaddingIndex = 1;
	const rightPaddingIndex = chars.length - 2;
	let visibleIndex = 0;
	return line.replace(/\x1b\[[0-9;:]*m|./gu, token => {
		if (token.startsWith("\x1b[")) return token;
		const shouldReplace =
			token === glyphs.horizontal && (visibleIndex === leftPaddingIndex || visibleIndex === rightPaddingIndex);
		visibleIndex += 1;
		return shouldReplace ? " " : token;
	});
}

function restyleTopBorderHorizontalRuns(line: string, glyphs: PromptBorderGlyphs): string {
	if (glyphs.horizontal === " ") return line;
	return line.replace(/([─━╌╍═-])\1+/gu, match => glyphs.horizontal.repeat([...match].length));
}

function hideSideBorderGlyphs(line: string, glyphs: PromptBorderGlyphs): string {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const chars = [...plain];
	if (chars.length < 2 || chars[0] !== glyphs.vertical || chars.at(-1) !== glyphs.vertical) return line;
	const leftPaddingIndex = 1;
	const rightPaddingIndex = chars.length - 2;
	let visibleIndex = 0;
	return line.replace(/\x1b\[[0-9;:]*m|./gu, token => {
		if (token.startsWith("\x1b[")) return token;
		const shouldReplace =
			(token === glyphs.vertical && (visibleIndex === 0 || visibleIndex === chars.length - 1)) ||
			(token === glyphs.horizontal && (visibleIndex === leftPaddingIndex || visibleIndex === rightPaddingIndex));
		visibleIndex += 1;
		return shouldReplace ? " " : token;
	});
}
function hideTopBorderLine(line: string, glyphs: PromptBorderGlyphs, topBorder: EditorTopBorder | undefined): string | null {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const chars = [...plain];
	if (chars.length < 2 || chars[0] !== glyphs.topLeft || chars.at(-1) !== glyphs.topRight) return line;
	if (!topBorder) return null;
	let plainContent = restyleTopBorderHorizontalRuns(topBorder.content, glyphs).replace(ANSI_SGR_PATTERN, "");
	let firstContentIndex = plain.indexOf(plainContent, 1);
	if (firstContentIndex === -1) {
		for (let width = topBorder.width - 1; width > 0; width -= 1) {
			const truncated = restyleTopBorderHorizontalRuns(truncateToWidth(topBorder.content, width), glyphs);
			plainContent = truncated.replace(ANSI_SGR_PATTERN, "");
			firstContentIndex = plain.indexOf(plainContent, 1);
			if (plainContent.length > 0 && firstContentIndex !== -1) break;
		}
	}
	if (plainContent.length === 0 || firstContentIndex === -1) return null;
	const lastContentIndex = firstContentIndex + [...plainContent].length - 1;
	let visibleIndex = 0;
	return line.replace(/\x1b\[[0-9;:]*m|./gu, token => {
		if (token.startsWith("\x1b[")) return token;
		const shouldReplace = visibleIndex < firstContentIndex || visibleIndex > lastContentIndex;
		visibleIndex += 1;
		return shouldReplace ? " " : token;
	});
}

export function renderBottomBorderLine(width: number, glyphs: PromptBorderGlyphs, color: (str: string) => string): string {
	return color(`${glyphs.bottomLeft}${glyphs.horizontal.repeat(Math.max(0, width - 2))}${glyphs.bottomRight}`);
}

function replaceVisibleGlyphAt(line: string, targetIndex: number, targetWidth: number, frame: string): string {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const tokens = [...line.matchAll(/\x1b\[[0-9;:]*m|./gu)].map(match => match[0]);
	let visibleIndex = 0;
	let targetTokenIndex = -1;
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index]!.startsWith("\x1b[")) continue;
		if (visibleIndex === targetIndex) {
			targetTokenIndex = index;
			break;
		}
		visibleIndex += 1;
	}
	if (targetTokenIndex === -1) return line;

	const originalWidth = visibleWidth(plain);
	const frameWidth = visibleWidth(frame);
	let suffix = tokens.slice(targetTokenIndex + 1).join("");
	let consumedSpaces = 0;

	if (frameWidth > targetWidth) {
		const availableSpaces = suffix.replace(ANSI_SGR_PATTERN, "").match(/^ +/u)?.[0].length ?? 0;
		consumedSpaces = Math.min(frameWidth - targetWidth, availableSpaces);
		if (consumedSpaces > 0) {
			const suffixWidth = visibleWidth(suffix);
			suffix = sliceByColumn(suffix, consumedSpaces, Math.max(0, suffixWidth - consumedSpaces));
		}
	}

	const allowedFrameWidth = targetWidth + consumedSpaces;
	const fittedFrame = frameWidth > allowedFrameWidth ? truncateToWidth(frame, allowedFrameWidth, "") : frame;
	let replacement = fittedFrame;
	const replacementWidth = visibleWidth(replacement);
	if (replacementWidth < targetWidth) {
		replacement = `${replacement}${" ".repeat(targetWidth - replacementWidth)}`;
	}

	const prefix = tokens.slice(0, targetTokenIndex).join("");
	const result = `${prefix}${replacement}${suffix}`;
	if (visibleWidth(result.replace(ANSI_SGR_PATTERN, "")) <= originalWidth) return result;

	const suffixWidth = visibleWidth(suffix.replace(ANSI_SGR_PATTERN, ""));
	const prefixWidth = visibleWidth(prefix.replace(ANSI_SGR_PATTERN, ""));
	const maxReplacementWidth = Math.max(0, originalWidth - prefixWidth - suffixWidth);
	replacement = truncateToWidth(replacement, maxReplacementWidth, "");
	return `${prefix}${replacement}${suffix}`;
}

export function replaceBodyLeftGlyph(line: string, glyphs: PromptBorderGlyphs, frame: string): string {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const plainChars = [...plain];
	if (plainChars[0] !== glyphs.bottomLeft || plainChars[1] !== glyphs.horizontal) return line;
	if (plainChars.at(-1) === glyphs.bottomRight && plainChars.slice(2, -1).every(char => char === glyphs.horizontal)) {
		return line;
	}
	return replaceVisibleGlyphAt(line, 1, visibleWidth(glyphs.horizontal), frame);
}

function replaceSideBodyLeftGlyph(line: string, glyphs: PromptBorderGlyphs, frame: string): string {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const plainChars = [...plain];
	if (plainChars.length < 4 || plainChars[0] !== glyphs.vertical || plainChars.at(-1) !== glyphs.vertical) return line;
	if (plainChars[1] !== " " || plainChars[2] !== " ") return line;

	const tokens = [...line.matchAll(/\x1b\[[0-9;:]*m|./gu)].map(match => match[0]);
	let visibleIndex = 0;
	let leftPaddingTokenIndex = -1;
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index]!.startsWith("\x1b[")) continue;
		if (visibleIndex === 1) {
			leftPaddingTokenIndex = index;
			break;
		}
		visibleIndex += 1;
	}
	if (leftPaddingTokenIndex === -1) return line;

	const prefix = tokens.slice(0, leftPaddingTokenIndex).join("");
	const suffixTokens = tokens.slice(leftPaddingTokenIndex + 1);
	let result = `${prefix}${frame}${suffixTokens.join("")}`;
	let overflow = visibleWidth(result.replace(ANSI_SGR_PATTERN, "")) - visibleWidth(plain);

	for (let index = suffixTokens.length - 2; overflow > 0 && index >= 0; index -= 1) {
		const token = suffixTokens[index]!;
		if (token.startsWith("\x1b[")) continue;
		if (token !== " ") continue;
		suffixTokens.splice(index, 1);
		overflow -= 1;
	}

	let fittedFrame = frame;
	if (overflow > 0) {
		fittedFrame = truncateToWidth(frame, Math.max(1, visibleWidth(frame) - overflow), "");
	}
	return `${prefix}${fittedFrame}${suffixTokens.join("")}`;
}

function replaceBodyRightGlyph(line: string, glyphs: PromptBorderGlyphs, frame: string): string {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const plainChars = [...plain];
	if (plainChars.length < 4 || plainChars[0] !== glyphs.bottomLeft || plainChars.at(-1) !== glyphs.bottomRight) return line;
	if (plainChars.slice(1, -1).every(char => char === glyphs.horizontal)) return line;
	const tokens = [...line.matchAll(/\x1b\[[0-9;:]*m|./gu)].map(match => match[0]);
	let borderTokenIndex = -1;
	let visibleIndex = 0;
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index]!.startsWith("\x1b[")) continue;
		if (visibleIndex === plainChars.length - 1) {
			borderTokenIndex = index;
			break;
		}
		visibleIndex += 1;
	}
	if (borderTokenIndex === -1) return line;
	const prefixTokens = tokens.slice(0, borderTokenIndex);
	const suffix = tokens.slice(borderTokenIndex).join("");
	const frameWidth = visibleWidth(frame);
	let removableWidth = 0;
	let removeFromIndex = prefixTokens.length;
	for (let index = prefixTokens.length - 1; index >= 0 && removableWidth < frameWidth; index -= 1) {
		const token = prefixTokens[index]!;
		if (token.startsWith("\x1b[")) continue;
		if (token !== " " && token !== glyphs.horizontal) break;
		removeFromIndex = index;
		removableWidth += visibleWidth(token);
	}
	if (removableWidth === 0) return line;
	const fittedFrame = frameWidth > removableWidth ? truncateToWidth(frame, removableWidth, "") : frame;
	const fittedWidth = visibleWidth(fittedFrame);
	const leftPad = removableWidth > fittedWidth ? " ".repeat(removableWidth - fittedWidth) : "";
	return `${prefixTokens.slice(0, removeFromIndex).join("")}${leftPad}${fittedFrame}${suffix}`;
}

function replaceSideBodyRightGlyph(line: string, glyphs: PromptBorderGlyphs, frame: string): string {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	const plainChars = [...plain];
	if (plainChars.length < 4 || plainChars[0] !== glyphs.vertical || plainChars.at(-1) !== glyphs.vertical) return line;
	const tokens = [...line.matchAll(/\x1b\[[0-9;:]*m|./gu)].map(match => match[0]);
	let borderTokenIndex = -1;
	let visibleIndex = 0;
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index]!.startsWith("\x1b[")) continue;
		if (visibleIndex === plainChars.length - 1) {
			borderTokenIndex = index;
			break;
		}
		visibleIndex += 1;
	}
	if (borderTokenIndex === -1) return line;
	const prefixTokens = tokens.slice(0, borderTokenIndex);
	const suffix = tokens.slice(borderTokenIndex).join("");
	const frameWidth = visibleWidth(frame);
	let removableWidth = 0;
	let removeFromIndex = prefixTokens.length;
	for (let index = prefixTokens.length - 1; index >= 0 && removableWidth < frameWidth; index -= 1) {
		const token = prefixTokens[index]!;
		if (token.startsWith("\x1b[")) continue;
		if (token !== " ") break;
		removeFromIndex = index;
		removableWidth += visibleWidth(token);
	}
	if (removableWidth === 0) return line;
	const fittedFrame = frameWidth > removableWidth ? truncateToWidth(frame, removableWidth, "") : frame;
	const fittedWidth = visibleWidth(fittedFrame);
	const leftPad = removableWidth > fittedWidth ? " ".repeat(removableWidth - fittedWidth) : "";
	return `${prefixTokens.slice(0, removeFromIndex).join("")}${leftPad}${fittedFrame}${suffix}`;
}

type CursorSymbols = Pick<EditorTheme["symbols"], "inputCursor" | "cursor">;

function scoreCursorBodyRow(
	line: string,
	cursorSymbols: CursorSymbols,
	cursorLineText: string,
	cursorCol: number,
): number {
	const plain = line.replace(ANSI_SGR_PATTERN, "");
	if (line.includes(CURSOR_MARKER) || line.includes("\x1b[7m")) return 100;
	if (!plain.includes(cursorSymbols.inputCursor) && !plain.includes(cursorSymbols.cursor)) return -1;
	let score = 1;
	const prefixHint = cursorCol > 0 ? cursorLineText.slice(Math.max(0, cursorCol - 8), cursorCol) : "";
	if (prefixHint.length > 0 && plain.includes(prefixHint)) score += 10;
	const lineHint = cursorLineText.length > 0 ? cursorLineText.slice(0, Math.min(cursorLineText.length, 8)) : "";
	if (lineHint.length > 0 && plain.includes(lineHint)) score += 5;
	return score;
}

function applyGlyphsToCursorRow(
	rows: readonly string[],
	glyphs: PromptBorderGlyphs,
	cursorSymbols: CursorSymbols,
	cursorLineText: string,
	cursorCol: number,
	leftFrame: string | undefined,
	rightFrame: string | undefined,
	borderLine?: string,
): readonly string[] {
	let targetIndex = -1;
	let targetScore = -1;
	let fallbackIndex = -1;
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index]!;
		if (row === borderLine) continue;
		fallbackIndex = index;
		const score = scoreCursorBodyRow(row, cursorSymbols, cursorLineText, cursorCol);
		if (score < targetScore) continue;
		targetScore = score;
		targetIndex = index;
	}
	const rowIndex = targetScore >= 0 ? targetIndex : fallbackIndex;
	if (rowIndex === -1 || (leftFrame === undefined && rightFrame === undefined)) return rows;
	return rows.map((row, index) => {
		if (index !== rowIndex) return row;
		let nextRow = row;
		if (leftFrame !== undefined) {
			nextRow = replaceSideBodyLeftGlyph(replaceBodyLeftGlyph(nextRow, glyphs, leftFrame), glyphs, leftFrame);
		}
		if (rightFrame !== undefined) {
			nextRow = replaceSideBodyRightGlyph(replaceBodyRightGlyph(nextRow, glyphs, rightFrame), glyphs, rightFrame);
		}
		return nextRow;
	});
}

export class PromptBorderEditor extends CustomEditor {
	readonly #cursorSymbols: CursorSymbols;
	readonly #state: PromptBorderState;
	readonly #glyphs: PromptBorderGlyphs;
	readonly #config: PromptBorderConfig;
	#topBorder: EditorTopBorder | undefined;
	#renderedTopBorder: EditorTopBorder | undefined;
	#topBorderProvider: ((availableWidth: number) => EditorTopBorder | undefined) | undefined;
	#leftGlyphFrameIndex = 0;
	#rightGlyphFrameIndex = 0;
	#leftGlyphTimer: Timer | undefined;
	#rightGlyphTimer: Timer | undefined;
	#requestGlyphRepaint: (() => void) | undefined;

	constructor(theme: EditorTheme, state: PromptBorderState, config: PromptBorderConfig = DEFAULT_PROMPT_BORDER_CONFIG) {
		const glyphs = borderStyles[state.style];
		const editorTheme =
			state.layout === "default"
				? withPromptBorder(theme, state)
				: withPromptBorder(theme, state, withSeparateBottomGlyphs(glyphs));
		super(editorTheme);
		this.#cursorSymbols = { inputCursor: theme.symbols.inputCursor, cursor: theme.symbols.cursor };
		this.#state = state;
		this.#glyphs = glyphs;
		this.#config = config;
	}
	override setTopBorder(content: EditorTopBorder | undefined): void {
		this.#topBorder = content;
		this.#renderedTopBorder = content;
		super.setTopBorder(content);
	}
	override setTopBorderProvider(
		provider: ((availableWidth: number) => EditorTopBorder | undefined) | undefined,
	): void {
		this.#topBorderProvider = provider;
		this.#renderedTopBorder = undefined;
		super.setTopBorderProvider(
			provider === undefined
				? undefined
				: availableWidth => {
						const content = provider(availableWidth);
						this.#renderedTopBorder = content;
						return content;
					},
		);
	}
	override setShimmerRepaintHandler(handler: (() => void) | undefined): void {
		super.setShimmerRepaintHandler(handler);
		this.#requestGlyphRepaint = handler;
		if (handler !== undefined) return;
		if (this.#leftGlyphTimer !== undefined) clearTimeout(this.#leftGlyphTimer);
		if (this.#rightGlyphTimer !== undefined) clearTimeout(this.#rightGlyphTimer);
		this.#leftGlyphTimer = undefined;
		this.#rightGlyphTimer = undefined;
	}
	#currentGlyphFrame(side: PromptBorderGlyphSide): string | undefined {
		const glyphConfig = side === "left" ? this.#config.leftGlyph : this.#config.rightGlyph;
		const frameIndex = side === "left" ? this.#leftGlyphFrameIndex : this.#rightGlyphFrameIndex;
		if (glyphConfig.frames.length === 0) return undefined;
		return glyphConfig.frames[frameIndex % glyphConfig.frames.length];
	}
	#scheduleGlyphFrame(side: PromptBorderGlyphSide): void {
		const glyphConfig = side === "left" ? this.#config.leftGlyph : this.#config.rightGlyph;
		const timer = side === "left" ? this.#leftGlyphTimer : this.#rightGlyphTimer;
		if (glyphConfig.frames.length <= 1 || timer !== undefined || this.#requestGlyphRepaint === undefined) return;
		const scheduledTimer = setTimeout(() => {
			if (side === "left") {
				this.#leftGlyphTimer = undefined;
				this.#leftGlyphFrameIndex = (this.#leftGlyphFrameIndex + 1) % glyphConfig.frames.length;
			} else {
				this.#rightGlyphTimer = undefined;
				this.#rightGlyphFrameIndex = (this.#rightGlyphFrameIndex + 1) % glyphConfig.frames.length;
			}
			this.#requestGlyphRepaint?.();
		}, glyphConfig.frameMs);
		scheduledTimer.unref?.();
		if (side === "left") this.#leftGlyphTimer = scheduledTimer;
		else this.#rightGlyphTimer = scheduledTimer;
	}
	override render(width: number): readonly string[] {
		const lines = [...super.render(width)];
		const leftFrame = this.#currentGlyphFrame("left");
		const rightFrame = this.#currentGlyphFrame("right");
		if (leftFrame !== undefined) this.#scheduleGlyphFrame("left");
		if (rightFrame !== undefined) this.#scheduleGlyphFrame("right");
		const cursor = this.getCursor();
		const cursorLineText = this.getText().split("\n")[cursor.line] ?? "";
		if (this.#state.layout === "default") {
			if (lines[0] === undefined) return lines;
			const bodyAndAutocompleteRows = lines.slice(1);
			const splitIndex = bodyAndAutocompleteRows.findIndex(line => {
				const plain = line.replace(ANSI_SGR_PATTERN, "");
				return !(
					(plain.startsWith(this.#glyphs.vertical) && plain.endsWith(this.#glyphs.vertical)) ||
					(plain.startsWith(this.#glyphs.bottomLeft) && plain.endsWith(this.#glyphs.bottomRight))
				);
			});
			const bodyRows = splitIndex === -1 ? bodyAndAutocompleteRows : bodyAndAutocompleteRows.slice(0, splitIndex);
			const autocompleteRows = splitIndex === -1 ? [] : bodyAndAutocompleteRows.slice(splitIndex);
			const glyphRows = applyGlyphsToCursorRow(
				bodyRows,
				this.#glyphs,
				this.#cursorSymbols,
				cursorLineText,
				cursor.col,
				leftFrame,
				rightFrame,
			);
			return [restyleTopBorderHorizontalRuns(lines[0], this.#glyphs), ...glyphRows, ...autocompleteRows];
		}
		const restyledTopRow = lines[0] === undefined ? undefined : restyleTopBorderHorizontalRuns(lines[0], this.#glyphs);
		const topBorder = this.#topBorderProvider === undefined ? this.#topBorder : this.#renderedTopBorder;
		const hiddenTopRow = restyledTopRow === undefined ? null : hideTopBorderLine(restyledTopRow, this.#glyphs, topBorder);
		const topRows =
			this.#state.layout === "full" || this.#state.layout === "top-bottom"
				? restyledTopRow === undefined
					? []
					: [restyledTopRow]
				: hiddenTopRow === null
					? []
					: [hiddenTopRow];
		const bodyAndAutocompleteRows = lines.slice(1);
		const splitIndex = bodyAndAutocompleteRows.findIndex(line => {
			const plain = line.replace(ANSI_SGR_PATTERN, "");
			return !plain.startsWith(this.#glyphs.vertical) || !plain.endsWith(this.#glyphs.vertical);
		});
		const borderedBodyRows =
			splitIndex === -1 ? bodyAndAutocompleteRows : bodyAndAutocompleteRows.slice(0, splitIndex);
		const sideOnlyBodyRows = borderedBodyRows.map(line => stripSideRowHorizontalPadding(line, this.#glyphs));
		const normalizedBodyRows =
			this.#state.layout === "top-bottom"
				? sideOnlyBodyRows.map(line => hideSideBorderGlyphs(line, this.#glyphs))
				: sideOnlyBodyRows;
		const borderLine = renderBottomBorderLine(width, this.#glyphs, this.borderColor);
		const glyphRows = applyGlyphsToCursorRow(
			normalizedBodyRows,
			this.#glyphs,
			this.#cursorSymbols,
			cursorLineText,
			cursor.col,
			leftFrame,
			rightFrame,
			borderLine,
		);
		if (this.#state.layout === "sides") {
			if (splitIndex === -1) return [...topRows, ...glyphRows];
			return [...topRows, ...glyphRows, ...bodyAndAutocompleteRows.slice(splitIndex)];
		}
		if (splitIndex === -1) return [...topRows, ...glyphRows, borderLine];
		return [...topRows, ...glyphRows, borderLine, ...bodyAndAutocompleteRows.slice(splitIndex)];
	}
	dispose(): void {
		if (this.#leftGlyphTimer !== undefined) clearTimeout(this.#leftGlyphTimer);
		if (this.#rightGlyphTimer !== undefined) clearTimeout(this.#rightGlyphTimer);
		this.#leftGlyphTimer = undefined;
		this.#rightGlyphTimer = undefined;
		super.setShimmerRepaintHandler(undefined);
	}
}
export default function promptBorderStyle(pi: ExtensionAPI, configPath = CONFIG_PATH): void {
	pi.setLabel("Prompt Border Style");

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		activeConfig = await ensurePromptBorderConfigFile(configPath);
		applySpinnerGlyphFrames(ctx.ui.theme, activeConfig);
		notifyInvalidConfig(ctx);
		activeBorder = { style: activeConfig.style, layout: activeConfig.layout };
		ctx.ui.setEditorComponent((_tui, theme) => new PromptBorderEditor(theme, activeBorder, activeConfig));
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setEditorComponent(undefined);
		clearPromptLoadingGlyphDebugUi(ctx);
		restoreSpinnerGlyphFrames(ctx.ui.theme);
	});


	pi.registerCommand("prompt-loading-glyphs", {
		description: "Debug prompt loading glyph adaptation",
		getArgumentCompletions: getPromptLoadingGlyphArgumentCompletions,
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			activeConfig = await ensurePromptBorderConfigFile(configPath);
			applySpinnerGlyphFrames(ctx.ui.theme, activeConfig);
			notifyInvalidConfig(ctx);
			const action = parsePromptLoadingGlyphArgs(args);
			if (action.kind === "invalid") {
				ctx.ui.notify(PROMPT_LOADING_GLYPHS_USAGE, "warning");
				return;
			}
			if (action.kind === "frames") {
				ctx.ui.notify(formatAllSpinnerFrameDebugReports(activeConfig), "info");
				return;
			}
			if (action.kind === "demo") {
				mountPromptLoadingGlyphDebugWidget(ctx, activeConfig);
				ctx.ui.notify("Prompt loading glyph demo enabled", "info");
				return;
			}
			if (action.kind === "on") {
				promptLoadingGlyphDebugEnabledSessions.add(ctx.ui.setWorkingMessage);
				ctx.ui.setWorkingMessage(buildPromptLoadingGlyphDebugMessage(activeConfig));
				ctx.ui.notify("Prompt loading glyph debug enabled", "info");
				return;
			}
			clearPromptLoadingGlyphDebugUi(ctx);
			ctx.ui.notify("Prompt loading glyph debug disabled", "info");
		},
	});
	pi.registerCommand("prompt-border", {
		description: "Change the prompt input border style",
		getArgumentCompletions: getPromptBorderArgumentCompletions,
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			activeConfig = await ensurePromptBorderConfigFile(configPath);
			applySpinnerGlyphFrames(ctx.ui.theme, activeConfig);
			notifyInvalidConfig(ctx);
			const action = parsePromptBorderArgs(args, activeBorder);
			if (action.kind === "reset") {
				activeBorder = { style: "double", layout: "full" };
				ctx.ui.setEditorComponent(undefined);
				ctx.ui.notify("Prompt border reset", "info");
				return;
			}
			if (action.kind === "invalid") {
				ctx.ui.notify(USAGE, "warning");
				return;
			}
			activeBorder = action.state;
			activeConfig = await writePromptBorderConfigSelection(activeBorder, configPath);
			applySpinnerGlyphFrames(ctx.ui.theme, activeConfig);
			notifyInvalidConfig(ctx);
			ctx.ui.setEditorComponent((_tui, theme) => new PromptBorderEditor(theme, activeBorder, activeConfig));
			ctx.ui.notify(`Prompt border: ${activeBorder.style} ${activeBorder.layout}`, "info");
		},
	});
}
