import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { visibleWidth } from "@oh-my-pi/pi-tui";
import { renderBeadsSegment, DEFAULT_BEADS_TEMPLATE } from "../packages/beads/src/status.ts";
import { loadPackageCavemanSequence, renderCavemanFrameSequence } from "../packages/caveman/src/display.ts";
import { CAVEMAN_ACTIVE_MODES, DEFAULT_CAVEMAN_CONFIG } from "../packages/caveman/src/types.ts";
import {
	DEFAULT_DISPLAY_CONFIG as DEFAULT_HEADROOM_DISPLAY,
	DEFAULT_GLYPHS as HEADROOM_GLYPHS,
	renderDisplayFrames,
} from "../packages/headroom/display.ts";
import { loadPonytailSequence, renderPonytailFrameSequence } from "../packages/ponytail/src/display.ts";
import { DEFAULT_PONYTAIL_CONFIG, PONYTAIL_MODES } from "../packages/ponytail/src/types.ts";
import { defaultRtkConfig } from "../packages/rtk/src/config.ts";
import { renderRtkFrames } from "../packages/rtk/src/display.ts";
import { FIXED_PALETTES } from "../packages/shared-display/src/palettes.ts";
import {
	DEFAULT_SHARED_DISPLAY_CONFIG,
	SHARED_DISPLAY_PALETTES,
	SHARED_DISPLAY_STYLES,
	composeDisplayRows,
	type ResolvedPalette,
	type SharedDisplayLayout,
	type SharedDisplayPalette,
	type SharedDisplayStyle,
} from "../packages/shared-display/src/index.ts";
import type { DisplaySource, FrameSequence } from "../packages/shared-display/src/client.ts";

const ROOT = path.resolve(import.meta.dir, "..");
const OUTPUT_DIRECTORY = path.join(ROOT, "docs", "assets", "readme");
const THEME_FILE = path.join(ROOT, "packages", "theme-catppuccin", "themes", "catppuccin-mocha.json");
const FONT_DIRECTORY = path.join(os.homedir(), "Library", "Fonts");
const PREFERRED_FONTS = ["IoskeleyMonoTermNerdFontMono-Regular.ttf"];
const NO_GLYPH_DIRECTORY = "/dev/null/no-glyphs";

const IMAGE_BACKGROUND = "#1e1e2e";
const FONT_SIZE = 16;
const LINE_HEIGHT = 1.2;
const PADDING = { vertical: 22, horizontal: 30 };
const DEVICE_SCALE = 2;
// freeze 0.2.2 draws a cell background 1px taller than the line, starting FREEZE_CELL_INSET em below the line's top; the screenshot is cropped to the cells with equal margins.
const FREEZE_CELL_INSET = 0.215;
// freeze lays out cells at 1/1.68 of the font size, so only fonts with a 0.6em advance keep Display Style joints aligned.
const ADVANCE_RANGE = { min: 0.58, max: 0.62 };
const CHROME_CANDIDATES = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"google-chrome",
	"chromium",
];

function fail(message: string): never {
	console.error(`readme-images: ${message}`);
	process.exit(1);
}

/** Advance width of the first glyph in em; Mono fonts share one advance. */
function fontAdvance(file: string): number {
	const bytes = readFileSync(file);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tables = new Map<string, number>();
	for (let index = 0; index < view.getUint16(4); index += 1) {
		const entry = 12 + index * 16;
		tables.set(bytes.toString("latin1", entry, entry + 4), view.getUint32(entry + 8));
	}
	const head = tables.get("head");
	const hmtx = tables.get("hmtx");
	if (head === undefined || hmtx === undefined) fail(`${file} is not a single TrueType/OpenType font file.`);
	return view.getUint16(hmtx) / view.getUint16(head + 18);
}

function resolveFontFile(): string {
	const override = process.env.README_IMAGES_FONT;
	const candidates = override
		? [override]
		: (existsSync(FONT_DIRECTORY) ? readdirSync(FONT_DIRECTORY).sort() : [])
				.filter(name => /NerdFontMono-Regular\.ttf$/u.test(name))
				.sort((a, b) => Number(PREFERRED_FONTS.includes(b)) - Number(PREFERRED_FONTS.includes(a)))
				.map(name => path.join(FONT_DIRECTORY, name));
	if (override && !existsSync(override)) fail(`README_IMAGES_FONT points to a missing file: ${override}`);
	const usable = candidates.find(file => {
		const advance = fontAdvance(file);
		return advance >= ADVANCE_RANGE.min && advance <= ADVANCE_RANGE.max;
	});
	if (!usable) {
		fail(
			`no usable Nerd Font found. Need a *NerdFontMono-Regular.ttf file with a 0.6em advance in ${FONT_DIRECTORY}` +
				" (for example IoskeleyMono Term Nerd Font Mono), or set README_IMAGES_FONT to one.",
		);
	}
	return usable;
}

function resolveChrome(): string {
	const override = process.env.CHROME_BIN;
	if (override) return existsSync(override) ? override : fail(`CHROME_BIN points to a missing file: ${override}`);
	const found = CHROME_CANDIDATES.map(candidate => (path.isAbsolute(candidate) ? (existsSync(candidate) ? candidate : null) : Bun.which(candidate))).find(Boolean);
	return found ?? fail("no Chrome or Chromium found. Install one or set CHROME_BIN; it rasterizes freeze's SVG so the Nerd Font is applied.");
}

type ThemeFile = { vars: Record<string, string>; colors: Record<string, string> };

const theme: ThemeFile = await Bun.file(THEME_FILE).json();

function themeHex(color: string): string {
	const value = theme.colors[color];
	if (value === undefined) fail(`theme color ${color} is missing in ${THEME_FILE}`);
	return theme.vars[value] ?? value;
}

function sgr(hex: string, plane: 38 | 48, text: string): string {
	const value = Number.parseInt(hex.slice(1), 16);
	return `\x1b[${plane};2;${(value >> 16) & 255};${(value >> 8) & 255};${value & 255}m${text}\x1b[0m`;
}

const caveman = { fg: (color: string, text: string) => sgr(themeHex(color), 38, text) };

// Mirrors resolveThemePalette in packages/shared-display/src/index.ts, which is not exported.
const THEME_SEGMENT_COLORS = ["statusLineModel", "statusLinePath", "statusLineGitClean", "statusLineContext", "statusLineSpend", "statusLineDirty"];
const catppuccinMochaPalette: ResolvedPalette = (() => {
	const hexes = THEME_SEGMENT_COLORS.map(themeHex);
	const fg = themeHex("statusLineBg");
	return { segments: hexes.map(bg => ({ bg, fg })), text: hexes };
})();

function resolvePalette(name: SharedDisplayPalette): ResolvedPalette | undefined {
	if (name === "none") return undefined;
	return name === "theme" ? catppuccinMochaPalette : FIXED_PALETTES[name];
}

async function buildSnapshots(): Promise<Map<DisplaySource, FrameSequence>> {
	const ponytailConfig = { ...DEFAULT_PONYTAIL_CONFIG, display: { ...DEFAULT_PONYTAIL_CONFIG.display, glyphDirectory: NO_GLYPH_DIRECTORY } };
	const ponytail = renderPonytailFrameSequence(await loadPonytailSequence("full", ponytailConfig), ponytailConfig, true);
	const cavemanSequence = renderCavemanFrameSequence(
		"caveman",
		await loadPackageCavemanSequence("caveman"),
		DEFAULT_CAVEMAN_CONFIG,
		true,
		caveman,
	);
	const headroomGlyph = HEADROOM_GLYPHS.compressed;
	const headroom = renderDisplayFrames(
		"compressed",
		{
			label: "Headroom",
			compressionPercent: 62,
			tokensSaved: 184_300,
			tokensBefore: 297_200,
			tokensAfter: 112_900,
			lastPercent: 58,
			lastSaved: 9_400,
			proxyStatus: "online",
			error: "",
			reason: "",
		},
		DEFAULT_HEADROOM_DISPLAY,
		headroomGlyph,
		{ frames: [[headroomGlyph]] },
	);
	const rtkDisplay = { ...defaultRtkConfig().display, glyphDirectory: NO_GLYPH_DIRECTORY };
	const rtk = renderRtkFrames("active", { commands: 128, tokensInput: 412_000, tokensSaved: 318_000 }, rtkDisplay);
	const beads = renderBeadsSegment("ready", { ready: 3, open: 12, inProgress: 1 }, DEFAULT_BEADS_TEMPLATE);
	const snapshots = new Map<DisplaySource, FrameSequence | null>([
		["ponytail", ponytail],
		["caveman", cavemanSequence],
		["headroom", headroom],
		["rtk", rtk],
		["codegraph", { frames: [["CodeGraph: ready"]] }],
		["beads", { frames: [[beads]] }],
	]);
	return new Map([...snapshots].filter((entry): entry is [DisplaySource, FrameSequence] => entry[1] !== null));
}

type Render = { style: SharedDisplayStyle; palette: SharedDisplayPalette; layout: SharedDisplayLayout };

function renderRows(snapshots: ReadonlyMap<DisplaySource, FrameSequence>, order: readonly DisplaySource[], render: Render): string[] {
	const options = {
		layout: render.layout,
		order,
		horizontalSeparator: DEFAULT_SHARED_DISPLAY_CONFIG.horizontalSeparator,
		verticalGapRows: DEFAULT_SHARED_DISPLAY_CONFIG.verticalGapRows,
		style: render.style,
		palette: resolvePalette(render.palette),
	};
	// composeDisplayRows right-aligns to `width`, so measure the content first and render again at that width.
	const probe = composeDisplayRows(snapshots, { ...options, width: 1000 });
	const width = Math.max(...probe.map(row => visibleWidth(row.trimStart())));
	return composeDisplayRows(snapshots, { ...options, width });
}

const font = resolveFontFile();
const chrome = resolveChrome();
const freeze = Bun.which("freeze");
if (!freeze) fail("freeze is not on PATH. Install it (https://github.com/charmbracelet/freeze) to regenerate README images.");

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
const workDirectory = mkdtempSync(path.join(os.tmpdir(), "readme-images-"));

/**
 * freeze's own PNG path (resvg) ignores --font.file, so freeze writes the SVG with the Nerd Font embedded
 * and Chrome rasterizes it.
 */
function writePng(name: string, rows: readonly string[]): void {
	const input = path.join(workDirectory, `${name}.ansi`);
	const svg = path.join(workDirectory, `${name}.svg`);
	const output = path.join(OUTPUT_DIRECTORY, `${name}.png`);
	const firstCellTop = PADDING.vertical + FREEZE_CELL_INSET * FONT_SIZE;
	const height = Math.ceil(2 * firstCellTop + rows.length * LINE_HEIGHT * FONT_SIZE + 1);
	writeFileSync(input, `${rows.join("\n")}\n`);
	const converted = Bun.spawnSync(
		[
			freeze, input,
			"--language", "ansi",
			"--background", IMAGE_BACKGROUND,
			"--padding", `${PADDING.vertical},${PADDING.horizontal}`,
			"--margin", "0",
			"--window=false",
			"--border.radius", "10",
			"--shadow.blur", "0",
			"--font.size", String(FONT_SIZE),
			"--font.family", "readme-nerd-font",
			"--font.file", font,
			"--line-height", String(LINE_HEIGHT),
			"--output", svg,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	if (converted.exitCode !== 0) fail(`freeze failed for ${name}: ${converted.stderr.toString().trim()}`);
	const root = /<svg width="([\d.]+)" height="([\d.]+)"/u.exec(readFileSync(svg, "utf8"));
	if (!root) fail(`freeze wrote an SVG without dimensions for ${name}`);
	// Chrome leaves a background updater holding inherited pipes open, so its output goes to a file.
	const chromeLog = path.join(workDirectory, `${name}.chrome.log`);
	const rasterized = Bun.spawnSync(
		[
			chrome,
			"--headless=new",
			"--disable-gpu",
			"--hide-scrollbars",
			`--user-data-dir=${path.join(workDirectory, "chrome-profile")}`,
			`--force-device-scale-factor=${DEVICE_SCALE}`,
			`--window-size=${Math.ceil(Number(root[1]))},${height}`,
			"--default-background-color=00000000",
			"--virtual-time-budget=2000",
			`--screenshot=${output}`,
			`file://${svg}`,
		],
		{ stdout: Bun.file(chromeLog), stderr: Bun.file(chromeLog) },
	);
	if (rasterized.exitCode !== 0) fail(`Chrome failed for ${name}: ${readFileSync(chromeLog, "utf8").trim()}`);
	console.log(`wrote ${path.relative(ROOT, output)}`);
}

try {
	const snapshots = await buildSnapshots();
	const order = DEFAULT_SHARED_DISPLAY_CONFIG.order;

	for (const style of SHARED_DISPLAY_STYLES) {
		writePng(`shared-display-style-${style}`, renderRows(snapshots, order, { style, palette: "catppuccin", layout: "horizontal" }));
	}
	for (const palette of SHARED_DISPLAY_PALETTES) {
		writePng(`shared-display-palette-${palette}`, renderRows(snapshots, order, { style: "powerline", palette, layout: "horizontal" }));
	}
	for (const layout of ["horizontal", "vertical"] as const) {
		writePng(`shared-display-layout-${layout}`, renderRows(snapshots, order, { style: "powerline", palette: "catppuccin", layout }));
	}

	const indicator = (source: DisplaySource, sequence: FrameSequence | null): string[] =>
		sequence === null ? [] : renderRows(new Map([[source, sequence]]), [source], { style: "plain", palette: "none", layout: "horizontal" });

	const cavemanRows: string[] = [];
	for (const mode of CAVEMAN_ACTIVE_MODES) {
		const asset = await loadPackageCavemanSequence(mode);
		cavemanRows.push(...indicator("caveman", renderCavemanFrameSequence(mode, asset, DEFAULT_CAVEMAN_CONFIG, true, caveman)));
	}
	writePng("caveman", cavemanRows);

	const ponytailConfig = { ...DEFAULT_PONYTAIL_CONFIG, display: { ...DEFAULT_PONYTAIL_CONFIG.display, glyphDirectory: NO_GLYPH_DIRECTORY } };
	const ponytailRows: string[] = [];
	for (const mode of PONYTAIL_MODES) {
		const asset = await loadPonytailSequence(mode, ponytailConfig);
		ponytailRows.push(...indicator("ponytail", renderPonytailFrameSequence(asset, ponytailConfig, mode !== "off")));
	}
	writePng("ponytail", ponytailRows);
} finally {
	rmSync(workDirectory, { recursive: true, force: true });
}
