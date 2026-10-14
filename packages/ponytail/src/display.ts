import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { parseFrameSequenceAsset, type FrameSequence } from "@codesook/omp-shared-display/client";
import { PACKAGE_ASSET_DIRECTORY, expandHomePath, type PonytailConfig, type PonytailMode } from "./types.ts";

export const PONYTAIL_MODE_ICONS: Readonly<Record<PonytailMode, string>> = {
	off: "",
	lite: "🌿 ",
	full: "⚡ ",
	ultra: "🔥 ",
	review: "",
};

const FALLBACK_SEQUENCE: FrameSequence = { frames: [["🐴"]] };

async function readSequence(filePath: string): Promise<FrameSequence | undefined> {
	try {
		return parseFrameSequenceAsset(await readFile(filePath, "utf8"));
	} catch {
		return undefined;
	}
}

/** A user file `<mode>.txt` in `display.glyphDirectory` wins when the Shared Display parser accepts it; else the packaged asset; else one horse. */
export async function loadPonytailSequence(
	mode: PonytailMode,
	config: PonytailConfig,
	options: { homeDirectory?: string; packageAssetDirectory?: string } = {},
): Promise<FrameSequence> {
	const user = await readSequence(
		path.join(expandHomePath(config.display.glyphDirectory, options.homeDirectory), `${mode}.txt`),
	);
	if (user) return user;
	return (await readSequence(path.join(options.packageAssetDirectory ?? PACKAGE_ASSET_DIRECTORY, `${mode}.txt`))) ?? FALLBACK_SEQUENCE;
}

/** Placeholders: `{activity}` ●/○, `{glyph}` current frame, `{mode}` upper-cased mode, `{modeIcon}` the mode's icon. */
export function renderPonytailTemplate(
	template: string,
	values: { activity: string; glyph: string; mode: string; modeIcon: string },
): string {
	return template
		.replace(/\{(activity|glyph|mode|modeIcon)\}/g, (_match, key: keyof typeof values) => values[key])
		.replace(/\r\n?/g, "\n");
}

function templateValues(mode: PonytailMode, glyph: string, active: boolean) {
	return { activity: active ? "●" : "○", glyph, mode: mode.toUpperCase(), modeIcon: PONYTAIL_MODE_ICONS[mode] };
}

export function renderPonytailFrameSequence(
	mode: PonytailMode,
	asset: FrameSequence,
	config: PonytailConfig,
	active: boolean,
): FrameSequence | null {
	if (!config.display.visible) return null;
	const frames = asset.frames
		.map(frame => renderPonytailTemplate(config.display.template, templateValues(mode, frame.join("\n"), active)).split("\n"))
		.filter(frame => frame.length > 0);
	if (frames.length === 0) return null;
	return asset.fps === undefined ? { frames } : { frames, fps: asset.fps };
}

/** Static footer text from frame zero's first row, so it never carries CR/LF. */
export function renderNativePonytailStatus(
	mode: PonytailMode,
	asset: FrameSequence,
	config: PonytailConfig,
	active: boolean,
): string | undefined {
	if (!config.nativeVisible) return undefined;
	const glyph = asset.frames[0]?.[0] || FALLBACK_SEQUENCE.frames[0]![0]!;
	return renderPonytailTemplate(config.display.template, templateValues(mode, glyph, active)).replace(/[\r\n]+/g, " ");
}
