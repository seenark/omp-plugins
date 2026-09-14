import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { Theme } from "@oh-my-pi/pi-coding-agent";
import {
	parseFrameSequenceAsset,
	type BlockFrame,
	type FrameSequence,
} from "@codesook/omp-shared-display/client";
import {
	CAVEMAN_ACTIVE_LEVELS,
	PACKAGE_ASSET_DIRECTORY,
	expandHomePath,
	type CavemanActiveLevel,
	type CavemanConfig,
} from "./types.ts";

export const CAVEMAN_LABELS: Readonly<Record<CavemanActiveLevel, string>> = {
	lite: "LITE",
	full: "FULL",
	ultra: "ULTRA",
	"wenyan-lite": "文言",
	"wenyan-full": "文言文",
	"wenyan-ultra": "文言文極",
};

export const CAVEMAN_ASSET_FPS: Readonly<Record<CavemanActiveLevel, number>> = {
	lite: 1000 / 300,
	full: 5,
	ultra: 10,
	"wenyan-lite": 1000 / 300,
	"wenyan-full": 5,
	"wenyan-ultra": 10,
};

export type CavemanThemeLike = Pick<Theme, "fg">;

const packageSequenceCache = new Map<string, Promise<FrameSequence>>();

function cloneSequence(sequence: FrameSequence): FrameSequence {
	return {
		frames: sequence.frames.map(frame => [...frame]),
		...(sequence.fps === undefined ? {} : { fps: sequence.fps }),
	};
}

function accent(theme: CavemanThemeLike | undefined, text: string): string {
	if (!theme?.fg) return text;
	try {
		const value = theme.fg("accent", text);
		return typeof value === "string" ? value : text;
	} catch {
		return text;
	}
}

function normalizeRenderedText(text: string): string {
	return text.replace(/\r\n?/g, "\n");
}

export function cavemanLabel(level: CavemanActiveLevel): string {
	return CAVEMAN_LABELS[level];
}

export function replaceCavemanTemplate(
	template: string,
	values: { activity: string; glyph: string; level: string },
): string {
	return template.replace(/\{(activity|glyph|level)\}/g, (_match, key: keyof typeof values) => values[key]);
}

export async function loadPackageCavemanSequence(
	level: CavemanActiveLevel,
	packageAssetDirectory = PACKAGE_ASSET_DIRECTORY,
): Promise<FrameSequence> {
	const assetPath = path.join(packageAssetDirectory, `${level}.txt`);
	let cached = packageSequenceCache.get(assetPath);
	if (!cached) {
		cached = readFile(assetPath, "utf8").then(text => {
			const sequence = parseFrameSequenceAsset(text);
			if (!sequence) throw new Error(`Invalid packaged Caveman asset: ${assetPath}`);
			return cloneSequence(sequence);
		});
		packageSequenceCache.set(assetPath, cached);
	}
	return cloneSequence(await cached);
}

export async function loadCavemanSequence(
	level: CavemanActiveLevel,
	config: CavemanConfig,
	options: { homeDirectory?: string; packageAssetDirectory?: string } = {},
): Promise<FrameSequence> {
	const packageAsset = await loadPackageCavemanSequence(level, options.packageAssetDirectory);
	const userPath = path.join(expandHomePath(config.display.glyphDirectory, options.homeDirectory), `${level}.txt`);
	try {
		const userText = await readFile(userPath, "utf8");
		const userAsset = parseFrameSequenceAsset(userText);
		if (userAsset) return cloneSequence(userAsset);
	} catch {
		// Missing and unreadable user files use packaged defaults.
	}
	return packageAsset;
}

export function renderCavemanFrameSequence(
	level: CavemanActiveLevel,
	asset: FrameSequence,
	config: CavemanConfig,
	active: boolean,
	theme?: CavemanThemeLike,
): FrameSequence | null {
	if (!config.display.visible) return null;
	const renderedFrames: BlockFrame[] = [];
	for (const frame of asset.frames) {
		const rows = frame.map(row => accent(theme, row));
		const glyph = rows.join("\n");
		const rendered = normalizeRenderedText(
			replaceCavemanTemplate(config.display.template, {
				activity: active ? "●" : "○",
				glyph,
				level: cavemanLabel(level),
			}),
		);
		renderedFrames.push(rendered.split("\n"));
	}
	if (renderedFrames.length === 0) return null;
	return {
		frames: renderedFrames,
		...(typeof asset.fps === "number" ? { fps: asset.fps } : {}),
	};
}

export function renderNativeCavemanStatus(
	level: CavemanActiveLevel,
	asset: FrameSequence,
	fallbackGlyph: string,
	config: CavemanConfig,
	active: boolean,
	theme?: CavemanThemeLike,
): string | undefined {
	if (!config.nativeVisible) return undefined;
	const firstRow = asset.frames[0]?.[0];
	const glyph = typeof firstRow === "string" && firstRow.length > 0 ? firstRow : fallbackGlyph;
	return normalizeRenderedText(
		replaceCavemanTemplate(config.display.template, {
			activity: active ? "●" : "○",
			glyph: accent(theme, glyph),
			level: cavemanLabel(level),
		}),
	).replace(/[\r\n]+/g, " ");
}

export async function loadAllPackageCavemanSequences(
	packageAssetDirectory = PACKAGE_ASSET_DIRECTORY,
): Promise<ReadonlyMap<CavemanActiveLevel, FrameSequence>> {
	const entries = await Promise.all(
		CAVEMAN_ACTIVE_LEVELS.map(async level => [level, await loadPackageCavemanSequence(level, packageAssetDirectory)] as const),
	);
	return new Map(entries);
}
